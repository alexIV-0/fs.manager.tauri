import path from 'path';
import fs from 'fs';
import { getFileTypeByExt } from '../../electron/main/utilits/getFileTypeByExt';
import { createPathForFileByPattern } from '../../electron/main/utilits/createPathForFileByPattern';
import { copyFileWithAddMetadata } from '../../electron/main/processing/ffmpeg/copyFileWithAddMetadata';
import { copyItem } from '../../electron/main/fileSistem/copyOrMoveItem';
import { testAndCreateFolder } from '../../electron/main/fileSistem/testAndCreateFolder';
import { sendToMW } from '../_template/pluginSender';

export { onLoad } from '../_template/pluginSender';

export async function saveFileOnGDFunc(_item: any, _description: any) {
	const finalFile: string[] = [];

	const fileType = getFileTypeByExt(_item.import.inputFile[0], _description.typeOfFile);

	let curPath = _item.path.length == 0 ? ['[$id]_$findTime-$clearName ($random(3))'] : _item.path;
	if (_item.import.path) {
		curPath.unshift(..._item.import.path);
	} else {
		curPath.unshift('$mainFolderPath', '$projectName', 'OUT');
	}
	for (let fileFrom of _item.import.inputFile) {
		let fileTo = createPathForFileByPattern(curPath, _description, fileFrom);

		// Индекс добавляем только если путь уже занят — на диске или среди уже зарезервированных в этом батче
		if (fs.existsSync(fileTo) || finalFile.includes(fileTo)) {
			const fileDir = path.dirname(fileTo);
			const fileExt = path.extname(fileTo);
			const fileName = path.basename(fileTo, fileExt);
			let i = 1;
			let candidate: string;
			do {
				candidate = path.join(fileDir, `${fileName}_${i}${fileExt}`);
				i++;
			} while (fs.existsSync(candidate) || finalFile.includes(candidate));
			fileTo = candidate;
		}

		sendToMW('statusbar', { text: `${_description.infoText}: [save file on GD] ${fileFrom} → ${fileTo}` });
		const isVideoFile = ['video'].includes(fileType);

		const pathDir = path.dirname(fileTo);
		testAndCreateFolder(pathDir);
		if (isVideoFile) {
			await copyFileWithAddMetadata(fileFrom, fileTo, _description);
		} else {
			const ok = copyItem(fileFrom, fileTo, { overwrite: _item.overwriteOldest });
			if (!ok) throw new Error(`[saveFileOnGD] Copy failed: ${path.basename(fileFrom)} → ${path.basename(fileTo)}`);
		}
		finalFile.push(fileTo);
	}
	sendToMW('log', { level: 'info', text: `Result:\n${finalFile}` });
	return finalFile;
}
