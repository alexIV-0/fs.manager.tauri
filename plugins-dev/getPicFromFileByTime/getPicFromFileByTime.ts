// getPicFromFileByTime — извлекает кадры из видео по таймкодам (сцены /
// чёрные кадры / регулярные интервалы / импортированные точки).
// Tauri-port: ffmpeg/fs через helper.

import path from 'path';
import { fs, ffmpeg, sendToMW } from '../_template/tauri';
import { createPathForFileByPattern } from '../../src/Utils/createPathForFileByPattern';

export { onLoad } from '../_template/tauri';

export async function getPicFromFileByTime(_item: any, _description: any): Promise<string[]> {
	const finalFile: string[] = [];

	const sceneDetect: boolean = _item.sceneDetection || false;
	const splitBy: number = Number(_item.splitBy || 0);
	const ALLOWED = ['jpeg', 'jpg', 'png', 'webp', 'bmp', 'tiff'];
	const rawFormat = (_item.outputFormat || 'jpeg').toLowerCase();
	const outputFormat = ALLOWED.includes(rawFormat) ? rawFormat : 'jpeg';
	const qualityPic: number = _item.qualityPic || 2;

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
				for (const t of await parseTimecodeFile(val)) {
					if (!importedTimestamps.includes(t)) importedTimestamps.push(t);
				}
			}
		}
		importedTimestamps.sort((a, b) => a - b);
	}

	for (const fileFrom of _item.import.inputFile as string[]) {
		const fileTo = createPathForFileByPattern(curPath, _description, fileFrom);
		const dirPath = path.dirname(fileTo);
		const fileName = path.basename(fileTo, path.extname(fileTo));

		await fs.mkdir(dirPath);

		const fileInfo = await ffmpeg.getInfo(fileFrom);
		sendToMW('statusbar', { text: `${_description.infoText}: [get pic from video]\n${path.basename(fileFrom)}` });

		const finalArrTimeStamp: { stTime: number; sceneDuration: number }[] = [];

		if (importedTimestamps !== null) {
			for (const t of importedTimestamps) {
				if (t < +fileInfo.durationInSeconds) {
					finalArrTimeStamp.push({ stTime: t, sceneDuration: 0 });
				}
			}
		} else if (sceneDetect || splitBy === 0) {
			const timeStamp = await ffmpeg.detectScenes(fileFrom);
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
				const sceneDuration = Math.min(+fileInfo.durationInSeconds - stTime, splitBy);
				finalArrTimeStamp.push({ stTime, sceneDuration });
				stTime += splitBy;
			}
		}

		for (let scNumm = 0; scNumm < finalArrTimeStamp.length; scNumm++) {
			const { stTime, sceneDuration } = finalArrTimeStamp[scNumm];
			const timeCode = formatTimecodeForFilename(stTime);
			const outputFile = path.join(dirPath, `${scNumm + 1} [${timeCode}] ${fileName}.${outputFormat}`);

			await ffmpeg.run({
				text: `${_description.infoText}: [get pic from video]\n${path.basename(fileFrom)} (${scNumm + 1}/${finalArrTimeStamp.length})`,
				duration: sceneDuration,
				nodeId: _item.id,
				command: ['-y', '-ss', String(stTime), '-i', fileFrom, '-vframes', '1', '-q:v', String(qualityPic), outputFile],
			});
			finalFile.push(outputFile);
		}
	}

	sendToMW('log', { level: 'info', text: `Result:\n${finalFile.join('\n')}` });
	return finalFile;
}

async function parseTimecodeFile(filePath: string): Promise<number[]> {
	try {
		const content = await fs.read(filePath);
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

function parseTimecodeToSeconds(tc: string): number | null {
	tc = tc.trim();
	if (!tc) return null;

	let match = tc.match(/^(\d+):(\d{2}):(\d{2})(?:[.,](\d+))?$/);
	if (match) {
		const ms = match[4] ? parseInt(match[4]) / Math.pow(10, match[4].length) : 0;
		return parseInt(match[1]) * 3600 + parseInt(match[2]) * 60 + parseInt(match[3]) + ms;
	}
	match = tc.match(/^(\d+):(\d{2})(?:[.,](\d+))?$/);
	if (match) {
		const ms = match[3] ? parseInt(match[3]) / Math.pow(10, match[3].length) : 0;
		return parseInt(match[1]) * 60 + parseInt(match[2]) + ms;
	}
	match = tc.match(/^(\d+)\.(\d{2})\.(\d{2})$/);
	if (match) {
		return parseInt(match[1]) * 3600 + parseInt(match[2]) * 60 + parseInt(match[3]);
	}
	const num = parseFloat(tc);
	if (!isNaN(num)) return num;
	return null;
}

function formatTimecodeForFilename(timecode: number): string {
	const seconds = Math.floor(timecode);
	const pad = (num: number) => num.toString().padStart(2, '0');
	return `${pad(Math.floor(seconds / 3600))}.${pad(Math.floor((seconds % 3600) / 60))}.${pad(seconds % 60)}`;
}
