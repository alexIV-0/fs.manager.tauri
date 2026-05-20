// sortByType — сортирует входной массив файлов по выбранному критерию.
// UI (ui.json):
//   sortBy: ddm  → 'StartNumber' | 'EndNumber' | 'Name' | 'Date' (одна строка)
//   sortDirection: checkbox → true = по возрастанию, false = по убыванию
//
// Tauri-port: stat вызывается асинхронно — предсобираем ключи через Promise.all
// и сортируем синхронно по готовым числам.

import path from 'path';
import { fs, sendToMW } from '../_template/tauri';

export { onLoad } from '../_template/tauri';

export type SortMethod = 'StartNumber' | 'EndNumber' | 'Name' | 'Date' | 'Size';

function extractNumberFromStart(filePath: string): number {
	const filename = path.basename(filePath);
	const match = filename.match(/^\d+/);
	return match ? parseInt(match[0], 10) : 0;
}

function extractNumberFromEnd(filePath: string): number {
	const filename = path.basename(filePath, path.extname(filePath));
	const match = filename.match(/\d+$/);
	return match ? parseInt(match[0], 10) : 0;
}

/** Предсобирает значение, по которому будем сортировать, для каждого файла. */
async function precomputeKeys(files: string[], method: SortMethod): Promise<Map<string, number>> {
	const keys = new Map<string, number>();

	if (method === 'Date' || method === 'Size') {
		const stats = await Promise.all(files.map((f) => fs.stat(f).catch(() => null)));
		files.forEach((f, i) => {
			const s = stats[i];
			if (!s) {
				keys.set(f, 0);
				return;
			}
			keys.set(f, method === 'Date' ? s.mtimeMs : s.size);
		});
	} else if (method === 'StartNumber') {
		for (const f of files) keys.set(f, extractNumberFromStart(f));
	} else if (method === 'EndNumber') {
		for (const f of files) keys.set(f, extractNumberFromEnd(f));
	}
	return keys;
}

async function sortFiles(files: string[], method: SortMethod, ascending: boolean): Promise<string[]> {
	let sorted: string[];

	if (method === 'Name') {
		sorted = [...files].sort((a, b) =>
			path.basename(a).toLowerCase().localeCompare(path.basename(b).toLowerCase()),
		);
	} else {
		const keys = await precomputeKeys(files, method);
		sorted = [...files].sort((a, b) => (keys.get(a) ?? 0) - (keys.get(b) ?? 0));
	}

	return ascending ? sorted : sorted.reverse();
}

/** Парсит значение sortBy: ddm возвращает string, но импортированное значение
 *  может прийти массивом — берём первый элемент. */
function pickMethod(raw: unknown): SortMethod {
	const v = Array.isArray(raw) ? raw[0] : raw;
	const allowed: SortMethod[] = ['StartNumber', 'EndNumber', 'Name', 'Date', 'Size'];
	return allowed.includes(v as SortMethod) ? (v as SortMethod) : 'Name';
}

export async function sortByType(_item: any, _description: any): Promise<string[]> {
	const files: string[] = _item.import?.inputFile ?? [];
	if (files.length === 0) {
		sendToMW('log', { level: 'warn', text: `[sortByType] inputFile is empty` });
		return [];
	}

	const method: SortMethod = pickMethod(_item.sortBy);
	// sortDirection: true = по возрастанию (A→Я, 1→99), false = в обратном.
	// Дефолт — true (как в ui.json controlProps.value).
	const ascending: boolean = _item.sortDirection !== false;

	sendToMW('statusbar', {
		text: `${_description.infoText}: [sorting]\n${method} ${ascending ? '↑' : '↓'}`,
	});

	const sorted = await sortFiles(files, method, ascending);
	sendToMW('log', { level: 'info', text: `Result (${method} ${ascending ? 'asc' : 'desc'}):\n${sorted.join('\n')}` });
	return sorted;
}
