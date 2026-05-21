import fs from 'fs';
import crypto from 'crypto';

// Размер одной выборки в байтах: начало, середина, конец.
export const SAMPLE_CHUNK = 1024 * 1024; // 1 MB
// Если файл ≤ 3 выборок — считаем полный хэш (дешевле, чем мудрить с окнами).
export const FULL_HASH_THRESHOLD = SAMPLE_CHUNK * 3;

/**
 * Sample-hash: SHA-1 от первого MB + среднего MB + последнего MB файла.
 * Для малых файлов (≤ 3 MB) — полный хэш.
 * SHA-1 выбран для скорости: это проверка целостности копирования, не безопасность.
 */
export function calculateSampleHashSync(filePath: string): string {
	const stat = fs.statSync(filePath);
	const size = stat.size;

	if (size <= FULL_HASH_THRESHOLD) {
		const buf = fs.readFileSync(filePath);
		return crypto.createHash('sha1').update(buf).digest('hex');
	}

	const hash = crypto.createHash('sha1');
	const fd = fs.openSync(filePath, 'r');
	try {
		const buf = Buffer.alloc(SAMPLE_CHUNK);

		// размер → в хэш, чтобы файлы разного размера с одинаковым сэмплом не совпали
		hash.update(String(size));

		// начало
		fs.readSync(fd, buf, 0, SAMPLE_CHUNK, 0);
		hash.update(buf);

		// середина
		const midOffset = Math.max(0, Math.floor(size / 2) - Math.floor(SAMPLE_CHUNK / 2));
		fs.readSync(fd, buf, 0, SAMPLE_CHUNK, midOffset);
		hash.update(buf);

		// конец
		const endOffset = size - SAMPLE_CHUNK;
		fs.readSync(fd, buf, 0, SAMPLE_CHUNK, endOffset);
		hash.update(buf);
	} finally {
		fs.closeSync(fd);
	}
	return hash.digest('hex');
}
