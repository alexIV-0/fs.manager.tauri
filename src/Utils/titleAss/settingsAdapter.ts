import { TitleSettings, TitleFormatSettings, VAlign } from './types';

/**
 * Ключи ФОРМАТОВ, а не все поля настроек. Раньше здесь стоял `keyof TitleSettings`, и
 * это ломалось от любого нового поля рядом с форматами (`encode`): ключ вдруг мог
 * указывать не на `TitleFormatSettings`.
 */
type FormatKey = 'landscape' | 'portrait' | 'square';

export function pickBestFormatKey(realWidth: number, realHeight: number, settings: TitleSettings): FormatKey {
	const realRatio = realWidth / realHeight;

	const formats: { key: FormatKey; ratio: number }[] = [
		{ key: 'landscape', ratio: settings.landscape.videoWidth / settings.landscape.videoHeight },
		{ key: 'portrait', ratio: settings.portrait.videoWidth / settings.portrait.videoHeight },
		{ key: 'square', ratio: settings.square.videoWidth / settings.square.videoHeight },
	];

	let bestKey: FormatKey = 'landscape';
	let bestDiff = Infinity;

	for (const f of formats) {
		const diff = Math.abs(f.ratio - realRatio);
		if (diff < bestDiff) {
			bestDiff = diff;
			bestKey = f.key;
		}
	}

	return bestKey;
}

/** Единственное место, где чинится разнобой имён: старые пресеты могли нести 'center'. */
function normalizeVAlign(v: unknown): VAlign {
	return v === 'top' ? 'top' : v === 'center' || v === 'middle' ? 'middle' : 'bottom';
}

export function scaleSettingsToVideo(
	formatSettings: TitleFormatSettings,
	realWidth: number,
	realHeight: number,
): TitleFormatSettings {
	const scaleX = realWidth / formatSettings.videoWidth;
	const scaleY = realHeight / formatSettings.videoHeight;
	const scale = Math.min(scaleX, scaleY);

	const r = (v: number) => Math.round(v * 10) / 10;

	return {
		videoWidth: realWidth,
		videoHeight: realHeight,

		text: {
			...formatSettings.text,
			size: r(formatSettings.text.size * scale),
		},

		position: {
			...formatSettings.position,
			vAlign: normalizeVAlign(formatSettings.position.vAlign),
			padding: r(formatSettings.position.padding * scale),
		},

		background: {
			...formatSettings.background,
			paddingX: r(formatSettings.background.paddingX * scale),
			paddingY: r(formatSettings.background.paddingY * scale),
			borderRadius: r(formatSettings.background.borderRadius * scale),
		},

		outline: {
			...formatSettings.outline,
			width: r(formatSettings.outline.width * scale),
		},

		shadow: {
			...formatSettings.shadow,
			offsetX: r(formatSettings.shadow.offsetX * scale),
			offsetY: r(formatSettings.shadow.offsetY * scale),
			blur: r(formatSettings.shadow.blur * scale),
		},

		animation: { ...formatSettings.animation },
	};
}

/** Возвращает и НАСТРОЙКИ, и то, какой формат был выбран, — иначе по логу не
 *  понять, почему титры легли не так, как в открытой вкладке панели. */
export function adaptSettingsToVideo(
	settings: TitleSettings,
	realWidth: number,
	realHeight: number,
): { format: FormatKey; source: TitleFormatSettings; scaled: TitleFormatSettings } {
	const format = pickBestFormatKey(realWidth, realHeight, settings);
	const source = settings[format];
	return { format, source, scaled: scaleSettingsToVideo(source, realWidth, realHeight) };
}
