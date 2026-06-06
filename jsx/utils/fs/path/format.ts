// ====================================================================
// format(obj) — собрать путь из { root|dir, base|name+ext }. Обратное parse().
// path.format({ dir:'/a/b', name:'clip', ext:'.mov' }) → '/a/b/clip.mov'
// ====================================================================
import { _format, SEP, FormatInputPathObject } from './_core';

export function format(pathObject: FormatInputPathObject): string {
	return _format(SEP, pathObject);
}
