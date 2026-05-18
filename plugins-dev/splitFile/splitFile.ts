import { detectSceneCuts } from '../../electron/main/processing/ffmpeg/detectSceneCut';
import { getFullInfoFromVideoFile } from '../../electron/main/processing/ffmpeg/getFullInfoFromVideoFile';
import path from 'path';
import { spawnFFmpegCommand } from '../../electron/main/processing/ffmpeg/spawnFFmpegCommand';
import { detectBlackFrames } from '../../electron/main/processing/ffmpeg/detectBlackFrames';

import { createPathForFileByPattern } from '../../electron/main/utilits/createPathForFileByPattern';
import { sendToMW } from '../_template/pluginSender';
import { testAndCreateFolder } from '../../electron/main/fileSistem/testAndCreateFolder';

export { onLoad } from '../_template/pluginSender';
export async function splitFileFunc(_item: any, _description: any) {
	const finalFile = [];

	// некоторые переменные, которые должня быть в интерфейсе ноды.
	// и значения по умолчанию если их нет (пока. т.к. не готовы компоненты. в будущем они будут обязательно)
	const sceneDetect = _item.sceneDetection || false;
	const blackFrames = _item.blackFrames || false;
	// const threshold = _item.threshold || 0.3;
	let splitBy = _item.splitBy || 0;

	let curPath = _item.targetPath.length == 0 ? ['$clearName (split $random(3))'] : _item.targetPath;

	const tPath = _item.import.targetPath || [];
	for (let fileFrom of _item.import.inputFile) {
		if (tPath.length != 0) {
			curPath.unshift(...tPath);
		} else {
			curPath.unshift(path.dirname(fileFrom));
		}
		let fileTo = createPathForFileByPattern(curPath, _description, fileFrom);
		const dirPath = path.dirname(fileTo);
		const fileName = path.basename(fileTo, path.extname(fileTo));
		const ext = path.extname(fileTo);

		testAndCreateFolder(dirPath);

		const fileInfo = await getFullInfoFromVideoFile(fileFrom, _description);

		sendToMW('statusbar', `${_description.infoText}: [split file]\n${path.basename(fileFrom)}`);

		const finalArrTimeStamp: { stTime: number; sceneDuration: number }[] = [];

		if (sceneDetect || blackFrames || splitBy == 0) {
			let timeStamp: number[] = [];

			let blackFramesTimeStamp: number[] = [];
			let sceneTimeStamp: number[] = [];
			if (blackFrames) {
				blackFramesTimeStamp = await detectBlackFrames(fileFrom, _description);
			}
			if (sceneDetect || splitBy == 0) {
				// sceneTimeStamp = await detectSceneCuts(fileFrom, threshold, _description);
				sceneTimeStamp = await detectSceneCuts(fileFrom, _description);
			}

			const combinedTimeStamp = [...blackFramesTimeStamp, ...sceneTimeStamp];
			const uniqueTimeStamp = [...new Set(combinedTimeStamp)];
			timeStamp = uniqueTimeStamp.sort((a, b) => a - b);
			timeStamp.push(+fileInfo.durationInSeconds);
			let i = 0;
			let startSceneTime = timeStamp[i]; // Начало текущего блока
			let accumulatedDuration = 0;

			while (i < timeStamp.length - 1) {
				const nextTime = timeStamp[i + 1];
				let curStTimeScene = timeStamp[i];
				if (timeStamp[i] < startSceneTime) {
					curStTimeScene = startSceneTime;
				}
				const curSceneLength = Math.round((nextTime - curStTimeScene) * 1000) / 1000;

				if (curSceneLength >= splitBy && splitBy > 0) {
					// Длинная сцена: закрываем предыдущий блок, если он есть
					if (accumulatedDuration > 0) {
						finalArrTimeStamp.push({ stTime: startSceneTime, sceneDuration: accumulatedDuration });
						accumulatedDuration = 0;
					}
					// Начинаем новую сцену длиной splitBy
					finalArrTimeStamp.push({ stTime: curStTimeScene, sceneDuration: splitBy });
					startSceneTime = curStTimeScene + splitBy;
				} else {
					// Текущая сцена короткая
					if (accumulatedDuration === 0) {
						// Начинаем блок
						if (timeStamp[i] > startSceneTime) {
							startSceneTime = timeStamp[i];
						}
						accumulatedDuration = curSceneLength;
						i++;
					} else {
						// Продолжаем накапливать
						if (accumulatedDuration + curSceneLength <= splitBy) {
							accumulatedDuration += curSceneLength;
							i++;
						} else {
							// Не влезает — закрываем
							finalArrTimeStamp.push({ stTime: startSceneTime, sceneDuration: accumulatedDuration });
							accumulatedDuration = 0;
							// Не увеличиваем i — следующая итерация начнёт с этого же i
						}
					}
				}
			}

			// Закрываем последний блок
			if (accumulatedDuration > 0) {
				finalArrTimeStamp.push({ stTime: startSceneTime, sceneDuration: accumulatedDuration });
			}
		} else {
			let stTime = 0;
			while (stTime < fileInfo.durationInSeconds) {
				finalArrTimeStamp.push({ stTime: stTime, sceneDuration: splitBy });
				stTime += splitBy;
			}
		}

		if (finalArrTimeStamp.length == 1 && finalArrTimeStamp[0].sceneDuration == fileInfo.durationInSeconds) {
			return [fileFrom];
		}

		for (let scNumm = 0; scNumm < finalArrTimeStamp.length; scNumm++) {
			const outputFile = path.join(dirPath, `${fileName}-${scNumm + 1}${ext}`);

			const command = {
				text: `${_description.infoText}: [split file]\n${path.basename(fileFrom)} → ${path.basename(outputFile)} (${
					scNumm + 1
				}/${finalArrTimeStamp.length})`,
				duration: finalArrTimeStamp[scNumm].sceneDuration,
				command: [
					`-ss`,
					String(finalArrTimeStamp[scNumm].stTime),
					'-i',
					fileFrom,
					'-c:v',
					'libx264',
					'-preset',
					'superfast',
					'-c:a',
					'aac',
					'-t',
					String(finalArrTimeStamp[scNumm].sceneDuration),
					outputFile,
				],
			};

			await spawnFFmpegCommand(command, _description, sendToMW);
			finalFile.push(outputFile);
		}
	}
	sendToMW('log', { level: 'info', text: `Result:\n${finalFile}` });
	return finalFile;
}
