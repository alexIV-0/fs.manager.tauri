// Типы анимации
export type TitleAnimationType = 'none' | 'word_highlight' | 'word_fade' | 'bg_reveal';

// Горизонтальное выравнивание
export type HAlign = 'left' | 'center' | 'right';

// Вертикальное выравнивание
export type VAlign = 'top' | 'middle' | 'bottom';

// Формат видео
export type VideoFormat = 'landscape' | 'portrait' | 'square';

// Настройки текста
export interface TitleTextSettings {
	font: string;
	size: number;
	color: string;
	bold: boolean;
	italic: boolean;
	wrapWidth: number; // % от ширины видео (0-100)
	maxLines: number;
	lineSpacing: number; // 👈 добавить (доп. отступ между строками в px)
}

// Настройки позиции
export interface TitlePositionSettings {
	x: number; // % от ширины (0-100)
	y: number; // % от высоты (0-100)
	hAlign: HAlign;
	vAlign: VAlign;
	padding: number; // px в design-пространстве
}

// Настройки фона
export interface TitleBackgroundSettings {
	enabled: boolean;
	color: string;
	opacity: number; // 0-1
	padding: number; // px
	borderRadius: number; // px
}

// Настройки обводки
export interface TitleOutlineSettings {
	enabled: boolean;
	color: string;
	width: number; // px
}

// Настройки тени
export interface TitleShadowSettings {
	enabled: boolean;
	color: string;
	offsetX: number;
	offsetY: number;
	blur: number;
}

// Настройки анимации
export interface TitleAnimationSettings {
	type: TitleAnimationType;
	wordColor: string; // цвет уже произнесённых слов
	highlightColor: string; // цвет текущего слова
	duration: number; // длительность fade (сек)
}

// Настройки одного формата
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

// Полные настройки (все форматы)
export interface TitleSettings {
	landscape: TitleFormatSettings;
	portrait: TitleFormatSettings;
	square: TitleFormatSettings;
}

// Пресет
export interface TitlePresetItem {
	id: string;
	name: string;
	description: string;
	preview: string; // base64 PNG
}

// Шрифт
export interface FontItem {
	name: string; // отображаемое имя (без расширения)
	path: string; // полный путь для ffmpeg fontfile=
}

// Дефолтные настройки для одного формата
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
		lineSpacing: 0, // 👈 добавить
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
		padding: 10,
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

// Дефолтные настройки для всех форматов
export const defaultTitleSettings = (): TitleSettings => ({
	landscape: defaultFormatSettings(1920, 1080),
	portrait: defaultFormatSettings(1080, 1920),
	square: defaultFormatSettings(1080, 1080),
});
