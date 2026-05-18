import fs from 'fs';
import { execFileSync } from 'child_process';

// Детектор «файл в облаке ещё не скачан локально».
// На macOS используем расширенные атрибуты:
//  - GoogleDrive File Stream / GoogleDrive Desktop: com.google.drivefs.download.pending
//  - Apple iCloud: com.apple.FileProvider.DownloadState / isBrelated атрибуты
// На Windows — пока только fs.stat (полноценная поддержка в BACKLOG).
// На Linux — по-умолчанию false.

const GD_ATTRS = [
	'com.google.drivefs.download.pending',
	'com.google.drivefs.cached',
];

// Читает список xattr одним вызовом `xattr <path>`.
function listXattrs(filePath: string): string[] {
	try {
		const out = execFileSync('xattr', [filePath], {
			encoding: 'utf-8',
			stdio: ['ignore', 'pipe', 'ignore'],
			timeout: 500,
		});
		return out
			.split('\n')
			.map((s) => s.trim())
			.filter(Boolean);
	} catch {
		return [];
	}
}

// Проверяем Cloud-pending атрибуты. Возвращает true, если файл
// вероятно ещё не полностью скачан и читать его пока небезопасно.
export function isCloudFilePending(filePath: string): boolean {
	if (process.platform !== 'darwin') return false;
	try {
		if (!fs.existsSync(filePath)) return false;
	} catch {
		return false;
	}

	const attrs = listXattrs(filePath);
	if (attrs.length === 0) return false;

	// Если присутствует явный pending-атрибут — считаем файл неготовым.
	if (attrs.includes('com.google.drivefs.download.pending')) return true;

	// Apple iCloud: файл-«заглушка» (.icloud) лежит отдельно.
	// На будущее оставим хук; если увидим — считаем pending.
	if (attrs.some((a) => a.startsWith('com.apple.clouddocs.'))) return true;

	return false;
}
