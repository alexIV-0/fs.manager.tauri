import fs from 'fs';
import path from 'path';
import { calculateSampleHashSync } from './sampleHash';
import { tryToUnlinkFile } from './copyOrMoveItem';

const COPY_RETRIES = 3;

export interface CopyMoveOpts {
	overwrite?: boolean;
}

// Минимальный интерфейс нативного аддона, используемый здесь.
export interface NativeFs {
	copyItem(src: string, dst: string, opts: { overwrite: boolean }): Promise<void>;
	moveItem(src: string, dst: string, opts: { overwrite: boolean }): Promise<void>;
}

function arePathsOnSameDisk(a: string, b: string): boolean {
	return path.parse(a).root === path.parse(b).root;
}

function isFileSync(p: string): boolean {
	try {
		return fs.statSync(p).isFile();
	} catch {
		return false;
	}
}

// Проверяет, что скопированный файл идентичен источнику: размер + sample-hash.
function verifyCopy(src: string, dst: string): boolean {
	try {
		const sStat = fs.statSync(src);
		const dStat = fs.statSync(dst);
		if (sStat.size !== dStat.size) return false;
		return calculateSampleHashSync(src) === calculateSampleHashSync(dst);
	} catch (e) {
		console.warn('[safeNativeCopy] verify failed:', e);
		return false;
	}
}

/**
 * Копирование через native-аддон с проверкой целостности.
 * Папки копируем без верификации (рекурсивная проверка слишком дорога;
 * см. docs/BACKLOG.md для будущей реализации per-file верификации папок).
 */
export async function safeCopyItem(
	nativeFs: NativeFs,
	src: string,
	dst: string,
	opts: CopyMoveOpts = {},
): Promise<void> {
	const isFile = isFileSync(src);

	// Папки: просто делегируем, без верификации
	if (!isFile) {
		await nativeFs.copyItem(src, dst, { overwrite: opts.overwrite ?? false });
		return;
	}

	// Файл: retry-loop с sample-hash
	let lastErr: unknown = null;
	for (let attempt = 1; attempt <= COPY_RETRIES; attempt++) {
		try {
			// чистим возможный мусор от предыдущей неудачной попытки
			if (fs.existsSync(dst)) tryToUnlinkFile(dst);

			await nativeFs.copyItem(src, dst, { overwrite: opts.overwrite ?? false });

			if (verifyCopy(src, dst)) return;

			console.warn(
				`[safeNativeCopy] integrity check failed attempt ${attempt}/${COPY_RETRIES} for ${path.basename(src)}`,
			);
			lastErr = new Error('integrity check failed');
		} catch (e) {
			lastErr = e;
			console.warn(`[safeNativeCopy] copy attempt ${attempt}/${COPY_RETRIES} threw:`, e);
		}
	}

	if (fs.existsSync(dst)) tryToUnlinkFile(dst);
	throw lastErr ?? new Error(`safeCopyItem failed: ${src} → ${dst}`);
}

/**
 * Перемещение через native-аддон:
 *  - папки и same-disk move → нативный rename (без верификации — rename не двигает данные)
 *  - cross-disk файл → safeCopyItem + delete source
 */
export async function safeMoveItem(
	nativeFs: NativeFs,
	src: string,
	dst: string,
	opts: CopyMoveOpts = {},
): Promise<void> {
	const isFile = isFileSync(src);

	// Папки или same-disk: rename внутри native — безопасно (данные не перемещаются)
	if (!isFile || arePathsOnSameDisk(src, dst)) {
		await nativeFs.moveItem(src, dst, { overwrite: opts.overwrite ?? false });
		return;
	}

	// Cross-disk файл: копируем безопасно, затем удаляем оригинал
	await safeCopyItem(nativeFs, src, dst, opts);
	tryToUnlinkFile(src);
}
