// ====================================================================
// join(...paths) — склеить сегменты разделителем ОС и нормализовать.
// path.join('/a', 'b', '../c') → '/a/c'  ;  path.join('C:\\a', 'b') → 'C:\\a\\b'
// ====================================================================
import { validateString, SEP } from './_core';
import { normalize } from './normalize';

export function join(...paths: string[]): string;
export function join(): string {
	if (arguments.length === 0) {
		return '.';
	}
	var joined: any;
	for (var i = 0; i < arguments.length; ++i) {
		var arg = arguments[i];
		validateString(arg, 'path');
		if (arg.length > 0) {
			if (joined === undefined) {
				joined = arg;
			} else {
				joined += SEP + arg;
			}
		}
	}
	if (joined === undefined) {
		return '.';
	}
	return normalize(joined);
}
