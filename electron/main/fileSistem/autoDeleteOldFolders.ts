import fs from 'fs';
import path from 'path';

/**
 * Удаляет поддиректории rootPath, у которых mtime старше maxAgeDays дней.
 * Обход bottom-up (post-order DFS): сначала самые глубокие папки, потом родители.
 * Это гарантирует, что родительская папка проверяется ПОСЛЕ своих детей —
 * если дети удалены, родитель может стать пустым и тоже попасть под удаление.
 * Папки, уже удалённые как часть родительской rm, пропускаются через existsSync.
 */
export function autoDeleteOldFolders(rootPath: string, maxAgeDays: number): void {
	if (!fs.existsSync(rootPath)) return;

	const cutoffMs = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;

	const bottomUp: string[] = [];

	function walk(dir: string): void {
		let entries: fs.Dirent[];
		try {
			entries = fs.readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const e of entries) {
			if (e.isDirectory()) {
				const sub = path.join(dir, e.name);
				walk(sub);       // сначала рекурсия (глубже)
				bottomUp.push(sub); // потом добавляем текущую (родитель идёт позже)
			}
		}
	}

	walk(rootPath);

	let deleted = 0;

	for (const dir of bottomUp) {
		try {
			if (!fs.existsSync(dir)) continue; // уже удалена вместе с родителем
			const stat = fs.statSync(dir);
			if (stat.mtimeMs < cutoffMs) {
				fs.rmSync(dir, { recursive: true, force: true });
				console.log(`[autoDelete] removed: ${path.relative(rootPath, dir)}`);
				deleted++;
			}
		} catch (e: any) {
			console.warn(`[autoDelete] failed to remove ${dir}: ${e.message}`);
		}
	}

	if (deleted > 0) {
		console.log(`[autoDelete] done — removed ${deleted} folder(s) older than ${maxAgeDays}d in ${rootPath}`);
	}
}
