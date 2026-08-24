import { TitleSettings, TitleFormatSettings } from './types';

/**
 * Ключи ФОРМАТОВ, а не все поля настроек. Раньше здесь стоял `keyof TitleSettings`, и
 * это ломалось от любого нового поля рядом с форматами (`encode`): ключ вдруг мог
 * указывать не на `TitleFormatSettings`.
 */
type FormatKey = 'landscape' | 'portrait' | 'square';

export function pickBestFormat(realWidth: number, realHeight: number, settings: TitleSettings): TitleFormatSettings {
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

	return settings[bestKey];
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
			padding: r(formatSettings.position.padding * scale),
		},

		background: {
			...formatSettings.background,
			padding: r(formatSettings.background.padding * scale),
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

export function adaptSettingsToVideo(settings: TitleSettings, realWidth: number, realHeight: number): TitleFormatSettings {
	const best = pickBestFormat(realWidth, realHeight, settings);
	return scaleSettingsToVideo(best, realWidth, realHeight);
}
