// convertFile_v1 — ручная конвертация ffmpeg-аргументами. Tauri-port.

import path from 'path';
import { fs, ffmpeg, sendToMW } from '../_template/tauri';
import { createPathForFileByPattern } from '../../electron/main/utilits/createPathForFileByPattern';

export { onLoad } from '../_template/tauri';

export async function convertFileFunc(_item: any, _description: any): Promise<string[]> {
	const finalFile: string[] = [];
	let iteration = 1;
	const inputs: string[] = _item.import.inputFile;

	for (const fileFrom of inputs) {
		let curPath: string[] =
			_item.targetPath.length === 0 ? ['$clearName ($random(3))'] : [..._item.targetPath];

		if (_item.import.targetPath?.length) {
			curPath.unshift(..._item.import.targetPath);
		} else {
			curPath.unshift('$localFolder', '$mainFolderName', '$projectName', '$findTime');
		}

		const newPath = createPathForFileByPattern(curPath, _description, fileFrom);
		const dirTo = path.dirname(newPath);
		const originalName = path.basename(fileFrom);
		const newName = path.basename(newPath, path.extname(newPath)) + '.' + _item.fileExt[0];
		const fileTo = path.join(dirTo, newName);

		await fs.mkdir(dirTo);

		const curDuration = (await ffmpeg.getInfo(fileFrom)).durationInSeconds;
		const ffmpegArgs = _item.ffmpegCommand
			? _item.ffmpegCommand.trim().split(/\s+/).filter(Boolean)
			: [];

		await ffmpeg.run({
			text: `${_description.infoText}: [convert file ${iteration}/${inputs.length}]\n ${originalName} → ${newName}`,
			duration: curDuration || 0,
			nodeId: _item.id,
			command: ['-y', '-i', fileFrom, ...ffmpegArgs, fileTo],
		});

		finalFile.push(fileTo);
		iteration++;
	}

	sendToMW('log', { level: 'info', text: `Result:\n${finalFile.join('\n')}` });
	return finalFile;
}
