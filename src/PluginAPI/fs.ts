// Полифил node:fs для renderer'а. Все методы — async (Promise-возвращающие),
// даже те, что в Node.js были sync (readFileSync, existsSync и т.п.).
// При использовании плагины ДОЛЖНЫ добавлять `await`.

const api = () => (window as any).electronAPI;

// ─── Stat ────────────────────────────────────────────────────────────────────

export interface Stats {
	size: number;
	mtime: Date;
	mtimeMs: number;
	atimeMs: number;
	ctimeMs: number;
	birthtimeMs: number;
	isFile: () => boolean;
	isDirectory: () => boolean;
	isSymbolicLink: () => boolean;
}

function makeStats(raw: any): Stats {
	const mtimeMs = raw.mtimeMs ?? raw.mtime_ms ?? 0;
	const atimeMs = raw.atimeMs ?? raw.atime_ms ?? 0;
	const ctimeMs = raw.ctimeMs ?? raw.ctime_ms ?? 0;
	const birthtimeMs = raw.birthtimeMs ?? raw.birthtime_ms ?? 0;
	const isFileFlag = raw.isFile ?? raw.is_file ?? false;
	const isDirFlag = raw.isDirectory ?? raw.is_dir ?? false;
	const isSymlinkFlag = raw.isSymbolicLink ?? raw.is_symlink ?? false;
	return {
		size: raw.size ?? 0,
		mtime: new Date(mtimeMs),
		mtimeMs,
		atimeMs,
		ctimeMs,
		birthtimeMs,
		isFile: () => isFileFlag,
		isDirectory: () => isDirFlag,
		isSymbolicLink: () => isSymlinkFlag,
	};
}

export async function stat(p: string): Promise<Stats> {
	// Передаём строку; argMapper в tauri-api.ts оборачивает в { path }.
	const raw = await api().invoke('get_stat', p);
	return makeStats(raw);
}

// В Node `statSync` синхронный — здесь всегда возвращает Promise. Плагин должен делать `await statSync(...)`.
export const statSync = stat;
export const lstat = stat;
export const lstatSync = stat;

// ─── Existence ───────────────────────────────────────────────────────────────

export async function exists(p: string): Promise<boolean> {
	const checked = await api().invoke('checkFilePath', p);
	return Boolean(checked);
}
export const existsSync = exists;

// ─── Read text ───────────────────────────────────────────────────────────────

interface ReadFileOptions {
	encoding?: string;
	flag?: string;
}

export async function readFile(p: string, opts?: ReadFileOptions | string): Promise<string> {
	const encoding = typeof opts === 'string' ? opts : opts?.encoding;
	const content = (await api().invoke('readFileSync', p)) as string;
	if (encoding && encoding !== 'utf-8' && encoding !== 'utf8') {
		// В renderer мы не возвращаем Buffer; для бинарных нужд использовать hashFile/etc.
		console.warn(`[@plugin-api/fs] readFile encoding "${encoding}" not supported, returning utf-8 string`);
	}
	return content;
}
export const readFileSync = readFile;

// ─── Write text ──────────────────────────────────────────────────────────────

export async function writeFile(
	p: string,
	data: string,
	_opts?: ReadFileOptions | string,
): Promise<void> {
	await api().invoke('writeFile', p, data);
}
export const writeFileSync = writeFile;

// ─── Append ──────────────────────────────────────────────────────────────────

export async function appendFile(p: string, data: string): Promise<void> {
	let existing = '';
	if (await exists(p)) {
		existing = await readFile(p);
	}
	await writeFile(p, existing + data);
}
export const appendFileSync = appendFile;

// ─── Mkdir / Rmdir ───────────────────────────────────────────────────────────

interface MkdirOptions {
	recursive?: boolean;
	mode?: number;
}

export async function mkdir(p: string, _opts?: MkdirOptions): Promise<void> {
	await api().invoke('testAndCreateFolder', p);
}
export const mkdirSync = mkdir;

export async function rmdir(p: string): Promise<void> {
	await api().invoke('deleteItem', p);
}
export const rmdirSync = rmdir;

export async function rm(p: string, _opts?: { recursive?: boolean; force?: boolean }): Promise<void> {
	await api().invoke('deleteItem', p);
}
export const rmSync = rm;

// ─── Unlink ──────────────────────────────────────────────────────────────────

export async function unlink(p: string): Promise<void> {
	await api().invoke('deleteItem', p);
}
export const unlinkSync = unlink;

// ─── Readdir ─────────────────────────────────────────────────────────────────

export interface Dirent {
	name: string;
	isFile: () => boolean;
	isDirectory: () => boolean;
}

interface ReaddirOptions {
	withFileTypes?: boolean;
	encoding?: string;
	recursive?: boolean;
}

export async function readdir(p: string, opts?: ReaddirOptions): Promise<any[]> {
	// getSomeFromFolder возвращает legacy-форму `{files: string[], folders: string[]}`.
	const raw = (await api().invoke('getSomeFromFolder', p, [
		{ type: 'files', ext: [] },
		{ type: 'folders', ext: [] },
	])) as { files?: string[]; folders?: string[] };

	const files = raw?.files ?? [];
	const folders = raw?.folders ?? [];

	if (opts?.withFileTypes) {
		const dirents: Dirent[] = [];
		for (const name of folders) {
			dirents.push({ name, isFile: () => false, isDirectory: () => true });
		}
		for (const name of files) {
			dirents.push({ name, isFile: () => true, isDirectory: () => false });
		}
		return dirents;
	}
	return [...folders, ...files];
}
export const readdirSync = readdir;

// ─── Copy / Rename ───────────────────────────────────────────────────────────

export async function copyFile(src: string, dst: string): Promise<void> {
	await api().invoke('copyItem', src, dst, { overwrite: true });
}
export const copyFileSync = copyFile;

export async function rename(oldPath: string, newPath: string): Promise<void> {
	await api().invoke('renameFile', oldPath, newPath);
}
export const renameSync = rename;

// ─── Stub'ы для редких API ───────────────────────────────────────────────────
// Эти не используются в плагинах активно, но если в helper случайно проникнет — даём заглушку.

export function watch(): never {
	throw new Error('@plugin-api/fs: watch() is not implemented in renderer');
}
export const unwatchFile = () => {};
export const watchFile = () => {};
export const constants = {
	F_OK: 0,
	R_OK: 4,
	W_OK: 2,
	X_OK: 1,
};

// ─── Default export ──────────────────────────────────────────────────────────

const fs = {
	stat,
	statSync,
	lstat,
	lstatSync,
	exists,
	existsSync,
	readFile,
	readFileSync,
	writeFile,
	writeFileSync,
	appendFile,
	appendFileSync,
	mkdir,
	mkdirSync,
	rmdir,
	rmdirSync,
	rm,
	rmSync,
	unlink,
	unlinkSync,
	readdir,
	readdirSync,
	copyFile,
	copyFileSync,
	rename,
	renameSync,
	watch,
	unwatchFile,
	watchFile,
	constants,
	promises: undefined as any, // заполняется ниже
};

// node:fs имеет .promises подпространство — у нас всё уже async, так что это просто self-ref
fs.promises = fs;

export default fs;
