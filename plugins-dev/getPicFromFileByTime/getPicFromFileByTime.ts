import { detectSceneCuts } from '../../electron/main/processing/ffmpeg/detectSceneCut';
import { getFullInfoFromVideoFile } from '../../electron/main/processing/ffmpeg/getFullInfoFromVideoFile';
import path from 'path';
import fs from 'fs';
import { spawnFFmpegCommand } from '../../electron/main/processing/ffmpeg/spawnFFmpegCommand';
import { createPathForFileByPattern } from '../../electron/main/utilits/createPathForFileByPattern';
import { sendToMW } from '../_template/pluginSender';
import { testAndCreateFolder } from '../../electron/main/fileSistem/testAndCreateFolder';

export { onLoad } from '../_template/pluginSender';

export async function getPicFromFileByTime(_item: any, _description: any) {
	const finalFile: string[] = [];

	const sceneDetect = _item.sceneDetection || false;
	const splitBy = _item.splitBy || 0;
	const ALLOWED_IMAGE_FORMATS = ['jpeg', 'jpg', 'png', 'webp', 'bmp', 'tiff'];
	const rawFormat = (_item.outputFormat || 'jpeg').toLowerCase();
	const outputFormat = ALLOWED_IMAGE_FORMATS.includes(rawFormat) ? rawFormat : 'jpeg';
	const qualityPic = _item.qualityPic || 2;

	// ── Путь для сохранения ───────────────────────────────────────────────────
	let curPath: string[] = _item.targetPath?.length > 0 ? [..._item.targetPath] : ['$clearName (pics $random(3))'];

	if (_item.import.targetPath?.length > 0) {
		curPath.unshift(..._item.import.targetPath);
	} else {
		curPath.unshift('$localFolder', '$mainFolderName', '$projectName', '$findTime');
	}

	const splitByImport: any[] = _item.import?.splitBy || [];

	let importedTimestamps: number[] | null = null;
	if (splitByImport.length > 0) {
		importedTimestamps = [];
		for (const val of splitByImport) {
			const parsed = parseTimecodeToSeconds(String(val));
			if (parsed !== null) {
				if (!importedTimestamps.includes(parsed)) importedTimestamps.push(parsed);
			} else if (typeof val === 'string') {
				for (const t of parseTimecodeFile(val)) {
					if (!importedTimestamps.includes(t)) importedTimestamps.push(t);
				}
			}
		}
		importedTimestamps.sort((a, b) => a - b);
	}

	for (const fileFrom of _item.import.inputFile) {
		const fileTo = createPathForFileByPattern(curPath, _description, fileFrom);
		const dirPath = path.dirname(fileTo);
		const fileName = path.basename(fileTo, path.extname(fileTo));

		testAndCreateFolder(dirPath);

		const fileInfo = await getFullInfoFromVideoFile(fileFrom, _description);
		sendToMW('statusbar', `${_description.infoText}: [get pic from video]\n${path.basename(fileFrom)}`);

		const finalArrTimeStamp: { stTime: number; sceneDuration: number }[] = [];

		if (importedTimestamps !== null) {
			// Приоритет: таймкоды из файла (только в пределах длины видео)
			for (const t of importedTimestamps) {
				if (t < +fileInfo.durationInSeconds) {
					finalArrTimeStamp.push({ stTime: t, sceneDuration: 0 });
				}
			}
		} else if (sceneDetect || splitBy == 0) {
			const timeStamp = await detectSceneCuts(fileFrom, _description);

			timeStamp.push(+fileInfo.durationInSeconds);
			let i = 0;
			let startSceneTime = timeStamp[i];
			let accumulatedDuration = 0;

			while (i < timeStamp.length - 1) {
				const nextTime = timeStamp[i + 1];
				let curStTimeScene = timeStamp[i];
				if (timeStamp[i] < startSceneTime) {
					curStTimeScene = startSceneTime;
				}
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
						if (timeStamp[i] > startSceneTime) {
							startSceneTime = timeStamp[i];
						}
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
				const sceneDuration = Math.min(+fileInfo.durationInSeconds - stTime, splitBy);
				finalArrTimeStamp.push({ stTime, sceneDuration });
				stTime += splitBy;
			}
		}

		for (let scNumm = 0; scNumm < finalArrTimeStamp.length; scNumm++) {
			const { stTime, sceneDuration } = finalArrTimeStamp[scNumm];
			const timeCode = formatTimecodeForFilename(stTime);
			const outputFile = path.join(dirPath, `${scNumm + 1} [${timeCode}] ${fileName}.${outputFormat}`);

			const command = {
				text: `${_description.infoText}: [get pic from video]\n${path.basename(fileFrom)} (${scNumm + 1}/${finalArrTimeStamp.length})`,
				duration: sceneDuration,
				command: ['-ss', String(stTime), '-i', fileFrom, '-vframes', '1', '-q:v', String(qualityPic), outputFile],
			};

			await spawnFFmpegCommand(command, _description, sendToMW);
			finalFile.push(outputFile);
		}
	}
	sendToMW('log', { level: 'info', text: `Result:\n${finalFile}` });
	return finalFile;
}

// Читает файл с таймкодами и возвращает массив секунд.
// Формат файла пока не определён — при необходимости доработать эту функцию.
function parseTimecodeFile(filePath: string): number[] {
	try {
		const content = fs.readFileSync(filePath, 'utf-8');
		const lines = content
			.split(/[\r\n,;]+/)
			.map((l) => l.trim())
			.filter(Boolean);
		const result: number[] = [];
		for (const line of lines) {
			const seconds = parseTimecodeToSeconds(line);
			if (seconds !== null) result.push(seconds);
		}
		return result;
	} catch {
		return [];
	}
}

// Парсит строку таймкода в секунды.
// Поддерживает: HH:MM:SS, MM:SS, HH.MM.SS, plain seconds
function parseTimecodeToSeconds(tc: string): number | null {
	tc = tc.trim();
	if (!tc) return null;

	// HH:MM:SS или HH:MM:SS.mmm
	let match = tc.match(/^(\d+):(\d{2}):(\d{2})(?:[.,](\d+))?$/);
	if (match) {
		const ms = match[4] ? parseInt(match[4]) / Math.pow(10, match[4].length) : 0;
		return parseInt(match[1]) * 3600 + parseInt(match[2]) * 60 + parseInt(match[3]) + ms;
	}

	// MM:SS или MM:SS.mmm
	match = tc.match(/^(\d+):(\d{2})(?:[.,](\d+))?$/);
	if (match) {
		const ms = match[3] ? parseInt(match[3]) / Math.pow(10, match[3].length) : 0;
		return parseInt(match[1]) * 60 + parseInt(match[2]) + ms;
	}

	// HH.MM.SS (через точку)
	match = tc.match(/^(\d+)\.(\d{2})\.(\d{2})$/);
	if (match) {
		return parseInt(match[1]) * 3600 + parseInt(match[2]) * 60 + parseInt(match[3]);
	}

	// Просто секунды
	const num = parseFloat(tc);
	if (!isNaN(num)) return num;

	return null;
}

// Форматирует секунды в строку HH.MM.SS для имени файла
function formatTimecodeForFilename(timecode: number): string {
	const seconds = Math.floor(timecode);
	const pad = (num: number) => num.toString().padStart(2, '0');
	return `${pad(Math.floor(seconds / 3600))}.${pad(Math.floor((seconds % 3600) / 60))}.${pad(seconds % 60)}`;
}
