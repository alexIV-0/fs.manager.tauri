/**
 * Формат описания проекта: палитра, разрешённая разметка, схема санитайза.
 *
 * ⚠️ ЭТО ПОЛОВИНА КОНТРАКТА. Вторая половина — рендер описания на сайте
 * (`innovation-hub`), и он обязан повторить те же имена классов и ту же схему.
 * Правила и обоснование: `ideasAndTest/DESCRIPTION_FORMAT_CONTRACT.md`.
 * Менять что-то здесь = менять контракт, а значит и сайт.
 *
 * Суть договорённости: файл `options/description.md` — это markdown (CommonMark +
 * GFM), а то, чего в markdown нет (цвет, заливка, подчёркивание, выравнивание,
 * красная строка), выражается закрытым списком HTML-тегов с классами. Именно
 * КЛАССАМИ, а не `style`: у сайта дизайн-система на токенах и правило «хардкод
 * hex — ошибка ревью», класс в токен мапится, а код цвета нет. Плюс содержимое
 * `style` санитайзером надёжно не отфильтровать — это разбор CSS.
 */

import { defaultSchema } from 'rehype-sanitize';
// `Options` у rehype-sanitize — это и есть `Schema` из hast-util-sanitize. Тип нужен
// явно: без него литерал выводится как `(string | (string | RegExp)[])[]`, а плагин
// ждёт кортежи `PropertyDefinition`, и unified отказывается принимать схему.
import type { Options as SanitizeSchema } from 'rehype-sanitize';

// ─── Палитра ────────────────────────────────────────────────────────────────

export interface MarkdownHue {
	/** ключ имени класса: `fg-<key>` / `bg-<key>` */
	key: string;
	/** подпись для тултипа в тулбаре */
	label: string;
	/** значение для тёмной темы (наше приложение). Светлые — в контракте §3 */
	color: string;
}

export const MARKDOWN_HUES: MarkdownHue[] = [
	{ key: 'blue', label: 'синий', color: '#89b4fa' },
	{ key: 'green', label: 'зелёный', color: '#a6e3a1' },
	{ key: 'orange', label: 'оранжевый', color: '#fab387' },
	{ key: 'red', label: 'красный', color: '#f38ba8' },
	{ key: 'yellow', label: 'жёлтый', color: '#f9e2af' },
	{ key: 'teal', label: 'бирюзовый', color: '#94e2d5' },
	{ key: 'purple', label: 'фиолетовый', color: '#cba6f7' },
	{ key: 'cyan', label: 'голубой', color: '#74c7ec' },
	{ key: 'pink', label: 'розовый', color: '#e879f9' },
	{ key: 'muted', label: 'серый', color: '#9399b2' },
];

/**
 * Насыщенность. Один цвет — три ступени, суффикс в имени класса.
 *
 * Ступень задаётся ПРОЗРАЧНОСТЬЮ, а не отдельным оттенком, по двум причинам:
 * на тёмном фоне подмешивание фона и есть «менее насыщенный», и это ровно тот
 * приём, которым набирает оттенки дизайн-система сайта («новых цветов не
 * заводим, берём прозрачность от токена», их `UI_TOKENS.md` §2.7). Значит обе
 * стороны получают одинаковый результат из одного имени.
 */
export interface MarkdownTone {
	/** суффикс класса: '' | '-2' | '-3' */
	suffix: string;
	label: string;
	/** множитель для текста и для заливки */
	fg: number;
	bg: number;
}

export const MARKDOWN_TONES: MarkdownTone[] = [
	{ suffix: '', label: 'насыщенный', fg: 1, bg: 0.28 },
	{ suffix: '-2', label: 'средний', fg: 0.7, bg: 0.18 },
	{ suffix: '-3', label: 'мягкий', fg: 0.45, bg: 0.1 },
];

/**
 * Серая шкала — отдельная, от белого до чёрного, без ступеней насыщенности.
 * Нужна как «просто текст потише/поярче», а не как цвет.
 */
export const MARKDOWN_GRAYS: MarkdownHue[] = [
	{ key: 'gray-0', label: 'белый', color: '#ffffff' },
	{ key: 'gray-1', label: 'светло-серый', color: '#d0d3da' },
	{ key: 'gray-2', label: 'серый', color: '#a0a5b0' },
	{ key: 'gray-3', label: 'тёмно-серый', color: '#6e737e' },
	{ key: 'gray-4', label: 'почти чёрный', color: '#3f434c' },
	{ key: 'gray-5', label: 'чёрный', color: '#0e1014' },
];

/** Все имена цветов: 10 оттенков × 3 ступени + 6 серых. */
export const COLOR_KEYS: string[] = [
	...MARKDOWN_HUES.flatMap((h) => MARKDOWN_TONES.map((t) => `${h.key}${t.suffix}`)),
	...MARKDOWN_GRAYS.map((g) => g.key),
];

