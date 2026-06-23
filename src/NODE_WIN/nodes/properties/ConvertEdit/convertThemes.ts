// src/NODE_WIN/nodes/properties/ConvertEdit/convertThemes.ts
//
// «Темы» модалки convertSettings. Тема — декларативное описание того, ЧТО показывает
// редактор convert: показывать ли превью-канвас, какие секции/фильтры доступны.
// Тяжёлая индивидуальная логика остаётся в одном движке (ConvertModal/ConvertPanel),
// а тема лишь конфигурирует её под конкретный плагин. Тема выбирается в pluginBuilder
// строкой controlProps.theme; нет темы → 'full' (текущее поведение).

import { VideoFilterType, AudioFilterType, ImageFilterType } from './types';

export interface ConvertTheme {
	id: string;
	label: string;
	/** Показывать ли левую область превью-канваса (ConvertPreview). */
	showCanvas: boolean;
	/** Доступные секции. undefined = определяются по outputExtension (как сейчас). */
	sections?: Array<'image' | 'video' | 'audio'>;
	/** Whitelist фильтров. undefined = все (текущее поведение). [] = ни одного. */
	allowedVideoFilters?: VideoFilterType[];
	allowedAudioFilters?: AudioFilterType[];
	allowedImageFilters?: ImageFilterType[];
}

// Полная тема — повторяет нынешнее поведение convert_v2 (всё видно, канвас включён).
export const CONVERT_THEME_FULL: ConvertTheme = {
	id: 'full',
	label: 'Full — все настройки + превью',
	showCanvas: true,
};

// Тема «только кодирование» — без превью-канваса и без фильтров: контейнер/кодек/качество.
export const CONVERT_THEME_ENCODE_ONLY: ConvertTheme = {
	id: 'encode-only',
	label: 'Encode only — кодек/качество, без превью',
	showCanvas: false,
	sections: ['video', 'audio'],
	allowedVideoFilters: [],
	allowedAudioFilters: [],
};

export const CONVERT_THEMES: ConvertTheme[] = [CONVERT_THEME_FULL, CONVERT_THEME_ENCODE_ONLY];

/** Резолвит тему по id из ui.json. Неизвестный/пустой id → 'full'. */
export function getConvertTheme(id?: string): ConvertTheme {
	if (!id) return CONVERT_THEME_FULL;
	return CONVERT_THEMES.find((t) => t.id === id) ?? CONVERT_THEME_FULL;
}
