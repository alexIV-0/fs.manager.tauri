import path from 'path';
import fs from 'fs/promises';
import { pathToFileURL, fileURLToPath } from 'url';
import { root, distrDir, buildEntry, resolveEntry, AE_ENTRY_MARKER } from './jsx-builder.js';

// ─────────────────────────────────────────────────────────────────────────────
// PLAYGROUND — локальная отладка JSX-скрипта прямо в After Effects.
//
// Идея: продакшн (src-tauri/.../ae_commands.rs::build_script) берёт собранный
// distr/<name>.jsx, заменяет `var inObj = {}` на реальный объект и дописывает
// вызов entry-функции. Здесь мы делаем ТО ЖЕ САМОЕ локально, но:
//   • inObj берём из jsx/_playground/playground.js (ты правишь руками);
//   • вместо lock/result-файлов оборачиваем вызов в try/catch с выводом в
//     консоль ExtendScript Debugger ($.writeln) + alert на ошибке.
// Результат — jsx/_playground/__run.jsx: открываешь его и запускаешь через
// ExtendScript Debugger (выбрав в пикере нужный After Effects), ловит `debugger;`
// и брейкпоинты прямо в AE. (launch.json не нужен — у расширения v1 свой флоу.)
//
// Собирается на `yarn jsx:watch` (вместе с чистым distr) и на `yarn jsx:play`.
// ─────────────────────────────────────────────────────────────────────────────

export const playgroundDir = path.join(root, 'jsx', '_playground');
export const playgroundConfig = path.join(playgroundDir, 'playground.js');
export const playgroundRun = path.join(playgroundDir, '__run.jsx');

/** Шаблон playground.js — пишется, если файла ещё нет (папка в .gitignore). */
const CONFIG_TEMPLATE = `// ─────────────────────────────────────────────────────────────────────────────
// PLAYGROUND-КОНФИГ — локальная отладка JSX в After Effects. Файл локальный (.gitignore).
//
//   1. Запусти \`yarn jsx:watch\` (или разово \`yarn jsx:play\`).
//   2. В \`script\` укажи имя dev-скрипта (файл jsx/dev/<script>.ts, без расширения).
//   3. В \`inObj\` вставь объект параметров. Готовый объект печатается в logwin
//      приложения при реальном запуске плагина: строка "[aeProcess] inObj → ..." —
//      просто скопируй его сюда.
//   4. Открой сгенерированный jsx/_playground/__run.jsx, выбери в пикере
//      ExtendScript Debugger нужный After Effects и запусти файл. \`debugger;\` и
//      брейкпоинты ловятся прямо в After Effects. (launch.json не нужен.)
//   5. Правишь dev-скрипт или этот конфиг → watch пересобирает __run.jsx → F5 снова.
// ─────────────────────────────────────────────────────────────────────────────

// Имя dev-скрипта (файл jsx/dev/<script>.ts), который хочешь гонять.
export const script = 'scaleAvatarByAudio';

// Параметры — подставятся вместо \`var inObj = {}\` внутри скрипта (как в продакшене).
export const inObj = {
	aeImport: {
		video: ['/Users/you/path/to/video.mov'],
	},
	targetPath: '/Users/you/path/to/output',
};
`;

/** Создаёт jsx/_playground/playground.js из шаблона, если его ещё нет. */
export async function ensurePlaygroundConfig() {
	await fs.mkdir(playgroundDir, { recursive: true });
	try {
		await fs.access(playgroundConfig);
	} catch {
		await fs.writeFile(playgroundConfig, CONFIG_TEMPLATE, 'utf8');
		console.log('   🆕 создан jsx/_playground/playground.js — впиши script + inObj');
	}
}

/** Импортирует playground.js со сбросом ESM-кэша (чтобы видеть свежие правки на watch). */
async function loadConfig(bust) {
	const url = `${pathToFileURL(playgroundConfig).href}?t=${bust}`;
	return import(url);
}

/**
 * Подставляет inObj в собранный distr-скрипт и оборачивает вызов entry-функции в
 * try/catch с выводом в консоль ExtendScript Debugger. Зеркалит build_script из
 * src-tauri/src/commands/ae_commands.rs, но без lock/result-файлов.
 */
function injectForDebug(distrCode, inObj) {
	const inObjJson = JSON.stringify(inObj, null, 2);
	// 1. подставляем inObj (первое вхождение `var inObj = {}` — как replacen(..., 1) в Rust)
	const code = distrCode.replace('var inObj = {}', `var inObj = ${inObjJson}`);

	// 2. находим помеченный маркером вызов entry-функции и оборачиваем его
	const markerPos = code.indexOf(AE_ENTRY_MARKER);
	if (markerPos === -1) return code; // нет маркера — гоняем как есть
	const afterMarker = markerPos + AE_ENTRY_MARKER.length;
	const semiPos = code.indexOf(';', afterMarker);
	if (semiPos === -1) return code;
	const callExpr = code.slice(afterMarker, semiPos).trim();

	const wrapper =
		`${AE_ENTRY_MARKER}\n` +
		'try {\n' +
		`    var __res__ = ${callExpr};\n` +
		"    $.writeln('=== PLAYGROUND RESULT ===');\n" +
		'    $.writeln(JSON.stringify(__res__));\n' +
		'} catch (e) {\n' +
		"    $.writeln('=== PLAYGROUND ERROR ===');\n" +
		"    $.writeln(e.toString() + (e.line ? ' (line ' + e.line + ')' : ''));\n" +
		"    alert('Playground error: ' + e.toString());\n" +
		'}';

	return code.slice(0, markerPos) + wrapper + code.slice(semiPos + 1);
}

/** Собирает jsx/_playground/__run.jsx из конфига playground.js. */
export async function buildPlayground(bust = Date.now()) {
	await ensurePlaygroundConfig();

	let cfg;
	try {
		cfg = await loadConfig(bust);
	} catch (e) {
		console.error(`   ❌ playground.js не загрузился: ${e.message}`);
		return;
	}

	const scriptName = cfg.script;
	if (!scriptName) {
		console.warn('   ⚠️  playground.js: не указан `export const script`');
		return;
	}

	// Убеждаемся, что distr-версия скрипта собрана (иначе собираем её сейчас).
	const entryFile = await resolveEntry(scriptName);
	if (!entryFile) {
		console.warn(`   ⚠️  playground: dev-скрипт "${scriptName}" не найден в jsx/dev`);
		return;
	}
	const baseName = path.basename(entryFile, path.extname(entryFile));
	const distrFile = path.join(distrDir, `${baseName}.jsx`);
	try {
		await fs.access(distrFile);
	} catch {
		await buildEntry(entryFile);
	}

	const distrCode = await fs.readFile(distrFile, 'utf8');
	const runCode = injectForDebug(distrCode, cfg.inObj ?? {});

	const header =
		'// ⚠️  АВТО-ГЕНЕРАЦИЯ — не редактируй. Источник: jsx/_playground/playground.js\n' +
		`//     dev-скрипт: ${scriptName}. Пересобирается на yarn jsx:watch / jsx:play.\n\n`;

	await fs.writeFile(playgroundRun, header + runCode, 'utf8');
	console.log(`   ▶️  playground: ${scriptName} → _playground/__run.jsx`);
}

// Прямой запуск: `node jsx/_packScripts/build-playground.js` (yarn jsx:play).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	await ensurePlaygroundConfig();
	await buildPlayground();
	console.log('✅ playground собран');
}
