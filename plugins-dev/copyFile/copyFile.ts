// main/copyFileFuncMain.ts
import path from 'path';
import { copyItem, tryToUnlinkFile } from '../../electron/main/fileSistem/copyOrMoveItem';
import { createPathForFileByPattern } from '../../electron/main/utilits/createPathForFileByPattern';
import { sendToMW } from '../_template/pluginSender';

export { onLoad } from '../_template/pluginSender';
export async function copyFileFunc(_item: any, _description: any) {
	const finalFile = [];

	let curPath = _item.targetPath.length == 0 ? ['$clearName ($random(3))'] : _item.targetPath;

	if (_item.import.targetPath) {
		curPath.unshift(..._item.import.targetPath);
	} else {
		curPath.unshift('$localFolder', '$mainFolderName', '$projectName', '$findTime');
	}

	for (let fileFrom of _item.import.inputFile) {
		const fileTo = createPathForFileByPattern(curPath, _description, fileFrom);

		// Отправляем статус перед копированием
		sendToMW('statusbar', {
			text: `${_description.infoText}: [copy file] ${fileFrom} → ${fileTo}`,
		});

		const ok = copyItem(fileFrom, fileTo, { overwrite: _item.overwriteOldest });
		if (!ok) throw new Error(`[copyFile] Copy failed: ${path.basename(fileFrom)} → ${path.basename(fileTo)}`);

		if (_item.deleteAfter) {
			tryToUnlinkFile(fileFrom);
		}
		finalFile.push(fileTo);
	}

	sendToMW('log', { level: 'info', text: `Result:\n${finalFile}` });
	return finalFile;
}
