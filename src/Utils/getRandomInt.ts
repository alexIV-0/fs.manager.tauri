export function getRandomInt(min: number, max?: number) {
	if (typeof max == 'undefined') {
		max = min;
		min = 0;
	}
	if (max < min) {
		var temp = max;
		max = min;
		min = temp;
	}
	if (min === max) {
		return min;
	}
	var randNum = Math.floor(Math.random() * (max - min + 1)) + min;
	return randNum;
}
