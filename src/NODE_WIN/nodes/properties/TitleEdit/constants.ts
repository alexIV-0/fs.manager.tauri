// src/NODE_WIN/nodes/properties/TitleEdit/constants.ts

export const DEFAULT_MODAL_SIZE = { width: 1100, height: 700 };
export const MIN_MODAL_WIDTH = 600;
export const MIN_MODAL_HEIGHT = 400;

export const DEFAULT_SETTINGS_WIDTH = 280;
export const MIN_SETTINGS_WIDTH = 200;
export const MAX_SETTINGS_WIDTH = 420;

export const DEFAULT_PRESETS_WIDTH = 220;
export const MIN_PRESETS_WIDTH = 160;
export const MAX_PRESETS_WIDTH = 350;

export const CANVAS_FORMATS = {
	landscape: { width: 1920, height: 1080, label: 'Landscape' },
	portrait: { width: 1080, height: 1920, label: 'Portrait' },
	square: { width: 1080, height: 1080, label: 'Square' },
} as const;

export const ANIMATION_TYPES = [
	{ value: 'none', label: 'None' },
	{ value: 'word_highlight', label: 'Word Highlight' },
	{ value: 'word_fade', label: 'Word Fade' },
	{ value: 'bg_reveal', label: 'Background Reveal' },
] as const;

export const H_ALIGN_OPTIONS = [
	{ value: 'left', label: 'Left' },
	{ value: 'center', label: 'Center' },
	{ value: 'right', label: 'Right' },
] as const;

export const V_ALIGN_OPTIONS = [
	{ value: 'top', label: 'Top' },
	{ value: 'middle', label: 'Middle' },
	{ value: 'bottom', label: 'Bottom' },
] as const;

// Форматы шрифтовых файлов которые принимает ffmpeg
export const FONT_EXTENSIONS = ['ttf', 'otf', 'woff', 'woff2', 'ttc', 'fon', 'pfb', 'pfm'] as const;

// Системные папки шрифтов по платформам
export const SYSTEM_FONT_DIRS = {
	darwin: ['/System/Library/Fonts', '/Library/Fonts'],
	win32: ['C:\\Windows\\Fonts'],
} as const;
