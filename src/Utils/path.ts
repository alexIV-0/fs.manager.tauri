/**
 * Канонический path-хелпер ПРИЛОЖЕНИЯ. Чистый TS, без IPC.
 *
 * basename/dirname/extname/join — тривиальные строковые операции, им незачем ходить
 * в Rust (раньше это были IPC-вызовы pathBasename/… — горячие, async, с round-trip'ом).
 *
 * Единственная реализация живёт в `@/PluginAPI/path` (кросс-платформенный полифил node:path:
 * POSIX `/`, Windows `C:\`, UNC `\\`, смешанные сепараторы; неоднозначные пути → OS-дефолт).
 * Тот же модуль отдаётся плагинам как `@plugin-api/path`, поэтому реализацию держим там
 * (самодостаточной, без `@/`-импортов — чтобы не ломать сборку плагинов), а здесь — фасад.
 */
export {
	join,
	basename,
	dirname,
	extname,
	parse,
	relative,
	normalize,
	isAbsolute,
	sep,
} from '@/PluginAPI/path';
