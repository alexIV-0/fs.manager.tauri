// ====================================================================
// isAbsolute(path) — абсолютный ли путь.
// posix: '/x'→true ; Windows: 'C:\\x'→true, '\\x'→true, 'x'→false
// ====================================================================
import { validateString, isSep, isWinDeviceRoot, IS_WIN, CHAR_COLON } from './_core';

export function isAbsolute(path: string): boolean {
	validateString(path, 'path');
	var len = path.length;
	if (len === 0) {
		return false;
	}
	var code = path.charCodeAt(0);
	if (isSep(code)) {
		return true;
	}
	if (IS_WIN) {
		return len > 2 && isWinDeviceRoot(code) && path.charCodeAt(1) === CHAR_COLON && isSep(path.charCodeAt(2));
	}
	return false;
}
