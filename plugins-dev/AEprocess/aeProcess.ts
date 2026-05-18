import { testAndCreateFolder } from '../../electron/main/fileSistem/testAndCreateFolder';
import { createPathForFileByPattern } from '../../electron/main/utilits/createPathForFileByPattern';
import { runScriptInAE } from '../../electron/main/processing/runScriptInAE';
import { sendToMW } from '../_template/pluginSender';
import path from 'path';

export { onLoad } from '../_template/pluginSender';

export async function aeProcess(_item: any, _description: any) {
	let finalFile: any[] = [];

	let curPath = _item.targetPath.length == 0 ? ['$clearName ($random(3))'] : _item.targetPath;

	if (_item.import.targetPath) {
		curPath.unshift(..._item.import.targetPath);
	} else {
		curPath.unshift('$localFolder', '$mainFolderName', '$projectName', '$findTime');
	}

	// const fileForName = getPreferredFile(_item, _description) || '';
	const fileForName = _description.pathForDelete;
	const fileTo = createPathForFileByPattern(curPath, _description, fileForName);

	testAndCreateFolder(path.dirname(fileTo));

	// // Отправляем статус перед копированием
	sendToMW('statusbar', {
		text: `${_description.infoText}: [AE process]\n ${_description.curItem}`,
	});

	const aeScript = _item.import.aeScript[0];
	const aePath = _description.programmPath.afterEffect[0];
	const { id: _removed, ...itemWithoutId } = _item;

	const inObj = {
		..._description,
		...itemWithoutId,
		tempScriptPath: fileTo,
	};

	const result = await runScriptInAE(aePath, aeScript, inObj);

	if (result.success) {
		finalFile = result.data; // твой массив строк
	} else {
		console.error('Ошибка AE:', result.error);
	}
	// finalFile.push('');
	sendToMW('log', { level: 'info', text: `Result:\n${finalFile}` });

	return finalFile;
}
