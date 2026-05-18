import { isFile } from '../../electron/main/fileSistem/operation/isFile';
import { getFileTypeByExt } from '../../electron/main/utilits/getFileTypeByExt';
import { getFullInfoFromVideoFile } from '../../electron/main/processing/ffmpeg/getFullInfoFromVideoFile';
import { detectSceneCuts } from '../../electron/main/processing/ffmpeg/detectSceneCut';
import { sendToMW } from '../_template/pluginSender';
import path from 'path';

export { onLoad } from '../_template/pluginSender';

export async function getTimecodeFunc(_item: any, _description: any) {
	let timeCodes: number[] = [];

	const op = (Array.isArray(_item.operation) ? _item.operation[0] : _item.operation) ?? 'set';

	if (op.toLowerCase() === 'scene timecode') {
		for (const curItem of _item.import.inputFile) {
			if (!isFile(curItem)) continue;
			const itemType = getFileTypeByExt(curItem, _description.typeOfFile);
			if (!['video', 'audio'].includes(itemType)) continue;
			sendToMW('statusbar', `${_description.infoText}: [get Scene Timecode]\n${path.basename(curItem)}`);
			const scenes = await detectSceneCuts(curItem, _description);
			const { durationInSeconds } = await getFullInfoFromVideoFile(curItem, _description);
			timeCodes = [...scenes, durationInSeconds];
			break;
		}
		sendToMW('log', { level: 'info', text: timeCodes.join(', ') });
		return timeCodes;
	}

	for (let curItem of _item.import.inputFile) {
		const checkIsFile = isFile(curItem);
		sendToMW('statusbar', `${_description.infoText}: [get Timecode]\n${path.basename(curItem)}`);

		if (checkIsFile) {
			let itemType = getFileTypeByExt(curItem, _description.typeOfFile);
			if (!['video', 'audio'].includes(itemType)) {
				continue;
			}
		}
		if (checkIsFile) {
			const fileDur: number = (await getFullInfoFromVideoFile(curItem, _description)).durationInSeconds;
			timeCodes.push(fileDur);
		} else {
			timeCodes.push(curItem);
		}
	}

	switch (op.toLowerCase()) {
		case 'summ':
			timeCodes = [timeCodes.reduce((acc, item) => acc + (Number(item) || 0), 0)];
			break;
		case 'min':
			timeCodes = [Math.min(...timeCodes)];
			break;
		case 'max':
			timeCodes = [Math.max(...timeCodes)];
			break;
		case 'set':
			if (timeCodes.length == 0) {
				timeCodes = [+_item.splitBy];
			}
			break;
		// case 'random':
		// 	_item.finalFile = [getRandomDurationInSec(setDuration, 25)];
		// 	break;
		default:
			break;
	}
	sendToMW('log', { level: 'info', text: timeCodes });

	return timeCodes;
}
