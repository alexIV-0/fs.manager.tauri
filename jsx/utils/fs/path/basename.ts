// ====================================================================
// basename(path[, suffix]) — последний сегмент пути.
// path.basename('/a/b/c.mov')        → 'c.mov'
// path.basename('/a/b/c.mov', '.mov')→ 'c'
// ====================================================================
import { validateString, isSep, isWinDeviceRoot, IS_WIN, CHAR_COLON } from './_core';

export function basename(path: string, suffix?: string): string {
	if (suffix !== undefined) {
		validateString(suffix, 'suffix');
	}
	validateString(path, 'path');
	var start = 0;
	var end = -1;
	var matchedSlash = true;
	var i: number;

	// Windows: пропускаем префикс диска ('C:'), чтобы двоеточие не мешало.
	if (IS_WIN && path.length >= 2 && isWinDeviceRoot(path.charCodeAt(0)) && path.charCodeAt(1) === CHAR_COLON) {
		start = 2;
	}

	if (suffix !== undefined && suffix.length > 0 && suffix.length <= path.length) {
		if (suffix === path) {
			return '';
		}
		var extIdx = suffix.length - 1;
		var firstNonSlashEnd = -1;
		for (i = path.length - 1; i >= start; --i) {
			var code = path.charCodeAt(i);
			if (isSep(code)) {
				if (!matchedSlash) {
					start = i + 1;
					break;
				}
			} else {
				if (firstNonSlashEnd === -1) {
					matchedSlash = false;
					firstNonSlashEnd = i + 1;
				}
				if (extIdx >= 0) {
					if (code === suffix.charCodeAt(extIdx)) {
						if (--extIdx === -1) {
							end = i;
						}
					} else {
						extIdx = -1;
						end = firstNonSlashEnd;
					}
				}
			}
		}

		if (start === end) {
			end = firstNonSlashEnd;
		} else if (end === -1) {
			end = path.length;
		}
		return path.slice(start, end);
	}
	for (i = path.length - 1; i >= start; --i) {
		if (isSep(path.charCodeAt(i))) {
			if (!matchedSlash) {
				start = i + 1;
				break;
			}
		} else if (end === -1) {
			matchedSlash = false;
			end = i + 1;
		}
	}

	if (end === -1) {
		return '';
	}
	return path.slice(start, end);
}