export const FG_CLASSES = COLOR_KEYS.map((k) => `fg-${k}`);
export const BG_CLASSES = COLOR_KEYS.map((k) => `bg-${k}`);

export type AlignKind = 'left' | 'center' | 'right' | 'justify';
export const ALIGN_CLASSES: string[] = ['align-left', 'align-center', 'align-right', 'align-justify'];

/** hex + альфа восьмизначным hex: работает везде, в отличие от `color-mix`. */
export function withAlpha(color: string, alpha: number): string {
	if (alpha >= 1) return color;
	const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255)
		.toString(16)
		.padStart(2, '0');
	return `${color}${a}`;
}

/** Цвет по ключу класса (`blue`, `blue-2`, `gray-4`) — для превью и палитры. */
export function colorForKey(key: string, kind: 'fg' | 'bg'): string {
	const gray = MARKDOWN_GRAYS.find((g) => g.key === key);
	if (gray) return kind === 'fg' ? gray.color : withAlpha(gray.color, 0.28);

	const tone = [...MARKDOWN_TONES].sort((a, b) => b.suffix.length - a.suffix.length).find((t) => t.suffix && key.endsWith(t.suffix)) ?? MARKDOWN_TONES[0];
	const hueKey = tone.suffix ? key.slice(0, -tone.suffix.length) : key;
	const hue = MARKDOWN_HUES.find((h) => h.key === hueKey);
	if (!hue) return 'inherit';
	return withAlpha(hue.color, kind === 'fg' ? tone.fg : tone.bg);
}

/** Класс → CSS, одним объектом для `sx`: и в превью редактора, и в просмотрщиках. */
export function paletteCss(): Record<string, object> {
	const css: Record<string, object> = {};
	for (const key of COLOR_KEYS) {
		css[`& .fg-${key}`] = { color: colorForKey(key, 'fg') };
		css[`& .bg-${key}`] = {
			backgroundColor: colorForKey(key, 'bg'),
			borderRadius: '3px',
			padding: '0 2px',
		};
	}
	css['& .align-left'] = { textAlign: 'left' };
	css['& .align-center'] = { textAlign: 'center' };
	css['& .align-right'] = { textAlign: 'right' };
	css['& .align-justify'] = { textAlign: 'justify' };
	css['& .indent'] = { textIndent: '2em' };
	return css;
}

// ─── Санитайз ───────────────────────────────────────────────────────────────

/**
 * Допустимые схемы у картинки: обычная ссылка или встроенный base64.
 * `data:` нужен потому, что картинки лежат ВНУТРИ файла описания (контракт §4),
 * но пускать любой `data:` нельзя — отсюда проверка типа.
 */
const IMG_SRC = [/^https?:\/\//, /^data:image\/(png|jpeg|webp|gif);base64,/];

/**
 * Общие атрибуты. Дефолтная (github-совместимая) схема разрешает `width`,
 * `height`, `align`, `color`, `size`, `border` — то есть ровно те жёсткие
 * размеры, из-за которых вёрстка рассыпается на узком экране. Поэтому список
 * задаётся заново, а не расширяется.
 */
const COMMON_ATTRS = [
	'alt',
	'title',
	'colSpan',
	'rowSpan',
	'scope',
	'dir',
	'lang',
	'start',
	'open',
	'checked',
	'disabled',
	'type',
	'ariaLabel',
	'ariaHidden',
	'ariaDescribedBy',
	'ariaLabelledBy',
];

export const descriptionSanitizeSchema: SanitizeSchema = {
	...defaultSchema,
	tagNames: [...(defaultSchema.tagNames ?? []), 'u', 'mark'],
	attributes: {
		...defaultSchema.attributes,
		'*': COMMON_ATTRS,
		// Выравнивание колонок таблицы ставит сам конвейер markdown, не автор.
		th: ['align'],
		td: ['align'],
		span: [['className', ...FG_CLASSES, ...BG_CLASSES]],
		div: [['className', ...ALIGN_CLASSES]],
		p: [['className', 'indent']],
		img: [['src', ...IMG_SRC], 'alt', 'title'],
	},
	protocols: {
		...defaultSchema.protocols,
		src: ['http', 'https', 'data'],
	},
};

// ─── Прочие константы контракта ─────────────────────────────────────────────

/** Имя файла описания внутри `options/` — вбито в контракт с сайтом. */
export const DESCRIPTION_FILE = 'description.md';

/** Мягкий предел размера: дальше предупреждаем автора (контракт §1). */
export const DESCRIPTION_SIZE_WARN = 2 * 1024 * 1024;

/** Картинки при вставке уменьшаются до этого размера по длинной стороне. */
export const IMAGE_MAX_SIDE = 1600;
export const IMAGE_QUALITY = 0.8;
