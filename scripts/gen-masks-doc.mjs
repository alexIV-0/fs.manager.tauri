#!/usr/bin/env node
// =============================================================================
// Генерация таблицы масок имён ($-переменных) в plugins-dev/_template/ui.md
// из единого источника src/Utils/masks.ts (MASKS).
//
//   node scripts/gen-masks-doc.mjs          — перегенерировать таблицу (запись)
//   node scripts/gen-masks-doc.mjs --check  — только проверить актуальность (CI), не писать
//
// Таблица вставляется между маркерами <!-- MASKS:START --> и <!-- MASKS:END -->.
// Дополнительно сверяет набор масок с Rust-подстановкой (db_analytics.rs apply_vars)
// и предупреждает о расхождении.
// =============================================================================

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import esbuild from 'esbuild';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const MASKS_SRC = join(ROOT, 'src/Utils/masks.ts');
const UI_MD = join(ROOT, 'plugins-dev/_template/ui.md');
const RUST_SRC = join(ROOT, 'src-tauri/src/commands/db_analytics.rs');

const START = '<!-- MASKS:START';
const END = '<!-- MASKS:END -->';

const isCheck = process.argv.includes('--check');

// ── 1. Загружаем MASKS из TS через esbuild (бандл → временный .mjs → import) ──
async function loadMasks() {
	const built = await esbuild.build({
		entryPoints: [MASKS_SRC],
		bundle: true,
		platform: 'node',
		format: 'esm',
		write: false,
		logLevel: 'silent',
	});
	const dir = mkdtempSync(join(tmpdir(), 'masks-'));
	const tmp = join(dir, 'masks.mjs');
	try {
		writeFileSync(tmp, built.outputFiles[0].text);
		const mod = await import(pathToFileURL(tmp).href);
		return mod.MASKS;
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

// ── 2. Строим markdown-таблицу ──────────────────────────────────────────────
const cell = (s) => String(s).replace(/\|/g, '\\|');
// docTokens (человекочитаемая форма) ?? tokens ?? '$key'
const tokensOf = (m) => (m.docTokens ?? m.tokens ?? [`$${m.key}`]).map((t) => `\`${t}\``).join(' / ');

function buildTable(masks) {
	const rows = masks.map((m) => [tokensOf(m), cell(m.desc)]);
	const head = ['Переменная', 'Описание'];
	const w0 = Math.max(head[0].length, ...rows.map((r) => r[0].length));
	const w1 = Math.max(head[1].length, ...rows.map((r) => r[1].length));
	const pad = (s, w) => s + ' '.repeat(w - s.length);
	const line = (a, b) => `| ${pad(a, w0)} | ${pad(b, w1)} |`;
	return [line(head[0], head[1]), `| ${'-'.repeat(w0)} | ${'-'.repeat(w1)} |`, ...rows.map((r) => line(r[0], r[1]))].join(
		'\n',
	);
}

// ── 3. Сверка с Rust apply_vars ─────────────────────────────────────────────
function rustDrift(masks) {
	let rust;
	try {
		rust = readFileSync(RUST_SRC, 'utf8');
	} catch {
		return null; // Rust-файл не найден — пропускаем
	}
	// токены вида .replace("$xxx", ...)
	const rustTokens = new Set([...rust.matchAll(/"\$([a-zA-Z]+)"/g)].map((m) => m[1]));
	const keyed = masks.filter((m) => m.resolve).map((m) => m.key);
	const missingInRust = keyed.filter((k) => !rustTokens.has(k));
	const extraInRust = [...rustTokens].filter((k) => !keyed.includes(k));
	return { missingInRust, extraInRust };
}

// ── main ────────────────────────────────────────────────────────────────────
const masks = await loadMasks();
const table = buildTable(masks);

const md = readFileSync(UI_MD, 'utf8');
const startIdx = md.indexOf(START);
const endIdx = md.indexOf(END);
if (startIdx === -1 || endIdx === -1) {
	console.error(
		`❌ В ${UI_MD} не найдены маркеры.\n   Добавь в файл:\n   <!-- MASKS:START -->\n   <!-- MASKS:END -->`,
	);
	process.exit(1);
}
const startLineEnd = md.indexOf('\n', startIdx) + 1;
const block = `\n${table}\n\n`;
const next = md.slice(0, startLineEnd) + block + md.slice(endIdx);

// Rust drift → предупреждение (не фейлим)
const drift = rustDrift(masks);
if (drift && (drift.missingInRust.length || drift.extraInRust.length)) {
	console.warn('⚠️  Расхождение масок с Rust apply_vars (db_analytics.rs):');
	if (drift.missingInRust.length) console.warn(`   есть в MASKS, нет в Rust: ${drift.missingInRust.join(', ')}`);
	if (drift.extraInRust.length) console.warn(`   есть в Rust, нет в MASKS: ${drift.extraInRust.join(', ')}`);
}

if (isCheck) {
	if (next !== md) {
		console.error('❌ Таблица масок в ui.md устарела. Запусти: npm run masks:docs');
		process.exit(1);
	}
	console.log(`✅ ui.md актуален (${masks.length} масок).`);
} else {
	if (next !== md) {
		writeFileSync(UI_MD, next);
		console.log(`✅ Таблица масок обновлена в ui.md (${masks.length} масок).`);
	} else {
		console.log(`✅ ui.md уже актуален (${masks.length} масок).`);
	}
}
