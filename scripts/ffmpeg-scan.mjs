#!/usr/bin/env node
// ffmpeg-scan — держит src-tauri/ffmpeg_requirements.json честным.
//
// Сканирует plugins-dev/**/*.ts + src-tauri/src/**/*.rs на использование ffmpeg-кодеков
// и фильтров и сверяет с манифестом. Печатает, что используется в коде, но НЕ объявлено в
// манифесте (значит gate это не проверяет — стоит добавить), и что объявлено, но не найдено
// в коде (возможно, устарело).
//
// Запуск: npm run ffmpeg:scan
// Exit 1, если есть «используется, но не в манифесте» — можно повесить в CI.
//
// Извлечение кодеков (-c:v/-c:a + *_CODEC_MAP) — надёжное. Фильтры берутся эвристически из
// строк после -vf/-af/-filter_complex/-lavfi и из *.push(`name=...`) — это помощник, а не
// формальная грамматика; неизбежный шум гасим стоп-листом.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = join(ROOT, 'src-tauri', 'ffmpeg_requirements.json');

// ── Чтение манифеста ────────────────────────────────────────────────────────────
const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
const knownEncoders = new Set([
	...manifest.required.encoders,
	...manifest.optional.encoders,
]);
const knownFilters = new Set(manifest.required.filters);

// Стоп-лист: токены `x=` внутри фильтр-строк, которые НЕ являются именами фильтров
// (это параметры фильтров и опции). Расширяй по мере шума.
const FILTER_PARAM_STOPLIST = new Set([
	'amount', 'scene', 'mix', 'type', 'expand', 'brightness', 'similarity', 'blend',
	'yuv', 'inputs', 'whole_dur', 'fontsdir', 'duration', 'size', 'key', 'file', 'print',
	'start', 'end', 'enable', 'alpha', 'shortest', 'eof_action', 'repeatlast', 'n', 'd',
	'w', 'h', 'x', 'y', 's', 'r', 'fps', 'sample_rate', 'channels', 'force_original_aspect_ratio',
	'color', 'c', 'eval', 'mode', 'radius', 'power', 'threshold', 'fontfile', 'text',
	'fontsize', 'fontcolor', 'box', 'boxcolor', 'pts', 'expr', 'metadata', 'tempo',
]);

// ── Сбор файлов ──────────────────────────────────────────────────────────────────
function walk(dir, exts, acc = []) {
	let entries;
	try {
		entries = readdirSync(dir);
	} catch {
		return acc;
	}
	for (const e of entries) {
		if (e === 'node_modules' || e === 'target' || e === 'distr' || e === '.git') continue;
		const p = join(dir, e);
		const st = statSync(p);
		if (st.isDirectory()) walk(p, exts, acc);
		else if (exts.some((x) => p.endsWith(x))) acc.push(p);
	}
	return acc;
}

const files = [
	...walk(join(ROOT, 'plugins-dev'), ['.ts']),
	...walk(join(ROOT, 'src-tauri', 'src'), ['.rs']),
];

// ── Извлечение использований ──────────────────────────────────────────────────────
const usedEncoders = new Map(); // name -> Set(file)
const usedFilters = new Map();

function add(map, name, file) {
	if (!map.has(name)) map.set(name, new Set());
	map.get(name).add(file.replace(ROOT + '/', ''));
}

// Значения, которые точно НЕ энкодеры (служебные).
const ENCODER_STOPLIST = new Set(['copy', 'null', 'rawvideo', 'pcm', 'auto']);

