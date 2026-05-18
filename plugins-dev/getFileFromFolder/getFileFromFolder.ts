import { checkFolderPath } from '../../electron/main/fileSistem/checkFolderPath';
import { formatNameByPattern } from '../../electron/main/fileSistem/formatNameByPattern';
import { extractFromParentheses } from '../../electron/main/utilits/extractFromParentheses';
import { getSomeFromFolder, recursiveFindFiles } from '../../electron/main/fileSistem/getSomeFromFolder';
import { getRandomInt } from '../../electron/main/utilits/getRandomInt';
import path from 'path';
import { sendToMW } from '../_template/pluginSender';

export { onLoad } from '../_template/pluginSender';

export async function getFileFromFolder(_item: any, _description: any) {
	const finalFile = [];
	let curPath = [..._item.inputFolder];
	if (_item.import.inputFolder && _item.import.inputFolder.length > 0) {
		curPath.unshift(..._item.import.inputFolder);
	} else {
		curPath.unshift('$projectPathGD');
	}

	let pathByPattern = formatNameByPattern({
		string: path.join(...curPath),
		description: _description,
	});
	sendToMW('statusbar', `${_description.infoText}: [get File from Folder]\n${pathByPattern}`);

	const textInBrackets = extractFromParentheses(path.basename(_description.curItem, path.extname(_description.curItem)));
	if ((textInBrackets.length > 0 && _item.searchInFolder) || _item.searchInRandomFolder) {
		const folderArr = getSomeFromFolder(pathByPattern, [{ type: 'folders', ext: [] }]).folders;
		if (_item.searchInFolder) {
			const match = textInBrackets.find((text) => folderArr.includes(text));
			if (match) {
				pathByPattern = path.join(pathByPattern, match);
			}
		}
		if (_item.searchInRandomFolder) {
			const match = folderArr[getRandomInt(folderArr.length - 1)];
			pathByPattern = path.join(pathByPattern, match);
		}
	}
	let allItems = getSomeFromFolder(pathByPattern, [
		{
			type: _item.searchType[0],
			ext: _description.typeOfFile[_item.searchType[0]],
		},
	])[_item.searchType[0]];
	if (_item.recursiveSearch) {
		allItems = recursiveFindFiles(pathByPattern, [
			{
				type: _item.searchType[0],
				ext: _description.typeOfFile[_item.searchType[0]],
			},
		])[_item.searchType[0]];
	}

	// Приводим к полным путям (getSomeFromFolder может вернуть только имена)
	allItems = allItems.map((file: string) => (path.isAbsolute(file) ? file : path.join(pathByPattern, file)));

	if (_item.oneRandomeFile) {
		finalFile.push(allItems[getRandomInt(allItems.length - 1)]);
	} else {
		finalFile.push(...allItems);
	}
	sendToMW('log', { level: 'info', text: `Result:\n${finalFile}` });
	return finalFile;
}
