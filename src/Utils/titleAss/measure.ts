// measure.ts — измеряет текст ТЕМ ЖЕ способом, что и превью в панели титров.
//
// Зачем: раньше плагин ломал строки по оценке «ширина символа ≈ 0.55 × кегль»
// (calcMaxChars), а превью в панели меряло реальным `ctx.measureText` реальным
// шрифтом. Отсюда расхождение, которое видно сильнее всего: в панели фраза
// влезала в две строки, в рендере рвалась на три (или наоборот), а вместе с
// числом строк уезжала и вся вертикальная геометрия блока.
//
// Плагин исполняется в WebView, значит канвас и FontFace ему доступны — меряем
// тем же движком, что и панель. Файл шрифта отдаёт asset-протокол (тот же
// fs.toFetchUrl, что и в fontFamily.ts).
//
// Метрики строки (ascent/descent) берём из fontBoundingBox*, а не из
// actualBoundingBox*: первое — ascender/descender самого шрифта, то есть ровно
// та «строчная коробка», по которой libass ставит строку тегом \an7 (проверено
// рендером). actualBoundingBox — чернильные границы КОНКРЕТНЫХ букв, они пляшут
// от текста и с libass не сходятся.

/** Локальный путь → URL, который умеет читать fetch (asset-протокол Tauri).
 *  Параметром, а не импортом: файл общий для приложения и плагина, а способ
 *  получить URL у них свой (`convertFileSrc` против `ctx.fs.toFetchUrl`). */
export type ToAssetUrl = (path: string) => string;

export interface Measurer {
	/** Ширина строки в px при заданном кегле. */
	width(text: string): number;
	/** Подъём над базовой линией (px) — верх строчной коробки. */
	ascent: number;
	/** Спуск под базовую линию (px). */
	descent: number;
	/** false — шрифт измерить не удалось, метрики оценочные. */
	exact: boolean;
	/** Чем всё кончилось — для лога ноды. */
	note: string;
}

/** Тот же множитель, что в превью (canvasUtils.drawTextBlock): шаг между строками. */
export const LINE_HEIGHT_FACTOR = 1.2;

/** Оценка на случай, когда шрифт не читается: прежнее поведение плагина. */
function fallbackMeasurer(size: number, note: string): Measurer {
	return {
		width: (text: string) => text.length * size * 0.55,
		ascent: size * 0.9,
		descent: size * 0.25,
		exact: false,
		note,
	};
}

let seq = 0;

/**
 * Файл шрифта → под каким CSS-именем он зарегистрирован (и почему, если не вышло).
 *
 * Кэш обязателен: раннер зовёт плагин на КАЖДЫЙ файл пачки, а FontFace из
 * `document.fonts` не выгружается — без кэша прогон сотни видео оставил бы
 * сотню копий одного и того же шрифта в документе.
 */
const registered = new Map<string, { family: string | null; note: string }>();

async function registerFont(fontPath: string, toUrl: ToAssetUrl): Promise<{ family: string | null; note: string }> {
	const cached = registered.get(fontPath);
	if (cached) return cached;

	let result: { family: string | null; note: string };
	// Приватное имя (а не имя из шрифта) — чтобы не переопределить системный шрифт
	// с тем же именем и не поймать чужой кэш: панель регистрирует шрифты под именем
	// файла, и совпадение имён давало бы гонку двух реалмов за одну запись.
	const privateName = `addTitleMeasure${++seq}`;
	try {
		// Байты, а не `url(asset://…)`: загрузку шрифта по URL режет CSP (font-src),
		// и падение было бы молчаливым — мерили бы подставным шрифтом. Тот же
		// asset-протокол через fetch работает (им же читает имена fontFamily.ts).
		const res = await fetch(toUrl(fontPath));
		if (!res.ok) throw new Error(`asset fetch ${res.status} ${res.statusText}`);
		const face = new FontFace(privateName, await res.arrayBuffer());
		await face.load();
		(document as any).fonts.add(face);
		result = { family: privateName, note: `файл шрифта загружен (${fontPath})` };
	} catch (e) {
		// .ttc WebKit не принимает — остаётся имя семейства, его WebView обычно
		// резолвит из системных шрифтов; хуже, но всё ещё точнее оценки по символам.
		result = { family: null, note: `FontFace не загрузился (${e instanceof Error ? e.message : String(e)})` };
	}

	registered.set(fontPath, result);
	return result;
}

/** Регистрирует файл шрифта (однократно) и возвращает измеритель под нужный кегль. */
export async function createMeasurer(
	fontPath: string | null,
	cssFallbackName: string,
	size: number,
	bold: boolean,
	italic: boolean,
	toUrl: ToAssetUrl,
): Promise<Measurer> {
	if (typeof document === 'undefined') return fallbackMeasurer(size, 'нет DOM');

	let family = `"${cssFallbackName}", sans-serif`;
	let note = `шрифт по имени "${cssFallbackName}" (файл не загружен)`;

	if (fontPath) {
		const reg = await registerFont(fontPath, toUrl);
		if (reg.family) {
			family = `"${reg.family}"`;
			note = reg.note;
		} else {
			note = `${reg.note}, меряю по имени "${cssFallbackName}"`;
		}
	}

	const canvas = document.createElement('canvas');
	const ctx = canvas.getContext('2d');
	if (!ctx) return fallbackMeasurer(size, 'канвас недоступен');

	ctx.font = [italic ? 'italic' : '', bold ? 'bold' : '', `${size}px`, family].filter(Boolean).join(' ');

	const probe = ctx.measureText('Hy');
	const ascent = probe.fontBoundingBoxAscent || probe.actualBoundingBoxAscent || size * 0.9;
	const descent = probe.fontBoundingBoxDescent || probe.actualBoundingBoxDescent || size * 0.25;

	return {
		width: (text: string) => ctx.measureText(text).width,
		ascent,
		descent,
		exact: true,
		note,
	};
}
