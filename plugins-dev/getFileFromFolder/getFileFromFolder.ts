// getFileFromFolder — ищет файлы/папки в заданной директории по паттерну.
// Поддерживает рекурсивный поиск, выбор по тегу из имени родителя или случайный выбор.
// Tauri-port: все fs-операции через @plugin-api/tauri helper.

import path from 'path';
import { fs, sendToMW } from '../_template/tauri';
import { formatNameByPattern } from '../../src/Utils/formatNameByPattern';
import { extractFromParentheses } from '../../src/Utils/extractFromParentheses';
import { getRandomInt } from '../../src/Utils/getRandomInt';

export { onLoad } from '../_template/tauri';

export async function getFileFromFolder(_item: any, _description: any): Promise<string[]> {
	const finalFile: string[] = [];

	let curPath: string[] = [..._item.inputFolder];
	if (_item.import.inputFolder && _item.import.inputFolder.length > 0) {
		curPath.unshift(..._item.import.inputFolder);
	} else {
		curPath.unshift('$projectPathGD');
	}

	let pathByPattern = formatNameByPattern({
		string: path.join(...curPath),
		description: _description,
	});
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

	if (_item.oneRandomeFile && allItems.length > 0) {
		finalFile.push(allItems[getRandomInt(allItems.length - 1)]);
	} else {
		finalFile.push(...allItems);
	}

	sendToMW('log', { level: 'info', text: `Result:\n${finalFile.join('\n')}` });
	return finalFile;
}
