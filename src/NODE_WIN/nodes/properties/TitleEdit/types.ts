// src/NODE_WIN/nodes/properties/TitleEdit/types.ts
//
// Формы настроек живут в ядре (`@/Utils/titleAss`) — там же, где сборка ASS,
// которой пользуются и панель (превью), и плагин addTitle (финальный рендер).
// Здесь остаётся только то, что нужно самой панели.

export type {
	TitleAnimationType,
	HAlign,
	VAlign,
	VideoFormat,
	TitleTextSettings,
	TitlePositionSettings,
	TitleBackgroundSettings,
	TitleOutlineSettings,
	TitleShadowSettings,
	TitleAnimationSettings,
	TitleFormatSettings,
	TitleSettings,
} from '@/Utils/titleAss';

export { defaultFormatSettings, defaultTitleSettings } from '@/Utils/titleAss';

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
