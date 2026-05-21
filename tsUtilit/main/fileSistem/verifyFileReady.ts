import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { getPathToProg } from '../utilits/getPathToProg';
import { isCloudFilePending } from './isCloudFilePending';

const execFileAsync = promisify(execFile);

export interface VerifyResult {
	ok: boolean;
	reason?: string;
}

// ============================================================
// Какие type-имена из typeOfFile считаются медиа (ffprobe).
// Всё остальное идёт через generic-проверку start/middle/end.
// При добавлении нового медиа-типа в typeOfFile_store — добавить сюда.
// ============================================================
const MEDIA_TYPES = new Set(['video', 'audio', 'image']);

// ============================================================
// Вспомогательные
// ============================================================

function ext(p: string): string {
	return path.extname(p).slice(1).toLowerCase();
}

/**
 * Из typeOfFile { "video": ["mp4","mov"], "image": ["jpg"] }
 * строит обратный маппинг: { mp4 → "video", mov → "video", jpg → "image" }.
 */
function buildExtToType(typeOfFile: Record<string, string[] | string>): Map<string, string> {
	const map = new Map<string, string>();
	for (const [typeName, exts] of Object.entries(typeOfFile)) {
		const list = Array.isArray(exts) ? exts : [exts];
		for (const e of list) {
			if (typeof e === 'string') map.set(e.toLowerCase(), typeName);
		}
	}
	return map;
}

// ============================================================
// Стратегии верификации
// ============================================================

async function verifyMedia(filePath: string): Promise<VerifyResult> {
	const raw = await getPathToProg('ffprobe');
	const ffprobe = Array.isArray(raw) ? raw[0] : raw;
	if (!ffprobe || typeof ffprobe !== 'string') return verifyGeneric(filePath);

	try {
		await execFileAsync(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', filePath], { timeout: 15000 });
		return { ok: true };
	} catch (e: any) {
		const stderr = e?.stderr?.toString?.()?.trim();
		return { ok: false, reason: `ffprobe: ${stderr || e?.message || 'error'}` };
	}
}

/**
 * Generic-проверка: читаем по 1 байту в начале, середине и конце файла.
 * Ловит cloud-placeholder (GD/iCloud не докачали — конец недоступен),
 * truncated-загрузки и битые блоки. Формат не валидирует.
 */
function verifyGeneric(filePath: string): VerifyResult {
	let fd: number | undefined;
	try {
		const stat = fs.statSync(filePath);
		if (stat.size === 0) return { ok: false, reason: 'empty file' };

		fd = fs.openSync(filePath, 'r');
		const buf = Buffer.alloc(1);

		fs.readSync(fd, buf, 0, 1, 0);
		if (stat.size > 2) fs.readSync(fd, buf, 0, 1, Math.floor(stat.size / 2));
		if (stat.size > 1) fs.readSync(fd, buf, 0, 1, stat.size - 1);

		return { ok: true };
	} catch (e: any) {
		return { ok: false, reason: e?.message ?? 'unreadable' };
	} finally {
		if (fd !== undefined) {
			try {
				fs.closeSync(fd);
			} catch {
				/* noop */
			}
		}
	}
}

// ============================================================
// Верификация одного файла
// ============================================================

async function verifyFile(filePath: string, extToType: Map<string, string>): Promise<VerifyResult> {
	if (isCloudFilePending(filePath)) return { ok: false, reason: 'cloud download pending' };
	const typeName = extToType.get(ext(filePath));
	if (typeName && MEDIA_TYPES.has(typeName)) return verifyMedia(filePath);
	return verifyGeneric(filePath);
}

// ============================================================
// Рекурсивный сбор + параллельная верификация папки
// ============================================================

function collectFiles(folderPath: string, extToType: Map<string, string>, out: string[]): void {
	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(folderPath, { withFileTypes: true });
	} catch {
		return;
	}
	for (const entry of entries) {
		if (entry.name.startsWith('.')) continue; // .DS_Store и прочая служебка
		const childPath = path.join(folderPath, entry.name);
		if (entry.isDirectory()) {
			collectFiles(childPath, extToType, out);
		} else if (entry.isFile() && extToType.has(ext(entry.name))) {
			out.push(childPath);
		}
	}
}

async function verifyFolder(folderPath: string, extToType: Map<string, string>): Promise<VerifyResult> {
	const targets: string[] = [];
	collectFiles(folderPath, extToType, targets);
	if (targets.length === 0) return { ok: true };

	const results = await Promise.all(targets.map(async (p) => ({ p, r: await verifyFile(p, extToType) })));
	const failed = results.find((x) => !x.r.ok);
	if (failed) return { ok: false, reason: `${path.basename(failed.p)}: ${failed.r.reason ?? 'unknown'}` };
	return { ok: true };
}

// ============================================================
// Точка входа
// ============================================================

/**
 * Проверяет, что файл или папка готовы к обработке:
 *  1) cloud download не в состоянии pending (GD/iCloud докачали)
 *  2) media-типы (video/audio/image из typeOfFile) — через ffprobe
 *  3) остальные типы — generic-проверка (читаемость начала/середины/конца)
 *
 * Папки рекурсивно: параллельно проверяются все файлы, чьё расширение
 * присутствует в typeOfFile. Остальное (мусор, служебные файлы) игнорируется.
 *
 * @param filePath   - путь к файлу или папке
 * @param typeOfFile - { typeName: [ext, ...] } из description.typeOfFile.
 *                    typeName определяет стратегию верификации.
 */
export async function verifyFileReady(filePath: string, typeOfFile?: Record<string, string[] | string>): Promise<VerifyResult> {
	let p: any = filePath;
	if (Array.isArray(p)) p = p[0];
	if (typeof p !== 'string') return { ok: false, reason: 'invalid path type' };

	if (!fs.existsSync(p)) return { ok: false, reason: 'missing' };
	if (isCloudFilePending(p)) return { ok: false, reason: 'cloud download pending' };

	let stat: fs.Stats;
	try {
		stat = fs.statSync(p);
	} catch (e: any) {
		return { ok: false, reason: e?.message ?? 'stat error' };
	}

	const extToType = buildExtToType(typeOfFile ?? {});

	if (stat.isDirectory()) return verifyFolder(p, extToType);
	if (stat.isFile()) return verifyFile(p, extToType);
	return { ok: false, reason: 'not a file or folder' };
}
