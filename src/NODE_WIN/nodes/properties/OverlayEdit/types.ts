// src/NODE_WIN/nodes/properties/OverlayEdit/types.ts

import type { EncodeSettings } from '@/Utils/ffmpegCaps';

export type VideoFormat = 'landscape' | 'portrait' | 'square';

/** Настройки наложения для одного формата */
export interface OverlayFormatSettings {
	bgWidth: number; // ширина фона (defaultSize[0])
	bgHeight: number; // высота фона (defaultSize[1])
	posX: number; // X-позиция FG слоя (в пикселях дизайн-пространства)
	posY: number; // Y-позиция FG слоя
	scaleW: number; // ширина FG слоя
	scaleH: number; // высота FG слоя
	rotation: number; // угол поворота в градусах (0 = без поворота)
}

/** Полные настройки наложения (все форматы + глобальные параметры) */
export interface OverlaySettings {
	landscape: OverlayFormatSettings;
	portrait: OverlayFormatSettings;
	square: OverlayFormatSettings;
	fgFilePath?: string;
	bgFilePath?: string;
	/** Render-настройки выхода (контейнер/кодек/preset/CRF/pix_fmt/alpha) — попап в шапке ноды. */
	encode?: EncodeSettings;
}

// ── Дефолтные значения ──────────────────────────────────────────────────────

function makeCenteredFG(bgW: number, bgH: number): OverlayFormatSettings {
	const scaleW = Math.round(bgW * 0.6);
	const scaleH = Math.round(bgH * 0.6);
	return {
		bgWidth: bgW,
		bgHeight: bgH,
		posX: Math.round((bgW - scaleW) / 2),
		posY: Math.round((bgH - scaleH) / 2),
		scaleW,
		scaleH,
		rotation: 0,
	};
}

export const defaultOverlaySettings = (): OverlaySettings => ({
	landscape: makeCenteredFG(1920, 1080),
	portrait: makeCenteredFG(1080, 1920),
	square: makeCenteredFG(1080, 1080),
});
