import path from 'path';
import fs from 'fs';

/* 
	ОПИСАНИЕ
	На вход функции передаются аргументы
	Обязательные:
	  _path - строка, путь до папки
	Необязательные:
	  _search - массив, что искать папки, файлы или конкретные форматы
	  если ничего не передано то ищется все.

	На выходе получается объект с {files:[], folders:[]}, 
	или просто массивы с нужными типами или форматами
 */

export type SearchItem = {
	type: string; // например: "folders", "video", "image", "custom"
	ext: string[]; // [] если нужны папки или нет фильтра
};

export function getSomeFromFolder(dirPath: string, search: SearchItem[]): Record<string, string[]> {
	const items = fs.readdirSync(dirPath, { withFileTypes: true });
	const result: Record<string, string[]> = {};

	// Создаем массивы под каждый тип
	for (const s of search) {
		result[s.type] = [];
	}

	for (const item of items) {
		const name = item.name;

		// Пропускаем скрытые
		if (name.startsWith('.')) continue;

		const ext = path.extname(name).replace('.', '').toLowerCase();

		for (const rule of search) {
			// Папки
			if (rule.type === 'folders') {
				if (item.isDirectory()) result[rule.type].push(name);
				continue;
			}

			// Файлы
			if (item.isFile()) {
				if (rule.ext.length === 0) {
					// нет фильтра → подходит всё
					result[rule.type].push(name);
				} else if (rule.ext.includes(ext)) {
					result[rule.type].push(name);
				}
			}
		}
	}

	return result;
}

// Async version — frees the main process thread during directory reads
export async function getSomeFromFolderAsync(dirPath: string, search: SearchItem[]): Promise<Record<string, string[]>> {
	const items = await fs.promises.readdir(dirPath, { withFileTypes: true });
	const result: Record<string, string[]> = {};

	for (const s of search) {
		result[s.type] = [];
	}

	for (const item of items) {
		const name = item.name;

		if (name.startsWith('.')) continue;

		const ext = path.extname(name).replace('.', '').toLowerCase();

		for (const rule of search) {
			if (rule.type === 'folders') {
				if (item.isDirectory()) result[rule.type].push(name);
				continue;
			}

			if (item.isFile()) {
				if (rule.ext.length === 0) {
					result[rule.type].push(name);
				} else if (rule.ext.includes(ext)) {
					result[rule.type].push(name);
				}
			}
		}
	}

	return result;
}

export function recursiveFindFiles(rootPath: string, search: SearchItem[]): Record<string, string[]> {
	const result: Record<string, string[]> = {};

	// Инициализация всех категорий
	for (const s of search) {
		result[s.type] = [];
	}

	const searchFolders = search.some((s) => s.type === 'folders') ? search : [...search, { type: 'folders', ext: [] }];

	function walk(currentPath: string, relativePath: string) {
		const found = getSomeFromFolder(currentPath, searchFolders);

		const folders = found['folders'] ?? [];

		// 1. Добавляем файлы (кроме папок)
		for (const rule of search) {
			// <-- важно: только реальные правила пользователя
			if (rule.type === 'folders') continue;

			for (const element of found[rule.type] ?? []) {
				const fullRelative = path.join(relativePath, element);
				result[rule.type].push(fullRelative);
			}
		}

		// 2. Рекурсия по папкам
		for (const folder of folders) {
			walk(path.join(currentPath, folder), path.join(relativePath, folder));
		}

		// 3. Если пользователь запросил папки — добавляем их в ответ
		if (search.some((r) => r.type === 'folders')) {
			for (const folder of folders) {
				const fullRelative = path.join(relativePath, folder);
				result['folders'].push(fullRelative);
			}
		}
	}

	walk(rootPath, '');

	return result;
}
