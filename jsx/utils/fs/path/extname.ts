// ====================================================================
// extname(path) — расширение с точкой.
// path.extname('a/clip.mov') → '.mov'  ;  path.extname('a/clip') → ''
// ====================================================================
import { validateString, isSep, isWinDeviceRoot, IS_WIN, CHAR_DOT, CHAR_COLON } from './_core';

export function extname(path: string): string {
	validateString(path, 'path');
	var start = 0;
	var startDot = -1;
	var startPart = 0;
	var end = -1;
	var matchedSlash = true;
	var preDotState = 0;

	// Windows: пропускаем префикс диска ('C:').
	if (IS_WIN && path.length >= 2 && path.charCodeAt(1) === CHAR_COLON && isWinDeviceRoot(path.charCodeAt(0))) {
		start = startPart = 2;
	}

	for (var i = path.length - 1; i >= start; --i) {
		var code = path.charCodeAt(i);
		if (isSep(code)) {
			if (!matchedSlash) {
				startPart = i + 1;
				break;
			}
			continue;
		}
		if (end === -1) {
			matchedSlash = false;
			end = i + 1;
		}
		if (code === CHAR_DOT) {
			if (startDot === -1) {
				startDot = i;
			} else if (preDotState !== 1) {
				preDotState = 1;
			}
		} else if (startDot !== -1) {
			preDotState = -1;
		}
	}

	if (startDot === -1 || end === -1 || preDotState === 0 || (preDotState === 1 && startDot === end - 1 && startDot === startPart + 1)) {
		return '';
	}
	return path.slice(startDot, end);
}
