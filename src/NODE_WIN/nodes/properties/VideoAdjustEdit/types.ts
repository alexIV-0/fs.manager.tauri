// src/NODE_WIN/nodes/properties/VideoAdjustEdit/types.ts

import { defaultEncodeSettings, type EncodeSettings } from '@/Utils/ffmpegCaps';

export interface BgAdjustSettings {
	blur: number;       // 0–50 px
	brightness: number; // -1 .. +1  (0 = no change; CSS: 1 + brightness)
	contrast: number;   // 0 .. 3    (1 = no change)
	saturation: number; // 0 .. 3    (1 = no change)
	hFlip: boolean;
}

export interface FgShadowSettings {
	enabled: boolean;
	blur: number;      // 0–60 px (0 = жёсткий край)
	/**
	 * Раздувание прямоугольника тени, px в каждую сторону (0–200).
	 * При blur=0 и нулевом смещении даёт цветную рамку вокруг кадра.
	 */
	spread: number;
	offsetX: number;   // -100..100 px
	offsetY: number;   // -100..100 px
	opacity: number;   // 0..1
	color: string;     // hex, '#000000'
}

export interface VideoAdjustSettings {
	/** Финальный формат кадра [width, height] */
	finalFormat: [number, number];
	/**
	 * Если true — финальный формат определяется автоматически как противоположный:
	 *   горизонтальный FG → 1080×1920, вертикальный → 1920×1080, квадрат → 1080×1920
	 * Если false — используется фиксированный finalFormat заданный вручную
	 */
	autoFormat: boolean;
	/** Использовать FG-файл и как бэкграунд */
	useFgAsBg: boolean;
	/** Цвет заливки BG если нет файла (hex, e.g. '#1a2b3c') */
	bgColor: string;
	fg: {
		copies: number;          // 1–5
		fitPercent: number;      // 0–100: 0 = вписать, 100 = заполнить
		shadow: FgShadowSettings;
	};
	bg: {
		copies: number;          // 1–5
		adjust: BgAdjustSettings;
	};
	fgFilePath?: string;
	bgFilePath?: string;
	/** Render-настройки выхода (контейнер/кодек/preset/CRF/pix_fmt). */
	encode?: EncodeSettings;
}

export function defaultFgShadow(): FgShadowSettings {
	return { enabled: false, blur: 20, spread: 0, offsetX: 10, offsetY: 20, opacity: 0.6, color: '#000000' };
}

export function defaultVideoAdjustSettings(): VideoAdjustSettings {
	return {
		finalFormat: [1080, 1920],
		autoFormat: true,
		useFgAsBg: true,
		bgColor: '#000000',
		fg: { copies: 1, fitPercent: 0, shadow: defaultFgShadow() },
		bg: {
			copies: 1,
			adjust: { blur: 0, brightness: 0, contrast: 1, saturation: 1, hFlip: false },
		},
		encode: defaultEncodeSettings(),
	};
}

/**
 * Возвращает противоположный формат:
 *   горизонтальный (w > h) → 1080×1920
 *   вертикальный (h > w)   → 1920×1080
 *   квадрат (w === h)       → 1080×1920
 */
export function oppositeFormat(vidW: number, vidH: number): [number, number] {
	if (vidH > vidW) return [1920, 1080]; // вертикальный → горизонтальный
	return [1080, 1920];                  // горизонтальный / квадрат → вертикальный
}

/**
 * Строит строку CSS/Canvas filter для BG слоя.
 * Пустая строка = нет фильтра.
 */
export function buildCanvasFilter(adj: BgAdjustSettings): string {
	const parts: string[] = [];
	if (adj.blur > 0) parts.push(`blur(${adj.blur}px)`);
	if (Math.abs(adj.brightness) > 0.001) parts.push(`brightness(${Math.max(0, 1 + adj.brightness).toFixed(3)})`);
	if (Math.abs(adj.contrast - 1) > 0.001) parts.push(`contrast(${adj.contrast.toFixed(3)})`);
	if (Math.abs(adj.saturation - 1) > 0.001) parts.push(`saturate(${adj.saturation.toFixed(3)})`);
	return parts.join(' ');
}
