import { getFileTypeByExt } from '../../electron/main/utilits/getFileTypeByExt';
import { getFullInfoFromVideoFile } from '../../electron/main/processing/ffmpeg/getFullInfoFromVideoFile';
import { spawnFFmpegCommand } from '../../electron/main/processing/ffmpeg/spawnFFmpegCommand';
import { createPathForFileByPattern } from '../../electron/main/utilits/createPathForFileByPattern';
import { sendToMW } from '../_template/pluginSender';
import path from 'path';
import { testAndCreateFolder } from '../../electron/main/fileSistem/testAndCreateFolder';

export { onLoad } from '../_template/pluginSender';

export async function merge2filesFunc(_item: any, _description: any) {
	const finalFile: string[] = [];

	// ── Входные файлы ─────────────────────────────────────────────────────────
	const inputVA: string[] = _item.import.inputVA ?? []; // видео или аудио
	const inputA: string[] = _item.import.inputA ?? []; // только аудио

	if (inputVA.length === 0 || inputA.length === 0) {
		sendToMW('log', { level: 'warn', text: `[merge2files] One of the inputs is empty, skipping` });
		return finalFile;
	}

	// ── Путь для сохранения ───────────────────────────────────────────────────
	let curPath: string[] = _item.targetPath?.length > 0 ? [..._item.targetPath] : ['$clearName ($random(3))'];

	if (_item.import.targetPath?.length > 0) {
		curPath.unshift(..._item.import.targetPath);
	} else {
		curPath.unshift('$localFolder', '$mainFolderName', '$projectName', '$findTime');
	}

	// ── Настройки ─────────────────────────────────────────────────────────────
	const durationMode: string = (_item.dyrationMode ?? 'video').toLowerCase().trim();
	const changeSpeed: boolean = _item.changeVideoSpeed ?? false;
	const mixAudio: boolean = _item.mixAudio ?? false;
	const outputFormat: string = _item.outputFormat ?? 'mp4';

	// ── Декартово произведение: каждый файл из inputVA × каждый из inputA ────
	for (const fileVA of inputVA) {
		const typeVA = getFileTypeByExt(fileVA, _description.typeOfFile);
		const infoVA = await getFullInfoFromVideoFile(fileVA, _description);

		for (const fileA of inputA) {
			const infoA = await getFullInfoFromVideoFile(fileA, _description);

			sendToMW('statusbar', {
				text: `${_description.infoText}: [merge 2 files]\n${path.basename(fileVA)} + ${path.basename(fileA)}`,
			});

			// ── Определяем длительность ───────────────────────────────────────
			let duration = 0;
			switch (durationMode) {
				case 'video':
					duration = typeVA === 'video' ? infoVA.durationInSeconds : infoA.durationInSeconds;
					break;
				case 'audio':
					duration = typeVA === 'audio' ? infoVA.durationInSeconds : infoA.durationInSeconds;
					break;
				case 'min':
					duration = Math.min(infoVA.durationInSeconds, infoA.durationInSeconds);
					break;
				case 'max':
					duration = Math.max(infoVA.durationInSeconds, infoA.durationInSeconds);
					break;
				default:
					duration = Math.max(infoVA.durationInSeconds, infoA.durationInSeconds);
			}

			// ── Путь финального файла ─────────────────────────────────────────
			const basePath = createPathForFileByPattern(curPath, _description, fileVA);
			const fileTo = path.join(path.dirname(basePath), path.basename(basePath, path.extname(basePath)) + '.' + outputFormat);

			sendToMW('log', { level: 'info', text: `outputFile:\n${fileTo}` });
			// ── Фильтр изменения скорости видео ──────────────────────────────
			let speedFilter = '';
			if (changeSpeed && typeVA === 'video' && infoVA.durationInSeconds > 0 && duration > 0) {
				const ratio = infoVA.durationInSeconds / duration;
				speedFilter = `[0:v]setpts=${(1 / ratio).toFixed(4)}*PTS[v]`;
			}

			// ── Формируем массив аргументов ffmpeg ────────────────────────────
			// Каждый аргумент — отдельный элемент массива, без кавычек и split
			let ffmpegArgs: string[] = [];

			if (typeVA === 'video') {
				if (mixAudio && infoVA.hasAudio) {
					// Видео с аудиодорожкой — миксуем оригинальное аудио с новым
					if (speedFilter) {
						ffmpegArgs = [
							'-filter_complex',
							`${speedFilter};[0:a][1:a]amix=inputs=2[a]`,
							'-map',
							'[v]',
							'-map',
							'[a]',
							'-c:v',
							'libx264',
							'-c:a',
							'aac',
							'-t',
							String(duration),
						];
					} else {
						ffmpegArgs = [
							'-filter_complex',
							'[0:a][1:a]amix=inputs=2[a]',
							'-map',
							'0:v',
							'-map',
							'[a]',
							'-c:v',
							'copy',
							'-c:a',
							'aac',
							'-t',
							String(duration),
						];
					}
				} else {
					// Видео без аудиодорожки или замена аудио (mixAudio=false)
					if (speedFilter) {
						ffmpegArgs = [
							'-filter_complex',
							speedFilter,
							'-map',
							'[v]',
							'-map',
							'1:a',
							'-c:v',
							'libx264',
							'-c:a',
							'aac',
							'-t',
							String(duration),
						];
					} else {
						ffmpegArgs = ['-c:v', 'copy', '-c:a', 'aac', '-map', '0:v', '-map', '1:a', '-t', String(duration)];
					}
				}
			} else {
				// Оба файла — аудио: всегда миксуем
				ffmpegArgs = ['-filter_complex', '[0:a][1:a]amix=inputs=2[a]', '-map', '[a]', '-t', String(duration)];
			}

			const command = {
				text: `${_description.infoText}: [merge 2 files]\n${path.basename(fileVA)} + ${path.basename(fileA)}`,
				duration,
				command: ['-y', '-i', fileVA, '-i', fileA, ...ffmpegArgs, fileTo],
			};

			testAndCreateFolder(path.dirname(fileTo));
			await spawnFFmpegCommand(command, _description, sendToMW);

			finalFile.push(fileTo);
		}
	}
	sendToMW('log', { level: 'info', text: `Result:\n${finalFile}` });
	return finalFile;
}
