import type { EncodeSettings } from '../ffmpegCaps';

// Настройки титров — ЕДИНСТВЕННОЕ определение на всю программу: по ним панель
// строит превью, а плагин addTitle — финальный ASS. Раньше типы жили в двух
// копиях (панель и плагин), и «middle» против «center» разъехалось именно так.

// ─── Animation ───────────────────────────────────────────────────────────────

// 'word_fade' пока рендерится как 'none' — тип есть в панели, обработчика в buildAss нет.
export type TitleAnimationType = 'none' | 'word_highlight' | 'word_fade' | 'bg_reveal';
export type HAlign = 'left' | 'center' | 'right';
// Значения приходят из панели титров (UI пишет именно 'middle'). Раньше здесь
// стояло 'center', и вертикальное выравнивание «по центру» молча рендерилось
// как «по низу»: строка не совпадала ни с одной веткой и падала в default.
export type VAlign = 'top' | 'middle' | 'bottom';

// ─── Sub-settings ─────────────────────────────────────────────────────────────

export interface TitleTextSettings {
	font: string;
	size: number;
	color: string;
	bold: boolean;
	italic: boolean;
	wrapWidth: number; // % of video width (0-100)
	maxLines: number;
	lineSpacing: number; // px
}

export interface TitlePositionSettings {
	x: number; // % (0=left, 100=right)
	y: number; // % (0=top, 100=bottom)
	hAlign: HAlign;
	vAlign: VAlign;
	padding: number; // px
}

export interface TitleBackgroundSettings {
	enabled: boolean;
	color: string;
	opacity: number; // 0..1
	/** Отступ плашки от текста по горизонтали, px. */
	paddingX: number;
	/** Отступ плашки от текста по вертикали, px. */
	paddingY: number;
	/** Старое общее поле. Осталось только ради ранее сохранённых настроек —
	 *  `normalizeTitleSettings` растаскивает его в paddingX/paddingY. */
	padding?: number;
	borderRadius: number;
}

export interface TitleOutlineSettings {
	enabled: boolean;
	color: string;
	width: number; // px
}

export interface TitleShadowSettings {
	enabled: boolean;
	color: string;
	offsetX: number;
	offsetY: number;
	blur: number;
}

export interface TitleAnimationSettings {
	type: TitleAnimationType;
	wordColor: string; // dim color for word_highlight base
	highlightColor: string; // active word color / bg_reveal box color
	duration: number; // fade duration (for future word_fade)
}

// ─── Per-format settings ──────────────────────────────────────────────────────

export interface TitleFormatSettings {
	videoWidth: number;
	videoHeight: number;
	text: TitleTextSettings;
	position: TitlePositionSettings;
	background: TitleBackgroundSettings;
	outline: TitleOutlineSettings;
	shadow: TitleShadowSettings;
	animation: TitleAnimationSettings;
}

// ─── Full settings (all 3 formats) ───────────────────────────────────────────

export interface TitleSettings {
	landscape: TitleFormatSettings;
	portrait: TitleFormatSettings;
	square: TitleFormatSettings;
	/** Render-настройки выхода: попап «настройки кодирования» в шапке ноды. */
	encode?: EncodeSettings;
}

// ─── Значения по умолчанию ────────────────────────────────────────────────────

/** Формат видео, под который настраиваются титры. */
export type VideoFormat = 'landscape' | 'portrait' | 'square';

export const defaultFormatSettings = (width: number, height: number): TitleFormatSettings => ({
	videoWidth: width,
	videoHeight: height,
	text: {
		font: 'Arial',
		size: 60,
		color: '#ffffff',
		bold: false,
		italic: false,
		wrapWidth: 80,
		maxLines: 2,
		lineSpacing: 0,
	},
	position: {
		x: 50,
		y: 85,
		hAlign: 'center',
		vAlign: 'bottom',
		padding: 20,
	},
	background: {
		enabled: false,
		color: '#000000',
		opacity: 0.5,
		paddingX: 10,
		paddingY: 10,
		borderRadius: 4,
	},
	outline: {
		enabled: true,
		color: '#000000',
		width: 2,
	},
	shadow: {
		enabled: false,
		color: '#000000',
		offsetX: 2,
		offsetY: 2,
		blur: 4,
	},
	animation: {
		type: 'none',
		wordColor: '#aaaaaa',
		highlightColor: '#ffffff',
		duration: 0.2,
	},
});

export const defaultTitleSettings = (): TitleSettings => ({
	landscape: defaultFormatSettings(1920, 1080),
	portrait: defaultFormatSettings(1080, 1920),
	square: defaultFormatSettings(1080, 1080),
});

// ─── Нормализация сохранённых настроек ────────────────────────────────────────

/**
 * Приводит настройки из options.json к текущей форме.
 *
 * Единственное место, где живут все совместимости со старыми записями: и панель,
 * и плагин зовут его сразу после разбора JSON, поэтому дальше по коду можно
 * читать поля как есть, без `??` на каждом шагу.
 */
export function normalizeTitleSettings(raw: TitleSettings): TitleSettings {
	const fmt = (f: TitleFormatSettings): TitleFormatSettings => ({
		...f,
		position: {
			...f.position,
			// В панели вертикальный центр всегда назывался 'middle'; 'center' мог
			// прийти только из старого пресета.
			vAlign: (f.position.vAlign as string) === 'center' ? 'middle' : f.position.vAlign,
		},
		background: {
			...f.background,
			// Раньше отступ плашки был один на обе оси.
			paddingX: f.background.paddingX ?? f.background.padding ?? 10,
			paddingY: f.background.paddingY ?? f.background.padding ?? 10,
		},
	});

	return {
		...raw,
		landscape: fmt(raw.landscape),
		portrait: fmt(raw.portrait),
		square: fmt(raw.square),
	};
}
