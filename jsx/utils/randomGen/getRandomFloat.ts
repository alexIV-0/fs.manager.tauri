export function getRandomFloat(min: number, max?: number) {
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
	var randNum = Math.random() * (max - min) + min;
	return parseFloat(randNum.toString());
}
