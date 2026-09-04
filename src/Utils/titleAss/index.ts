// src/Utils/titleAss/index.ts
//
// Сборка ASS-файла титров — общий движок панели настроек и плагина addTitle.
// Панель гонит через него превью (ffmpeg + libass), плагин — финальный рендер,
// поэтому «что видно» и «что получится» строит один и тот же код.

export * from './types';
export * from './parsers';
export * from './measure';
export * from './fontFamily';
export * from './settingsAdapter';
export * from './buildPhrases';
export * from './buildAss';
