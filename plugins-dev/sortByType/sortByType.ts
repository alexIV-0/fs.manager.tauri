import fs from 'fs';
import path from 'path';
import { sendToMW } from '../_template/pluginSender';

export { onLoad } from '../_template/pluginSender';
// ===== ТИПЫ =====

export type SortMethod = 'StartNumber' | 'EndNumber' | 'Name' | 'Date' | 'Size';
export type SortDirection = 'asc' | 'desc';

// ===== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ =====

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

// ===== МЕТОДЫ СОРТИРОВКИ =====

const sortMethods: Record<SortMethod, (a: string, b: string) => number> = {
	StartNumber: (a, b) => extractNumberFromStart(a) - extractNumberFromStart(b),

	EndNumber: (a, b) => extractNumberFromEnd(a) - extractNumberFromEnd(b),

	Name: (a, b) => {
		const nameA = path.basename(a).toLowerCase();
		const nameB = path.basename(b).toLowerCase();
		return nameA.localeCompare(nameB);
	},

	Date: (a, b) => {
		const dateA = fs.statSync(a).mtimeMs; // дата последнего изменения
		const dateB = fs.statSync(b).mtimeMs;
		return dateA - dateB;
	},

	Size: (a, b) => {
		const sizeA = fs.statSync(a).size;
		const sizeB = fs.statSync(b).size;
		return sizeA - sizeB;
	},
};

// ===== ОСНОВНАЯ ФУНКЦИЯ СОРТИРОВКИ =====

function sortFiles(files: string[], method: SortMethod, direction: SortDirection = 'asc'): string[] {
	const compareFn = sortMethods[method];
	const sorted = [...files].sort(compareFn);
	return direction === 'desc' ? sorted.reverse() : sorted;
}

// ===== ПЛАГИН =====

export async function sortByType(_item: any, _description: any) {
	const files: string[] = _item.import.inputFile;
	const method: SortMethod = _description.method ?? 'Name';
	const direction: SortDirection = _description.direction ?? 'asc';

	sendToMW('statusbar', `${_description.infoText}: [sorting by]\n${method} - ${direction}`);

	const sorted = sortFiles(files, method, direction);
	sendToMW('log', { level: 'info', text: `Result:\n${sorted}` });
	return sorted;
}
