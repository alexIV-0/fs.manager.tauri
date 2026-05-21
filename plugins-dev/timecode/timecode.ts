// timecode — возвращает таймкод из файла(ов) или вручную выставленное значение.
// Поддерживает операции SET / MAX / MIN / SUMM / SCENE_TIMECODE.
// Tauri-port: getFullInfoFromVideoFile/detectSceneCuts через helper.

import path from 'path';
import { fs, ffmpeg, sendToMW } from '../_template/tauri';
import { getFileTypeByExt } from '../../src/Utils/getFileTypeByExt';

export { onLoad } from '../_template/tauri';

export async function getTimecodeFunc(_item: any, _description: any): Promise<(number | string)[]> {
	let timeCodes: (number | string)[] = [];

	const op = (Array.isArray(_item.operation) ? _item.operation[0] : _item.operation) ?? 'set';

	if (String(op).toLowerCase() === 'scene timecode') {
		for (const curItem of _item.import.inputFile as string[]) {
			if (!(await fs.existsFile(curItem))) continue;
			const itemType = getFileTypeByExt(curItem, _description.typeOfFile);
			if (!['video', 'audio'].includes(itemType)) continue;
			sendToMW('statusbar', { text: `${_description.infoText}: [get Scene Timecode]\n${path.basename(curItem)}` });
			const scenes = await ffmpeg.detectScenes(curItem);
			const { durationInSeconds } = await ffmpeg.getInfo(curItem);
			timeCodes = [...scenes, durationInSeconds];
			break;
		}
		sendToMW('log', { level: 'info', text: timeCodes.join(', ') });
		return timeCodes;
	}

	for (const curItem of _item.import.inputFile as string[]) {
		const checkIsFile = await fs.existsFile(curItem);
		sendToMW('statusbar', { text: `${_description.infoText}: [get Timecode]\n${path.basename(String(curItem))}` });

		if (checkIsFile) {
			const itemType = getFileTypeByExt(curItem, _description.typeOfFile);
			if (!['video', 'audio'].includes(itemType)) continue;
			const fileDur = (await ffmpeg.getInfo(curItem)).durationInSeconds;
			timeCodes.push(fileDur);
		} else {
			timeCodes.push(curItem);
		}
	}

	switch (String(op).toLowerCase()) {
		case 'summ':
			timeCodes = [timeCodes.reduce<number>((acc, item) => acc + (Number(item) || 0), 0)];
			break;
		case 'min':
			timeCodes = [Math.min(...timeCodes.map((v) => Number(v) || 0))];
			break;
		case 'max':
			timeCodes = [Math.max(...timeCodes.map((v) => Number(v) || 0))];
			break;
		case 'set':
			if (timeCodes.length === 0) timeCodes = [+_item.splitBy];
			break;
	}

	sendToMW('log', { level: 'info', text: String(timeCodes) });
	return timeCodes;
}
