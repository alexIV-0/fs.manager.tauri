import { isArray } from '../prototips/isArray';
import { getRandomInt } from './getRandomInt';

export function getDurationInSecconds(rand: number | number[], fps: number) {
	var minVal = 0;
	var maxVal = 0;

	if (isArray(rand)) {
		if (rand.length === 1) {
			minVal = 0;
			maxVal = rand[0];
		} else if (rand.length >= 2) {
			minVal = rand[0];
			maxVal = rand[1];
		}
	} else {
		// просто число
		minVal = 0;
		maxVal = rand as number;
	}

	// если вдруг перепутали порядок
	if (maxVal < minVal) {
		var tmp = maxVal;
		maxVal = minVal;
		minVal = tmp;
	}

	// если оба значения равны → вернём фиксированное число
	if (minVal === maxVal) {
		return minVal;
	}

	var minFrame = minVal * fps;
	var maxFrame = maxVal * fps;

	var randNum = getRandomInt(minFrame, maxFrame);
	var sec = randNum / fps;

	return sec;
}
