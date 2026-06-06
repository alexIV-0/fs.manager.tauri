// ====================================================================
// path/_core — общий «движок» для path-функций (After Effects / ExtendScript).
//
// Идея «как osSep.ts»: разделитель выбирается ОДИН раз по $.os, и все функции
// работают с ним (никаких двух полных реализаций win32/posix — один код).
//   • Windows → SEP='\\', разделителем считаются и '\\', и '/' (как принимает сам Windows);
//   • остальное → SEP='/'.
//
// Каждая публичная функция лежит в своём файле и импортирует отсюда только то,
// что ей нужно — поэтому esbuild (tree-shaking) кладёт в собранный .jsx лишь
// реально используемое. Скрипт, дёрнувший один basename, не тянет resolve/parse и пр.
//
// ES3-стиль обязателен (esbuild не транспилирует ниже es2015): var, function(),
// конкатенация строк, arguments вместо ...rest, str.charAt вместо str[i],
// явное { key: value } в объектах (без shorthand).
// ====================================================================

/** Результат parse(): как у node:path. */
export interface ParsedPath {
	/** Корень: '' | '/' | 'C:\\' … */
	root: string;
	/** Каталог (без хвостового разделителя). */
	dir: string;
	/** Имя с расширением: 'clip.mov'. */
	base: string;
	/** Расширение с точкой: '.mov' (или ''). */
	ext: string;
	/** Имя без расширения: 'clip'. */
	name: string;
}

/** Вход format(): все поля необязательны. */
export interface FormatInputPathObject {
	root?: string;
	dir?: string;
	base?: string;
	ext?: string;
	name?: string;
}

/** Публичный API объекта 'path' — повторяет node:path. */
export interface PathModule {
	normalize(p: string): string;
	basename(p: string, suffix?: string): string;
	dirname(p: string): string;
	extname(p: string): string;
	join(...paths: string[]): string;
	resolve(...paths: string[]): string;
	isAbsolute(p: string): boolean;
	relative(from: string, to: string): string;
	toNamespacedPath(p: string): string;
	parse(p: string): ParsedPath;
	format(pathObject: FormatInputPathObject): string;
	sep: string;
	delimiter: string;
}

// ── символьные коды ──────────────────────────────────────────────────
export var CHAR_DOT = 46;
export var CHAR_FORWARD_SLASH = 47;
export var CHAR_BACKWARD_SLASH = 92;
export var CHAR_COLON = 58;

var CHAR_UPPERCASE_A = 65;
var CHAR_UPPERCASE_Z = 90;
var CHAR_LOWERCASE_A = 97;
var CHAR_LOWERCASE_Z = 122;

// ── выбор ОС и разделителя (один раз, как osSep) ─────────────────────
export function isWindowsOS(): boolean {
	return ('' + $.os).match(/Windows/) != null;
}

/** true на Windows. */
export var IS_WIN: boolean = isWindowsOS();
/** Разделитель сегментов текущей ОС: '\\' или '/'. */
export var SEP: string = IS_WIN ? '\\' : '/';
/** Разделитель списка путей: ';' (Windows) или ':' (posix). */
export var DELIMITER: string = IS_WIN ? ';' : ':';

/** Считается ли код символом-разделителем. На Windows это и '\\', и '/'. */
export function isSep(code: number): boolean {
	if (IS_WIN) {
		return code === CHAR_FORWARD_SLASH || code === CHAR_BACKWARD_SLASH;
	}
	return code === CHAR_FORWARD_SLASH;
}

/** Буква диска A–Z / a–z (для префикса вида 'C:'). */
export function isWinDeviceRoot(code: number): boolean {
	return (code >= CHAR_UPPERCASE_A && code <= CHAR_UPPERCASE_Z) ||
		(code >= CHAR_LOWERCASE_A && code <= CHAR_LOWERCASE_Z);
}

export function validateString(value: any, name: string): void {
	if (typeof value !== 'string') {
		throw new Error('The "' + name + '" argument must be of type string. Received ' + typeof value);
	}
}

/** Замена process.cwd() для ExtendScript: текущая папка либо корень ОС. */
export function cwd(): string {
	try {
		// @ts-ignore — Folder.current есть в ExtendScript; .fsName — нативный путь ОС.
		return Folder.current.fsName;
	} catch (e) {
		return IS_WIN ? 'C:\\' : '/';
	}
}

// ── свёртка '.' и '..' (порт normalizeString из node:path) ───────────
// Разделитель — SEP, предикат — isSep; оба берутся из ОС, поэтому код один.
export function normalizeString(path: string, allowAboveRoot: boolean): string {
	var res = '';
	var lastSegmentLength = 0;
	var lastSlash = -1;
	var dots = 0;
	var code = 0;
	for (var i = 0; i <= path.length; ++i) {
		if (i < path.length) {
			code = path.charCodeAt(i);
		} else if (isSep(code)) {
			break;
		} else {
			code = CHAR_FORWARD_SLASH;
		}

		if (isSep(code)) {
			if (lastSlash === i - 1 || dots === 1) {
				// NOOP
			} else if (dots === 2) {
				if (res.length < 2 || lastSegmentLength !== 2 ||
					res.charCodeAt(res.length - 1) !== CHAR_DOT ||
					res.charCodeAt(res.length - 2) !== CHAR_DOT) {
					if (res.length > 2) {
						var lastSlashIndex = res.lastIndexOf(SEP);
						if (lastSlashIndex === -1) {
							res = '';
							lastSegmentLength = 0;
						} else {
							res = res.slice(0, lastSlashIndex);
							lastSegmentLength = res.length - 1 - res.lastIndexOf(SEP);
						}
						lastSlash = i;
						dots = 0;
						continue;
					} else if (res.length !== 0) {
						res = '';
						lastSegmentLength = 0;
						lastSlash = i;
						dots = 0;
						continue;
					}
				}
				if (allowAboveRoot) {
					res += res.length > 0 ? SEP + '..' : '..';
					lastSegmentLength = 2;
				}
			} else {
				if (res.length > 0) {
					res += SEP + path.slice(lastSlash + 1, i);
				} else {
					res = path.slice(lastSlash + 1, i);
				}
				lastSegmentLength = i - lastSlash - 1;
			}
			lastSlash = i;
			dots = 0;
		} else if (code === CHAR_DOT && dots !== -1) {
			++dots;
		} else {
			dots = -1;
		}
	}
	return res;
}

export function formatExt(ext: any): string {
	if (!ext) {
		return '';
	}
	return (ext.charAt(0) === '.' ? '' : '.') + ext;
}

export function _format(sep: string, pathObject: any): string {
	var dir = pathObject.dir || pathObject.root;
	var base = pathObject.base || ((pathObject.name || '') + formatExt(pathObject.ext));
	if (!dir) {
		return base;
	}
	if (dir === pathObject.root) {
		return dir + base;
	}
	return dir + sep + base;
}
