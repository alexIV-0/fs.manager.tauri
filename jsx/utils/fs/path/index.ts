// ====================================================================
// path для After Effects / ExtendScript — barrel (точка входа).
//
// Два способа использования — выбирай по размеру скрипта:
//
//   1) ИМЕНОВАННЫЕ функции (рекомендуется для маленьких скриптов):
//        import { basename, dirname, join } from '../utils/fs/path';
//        var name = basename(inObj.file);
//      esbuild подтянет в .jsx ТОЛЬКО эти функции (tree-shaking) — лёгкий бандл.
//
//   2) Объект 'path' (удобный, как в Node, но тянет ВСЕ функции сразу):
//        import { path } from '../utils/fs/path';
//        var name = path.basename(inObj.file);
//
// Обе ветки — из одного barrel; API одинаков. Разделитель ('\\' или '/')
// выбирается по $.os один раз внутри (см. _core.ts, в духе osSep.ts).
// ====================================================================

// — именованные функции (tree-shakeable) —
export { basename } from './basename';
export { dirname } from './dirname';
export { extname } from './extname';
export { normalize } from './normalize';
export { join } from './join';
export { isAbsolute } from './isAbsolute';
export { resolve } from './resolve';
export { relative } from './relative';
export { parse } from './parse';
export { format } from './format';

// — типы —
export type { ParsedPath, FormatInputPathObject, PathModule } from './_core';

// — объект 'path' (удобная обёртка, как node:path) —
import { SEP, DELIMITER, PathModule } from './_core';
import { basename } from './basename';
import { dirname } from './dirname';
import { extname } from './extname';
import { normalize } from './normalize';
import { join } from './join';
import { isAbsolute } from './isAbsolute';
import { resolve } from './resolve';
import { relative } from './relative';
import { parse } from './parse';
import { format } from './format';

export var path: PathModule = {
	basename: basename,
	dirname: dirname,
	extname: extname,
	normalize: normalize,
	join: join,
	isAbsolute: isAbsolute,
	resolve: resolve,
	relative: relative,
	parse: parse,
	format: format,
	// На posix это no-op, на Windows '\\?\'-формат в AE не нужен — отдаём как есть.
	toNamespacedPath: function (p: any): any {
		return p;
	},
	sep: SEP,
	delimiter: DELIMITER
};
