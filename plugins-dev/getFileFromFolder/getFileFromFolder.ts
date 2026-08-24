// getFileFromFolder — ищет файлы/папки в заданной директории по паттерну.
// Поддерживает рекурсивный поиск, выбор по тегу из имени родителя или случайный выбор.
// Tauri-port: все fs-операции через @plugin-api/tauri helper.

import path from 'path';
import type { PluginContext } from '../../src/PluginAPI/host';
import { formatNameByPattern } from '../../src/Utils/formatNameByPattern';
import { extractFromParentheses } from '../../src/Utils/extractFromParentheses';
import { getRandomInt } from '../../src/Utils/getRandomInt';


export async function getFileFromFolder(_item: any, _description: any, ctx: PluginContext): Promise<string[]> {
	const { fs, sendToMW } = ctx;
	const finalFile: string[] = [];

	let curPath: string[] = [..._item.inputFolder];
	if (_item.import.inputFolder && _item.import.inputFolder.length > 0) {
		curPath.unshift(..._item.import.inputFolder);
	} else {
		curPath.unshift('$projectPathGD');
	}

	// Соединяем простым '/', НЕ через path.join: иначе '..' схлопнулся бы против
	// нераскрытого токена ('$projectPathGD' + '../foo' => 'foo'). Раскрываем токены,
	// затем path.normalize схлопывает '..' уже против реального пути.
	let pathByPattern = path.normalize(
		formatNameByPattern({
			string: curPath.filter((s) => s != null && s !== '').join('/'),
			description: _description,
		}),
	);
	sendToMW('statusbar', { text: `${_description.infoText}: [get File from Folder]\n${pathByPattern}` });

	// Если включён поиск по тегу из имени файла или случайной подпапке —
	// сначала залезаем в подпапку.
	const textInBrackets = extractFromParentheses(path.basename(_description.curItem, path.extname(_description.curItem)));
	if ((textInBrackets.length > 0 && _item.searchInFolder) || _item.searchInRandomFolder) {
		const folderArr = await fs.folders(pathByPattern);
		if (_item.searchInFolder) {
			const match = textInBrackets.find((text) => folderArr.includes(text));
			if (match) pathByPattern = path.join(pathByPattern, match);
		}
		if (_item.searchInRandomFolder && folderArr.length > 0) {
			const match = folderArr[getRandomInt(folderArr.length - 1)];
			pathByPattern = path.join(pathByPattern, match);
		}
	}

	const searchType: string = _item.searchType[0];
	const exts: string[] = _description.typeOfFile?.[searchType] ?? [];
	const recursive = Boolean(_item.recursiveSearch);

	let allItems: string[] =
		searchType === 'folders' ? await fs.folders(pathByPattern, recursive) : await fs.filesByExt(pathByPattern, exts, recursive);

	// Полные пути (Rust возвращает только имена).
	allItems = allItems.map((file) => (path.isAbsolute(file) ? file : path.join(pathByPattern, file)));

	// Сколько файлов вернуть:
	// 1) oneRandomeFile (legacy-чекбокс) — ровно 1 случайный файл. Имеет приоритет,
	//    чтобы старые флоу работали как прежде.
	// 2) countRange [min, max] — если max>0, берём случайное N в [max(1,min), max]
	//    (минимум 1 при активном параметре), но не больше, чем есть файлов. 0,0 = выкл.
	// 3) иначе — все файлы.
	const countRange: [number, number] = Array.isArray(_item.countRange) ? _item.countRange : [0, 0];
	const [rangeMin, rangeMax] = countRange;

	if (_item.oneRandomeFile && allItems.length > 0) {
		finalFile.push(allItems[getRandomInt(allItems.length - 1)]);
	} else if (rangeMax > 0 && allItems.length > 0) {
		const minN = Math.max(1, rangeMin);
		const maxN = Math.max(minN, rangeMax);
		const count = Math.min(getRandomInt(minN, maxN), allItems.length);
		// Выбираем count случайных файлов без повторений.
		const pool = [...allItems];
		for (let i = 0; i < count && pool.length > 0; i++) {
			finalFile.push(pool.splice(getRandomInt(pool.length - 1), 1)[0]);
		}
	} else {
		finalFile.push(...allItems);
	}

	sendToMW('log', { level: 'info', text: `Result:\n${finalFile.join('\n')}` });
	return finalFile;
}