for (const file of files) {
	const src = readFileSync(file, 'utf8');

	// 1) Кодеки: '-c:v','libx264' / '-c:a','aac' / -vcodec/-acodec
	for (const m of src.matchAll(/['"]-(?:c:v|c:a|vcodec|acodec|codec:v|codec:a)['"]\s*,\s*['"]([a-z0-9_]+)['"]/gi)) {
		const enc = m[1].toLowerCase();
		if (!ENCODER_STOPLIST.has(enc)) add(usedEncoders, enc, file);
	}
	// 2) Значения codec-map (h264:'libx264', prores:'prores_ks', ...)
	for (const m of src.matchAll(/:\s*['"]((?:lib|prores|dnxhd|pcm|hap|flac|aac)[a-z0-9_-]*)['"]/gi)) {
		const enc = m[1].toLowerCase();
		if (!ENCODER_STOPLIST.has(enc)) add(usedEncoders, enc, file);
	}

	// 3) Фильтры: строки после -vf/-af/-filter_complex/-lavfi
	for (const m of src.matchAll(/['"]-(?:vf|af|filter_complex|lavfi)['"]\s*,\s*[`'"]([^`'"]+)[`'"]/gi)) {
		extractFilterHeads(m[1], file);
	}
	// 4) Фильтры, собираемые в массив: filters.push(`chromakey=...`) / filterParts.push / parts.push.
	//    \b обязателен: иначе `eqParts.push('contrast=…')` ловится как фильтр, хотя contrast —
	//    это ПАРАМЕТР фильтра eq, а не фильтр.
	for (const m of src.matchAll(/\b(?:filters|filterParts|parts)\.push\(\s*[`'"]([^`'"]+)[`'"]/gi)) {
		extractFilterHeads(m[1], file);
	}
}

function extractFilterHeads(filterStr, file) {
	// Разбиваем на звенья по , ; и убираем [label]. Голова звена до '=' — имя фильтра.
	const cleaned = filterStr.replace(/\[[^\]]*\]/g, ' ');
	for (const chunk of cleaned.split(/[,;]/)) {
		const head = chunk.trim().split('=')[0].trim();
		// Имя фильтра: буквы/цифры/подчёркивание, начинается с буквы; без ${...} интерполяций.
		if (/^[a-z][a-z0-9_]*$/.test(head) && !FILTER_PARAM_STOPLIST.has(head)) {
			add(usedFilters, head, file);
		}
	}
}

// ── Отчёт ──────────────────────────────────────────────────────────────────────────
function diff(usedMap, knownSet) {
	const missing = []; // used but not in manifest
	for (const [name, fileset] of usedMap) {
		if (!knownSet.has(name)) missing.push({ name, files: [...fileset] });
	}
	const unused = [...knownSet].filter((n) => !usedMap.has(n)); // declared but not seen
	return { missing, unused };
}

const enc = diff(usedEncoders, knownEncoders);
const flt = diff(usedFilters, knownFilters);

const C = { red: '\x1b[31m', yellow: '\x1b[33m', green: '\x1b[32m', dim: '\x1b[2m', reset: '\x1b[0m' };
console.log(`\n🔎 ffmpeg-scan — сверка использования с ${'ffmpeg_requirements.json'}\n`);

function report(label, d) {
	if (d.missing.length === 0) {
		console.log(`${C.green}✓ ${label}: всё используемое объявлено в манифесте${C.reset}`);
	} else {
		console.log(`${C.red}✗ ${label}: используется, но НЕ в манифесте (gate их не проверяет):${C.reset}`);
		for (const m of d.missing) console.log(`    ${C.red}${m.name}${C.reset} ${C.dim}— ${m.files.join(', ')}${C.reset}`);
	}
	if (d.unused.length > 0) {
		console.log(`${C.yellow}  ⓘ объявлено в манифесте, но не найдено в коде (возможно устарело): ${d.unused.join(', ')}${C.reset}`);
	}
}

report('Энкодеры', enc);
report('Фильтры', flt);

const hasProblems = enc.missing.length > 0 || flt.missing.length > 0;
console.log('');
if (hasProblems) {
	console.log(`${C.red}Добавь недостающее в src-tauri/ffmpeg_requirements.json (required — если без этого плагин не работает; optional — иначе).${C.reset}\n`);
	process.exit(1);
}
console.log(`${C.green}Манифест в синхроне с плагинами.${C.reset}\n`);
