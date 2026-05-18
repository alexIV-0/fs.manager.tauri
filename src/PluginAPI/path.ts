// Полифил node:path для renderer'а. Pure JS, без IPC.
// Поддерживает POSIX (/) и Windows (\\) пути; разделитель выбирается по первому сегменту.

function isWindows(p: string): boolean {
	return /^[a-zA-Z]:[\\/]/.test(p) || p.includes('\\');
}

function getSep(p: string): string {
	return isWindows(p) ? '\\' : '/';
}

export const sep = '/';

export function join(...segments: string[]): string {
	const parts = segments.filter((s) => s != null && s !== '');
	if (parts.length === 0) return '';

	const useBackslash = parts[0].includes('\\') || /^[a-zA-Z]:/.test(parts[0]);
	const s = useBackslash ? '\\' : '/';

	let prefix = '';
	const first = parts[0];
	if (first.startsWith('\\\\')) prefix = '\\\\'; // UNC
	else if (first.startsWith('/')) prefix = '/';
	else if (first.startsWith('\\')) prefix = '\\';

	const cleaned = parts
		.map((p) => p.replace(/^[\\/]+/, '').replace(/[\\/]+$/, ''))
		.filter((p) => p !== '');

	return prefix + cleaned.join(s);
}

export function basename(p: string, ext?: string): string {
	const s = getSep(p);
	const parts = p.split(s);
	let name = parts[parts.length - 1] || parts[parts.length - 2] || '';
	if (ext && name.toLowerCase().endsWith(ext.toLowerCase())) {
		name = name.slice(0, name.length - ext.length);
	}
	return name;
}

export function dirname(p: string): string {
	const s = getSep(p);
	const idx = p.lastIndexOf(s);
	if (idx <= 0) return s === '/' ? '/' : p;
	return p.slice(0, idx);
}

export function extname(p: string): string {
	const name = basename(p);
	const dotIdx = name.lastIndexOf('.');
	if (dotIdx <= 0) return '';
	return name.slice(dotIdx);
}

export interface ParsedPath {
	root: string;
	dir: string;
	base: string;
	ext: string;
	name: string;
}

export function parse(p: string): ParsedPath {
	const s = getSep(p);
	const dir = dirname(p);
	const base = basename(p);
	const ext = extname(p);
	const name = ext ? base.slice(0, base.length - ext.length) : base;
	let root = '';
	if (p.startsWith('\\\\')) root = '\\\\';
	else if (p.startsWith(s)) root = s;
	else if (/^[a-zA-Z]:/.test(p)) root = p.slice(0, 3); // C:\
	return { root, dir, base, ext, name };
}

export function format(parts: Partial<ParsedPath>): string {
	const dir = parts.dir || parts.root || '';
	const base = parts.base || ((parts.name || '') + (parts.ext || ''));
	if (!dir) return base;
	const s = getSep(dir);
	if (dir.endsWith(s)) return dir + base;
	return dir + s + base;
}

export function resolve(...segments: string[]): string {
	// Упрощённая реализация: для абсолютного первого сегмента — join; иначе — join без CWD
	// (renderer не имеет понятия CWD). Большинство плагинов передают абсолютные пути.
	let absSeen = false;
	const result: string[] = [];
	for (const seg of segments) {
		if (seg.startsWith('/') || /^[a-zA-Z]:/.test(seg) || seg.startsWith('\\\\')) {
			result.length = 0;
			absSeen = true;
		}
		result.push(seg);
	}
	if (!absSeen) {
		// Без CWD: возвращаем как join, без префикса
		return join(...result);
	}
	return join(...result);
}

export function relative(from: string, to: string): string {
	const s = getSep(from);
	const fromParts = from.split(s).filter(Boolean);
	const toParts = to.split(s).filter(Boolean);
	let i = 0;
	while (i < fromParts.length && i < toParts.length && fromParts[i] === toParts[i]) {
		i++;
	}
	const up = fromParts.length - i;
	const down = toParts.slice(i);
	return [...new Array(up).fill('..'), ...down].join(s);
}

export function isAbsolute(p: string): boolean {
	return p.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith('\\\\');
}

export function normalize(p: string): string {
	const s = getSep(p);
	const isAbs = isAbsolute(p);
	const parts = p.split(/[\\/]+/);
	const result: string[] = [];
	for (const part of parts) {
		if (!part || part === '.') continue;
		if (part === '..') {
			if (result.length > 0 && result[result.length - 1] !== '..') result.pop();
			else if (!isAbs) result.push('..');
		} else {
			result.push(part);
		}
	}
	const joined = result.join(s);
	return isAbs ? s + joined : joined || '.';
}

// node:path/posix и node:path/win32 — в большинстве плагинов не используются, но добавим как алиасы.
export const posix = { join, basename, dirname, extname, parse, format, resolve, relative, isAbsolute, normalize, sep: '/' };
export const win32 = { join, basename, dirname, extname, parse, format, resolve, relative, isAbsolute, normalize, sep: '\\' };

export default {
	sep,
	join,
	basename,
	dirname,
	extname,
	parse,
	format,
	resolve,
	relative,
	isAbsolute,
	normalize,
	posix,
	win32,
};
