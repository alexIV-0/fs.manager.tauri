// fontFamily.ts — читает реальное имя семейства шрифта прямо из файла .ttf/.otf/.ttc.
//
// Зачем: libass матчит шрифт ASS-стиля по ИМЕНИ СЕМЕЙСТВА (OpenType `name` table,
// nameID 16 «Typographic Family» / nameID 1 «Font Family»). А fonts_get_list (Rust)
// отдаёт лишь stem имени файла — напр. "ArialHB" вместо "Arial Hebrew", "Avenir"
// вместо "Avenir Book". При несовпадении libass/coretext молча подменяет шрифт
// дефолтным (проверено: stem "ArialHB" рендерится попиксельно как несуществующий
// шрифт). Поэтому имя семейства достаём сами и пишем именно его в Style.Fontname.
//
// Файл шрифта читаем через asset-протокол (scope = "**" в tauri.conf.json) обычным
// fetch'ем в WebView — без новых Rust-команд.

import { fs } from '../_template/tauri';

const u16 = (dv: DataView, off: number) => dv.getUint16(off, false);
const u32 = (dv: DataView, off: number) => dv.getUint32(off, false);

function decodeName(bytes: Uint8Array, platformId: number): string {
	// Windows(3)/Unicode(0) — UTF-16BE; Mac(1) — однобайтовый (для лат. имён достаточно).
	if (platformId === 3 || platformId === 0) {
		let s = '';
		for (let i = 0; i + 1 < bytes.length; i += 2) s += String.fromCharCode((bytes[i] << 8) | bytes[i + 1]);
		return s;
	}
	let s = '';
	for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
	return s;
}

/** Разбирает одну sfnt-таблицу (по смещению sfntOffset) и возвращает имя семейства. */
function parseSfnt(dv: DataView, bytes: Uint8Array, sfntOffset: number): string | null {
	const numTables = u16(dv, sfntOffset + 4);

	let nameOffset = -1;
	for (let i = 0; i < numTables; i++) {
		const rec = sfntOffset + 12 + i * 16;
		const tag = String.fromCharCode(bytes[rec], bytes[rec + 1], bytes[rec + 2], bytes[rec + 3]);
		if (tag === 'name') {
			nameOffset = u32(dv, rec + 8);
			break;
		}
	}
	if (nameOffset < 0) return null;

	const count = u16(dv, nameOffset + 2);
	const storage = nameOffset + u16(dv, nameOffset + 4);

	// Выбираем лучшего кандидата: nameID 16 (Typographic Family) важнее 1 (Family);
	// англоязычная запись и платформа Windows предпочтительнее (избегаем локализованных имён).
	let best: { name: string; score: number } | null = null;
	for (let i = 0; i < count; i++) {
		const r = nameOffset + 6 + i * 12;
		const platformId = u16(dv, r);
		const languageId = u16(dv, r + 4);
		const nameId = u16(dv, r + 6);
		if (nameId !== 1 && nameId !== 16) continue;

		const len = u16(dv, r + 8);
		const off = u16(dv, r + 10);
		const value = decodeName(bytes.subarray(storage + off, storage + off + len), platformId).trim();
		if (!value) continue;

		const isEnglish =
			(platformId === 3 && languageId === 0x409) || (platformId === 1 && languageId === 0) || platformId === 0;
		const score =
			(nameId === 16 ? 100 : 50) + (platformId === 3 ? 10 : platformId === 0 ? 8 : 5) + (isEnglish ? 20 : 0);

		if (!best || score > best.score) best = { name: value, score };
	}
	return best?.name ?? null;
}

const cache = new Map<string, string | null>();

/** Имя семейства шрифта по пути к файлу, либо null если прочитать не удалось. */
export async function resolveFontFamily(fontPath: string): Promise<string | null> {
	if (cache.has(fontPath)) return cache.get(fontPath)!;

	let family: string | null = null;
	try {
		const buf = await (await fetch(fs.toFetchUrl(fontPath))).arrayBuffer();
		const dv = new DataView(buf);
		const bytes = new Uint8Array(buf);
		// 'ttcf' (0x74746366) — коллекция: берём первый шрифт.
		family = u32(dv, 0) === 0x74746366 ? parseSfnt(dv, bytes, u32(dv, 12)) : parseSfnt(dv, bytes, 0);
	} catch {
		family = null;
	}

	cache.set(fontPath, family);
	return family;
}
