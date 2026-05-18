import { getFullInfoFromVideoFile } from '../../electron/main/processing/ffmpeg/getFullInfoFromVideoFile';
import { spawnFFmpegCommand } from '../../electron/main/processing/ffmpeg/spawnFFmpegCommand';
import { testAndCreateFolder } from '../../electron/main/fileSistem/testAndCreateFolder';
import { createPathForFileByPattern } from '../../electron/main/utilits/createPathForFileByPattern';
import { sendToMW } from '../_template/pluginSender';
import path from 'path';

export { onLoad } from '../_template/pluginSender';

export async function convertFileFunc(_item: any, _description: any) {
	const finalFile = [];

	let iteration = 1;

	for (let fileFrom of _item.import.inputFile) {
		let curPath = _item.targetPath.length == 0 ? ['$clearName ($random(3))'] : _item.targetPath;

		if (_item.import.targetPath) {
			curPath.unshift(..._item.import.targetPath);
		} else {
			curPath.unshift('$localFolder', '$mainFolderName', '$projectName', '$findTime');
		}

		const newPath = createPathForFileByPattern(curPath, _description, fileFrom);
		const dirTo = path.dirname(newPath);

		const originalName = path.basename(fileFrom);

		const newName = path.basename(newPath, path.extname(newPath)) + '.' + _item.fileExt[0];

		const fileTo = path.join(dirTo, newName);

		testAndCreateFolder(dirTo);

		// Отправляем статус перед копированием

		const curDuration = (await getFullInfoFromVideoFile(fileFrom, _description)).durationInSeconds;
		const ffmpegArgs = _item.ffmpegCommand ? _item.ffmpegCommand.trim().split(/\s+/).filter(Boolean) : [];
		const command = {
			text: `${_description.infoText}: [convert file ${iteration}/${_item.import.inputFile.length}]\n ${originalName} → ${newName}`,
			duration: curDuration || 0,
			command: ['-y', '-i', fileFrom, ...ffmpegArgs, fileTo],
		};

		await spawnFFmpegCommand(command, _description, sendToMW);

		finalFile.push(fileTo);

		iteration++;
	}

	return finalFile;
}
