// splitFile — нарезает видеофайл по таймкоду или сценам/чёрным кадрам.
// Tauri-port: вместо detectSceneCuts/detectBlackFrames-из-electron используем
// ffmpeg.detectScenes / ffmpeg.detectBlackFrames из helper'а.

import path from 'path';
import type { PluginContext } from '../../src/PluginAPI/host';
import { createPathForFileByPattern } from '../../src/Utils/createPathForFileByPattern';
import { buildEncodeArgs, encodeExt, parseEncodeSettings } from '../../src/Utils/ffmpegCaps';


function getRandomInRange(min: number, max: number): number {
	if (min === max) return min;
	return min + Math.random() * (max - min);
}

export async function splitFileFunc(_item: any, _description: any, ctx: PluginContext): Promise<string[]> {
	const { fs, ffmpeg, sendToMW } = ctx;
	const finalFile: string[] = [];

	const sceneDetect: boolean = _item.sceneDetection || false;
	const blackFrames: boolean = _item.blackFrames || false;

	// Кодирование сегментов. Свойство `encode` — невидимое, его правит шестерёнка в шапке
	// ноды; профиль `fastCut` (`libx264 -preset superfast`) повторяет то, чем нарезка
	// кодировала до появления настройки. У ноды из СТАРОГО флоу этого свойства нет вовсе
	// (сохранённый граф не досыпает свойства из ui.json) — тогда работает тот же профиль.
	const enc = parseEncodeSettings(_item.encode, 'fastCut');

	// splitBy может быть числом (old format) или массивом [min, max] (new format)
	let splitByMin = 0;
	let splitByMax = 0;
	if (Array.isArray(_item.splitBy)) {
		[splitByMin, splitByMax] = _item.splitBy as [number, number];
	} else {
		const val = Number(_item.splitBy || 0);
		splitByMin = val;
		splitByMax = val;
	}

	let curPath: string[] = _item.targetPath.length === 0 ? ['$clearName (split $random(3))'] : [..._item.targetPath];
	const tPath: string[] = _item.import.targetPath || [];

	for (const fileFrom of _item.import.inputFile as string[]) {
		if (tPath.length !== 0) curPath.unshift(...tPath);
		else curPath.unshift(path.dirname(fileFrom));

		const fileTo = createPathForFileByPattern(curPath, _description, fileFrom);
		const dirPath = path.dirname(fileTo);
		const fileName = path.basename(fileTo, path.extname(fileTo));
		// Расширение — из настроек кодирования: `original` = как у источника (прежнее
		// поведение), иначе выбранный контейнер.
		const ext = `.${encodeExt(enc, fileTo)}`;

		await fs.mkdir(dirPath);

		const fileInfo = await ffmpeg.getInfo(fileFrom);

		sendToMW('statusbar', { text: `${_description.infoText}: [split file]\n${path.basename(fileFrom)}` });

		const finalArrTimeStamp: { stTime: number; sceneDuration: number }[] = [];
		const isSceneMode = splitByMin === 0 && splitByMax === 0;

		if (sceneDetect || blackFrames || isSceneMode) {
			let blackFramesTimeStamp: number[] = [];
			let sceneTimeStamp: number[] = [];

			if (blackFrames) blackFramesTimeStamp = await ffmpeg.detectBlackFrames(fileFrom);
			if (sceneDetect || isSceneMode) sceneTimeStamp = await ffmpeg.detectScenes(fileFrom);

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

				// Если это диапазон нарезки (а не режим сцен)
				const targetDuration = !isSceneMode ? getRandomInRange(splitByMin, splitByMax) : 0;

				if (!isSceneMode && curSceneLength >= targetDuration && targetDuration > 0) {
					if (accumulatedDuration > 0) {
						finalArrTimeStamp.push({ stTime: startSceneTime, sceneDuration: accumulatedDuration });
						accumulatedDuration = 0;
					}
					finalArrTimeStamp.push({ stTime: curStTimeScene, sceneDuration: targetDuration });
					startSceneTime = curStTimeScene + targetDuration;
				} else {
					if (accumulatedDuration === 0) {
						if (timeStamp[i] > startSceneTime) startSceneTime = timeStamp[i];
						accumulatedDuration = curSceneLength;
						i++;
					} else {
						const maxAccum = !isSceneMode ? targetDuration : Infinity;
						if (accumulatedDuration + curSceneLength <= maxAccum) {
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
			// Режим нарезки по длительности (без сцен)
			let stTime = 0;
			while (stTime < fileInfo.durationInSeconds) {
				const duration = getRandomInRange(splitByMin, splitByMax);
				finalArrTimeStamp.push({ stTime, sceneDuration: duration });
				stTime += duration;
			}
		}

		// Если получился один сегмент длиной во весь файл — возвращаем оригинал.
		if (finalArrTimeStamp.length === 1 && finalArrTimeStamp[0].sceneDuration === fileInfo.durationInSeconds) {
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
					'-ss',
					String(finalArrTimeStamp[scNumm].stTime),
					'-i',
					fileFrom,
					...buildEncodeArgs(enc),
					'-c:a',
					'aac',
					'-t',
					String(finalArrTimeStamp[scNumm].sceneDuration),
					outputFile,
				],
			});
			finalFile.push(outputFile);
		}
	}

	sendToMW('log', { level: 'info', text: `Result:\n${finalFile.join('\n')}` });
	return finalFile;
}
