// buildAss.ts — переводит настройки панели титров в ASS.
//
// Главное правило файла: то, что нарисовала панель предпросмотра
// (`src/NODE_WIN/nodes/properties/TitleEdit/canvasUtils.ts`), обязано совпасть с
// тем, что нарисует libass. Поэтому геометрия здесь повторяет канвасную один в
// один — те же формулы блока, тот же множитель межстрочного шага, те же метрики
// шрифта, — а не отдаётся на откуп полям стиля ASS.
//
// Что для этого пришлось перестать делать (каждый пункт — ровно тот случай,
// когда «настройка в панели не действует на рендер»):
//
//  • Строка ставится КАЖДАЯ своим `\an7/8/9 + \pos`, а не одним \N-блоком через
//    Alignment. Alignment+MarginV не работают вместе с \pos (поля отступа ASS
//    просто игнорирует), поэтому Position → Padding не действовал вообще, а
//    Text → Line Spacing в ASS не выражается в принципе — только своими \pos.
//    Проверено рендером: `\an7\pos(x,y)` кладёт ВЕРХ строчной коробки (базовая
//    линия минус ascent шрифта) ровно в (x,y).
//
//  • Фон — собственная векторная фигура (`\p1`), а не BorderStyle 3. У опакового
//    бокса ASS цвет берётся из OutlineColour, то есть фон рендерился цветом
//    ОБВОДКИ; padding фона игнорировался (в это поле ASS кладёт толщину рамки),
//    скругления нет, коробка рисуется вокруг каждой строки, и текстовая обводка
//    при этом отключается целиком. Своя фигура снимает все пять ограничений.
//
//  • Тень — отдельный слой-копия текста со смещением, а не поле Shadow. У ASS
//    тень это одно число (сдвиг вправо-вниз), цвет её лежит в BackColour — а
//    туда писался цвет ФОНА, из-за чего Shadow → Color не действовал никогда
//    (переменная с цветом тени вообще никуда не уходила). Копия даёт и знак
//    смещения по каждой оси, и свой цвет, и размытие только на тени (\blur на
//    основном тексте размыл бы и обводку).

import { TitleFormatSettings } from './types';
import { DisplayPhrase } from './buildPhrases';
import { Measurer, LINE_HEIGHT_FACTOR } from './measure';

/** Экранирует путь как значение опции в filtergraph ffmpeg (`ass=PATH:fontsdir=DIR`).
 * Парсер фильтров трактует `:` как разделитель опций, `\` — как escape, `'` — как кавычку;
 * без экранирования ломаются пути с двоеточием (напр. Windows `C:\...`). */
export function escapeFilterPath(p: string): string {
	return p.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'");
}

// ─── Слои ─────────────────────────────────────────────────────────────────────
// Больше Layer — выше. Порядок повторяет канвас: фон → тень → текст → анимация.

