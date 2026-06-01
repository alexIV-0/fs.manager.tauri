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
// без `` ` ``-строк. Импорты/экспорты можно использовать — их esbuild уберёт при
// сборке (всё инлайнится в глобальную область как обычные function/var).
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

/** Собирает один dev entry-файл в jsx/distr/<name>.jsx. */
export async function buildEntry(entryFile) {
	const ext = path.extname(entryFile);
	const baseName = path.basename(entryFile, ext);
	const entryPath = path.join(devDir, entryFile);
	const outFile = path.join(distrDir, `${baseName}.jsx`);

	await fs.mkdir(distrDir, { recursive: true });

	await esbuild.build({
		entryPoints: [entryPath],
		outfile: outFile,

		bundle: true,
		// neutral — никаких node/browser-специфичных подстановок, чистый скрипт
		platform: 'neutral',
		// плоский top-level код без import/export-обёрток (функции попадают в
		// глобальную область — как и ожидает ExtendScript / обвязка ae_commands.rs)
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

	console.log(`   ✅ ${entryFile} → distr/${baseName}.jsx`);
}
