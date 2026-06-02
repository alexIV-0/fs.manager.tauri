import esbuild from 'esbuild';
import path from 'path';
import fs from 'fs/promises';

// ─────────────────────────────────────────────────────────────────────────────
// Общая логика сборки ExtendScript (.jsx) для After Effects.
// Используется и одноразовой сборкой (build-jsx.js), и watch'ем (build-jsx-watch.js).
//
// Пишем разработку в jsx/dev/<name>.ts — можно импортировать из jsx/utils и
// любых других папок внутри jsx/. esbuild инлайнит все импорты в один файл и
// кладёт результат в jsx/distr/<name>.jsx с тем же именем.
//
// ВАЖНО (ограничения ExtendScript):
// ExtendScript — это движок ES3. esbuild НЕ умеет транспилировать ниже es2015,
// поэтому он не превратит arrow-функции / let / const / template-строки в ES3.
// Пишите dev-код в ES3-стиле: var, обычные function(), без `=>`, без `let/const`,
// без `` ` ``-строк. TS-типы (`: any`, `: string`) писать МОЖНО — esbuild их снимает.
//
// КОНТРАКТ entry-файла (jsx/dev/<name>.ts):
//   import { ... } from '../utils/...';   // утилиты можно экспортировать как угодно
//
//   export function myFn() {              // ровно ОДНА exported-функция, имя любое
//     var inObj = {};                     // объяви ВНУТРИ — плагин подставит сюда аргументы
//     // ... твой ES3-код, читаешь данные из inObj.*
//     return [outPath];
//   }
//
// На сборке esbuild инлайнит утилиты (их export снимает сам), а пост-процесс
// finalizeForAE: снимает `export` с твоей entry-функции и дописывает её вызов с
// маркером `/* @AE_ENTRY */`. По этому маркеру Rust-команда run_script_in_ae
// (src-tauri/src/commands/ae_commands.rs) находит вызов и в момент обработки
// оборачивает его в lock/result-обвязку, а `var inObj = {}` заменяет на аргументы.
// Готовый distr/<name>.jsx — валидный ES3, его можно гонять в AE и руками.
// ─────────────────────────────────────────────────────────────────────────────

export const root = process.cwd();
export const devDir = path.join(root, 'jsx', 'dev');
export const distrDir = path.join(root, 'jsx', 'distr');

export const SUPPORTED_EXT = ['.ts', '.js', '.tsx', '.jsx'];

/** entry-файл считается «своим» для сборки, если он не начинается с _ и имеет нужное расширение */
function isEntryFile(name) {
	return !name.startsWith('_') && SUPPORTED_EXT.includes(path.extname(name));
}

/** Список всех dev entry-файлов (имена с расширением, без вложенных папок и _-файлов) */
export async function listEntries() {
	let entries;
	try {
		entries = await fs.readdir(devDir, { withFileTypes: true });
	} catch {
		return [];
	}
	return entries
		.filter((e) => e.isFile())
		.map((e) => e.name)
		.filter(isEntryFile);
}

/** Разрешает аргумент (имя с расширением или без) в реальный файл в jsx/dev. null если не найден. */
export async function resolveEntry(arg) {
	if (SUPPORTED_EXT.includes(path.extname(arg))) {
		return arg;
	}
	for (const ext of SUPPORTED_EXT) {
		const candidate = `${arg}${ext}`;
		try {
			await fs.access(path.join(devDir, candidate));
			return candidate;
		} catch {}
	}
	return null;
}

/** Маркер вызова entry-функции — по нему Rust (ae_commands.rs) находит, что обернуть. */
export const AE_ENTRY_MARKER = '/* @AE_ENTRY */';

/**
 * Пост-обработка бандла esbuild под ExtendScript:
 *  1. снимает хвостовой `export { ... };` (невалиден в ES3) и достаёт имя entry-функции;
 *  2. дописывает её вызов `name();` с маркером AE_ENTRY_MARKER — по нему Rust находит
 *     вызов и оборачивает его в lock/result-обвязку в момент обработки;
 *     если ты сам написал вызов entry-функции последней строкой dev-файла
 *     (напр. `myFn(42)`), он сохраняется ВМЕСТЕ с аргументами — просто помечается маркером;
 *  3. предупреждает, если внутри нет `var inObj = {}` (плагину некуда подставлять аргументы).
 * Бросает, если entry-файл экспортирует не ровно одну функцию.
 */
