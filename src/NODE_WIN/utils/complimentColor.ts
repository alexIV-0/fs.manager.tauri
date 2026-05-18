function hexToRgb(hex: string) {
	hex = hex.replace('#', '');

	// Убираем альфа-канал, если он есть (последние 2 символа при длине 8)
	if (hex.length === 8) {
		hex = hex.slice(0, 6);
	}

	if (hex.length === 3) {
		hex = hex
			.split('')
			.map((char) => char + char)
			.join('');
	}

	const bigint = parseInt(hex, 16);
	const r = (bigint >> 16) & 255;
	const g = (bigint >> 8) & 255;
	const b = bigint & 255;
	return [r, g, b];
}

function hslToRgb(h: number, s: number, l: number) {
	s /= 100;
	l /= 100;
	const c = (1 - Math.abs(2 * l - 1)) * s;
	const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
	const m = l - c / 2;
	let r, g, b;
	if (h < 60) [r, g, b] = [c, x, 0];
	else if (h < 120) [r, g, b] = [x, c, 0];
	else if (h < 180) [r, g, b] = [0, c, x];
	else if (h < 240) [r, g, b] = [0, x, c];
	else if (h < 300) [r, g, b] = [x, 0, c];
	else [r, g, b] = [c, 0, x];
	return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

export function complimentColor(bgColor: string, white: string = 'white', black: string = 'black') {
	let rgbValues;
	// Обработка RGB и RGBA
	if (bgColor.startsWith('rgb')) {
		rgbValues = bgColor.match(/\d+/g)?.slice(0, 3).map(Number) || [0, 0, 0];
	}
	// Обработка HSL и HSLA
	else if (bgColor.startsWith('hsl')) {
		const hslValues = bgColor.match(/(\d+|\d+\.\d+)/g)?.map(Number) || [0, 0, 0];
		rgbValues = hslToRgb(hslValues[0], hslValues[1], hslValues[2]);
	}
	// Обработка HEX
	else if (bgColor.startsWith('#')) {
		rgbValues = hexToRgb(bgColor);
	}
	// Обработка названий цветов
	else {
		// Создаем временный элемент для получения RGB значения из названия цвета
		const tempDiv = document.createElement('div');
		tempDiv.style.color = bgColor;
		document.body.appendChild(tempDiv);
		const computedColor = window.getComputedStyle(tempDiv).color;
		document.body.removeChild(tempDiv);
		rgbValues = computedColor.match(/\d+/g)?.slice(0, 3).map(Number) || [0, 0, 0];
	}

	// Вычисляем яркость цвета по формуле
	const brightness = (rgbValues[0] * 299 + rgbValues[1] * 587 + rgbValues[2] * 114) / 1000;

	// Возвращаем черный или белый цвет в зависимости от яркости
	return brightness > 128 ? black : white;
}
