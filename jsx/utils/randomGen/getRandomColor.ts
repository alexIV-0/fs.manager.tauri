import { getRandomFloat } from './getRandomFloat';

export function getRandomColor() {
	var red = getRandomFloat(0, 1);
	var green = getRandomFloat(0, 1);
	var blue = getRandomFloat(0, 1);
	return [red, green, blue];
}
