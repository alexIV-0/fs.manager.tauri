// Полифил node:fs для renderer'а. Все методы — async (Promise-возвращающие),
// даже те, что в Node.js были sync (readFileSync, existsSync и т.п.).
// При использовании плагины ДОЛЖНЫ добавлять `await`.

import { commands, unwrap } from '@/Utils/specta';
import { deleteEverywhere, ensureDir } from '@/Utils/storageSeam';

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
	const raw = unwrap(await commands.getStat(p));
	return makeStats(raw);
}

// В Node `statSync` синхронный — здесь всегда возвращает Promise. Плагин должен делать `await statSync(...)`.
export const statSync = stat;
export const lstat = stat;
export const lstatSync = stat;

// ─── Existence ───────────────────────────────────────────────────────────────

export async function exists(p: string): Promise<boolean> {
	const checked = unwrap(await commands.checkFilePath(p, null));
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
	const content = unwrap(await commands.readFileSync(p));
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
	unwrap(await commands.writeFile(p, data));
}
export const writeFileSync = writeFile;

// ─── Append ──────────────────────────────────────────────────────────────────

export async function appendFile(p: string, data: string): Promise<void> {
	// Настоящий append (O_APPEND) через Rust — не перезаписывает файл целиком.
	unwrap(await commands.appendFile(p, data));
}
export const appendFileSync = appendFile;

// ─── Mkdir / Rmdir ───────────────────────────────────────────────────────────

interface MkdirOptions {
	recursive?: boolean;
	mode?: number;
}

export async function mkdir(p: string, _opts?: MkdirOptions): Promise<void> {
	// Через шов — тот же выбор, что у `remove`/`rmdir` ниже: папку в зеркале надо
	// заводить в каталоге, иначе для облака её не существует. Вне зеркала шов сам
	// падает на обычное создание на диске.
	await ensureDir(p);
}
export const mkdirSync = mkdir;

// Удаление в зеркале идёт через шов — тот же выбор, что в `host.fs.remove`: файл
// облака надо убрать И из каталога, иначе он остаётся «только онлайн» и следующая
// гидрация возвращает его в работу. Вне зеркала `deleteEverywhere` возвращает
// `false`, и удаляем как раньше.
async function removeAnywhere(p: string): Promise<void> {
	if (await deleteEverywhere(p)) return;
	unwrap(await commands.deleteItem(p));
}

export async function rmdir(p: string): Promise<void> {
	await removeAnywhere(p);
}
export const rmdirSync = rmdir;

export async function rm(p: string, _opts?: { recursive?: boolean; force?: boolean }): Promise<void> {
	await removeAnywhere(p);
}
export const rmSync = rm;

// ─── Unlink ──────────────────────────────────────────────────────────────────

export async function unlink(p: string): Promise<void> {
	await removeAnywhere(p);
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
	const raw = unwrap(
		await commands.getSomeFromFolder(p, [
			{ type: 'files', ext: [] },
			{ type: 'folders', ext: [] },
		]),
	) as unknown as { files?: string[]; folders?: string[] };

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
	unwrap(await commands.copyItem(src, dst, { overwrite: true }));
}
export const copyFileSync = copyFile;

export async function rename(oldPath: string, newPath: string): Promise<void> {
	unwrap(await commands.renameFile(oldPath, newPath));
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
