// ====================================================================
// normalize(path) — свернуть '.', '..' и лишние разделители.
// posix:   '/a/b/../c' → '/a/c'
// Windows: 'C:\\a\\..\\b' → 'C:\\b'
// (UNC-корень '\\server\share' как особый случай НЕ обрабатывается —
//  см. шапку _core: единая реализация без редких win32-кейсов.)
// ====================================================================
import { validateString, isSep, isWinDeviceRoot, normalizeString, IS_WIN, CHAR_FORWARD_SLASH, CHAR_COLON } from './_core';

export function normalize(path: string): string {
	validateString(path, 'path');
	var len = path.length;
	if (len === 0) {
		return '.';
	}

	if (!IS_WIN) {
		var isAbs = path.charCodeAt(0) === CHAR_FORWARD_SLASH;
		var trail = path.charCodeAt(len - 1) === CHAR_FORWARD_SLASH;
		path = normalizeString(path, !isAbs);
		if (path.length === 0) {
			if (isAbs) {
				return '/';
			}
			return trail ? './' : '.';
		}
		if (trail) {
			path += '/';
		}
		return isAbs ? '/' + path : path;
	}

	// Windows
	var rootEnd = 0;
	var device: any;
	var isAbsW = false;
	var code = path.charCodeAt(0);
	if (len === 1) {
		return isSep(code) ? '\\' : path;
	}
	if (isWinDeviceRoot(code) && path.charCodeAt(1) === CHAR_COLON) {
		device = path.slice(0, 2);
		rootEnd = 2;
		if (len > 2 && isSep(path.charCodeAt(2))) {
			isAbsW = true;
			rootEnd = 3;
		}
	} else if (isSep(code)) {
		isAbsW = true;
		rootEnd = 1;
	}

	var tail = rootEnd < len ? normalizeString(path.slice(rootEnd), !isAbsW) : '';
	if (tail.length === 0 && !isAbsW) {
		tail = '.';
	}
	if (tail.length > 0 && isSep(path.charCodeAt(len - 1))) {
		tail += '\\';
	}
	if (device === undefined) {
		return isAbsW ? '\\' + tail : tail;
	}
	return isAbsW ? device + '\\' + tail : device + tail;
}