const L_BACKGROUND = 0;
const L_SHADOW = 1;
const L_TEXT = 2;
const L_ANIM = 3;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** ms → ASS timestamp H:MM:SS.cc */
function ms2ass(ms: number): string {
	const totalCs = Math.round(ms / 10);
	const cs = totalCs % 100;
	const totalSec = Math.floor(totalCs / 100);
	const sec = totalSec % 60;
	const totalMin = Math.floor(totalSec / 60);
	const min = totalMin % 60;
	const hour = Math.floor(totalMin / 60);
	return `${hour}:${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

/** hex #rrggbb → ASS &HAABBGGRR (BGR order, alpha first) — для полей стиля. */
function hexToASS(hex: string, opacity: number = 1): string {
	const h = hex.replace('#', '').padEnd(6, '0');
	const r = h.slice(0, 2);
	const g = h.slice(2, 4);
	const b = h.slice(4, 6);
	const alpha = Math.round((1 - opacity) * 255)
		.toString(16)
		.padStart(2, '0')
		.toUpperCase();
	return `&H${alpha}${b}${g}${r}`;
}

/** hex #rrggbb → &HBBGGRR& — для inline-тегов \1c \3c \4c. */
function tagColor(hex: string): string {
	const h = hex.replace('#', '').padEnd(6, '0');
	return `&H${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}&`.toUpperCase();
}

/** 0..1 непрозрачности → &HAA& для inline-тегов \1a \3a \4a (00 = непрозрачно). */
function tagAlpha(opacity: number): string {
	const a = Math.round((1 - Math.max(0, Math.min(1, opacity))) * 255);
	return `&H${a.toString(16).padStart(2, '0').toUpperCase()}&`;
}

function escapeAss(text: string): string {
	// Only escape { and } — do NOT escape backslash,
	// because \N (line break) is added after escaping
	return text.replace(/\{/g, '\\{').replace(/\}/g, '\\}');
}

function dialogue(layer: number, fromMs: number, toMs: number, text: string): string {
	return `Dialogue: ${layer},${ms2ass(fromMs)},${ms2ass(toMs)},Default,,0,0,0,,${text}`;
}

const n = (v: number) => Math.round(v * 10) / 10;

// ─── ASS Alignment numpad ─────────────────────────────────────────────────────
// 7 8 9  top-left / top-center / top-right
// 4 5 6  mid-left / mid-center / mid-right
// 1 2 3  bot-left / bot-center / bot-right
//
// Строки позиционируются ПО ВЕРХУ (ряд 7/8/9): вертикаль целиком считает layout(),
// от Alignment нужна только горизонтальная привязка.

function topAlign(hAlign: string): number {
	return hAlign === 'left' ? 7 : hAlign === 'right' ? 9 : 8;
}

// ─── Геометрия блока (зеркало canvasUtils.drawTextBlock) ─────────────────────

interface Layout {
	/** Шаг между верхами соседних строк. */
	lineHeight: number;
	/** Высота строчной коробки (ascent + descent). */
	realLineH: number;
	/** Высота всего блока строк. */
	totalHeight: number;
	/** Y верха первой строки. */
	blockTop: number;
	/** X точки привязки (смысл зависит от hAlign). */
	textX: number;
	/** Y верха i-й строки. */
	lineTop(i: number): number;
}

function layout(s: TitleFormatSettings, m: Measurer, lineCount: number): Layout {
	const lineHeight = s.text.size * LINE_HEIGHT_FACTOR + (s.text.lineSpacing ?? 0);
	const realLineH = m.ascent + m.descent;
	const totalHeight = Math.max(0, lineCount - 1) * lineHeight + realLineH;

	const anchorY = s.videoHeight * (s.position.y / 100);
	const pad = s.position.padding;

	// Padding сдвигает блок от точки привязки — ровно как в превью. Для 'middle'
	// отступа нет: там блок центрируется по точке, отступать не от чего.
	const blockTop =
		s.position.vAlign === 'top'
			? anchorY + pad
			: s.position.vAlign === 'middle'
				? anchorY - totalHeight / 2
				: anchorY - totalHeight - pad;

	return {
		lineHeight,
		realLineH,
		totalHeight,
		blockTop,
		textX: s.videoWidth * (s.position.x / 100),
		lineTop: (i: number) => blockTop + i * lineHeight,
	};
}

/** X левого края строки при текущем выравнивании — для фигур (фон, бокс слова). */
function lineLeft(s: TitleFormatSettings, textX: number, lineWidth: number): number {
	switch (s.position.hAlign) {
		case 'left':
			return textX;
		case 'right':
			return textX - lineWidth;
		default:
			return textX - lineWidth / 2;
	}
}

// ─── Фигуры ───────────────────────────────────────────────────────────────────

/** Прямоугольник (при r > 0 — скруглённый) как путь ASS-drawing от (0,0). */
function rectPath(w: number, h: number, radius: number): string {
	const r = Math.max(0, Math.min(radius, w / 2, h / 2));
	const R = (v: number) => Math.round(v);

	if (r <= 0) return `m 0 0 l ${R(w)} 0 l ${R(w)} ${R(h)} l 0 ${R(h)}`;

	// Канвас скругляет через quadraticCurveTo с углом в качестве контрольной точки;
	// у ASS кривая только кубическая, поэтому переводим: C1 = P0 + ⅔(C−P0), C2 = P1 + ⅔(C−P1).
	const q = (p0: [number, number], c: [number, number], p1: [number, number]) => {
		const c1: [number, number] = [p0[0] + (2 / 3) * (c[0] - p0[0]), p0[1] + (2 / 3) * (c[1] - p0[1])];
		const c2: [number, number] = [p1[0] + (2 / 3) * (c[0] - p1[0]), p1[1] + (2 / 3) * (c[1] - p1[1])];
		return `b ${R(c1[0])} ${R(c1[1])} ${R(c2[0])} ${R(c2[1])} ${R(p1[0])} ${R(p1[1])}`;
	};

	return [
		`m ${R(r)} 0`,
		`l ${R(w - r)} 0`,
		q([w - r, 0], [w, 0], [w, r]),
		`l ${R(w)} ${R(h - r)}`,
		q([w, h - r], [w, h], [w - r, h]),
		`l ${R(r)} ${R(h)}`,
		q([r, h], [0, h], [0, h - r]),
		`l 0 ${R(r)}`,
		q([0, r], [0, 0], [r, 0]),
	].join(' ');
}

/** Залитая фигура: своя ASS-строка, привязанная левым верхним углом к (x, y). */
function shapeDialogue(
	layer: number,
	fromMs: number,
	toMs: number,
	x: number,
	y: number,
	path: string,
	color: string,
	opacity: number,
): string {
	const tags = `{\\an7\\pos(${n(x)},${n(y)})\\bord0\\shad0\\1c${tagColor(color)}\\1a${tagAlpha(opacity)}\\p1}`;
	return dialogue(layer, fromMs, toMs, `${tags}${path}{\\p0}`);
}

// ─── ASS header ───────────────────────────────────────────────────────────────

function buildHeader(s: TitleFormatSettings, fontName: string): string {
	// Тень и фон рисуются своими слоями, стилю остаются только текст и обводка.
	const outline = s.outline.enabled ? n(s.outline.width) : 0;

	const primaryColor = hexToASS(s.text.color);
	const outlineColor = s.outline.enabled ? hexToASS(s.outline.color) : '&H00000000';
	const bold = s.text.bold ? -1 : 0;
	const italic = s.text.italic ? -1 : 0;

	// WrapStyle: 2 — переносы только там, где мы их поставили сами. Иначе libass
	// доламывает длинную строку по-своему, и число строк расходится с превью.
	return `[Script Info]
ScriptType: v4.00+
PlayResX: ${s.videoWidth}
PlayResY: ${s.videoHeight}
ScaledBorderAndShadow: yes
WrapStyle: 2

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${fontName},${Math.round(s.text.size)},${primaryColor},${primaryColor},${outlineColor},&H00000000,${bold},${italic},0,0,100,100,0,0,1,${outline},0,7,0,0,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`;
}

// ─── Строки текста ────────────────────────────────────────────────────────────

/** Одна строка фразы: фон-независимый набор строк ASS (тень + сам текст). */
function lineDialogues(
	s: TitleFormatSettings,
	lay: Layout,
	i: number,
	body: string,
	fromMs: number,
	toMs: number,
	layer: number,
	withShadow: boolean,
): string[] {
	const an = topAlign(s.position.hAlign);
	const x = lay.textX;
	const y = lay.lineTop(i);
	const out: string[] = [];

	if (withShadow && s.shadow.enabled) {
		const sc = tagColor(s.shadow.color);
		const blur = s.shadow.blur > 0 ? `\\blur${n(s.shadow.blur)}` : '';
		// Копия силуэта (заливка + обводка одним цветом) — то же, что даёт
		// ctx.shadow* канвасу, который тенит уже обведённый текст.
		out.push(
			dialogue(
				L_SHADOW,
				fromMs,
				toMs,
				`{\\an${an}\\pos(${n(x + s.shadow.offsetX)},${n(y + s.shadow.offsetY)})\\1c${sc}\\3c${sc}\\1a&H00&\\3a&H00&\\shad0${blur}}${body}`,
			),
		);
	}

	out.push(dialogue(layer, fromMs, toMs, `{\\an${an}\\pos(${n(x)},${n(y)})}${body}`));
	return out;
}

/** Фигура фона под всем блоком строк (одна на фразу — как в превью). */
function backgroundDialogue(s: TitleFormatSettings, lay: Layout, lines: string[], m: Measurer, p: DisplayPhrase): string | null {
	if (!s.background.enabled) return null;

	const padX = s.background.paddingX;
	const padY = s.background.paddingY;
	const maxW = lines.reduce((acc, l) => Math.max(acc, m.width(l)), 0);
	const w = maxW + padX * 2;
	const h = lay.totalHeight + padY * 2;
	const x = lineLeft(s, lay.textX, maxW) - padX;
	const y = lay.blockTop - padY;

	return shapeDialogue(
		L_BACKGROUND,
		p.fromMs,
		p.toMs,
		x,
		y,
		rectPath(w, h, s.background.borderRadius),
		s.background.color,
		s.background.opacity,
	);
}

// ─── Animation: none ──────────────────────────────────────────────────────────

function buildNoneDialogues(phrases: DisplayPhrase[], s: TitleFormatSettings, m: Measurer): string[] {
	const result: string[] = [];

	for (const phrase of phrases) {
		const lay = layout(s, m, phrase.lines.length);

		const bg = backgroundDialogue(s, lay, phrase.lines, m, phrase);
		if (bg) result.push(bg);

		phrase.lines.forEach((line, i) => {
			result.push(...lineDialogues(s, lay, i, escapeAss(line), phrase.fromMs, phrase.toMs, L_TEXT, true));
		});
	}

	return result;
}

// ─── Animation: word highlight ────────────────────────────────────────────────

function buildWordHighlightDialogues(phrases: DisplayPhrase[], s: TitleFormatSettings, m: Measurer): string[] {
	const dimColor = tagColor(s.animation.wordColor);
	const hlColor = tagColor(s.animation.highlightColor);
	const result: string[] = [];

	for (const phrase of phrases) {
		const lay = layout(s, m, phrase.lines.length);

		const bg = backgroundDialogue(s, lay, phrase.lines, m, phrase);
		if (bg) result.push(bg);

		// База: вся фраза приглушённым цветом на весь свой интервал.
		phrase.lines.forEach((line, i) => {
			result.push(
				...lineDialogues(s, lay, i, `{\\1c${dimColor}}${escapeAss(line)}`, phrase.fromMs, phrase.toMs, L_TEXT, true),
			);
		});

		if (!phrase.words?.length) continue;

		// Поверх: та же СТРОКА целиком, но одно слово ярким цветом. Перерисовываем
		// строку, а не слово, — тогда ширина и привязка совпадают с базой сами собой,
		// без вычисления координат отдельного слова.
		for (const w of phrase.words) {
			const lineWords = phrase.words.filter((x) => x.lineIndex === w.lineIndex);
			const body =
				`{\\1c${dimColor}}` +
				lineWords
					.map((lw) => (lw === w ? `{\\1c${hlColor}}${escapeAss(lw.text)}{\\1c${dimColor}}` : escapeAss(lw.text)))
					.join(' ');

			result.push(...lineDialogues(s, lay, w.lineIndex, body, w.fromMs, w.toMs, L_ANIM, false));
		}
	}

	return result;
}

// ─── Animation: background reveal ─────────────────────────────────────────────

function buildBgRevealDialogues(phrases: DisplayPhrase[], s: TitleFormatSettings, m: Measurer): string[] {
	const result: string[] = [];

	for (const phrase of phrases) {
		const lay = layout(s, m, phrase.lines.length);

		const bg = backgroundDialogue(s, lay, phrase.lines, m, phrase);
		if (bg) result.push(bg);

		// Плашки под словами — по измеренной ширине префикса строки, а не по
		// «средней ширине символа»: с пропорциональным шрифтом оценка уезжала
		// тем сильнее, чем длиннее строка.
		if (phrase.words?.length) {
			for (const w of phrase.words) {
				const lineWords = phrase.words.filter((x) => x.lineIndex === w.lineIndex);
				const idx = lineWords.indexOf(w);
				const prefix = lineWords
					.slice(0, idx)
					.map((lw) => lw.text)
					.join(' ');

				const lineText = lineWords.map((lw) => lw.text).join(' ');
				const lineW = m.width(lineText);
				const left = lineLeft(s, lay.textX, lineW);
				const offset = idx === 0 ? 0 : m.width(`${prefix} `);
				const wordW = m.width(w.text);
				const padX = s.background.paddingX;
				const padY = s.background.paddingY;

				result.push(
					shapeDialogue(
						L_SHADOW,
						w.fromMs,
						w.toMs,
						left + offset - padX,
						lay.lineTop(w.lineIndex) - padY,
						rectPath(wordW + padX * 2, lay.realLineH + padY * 2, s.background.borderRadius),
						s.animation.highlightColor,
						1,
					),
				);
			}
		} else {
			// Нет слов — одна плашка на всю фразу.
			const maxW = phrase.lines.reduce((acc, l) => Math.max(acc, m.width(l)), 0);
			const padX = s.background.paddingX;
			const padY = s.background.paddingY;
			result.push(
				shapeDialogue(
					L_SHADOW,
					phrase.fromMs,
					phrase.toMs,
					lineLeft(s, lay.textX, maxW) - padX,
					lay.blockTop - padY,
					rectPath(maxW + padX * 2, lay.totalHeight + padY * 2, s.background.borderRadius),
					s.animation.highlightColor,
					1,
				),
			);
		}

		phrase.lines.forEach((line, i) => {
			result.push(...lineDialogues(s, lay, i, escapeAss(line), phrase.fromMs, phrase.toMs, L_TEXT, true));
		});
	}

	return result;
}

// ─── Main entry point ─────────────────────────────────────────────────────────

/**
 * Builds complete ASS file content from ready DisplayPhrases.
 *
 * @param phrases  - output of buildPhrases()
 * @param settings - adapted format settings (already scaled to real video)
 * @param fontName - font family name for ASS Style header
 * @param measurer - измеритель текста тем же шрифтом (см. measure.ts)
 */
export function buildAssFile(
	phrases: DisplayPhrase[],
	settings: TitleFormatSettings,
	fontName: string,
	measurer: Measurer,
): string {
	const header = buildHeader(settings, fontName);

	const animType = settings.animation.type;
	let dialogues: string[];

	switch (animType) {
		case 'word_highlight':
			dialogues = buildWordHighlightDialogues(phrases, settings, measurer);
			break;
		case 'bg_reveal':
			dialogues = buildBgRevealDialogues(phrases, settings, measurer);
			break;
		case 'none':
		default:
			dialogues = buildNoneDialogues(phrases, settings, measurer);
			break;
	}

	return header + '\n' + dialogues.join('\n') + '\n';
}