export function finalizeForAE(code, baseName) {
	const exportRe = /\n?export\s*\{([^}]*)\}\s*;?\s*$/;
	const m = code.match(exportRe);
	if (!m) {
		throw new Error(
			`[jsx ${baseName}] не найден экспорт entry-функции. Объяви ровно одну: ` +
				'`export function myFn() { var inObj = {}; ... }`'
		);
	}

	// `entryFn` или `myEntry as default` → берём локальное имя (то, что слева от ` as `)
	const names = m[1]
		.split(',')
		.map((s) => s.trim().split(/\s+as\s+/)[0].trim())
		.filter(Boolean);

	if (names.length === 0) {
		throw new Error(`[jsx ${baseName}] пустой блок export — нечего вызывать в AE.`);
	}
	if (names.length > 1) {
		throw new Error(
			`[jsx ${baseName}] entry-файл экспортирует несколько имён (${names.join(', ')}). ` +
				'Должна быть ровно одна exported-функция (утилиты экспортируй из jsx/utils/).'
		);
	}

	const entryName = names[0];
	const stripped = code.replace(exportRe, '\n');

	if (!/\bvar\s+inObj\s*=\s*\{\s*\}/.test(stripped)) {
		console.warn(
			`   ⚠️  ${baseName}: внутри нет \`var inObj = {}\` — плагин не сможет подставить ` +
				'аргументы. Объяви `var inObj = {}` (именно var) внутри entry-функции.'
		);
	}

	// 1% случай: ты сам написал вызов entry-функции последней строкой (с аргументами).
	// Сохраняем его как есть, только помечаем маркером. (Аргументы без вложенных скобок и `;`.)
	const trailingCallRe = new RegExp(`(^|[\\n;}])[ \\t]*(${entryName}\\s*\\([^()]*\\))\\s*;?\\s*$`);
	const tc = stripped.match(trailingCallRe);
	if (tc) {
		const head = stripped.slice(0, tc.index + tc[1].length);
		return `${head}\n${AE_ENTRY_MARKER}\n${tc[2]};\n`;
	}

	// 99% случай: вызова нет — дописываем чистый `name();`.
	return `${stripped}\n${AE_ENTRY_MARKER}\n${entryName}();\n`;
}

/** Собирает один dev entry-файл в jsx/distr/<name>.jsx. */
export async function buildEntry(entryFile) {
	const ext = path.extname(entryFile);
	const baseName = path.basename(entryFile, ext);
	const entryPath = path.join(devDir, entryFile);
	const outFile = path.join(distrDir, `${baseName}.jsx`);

	await fs.mkdir(distrDir, { recursive: true });

	const result = await esbuild.build({
		entryPoints: [entryPath],
		// write: false — забираем текст и доводим его finalizeForAE перед записью
		write: false,
		outfile: outFile,

		bundle: true,
		// neutral — никаких node/browser-специфичных подстановок, чистый скрипт
		platform: 'neutral',
		// плоский top-level код; entry-export снимаем сами (см. finalizeForAE),
		// утилитные импорты esbuild инлайнит как обычные function/var
		format: 'esm',
		// es2015 — минимально доступный target esbuild (ниже = ES3 esbuild не умеет)
		target: 'es2015',

		treeShaking: true,
		minify: false,
		// keepNames вставляет arrow-функцию __name + Object.defineProperty — это
		// невалидно для ES3-движка ExtendScript. Имена function-деклараций и так
		// сохраняются без минификации, поэтому keepNames не нужен.
		keepNames: false,
		// .jsx — это ExtendScript, а НЕ React; отключаем JSX-трансформацию
		jsx: 'preserve',
		// без sourcemap — AE их не понимает, а файл идёт прямо в движок
		sourcemap: false,
		legalComments: 'none',
	});

	const finalCode = finalizeForAE(result.outputFiles[0].text, baseName);
	await fs.writeFile(outFile, finalCode, 'utf8');

	console.log(`   ✅ ${entryFile} → distr/${baseName}.jsx`);
}
