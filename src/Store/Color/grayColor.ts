type ColorType = 'gray' | 'red' | 'blue' | 'green' | 'yellow' | 'purple' | 'cyan' | 'steel';

// Конвертация HSL → rgb() строка
const hslToRgbString = (h: number, s: number, l: number): string => {
	s /= 100;
	l /= 100;
	const c = (1 - Math.abs(2 * l - 1)) * s;
	const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
	const m = l - c / 2;
	let r = 0,
		g = 0,
		b = 0;
	if (h < 60) [r, g, b] = [c, x, 0];
	else if (h < 120) [r, g, b] = [x, c, 0];
	else if (h < 180) [r, g, b] = [0, c, x];
	else if (h < 240) [r, g, b] = [0, x, c];
	else if (h < 300) [r, g, b] = [x, 0, c];
	else [r, g, b] = [c, 0, x];
	return `rgb(${Math.round((r + m) * 255)}, ${Math.round((g + m) * 255)}, ${Math.round((b + m) * 255)})`;
};

/**
 * Базовая функция для генерации цвета.
 *
 * @param value      Яркость/светлота: 10 (тёмный) → 95 (светлый)
 * @param colorType  Тип цвета
 * @param saturation Насыщенность: 0 (серый) → 100 (полная). По умолчанию 100
 */
export const getColor = (value: number, colorType: ColorType, saturation: number = 100): string => {
	if (value < 10) value = 10;
	if (value > 95) value = 95;
	if (saturation < 0) saturation = 0;
	if (saturation > 100) saturation = 100;

	const minVal = 10;
	const maxVal = 95;
	const ratio = (value - minVal) / (maxVal - minVal);

	// Lightness: от 8% (тёмный) до 90% (светлый)
	const lightness = Math.round(8 + (90 - 8) * ratio);

	// Для gray насыщенность всегда 0
	if (colorType === 'gray') {
		return hslToRgbString(0, 0, lightness);
	}

	// Параметры цветов: [hue, базовая насыщенность]
	const colorParams: Record<Exclude<ColorType, 'gray'>, [number, number]> = {
		red: [0, 80],
		blue: [220, 80],
		green: [130, 75],
		yellow: [48, 85],
		purple: [280, 70],
		cyan: [200, 85],
		// steel: hsl(210, 42%, lightness) — стальной синий как в chainner
		steel: [210, 17],
	};

	const [hue, baseSat] = colorParams[colorType];

	// Применяем пользовательскую насыщенность как множитель от базовой
	const finalSat = Math.round(baseSat * (saturation / 100));

	return hslToRgbString(hue, finalSat, lightness);
};

// ─── Хуки ────────────────────────────────────────────────────────────────────

/** Серый. saturation не влияет — серый всегда нейтральный */
export const greyColor = (value: number, saturation: number = 100): string => getColor(value, 'gray', saturation);

export const redColor = (value: number, saturation: number = 100): string => getColor(value, 'red', saturation);
export const blueColor = (value: number, saturation: number = 100): string => getColor(value, 'blue', saturation);
export const greenColor = (value: number, saturation: number = 100): string => getColor(value, 'green', saturation);
export const yellowColor = (value: number, saturation: number = 100): string => getColor(value, 'yellow', saturation);
export const purpleColor = (value: number, saturation: number = 100): string => getColor(value, 'purple', saturation);
export const cyanColor = (value: number, saturation: number = 100): string => getColor(value, 'cyan', saturation);

/** Стальной синий — приглушённый, как в chainner. Например: steelColor(35) ≈ rgb(49, 86, 121) */
export const steelColor = (value: number, saturation: number = 100): string => getColor(value, 'steel', saturation);

// Универсальный хук
export const useColor = (value: number, colorType: ColorType, saturation: number = 100): string =>
	getColor(value, colorType, saturation);

export const defGray = 'rgb(120, 120, 120)';
