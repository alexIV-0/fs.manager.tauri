// splitFile — нарезает видеофайл по таймкоду или сценам/чёрным кадрам.
// Tauri-port: вместо detectSceneCuts/detectBlackFrames-из-electron используем
// ffmpeg.detectScenes / ffmpeg.detectBlackFrames из helper'а.

import path from 'path';
import { fs, ffmpeg, sendToMW } from '../_template/tauri';
import { createPathForFileByPattern } from '../../electron/main/utilits/createPathForFileByPattern';

export { onLoad } from '../_template/tauri';

export async function splitFileFunc(_item: any, _description: any): Promise<string[]> {
	const finalFile: string[] = [];

	const sceneDetect: boolean = _item.sceneDetection || false;
	const blackFrames: boolean = _item.blackFrames || false;
	const splitBy: number = Number(_item.splitBy || 0);

	let curPath: string[] =
		_item.targetPath.length === 0 ? ['$clearName (split $random(3))'] : [..._item.targetPath];
	const tPath: string[] = _item.import.targetPath || [];

	for (const fileFrom of _item.import.inputFile as string[]) {
		if (tPath.length !== 0) curPath.unshift(...tPath);
		else curPath.unshift(path.dirname(fileFrom));

		const fileTo = createPathForFileByPattern(curPath, _description, fileFrom);
		const dirPath = path.dirname(fileTo);
		const fileName = path.basename(fileTo, path.extname(fileTo));
		const ext = path.extname(fileTo);

		await fs.mkdir(dirPath);

		const fileInfo = await ffmpeg.getInfo(fileFrom);

		sendToMW('statusbar', { text: `${_description.infoText}: [split file]\n${path.basename(fileFrom)}` });

		const finalArrTimeStamp: { stTime: number; sceneDuration: number }[] = [];

		if (sceneDetect || blackFrames || splitBy === 0) {
			let blackFramesTimeStamp: number[] = [];
			let sceneTimeStamp: number[] = [];

			if (blackFrames) blackFramesTimeStamp = await ffmpeg.detectBlackFrames(fileFrom);
			if (sceneDetect || splitBy === 0) sceneTimeStamp = await ffmpeg.detectScenes(fileFrom);

			const combined = [...blackFramesTimeStamp, ...sceneTimeStamp];
			const timeStamp = [...new Set(combined)].sort((a, b) => a - b);
			timeStamp.push(+fileInfo.durationInSeconds);

			let i = 0;
			let startSceneTime = timeStamp[i];
			let accumulatedDuration = 0;

			while (i < timeStamp.length - 1) {
				const nextTime = timeStamp[i + 1];
				let curStTimeScene = timeStamp[i];
				if (timeStamp[i] < startSceneTime) curStTimeScene = startSceneTime;
				const curSceneLength = Math.round((nextTime - curStTimeScene) * 1000) / 1000;

				if (curSceneLength >= splitBy && splitBy > 0) {
					if (accumulatedDuration > 0) {
						finalArrTimeStamp.push({ stTime: startSceneTime, sceneDuration: accumulatedDuration });
						accumulatedDuration = 0;
					}
					finalArrTimeStamp.push({ stTime: curStTimeScene, sceneDuration: splitBy });
					startSceneTime = curStTimeScene + splitBy;
				} else {
					if (accumulatedDuration === 0) {
						if (timeStamp[i] > startSceneTime) startSceneTime = timeStamp[i];
						accumulatedDuration = curSceneLength;
						i++;
					} else {
						if (accumulatedDuration + curSceneLength <= splitBy) {
							accumulatedDuration += curSceneLength;
							i++;
						} else {
							finalArrTimeStamp.push({ stTime: startSceneTime, sceneDuration: accumulatedDuration });
							accumulatedDuration = 0;
						}
					}
				}
			}

			if (accumulatedDuration > 0) {
				finalArrTimeStamp.push({ stTime: startSceneTime, sceneDuration: accumulatedDuration });
			}
		} else {
			let stTime = 0;
			while (stTime < fileInfo.durationInSeconds) {
				finalArrTimeStamp.push({ stTime, sceneDuration: splitBy });
				stTime += splitBy;
			}
		}

		// Если получился один сегмент длиной во весь файл — возвращаем оригинал.
		if (
			finalArrTimeStamp.length === 1 &&
			finalArrTimeStamp[0].sceneDuration === fileInfo.durationInSeconds
		) {
			return [fileFrom];
		}

		for (let scNumm = 0; scNumm < finalArrTimeStamp.length; scNumm++) {
			const outputFile = path.join(dirPath, `${fileName}-${scNumm + 1}${ext}`);
			await ffmpeg.run({
				text: `${_description.infoText}: [split file]\n${path.basename(fileFrom)} → ${path.basename(outputFile)} (${scNumm + 1}/${finalArrTimeStamp.length})`,
				duration: finalArrTimeStamp[scNumm].sceneDuration,
				nodeId: _item.id,
				command: [
					'-y',
					'-ss', String(finalArrTimeStamp[scNumm].stTime),
					'-i', fileFrom,
					'-c:v', 'libx264',
					'-preset', 'superfast',
					'-c:a', 'aac',
					'-t', String(finalArrTimeStamp[scNumm].sceneDuration),
					outputFile,
				],
			});
			finalFile.push(outputFile);
		}
	}

	sendToMW('log', { level: 'info', text: `Result:\n${finalFile.join('\n')}` });
	return finalFile;
}
