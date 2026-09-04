import type { EncodeSettings } from '../../src/Utils/ffmpegCaps';

// ─── Animation ───────────────────────────────────────────────────────────────

export type TitleAnimationType = 'none' | 'word_highlight' | 'bg_reveal';
export type HAlign = 'left' | 'center' | 'right';
export type VAlign = 'top' | 'center' | 'bottom';

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
	padding: number; // px around text
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
