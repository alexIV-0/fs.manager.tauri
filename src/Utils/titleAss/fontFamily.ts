// fontFamily.ts — читает из файла шрифта (.ttf/.otf/.ttc) то имя, которое libass
// сможет сопоставить, и возвращает его для Style.Fontname.
//
// Зачем вообще: в панели титров шрифт выбирают ФАЙЛОМ, и WebView показывает его
// верно — там FontFace регистрируется под именем файла, байты отдаются напрямую.
// А libass получает только ИМЯ и ищет шрифт сам, по таблице `name` (OpenType):
// nameID 1 «Font Family», 2 «Subfamily», 4 «Full name», 16/17 — типографские
// варианты первых двух. fonts_get_list отдаёт лишь stem файла, и он с этими
// именами обычно не совпадает («ArialHB» → «Arial Hebrew»), а при несовпадении
// libass молча подставляет чужой шрифт.
//
// Почему недостаточно одного имени семейства (так было раньше): у файла-начертания
// семейство общее для всей четвёрки — у «Georgia Bold.ttf» это «Georgia», а
// «Bold» лежит в subfamily. Отдав libass «Georgia», мы получали ОБЫЧНУЮ Georgia
// там, где пользователь выбрал жирную, — то есть шрифт «не применялся». Поэтому
// когда имя файла называет начертание, отдаём полное имя лица («Georgia Bold»):
// проверено рендером, libass его сопоставляет, а если не сопоставит — сам
// откатится к базовому лицу семейства, то есть к прежнему поведению.
//
// Байты читаем через asset-протокол (scope = "**" в tauri.conf.json) обычным
// fetch'ем в WebView — без новых Rust-команд.

import type { ToAssetUrl } from './measure';

// Сервисы приходят параметром из ctx точки входа через границу модуля —
// у файла не остаётся собственного состояния, плагин кэшируется.

const u16 = (dv: DataView, off: number) => dv.getUint16(off, false);
const u32 = (dv: DataView, off: number) => dv.getUint32(off, false);

/** Слова начертания, которые ничего не уточняют: лицо с таким subfamily — базовое. */
const BASE_WORDS = new Set(['regular', 'normal', 'roman', 'book', 'plain', 'standard']);

