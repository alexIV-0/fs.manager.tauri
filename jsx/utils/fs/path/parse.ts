// ====================================================================
// parse(path) → { root, dir, base, ext, name }
// path.parse('/a/b/clip.mov') → { root:'/', dir:'/a/b', base:'clip.mov', ext:'.mov', name:'clip' }
// (UNC-корень '\\server\share' как особый случай НЕ выделяется — см. _core.)
// ====================================================================
import { ParsedPath, validateString, isSep, isWinDeviceRoot, IS_WIN, CHAR_DOT, CHAR_FORWARD_SLASH, CHAR_COLON } from './_core';

export function parse(path: string): ParsedPath {
	validateString(path, 'path');

	var ret: ParsedPath = { root: '', dir: '', base: '', ext: '', name: '' };
	if (path.length === 0) {
		return ret;
	}

	var len = path.length;
	var code = path.charCodeAt(0);
	var startDot = -1;
	var end = -1;
	var matchedSlash = true;
	var preDotState = 0;
	var i: number;
	var c: number;

	if (!IS_WIN) {
		// posix — точный порт node:path
		var isAbs = code === CHAR_FORWARD_SLASH;
		var start: number;
		if (isAbs) {
			ret.root = '/';
			start = 1;
		} else {
			start = 0;
		}
		var startPartP = 0;
		for (i = len - 1; i >= start; --i) {
			c = path.charCodeAt(i);
			if (c === CHAR_FORWARD_SLASH) {
				if (!matchedSlash) {
					startPartP = i + 1;
					break;
				}
				continue;
			}
			if (end === -1) {
				matchedSlash = false;
				end = i + 1;
			}
			if (c === CHAR_DOT) {
				if (startDot === -1) {
					startDot = i;
				} else if (preDotState !== 1) {
					preDotState = 1;
				}
			} else if (startDot !== -1) {
				preDotState = -1;
			}
		}
		if (end !== -1) {
			var s = startPartP === 0 && isAbs ? 1 : startPartP;
			if (startDot === -1 || preDotState === 0 ||
				(preDotState === 1 && startDot === end - 1 && startDot === startPartP + 1)) {
				ret.base = ret.name = path.slice(s, end);
			} else {
				ret.name = path.slice(s, startDot);
				ret.base = path.slice(s, end);
				ret.ext = path.slice(startDot, end);
			}
		}
		if (startPartP > 0) {
			ret.dir = path.slice(0, startPartP - 1);
		} else if (isAbs) {
			ret.dir = '/';
		}
		return ret;
	}

	// Windows — точный порт node:path (без особого UNC-корня)
	var rootEnd = 0;
	if (len === 1) {
		if (isSep(code)) {
			ret.root = ret.dir = path;
			return ret;
		}
		ret.base = ret.name = path;
		return ret;
	}
	if (isWinDeviceRoot(code) && path.charCodeAt(1) === CHAR_COLON) {
		if (len <= 2) {
			ret.root = ret.dir = path;
			return ret;
		}
		rootEnd = 2;
		if (isSep(path.charCodeAt(2))) {
			if (len === 3) {
				ret.root = ret.dir = path;
				return ret;
			}
			rootEnd = 3;
		}
	} else if (isSep(code)) {
		rootEnd = 1;
	}
	if (rootEnd > 0) {
		ret.root = path.slice(0, rootEnd);
	}

	var startPartW = rootEnd;
	for (i = len - 1; i >= rootEnd; --i) {
		c = path.charCodeAt(i);
		if (isSep(c)) {
			if (!matchedSlash) {
				startPartW = i + 1;
				break;
			}
			continue;
		}
		if (end === -1) {
			matchedSlash = false;
			end = i + 1;
		}
		if (c === CHAR_DOT) {
			if (startDot === -1) {
				startDot = i;
			} else if (preDotState !== 1) {
				preDotState = 1;
			}
		} else if (startDot !== -1) {
			preDotState = -1;
		}
	}
	if (end !== -1) {
		if (startDot === -1 || preDotState === 0 ||
			(preDotState === 1 && startDot === end - 1 && startDot === startPartW + 1)) {
			ret.base = ret.name = path.slice(startPartW, end);
		} else {
			ret.name = path.slice(startPartW, startDot);
			ret.base = path.slice(startPartW, end);
			ret.ext = path.slice(startDot, end);
		}
	}
	if (startPartW > 0 && startPartW !== rootEnd) {
		ret.dir = path.slice(0, startPartW - 1);
	} else {
		ret.dir = ret.root;
	}
	return ret;
}
