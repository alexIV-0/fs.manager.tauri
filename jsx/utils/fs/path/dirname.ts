// ====================================================================
// dirname(path) — каталог пути (всё до последнего сегмента).
// path.dirname('/a/b/c.mov') → '/a/b'   ;  path.dirname('C:\\a\\b') → 'C:\\a'
// ====================================================================
import { validateString, isSep, isWinDeviceRoot, IS_WIN, CHAR_FORWARD_SLASH, CHAR_COLON } from './_core';

export function dirname(path: string): string {
	validateString(path, 'path');
	var len = path.length;
	if (len === 0) {
		return '.';
	}
	var code = path.charCodeAt(0);
	if (len === 1) {
		return isSep(code) ? path : '.';
	}

	var rootEnd = -1;
	var offset = 0;
	// Windows-корень 'C:' / 'C:\'.
	if (IS_WIN && isWinDeviceRoot(code) && path.charCodeAt(1) === CHAR_COLON) {
		rootEnd = len > 2 && isSep(path.charCodeAt(2)) ? 3 : 2;
		offset = rootEnd;
	} else if (isSep(code)) {
		rootEnd = offset = 1;
	}

	var end = -1;
	var matchedSlash = true;
	for (var i = len - 1; i >= offset; --i) {
		if (isSep(path.charCodeAt(i))) {
			if (!matchedSlash) {
				end = i;
				break;
			}
		} else {
			matchedSlash = false;
		}
	}

	if (end === -1) {
		if (rootEnd === -1) {
			return '.';
		}
		return path.slice(0, rootEnd);
	}
	// posix-квирк: '//foo' → '//'
	if (!IS_WIN && rootEnd === 1 && end === 1 && code === CHAR_FORWARD_SLASH) {
		return '//';
	}
	return path.slice(0, end);
}
