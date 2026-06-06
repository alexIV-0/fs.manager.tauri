// ====================================================================
// resolve(...paths) — собрать абсолютный путь (справа налево).
// Базой для относительных служит cwd() (Folder.current.fsName) — см. _core.
// (Per-drive cwd и 'C:relative' на Windows НЕ поддерживаются — редкие кейсы.)
// ====================================================================
import { validateString, normalizeString, cwd, IS_WIN, SEP, CHAR_BACKWARD_SLASH } from './_core';
import { isAbsolute } from './isAbsolute';
import { normalize } from './normalize';

export function resolve(...paths: string[]): string;
export function resolve(): string {
	var resolved = '';
	var isAbs = false;

	for (var i = arguments.length - 1; i >= -1 && !isAbs; i--) {
		var p = i >= 0 ? arguments[i] : cwd();
		validateString(p, 'path');
		if (p.length === 0) {
			continue;
		}
		resolved = p + SEP + resolved;
		isAbs = isAbsolute(p);
	}

	if (!IS_WIN) {
		resolved = normalizeString(resolved, !isAbs);
		if (isAbs) {
			return '/' + resolved;
		}
		return resolved.length > 0 ? resolved : '.';
	}

	// Windows: normalize() сам разбирает диск/ведущий разделитель.
	// resolved всегда оканчивается на SEP — снимаем возможный хвост.
	var n = normalize(resolved);
	if (n.length > 1 && n.charCodeAt(n.length - 1) === CHAR_BACKWARD_SLASH) {
		n = n.slice(0, n.length - 1);
	}
	return n;
}