const norm = (s: string | null) => (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Значимые слова начертания: «Bold Italic» → ['bold','italic'], «Regular» → []. */
const faceTokens = (subfamily: string | null) =>
	(subfamily ?? '')
		.split(/[\s-]+/)
		.map(norm)
		.filter((t) => t && !BASE_WORDS.has(t));

interface Face {
	family: string | null;
	subfamily: string | null;
	fullName: string | null;
}

export interface FontNameInfo {
	/** Значение для Style.Fontname. */
	name: string;
	family: string | null;
	subfamily: string | null;
	/** true — имя называет конкретное начертание, false — семейство. */
	viaFace: boolean;
}

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

/** Разбирает одну sfnt-таблицу (по смещению sfntOffset) и возвращает её имена. */
function parseSfnt(dv: DataView, bytes: Uint8Array, sfntOffset: number): Face | null {
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

	// Одно и то же имя лежит в нескольких записях (разные платформы и языки).
	// Берём лучшую: англоязычная предпочтительнее локализованной, Windows —
	// прочих платформ. Иначе в Fontname уехало бы, например, японское имя.
	const best = new Map<number, { value: string; score: number }>();
	for (let i = 0; i < count; i++) {
		const r = nameOffset + 6 + i * 12;
		const platformId = u16(dv, r);
		const languageId = u16(dv, r + 4);
		const nameId = u16(dv, r + 6);
		if (nameId !== 1 && nameId !== 2 && nameId !== 4 && nameId !== 16 && nameId !== 17) continue;

		const len = u16(dv, r + 8);
		const off = u16(dv, r + 10);
		const value = decodeName(bytes.subarray(storage + off, storage + off + len), platformId).trim();
		if (!value) continue;

		const isEnglish =
			(platformId === 3 && languageId === 0x409) || (platformId === 1 && languageId === 0) || platformId === 0;
		const score = (platformId === 3 ? 10 : platformId === 0 ? 8 : 5) + (isEnglish ? 20 : 0);

		const prev = best.get(nameId);
		if (!prev || score > prev.score) best.set(nameId, { value, score });
	}

	const get = (id: number) => best.get(id)?.value ?? null;
	// Типографские имена (16/17) точнее там, где есть: у коллекции nameID 1
	// первого лица — это семейство именно ЛИЦА («Avenir Book» вместо «Avenir»).
	return { family: get(16) ?? get(1), subfamily: get(17) ?? get(2), fullName: get(4) };
}

/** Все лица файла: у .ttc их несколько, у обычного шрифта одно. */
function parseFaces(dv: DataView, bytes: Uint8Array): Face[] {
	// 'ttcf' (0x74746366) — коллекция: смещения лиц лежат подряд с offset 12.
	if (u32(dv, 0) !== 0x74746366) {
		const one = parseSfnt(dv, bytes, 0);
		return one ? [one] : [];
	}
	const count = u32(dv, 8);
	const faces: Face[] = [];
	for (let i = 0; i < count; i++) {
		const face = parseSfnt(dv, bytes, u32(dv, 12 + i * 4));
		if (face) faces.push(face);
	}
	return faces;
}

/**
 * Выбирает имя для ASS по лицам файла и имени, которым шрифт назван в списке.
 *
 * Лицо берём только если ВСЕ его значимые слова названы в имени файла: файл —
 * это то, что выбрал пользователь, и «Light» в «STHeiti Light.ttc» сказано им.
 * Наоборот, у «Avenir.ttc» двенадцать лиц и ни одного слова в имени файла —
 * там взять произвольное лицо значило бы отрендерить не то, что выбрано, так
 * что отдаём семейство базового лица, как и раньше.
 */
function pickName(faces: Face[], pickedName: string): FontNameInfo | null {
	if (faces.length === 0) return null;
	const picked = norm(pickedName);

	let chosen: Face | null = null;
	let chosenTokens = 0;
	for (const face of faces) {
		const tokens = faceTokens(face.subfamily);
		if (tokens.length === 0) continue;
		if (!tokens.every((t) => picked.includes(t))) continue;
		// Больше совпавших слов — точнее лицо: «Bold Italic» важнее «Bold».
		if (tokens.length > chosenTokens) {
			chosen = face;
			chosenTokens = tokens.length;
		}
	}

	if (chosen) {
		const name = chosen.fullName ?? `${chosen.family ?? ''} ${chosen.subfamily ?? ''}`.trim();
		if (name) return { name, family: chosen.family, subfamily: chosen.subfamily, viaFace: true };
	}

	const base = faces.find((f) => faceTokens(f.subfamily).length === 0) ?? faces[0];
	const name = base.family ?? base.fullName;
	return name ? { name, family: base.family, subfamily: base.subfamily, viaFace: false } : null;
}

const cache = new Map<string, { info: FontNameInfo | null; error: string | null }>();

/**
 * Имя шрифта для Style.Fontname по пути к файлу.
 *
 * @param pickedName имя, под которым шрифт выбран в панели (stem файла).
 * @returns `info` — что писать в ASS; `error` — почему не получилось (для лога:
 *   без него подмена шрифта libass'ом выглядит как «настройка не работает»).
 */
export async function resolveAssFontName(
	fontPath: string,
	pickedName: string,
	toUrl: ToAssetUrl,
): Promise<{ info: FontNameInfo | null; error: string | null }> {
	const cached = cache.get(fontPath);
	if (cached) return cached;

	let result: { info: FontNameInfo | null; error: string | null };
	try {
		const res = await fetch(toUrl(fontPath));
		// Без этой проверки тело ошибки уходило в разбор таблиц и падало там —
		// в логе оставалось «не смог прочитать», а не «asset-протокол ответил 403».
		if (!res.ok) throw new Error(`asset fetch ${res.status} ${res.statusText}`);
		const buf = await res.arrayBuffer();
		const dv = new DataView(buf);
		const faces = parseFaces(dv, new Uint8Array(buf));
		const info = pickName(faces, pickedName);
		result = { info, error: info ? null : 'no usable name records' };
	} catch (e) {
		result = { info: null, error: e instanceof Error ? e.message : String(e) };
	}

	cache.set(fontPath, result);
	return result;
}
