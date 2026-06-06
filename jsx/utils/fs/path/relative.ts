// ====================================================================
// relative(from, to) — относительный путь от from к to.
// path.relative('/a/b', '/a/c') → '../c'
// ====================================================================
import { validateString, isSep, IS_WIN, SEP, CHAR_FORWARD_SLASH } from './_core';
import { resolve } from './resolve';

export function relative(from: string, to: string): string {
	validateString(from, 'from');
	validateString(to, 'to');

	if (from === to) {
		return '';
	}

	from = resolve(from);
	to = resolve(to);

	if (from === to) {
		return '';
	}

	if (!IS_WIN) {
		// posix — точный порт node:path
		var fromStart = 1;
		var fromEnd = from.length;
		var fromLen = fromEnd - fromStart;
		var toStart = 1;
		var toLen = to.length - toStart;
		var length = fromLen < toLen ? fromLen : toLen;
		var lastCommonSep = -1;
		var i = 0;
		for (; i < length; i++) {
			var fc = from.charCodeAt(fromStart + i);
			if (fc !== to.charCodeAt(toStart + i)) {
				break;
			} else if (fc === CHAR_FORWARD_SLASH) {
				lastCommonSep = i;
			}
		}
		if (i === length) {
			if (toLen > length) {
				if (to.charCodeAt(toStart + i) === CHAR_FORWARD_SLASH) {
					return to.slice(toStart + i + 1);
				}
				if (i === 0) {
					return to.slice(toStart + i);
				}
			} else if (fromLen > length) {
				if (from.charCodeAt(fromStart + i) === CHAR_FORWARD_SLASH) {
					lastCommonSep = i;
				} else if (i === 0) {
					lastCommonSep = 0;
				}
			}
		}

		var out = '';
		for (i = fromStart + lastCommonSep + 1; i <= fromEnd; ++i) {
			if (i === fromEnd || from.charCodeAt(i) === CHAR_FORWARD_SLASH) {
				out += out.length === 0 ? '..' : '/..';
			}
		}
		return out + to.slice(toStart + lastCommonSep);
	}

	// Windows — общий способ через сегменты (регистронезависимо).
	var fSeg = splitSegments(from.toLowerCase());
	var tSeg = splitSegments(to.toLowerCase());
	var tSegOrig = splitSegments(to);
	var k = 0;
	while (k < fSeg.length && k < tSeg.length && fSeg[k] === tSeg[k]) {
		k++;
	}
	// Разные диски — относительного пути нет, отдаём абсолютный 'to'.
	if (k === 0 && fSeg.length > 0 && tSeg.length > 0 && fSeg[0] !== tSeg[0]) {
		return to;
	}
	var parts: string[] = [];
	for (var u = k; u < fSeg.length; u++) {
		parts.push('..');
	}
	for (var d = k; d < tSegOrig.length; d++) {
		parts.push(tSegOrig[d]);
	}
	return parts.join(SEP);
}

/** Разбить путь на непустые сегменты по любому разделителю ОС. */
function splitSegments(p: string): string[] {
	var out: string[] = [];
	var seg = '';
	for (var i = 0; i < p.length; i++) {
		if (isSep(p.charCodeAt(i))) {
			if (seg.length > 0) {
				out.push(seg);
				seg = '';
			}
		} else {
			seg += p.charAt(i);
		}
	}
	if (seg.length > 0) {
		out.push(seg);
	}
	return out;
}
