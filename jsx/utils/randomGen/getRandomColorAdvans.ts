import { getRandomColor } from './getRandomColor';

// Версия с передачей предыдущего цвета как параметра
export function getRandomColorAdvans(previousColor: any, _diff: any) {
	let newColor;
	let attempts = 0;
	const maxAttempts = 50;

	do {
		newColor = getRandomColor();
		attempts++;

		if (previousColor === null || getColorDifference(newColor, previousColor) >= _diff) {
			break;
		}

		if (attempts >= maxAttempts) {
			break;
		}
	} while (true);

	// Функция для вычисления разницы между цветами
	function getColorDifference(color1: number[] | [any, any, any], color2: [any, any, any]) {
		var [r1, g1, b1] = color1;
		var [r2, g2, b2] = color2;

		var diff = Math.sqrt(Math.pow(r1 - r2, 2) + Math.pow(g1 - g2, 2) + Math.pow(b1 - b2, 2));

		return diff / Math.sqrt(3);
	}

	return newColor;
}
