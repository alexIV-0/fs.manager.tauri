// Полифил node:path для renderer'а. Pure JS, без IPC.
// Сепаратор выбирается по правилам:
//  1) Явный Windows-маркер в пути (C:\, \\UNC, \) → '\\'
//  2) Явный POSIX-маркер (/ в начале) → '/'
//  3) Ambiguous (токены, относительные сегменты без сепаратора) → OS-дефолт
// Это критично потому что `path.join('$mainFolderPath', 'OUT')` сам по себе
// не выглядит ни Windows ни POSIX, а финальный путь после подстановки токенов
// зависит от реальной ОС.

// Детектится один раз при загрузке модуля; та же логика что в os.platform() и globals.ts.
const OS_DEFAULT_SEP: '\\' | '/' = (() => {
	const ua = (typeof navigator !== 'undefined' ? navigator.userAgent : '') ?? '';
	return ua.includes('Windows') ? '\\' : '/';
})();

function isWindows(p: string): boolean {
	return /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith('\\\\') || p.includes('\\');
}

function isPosixRooted(p: string): boolean {
	return p.startsWith('/');
}

function getSep(p: string): string {
	if (isWindows(p)) return '\\';
	if (isPosixRooted(p)) return '/';
	return OS_DEFAULT_SEP;
}

// На путях со смешанными сепараторами ищем последний разделитель любого вида —
// иначе dirname/basename режут путь по неправильному месту.
function lastSepIdx(p: string): number {
	if (OS_DEFAULT_SEP === '\\' || isWindows(p)) return Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/'));
	return p.lastIndexOf('/');
}

function splitAll(p: string): string[] {
	if (OS_DEFAULT_SEP === '\\' || isWindows(p)) return p.split(/[\\/]/);
	return p.split('/');
}

export const sep = '/';

export function join(...segments: string[]): string {
	const parts = segments.filter((s) => s != null && s !== '');
	if (parts.length === 0) return '';

	// Sep по тем же правилам что и getSep, но смотрим на ВСЕ сегменты:
	//  - Windows-маркер хоть в одном → '\\'
	//  - POSIX-маркер (leading '/') хоть в одном → '/'
	//  - Иначе → OS-дефолт (важно для случая токенов '$mainFolderPath' и т.п.)
	const looksWindows = parts.some((p) => /^[a-zA-Z]:/.test(p) || p.startsWith('\\\\') || p.includes('\\'));
	const looksPosix = !looksWindows && parts.some((p) => p.startsWith('/'));
	const s = looksWindows ? '\\' : looksPosix ? '/' : OS_DEFAULT_SEP;

	let prefix = '';
	const first = parts[0];
	if (first.startsWith('\\\\')) prefix = '\\\\'; // UNC
	else if (/^[a-zA-Z]:[\\/]/.test(first)) prefix = first.slice(0, 2) + s; // 'C:\'
	else if (/^[a-zA-Z]:/.test(first)) prefix = first.slice(0, 2); // 'C:' (drive-relative)
	else if (first.startsWith('/')) prefix = '/';
	else if (first.startsWith('\\')) prefix = '\\';

	// Внутри каждого сегмента приводим ВСЕ разделители к выбранному s,
	// и обрезаем края — иначе после подстановок остаются микс-сепараторы.
	const cleaned = parts
		.map((p, i) => {
			let segment = i === 0 && prefix ? p.slice(prefix.length) : p;
			segment = segment.replace(/[\\/]+/g, s);
			return segment.replace(/^[\\/]+|[\\/]+$/g, '');
		})
		.filter((p) => p !== '');

	return prefix + cleaned.join(s);
}

export function basename(p: string, ext?: string): string {
	const parts = splitAll(p);
	let name = parts[parts.length - 1] || parts[parts.length - 2] || '';
	if (ext && name.toLowerCase().endsWith(ext.toLowerCase())) {
		name = name.slice(0, name.length - ext.length);
	}
	return name;
}

export function dirname(p: string): string {
	const idx = lastSepIdx(p);
	if (idx <= 0) return isWindows(p) ? p : '/';
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
	const fromParts = splitAll(from).filter(Boolean);
	const toParts = splitAll(to).filter(Boolean);
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
	if (!p) return '.';
	const s = getSep(p);

	// Вычисляем root отдельно — он не должен попадать в split/.. логику
	// (иначе для 'C:\foo' получим обратно '\C:\foo').
	let root = '';
	let rest = p;
	if (rest.startsWith('\\\\')) {
		root = '\\\\';
		rest = rest.slice(2);
	} else {
		const drive = rest.match(/^([a-zA-Z]:)([\\/])?/);
		if (drive) {
			root = drive[1] + (drive[2] ? s : '');
			rest = rest.slice(drive[0].length);
		} else if (rest.startsWith('/') || rest.startsWith('\\')) {
			root = s;
			rest = rest.replace(/^[\\/]+/, '');
		}
	}

	const isAbs = root.length > 0;
	const parts = rest.split(/[\\/]+/);
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
	return (root + joined) || '.';
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
