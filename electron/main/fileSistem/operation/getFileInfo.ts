import path from 'path';
import fs from 'fs';

export function getFileInfo(filePath: string) {
	try {
		const stats = fs.statSync(filePath);

		return {
			name: path.basename(filePath),
			path: filePath,
			isFile: stats.isFile(),
			isDirectory: stats.isDirectory(),
			size: stats.size, // размер в байтах
			// Время в миллисекундах (timestamp)
			createdMs: stats.birthtimeMs, // время создания в мс
			modifiedMs: stats.mtimeMs, // время последнего изменения в мс
			accessedMs: stats.atimeMs, // время последнего доступа в мс
			changedMs: stats.ctimeMs, // время изменения метаданных в мс
			// Оригинальные Date объекты (на случай если нужны)
			created: stats.birthtime,
			modified: stats.mtime,
			accessed: stats.atime,
			changed: stats.ctime,
			// Дополнительно можно получить права доступа:
			mode: stats.mode,
			// Размер в читаемом формате:
			sizeFormatted: formatFileSize(stats.size),
		};
	} catch (error: any) {
		console.error('Ошибка при получении информации о файле:', error.message);
		return null;
	}
}

// Вспомогательная функция для форматирования размера
function formatFileSize(bytes: number) {
	if (bytes === 0) return '0 B';

	const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
	const i = Math.floor(Math.log(bytes) / Math.log(1024));

	return Math.round((bytes / Math.pow(1024, i)) * 100) / 100 + ' ' + sizes[i];
}
