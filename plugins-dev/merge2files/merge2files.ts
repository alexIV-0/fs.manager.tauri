// merge2files — мердж видео+аудио (или аудио+аудио), Cartesian product входов.
// Tauri-port: spawnFFmpegCommand → ffmpeg.run, getFullInfoFromVideoFile → ffmpeg.getInfo.

import path from 'path';
import type { PluginContext } from '../../src/PluginAPI/host';
import { getFileTypeByExt } from '../../src/Utils/getFileTypeByExt';
import { createPathForFileByPattern } from '../../src/Utils/createPathForFileByPattern';


export async function merge2filesFunc(_item: any, _description: any, ctx: PluginContext): Promise<string[]> {
	const { fs, ffmpeg, sendToMW } = ctx;
	const finalFile: string[] = [];

	const inputVA: string[] = _item.import.inputVA ?? [];
	const inputA: string[] = _item.import.inputA ?? [];

	if (inputVA.length === 0 || inputA.length === 0) {
		sendToMW('log', { level: 'warn', text: `[merge2files] One of the inputs is empty, skipping` });
		return finalFile;
	}

	let curPath: string[] = _item.targetPath?.length > 0 ? [..._item.targetPath] : ['$clearName ($random(3))'];
	if (_item.import.targetPath?.length > 0) {
		curPath.unshift(..._item.import.targetPath);
	} else {
		curPath.unshift('$localFolder', '$mainFolderName', '$projectName', '$findTime');
	}

	const durationMode: string = (_item.dyrationMode ?? 'video').toLowerCase().trim();
	const changeSpeed: boolean = _item.changeVideoSpeed ?? false;
	const mixAudio: boolean = _item.mixAudio ?? false;
	const outputFormat: string = _item.outputFormat ?? 'mp4';

	for (const fileVA of inputVA) {
		const typeVA = getFileTypeByExt(fileVA, _description.typeOfFile);
		const infoVA = await ffmpeg.getInfo(fileVA);

		for (const fileA of inputA) {
			const infoA = await ffmpeg.getInfo(fileA);

			sendToMW('statusbar', {
				text: `${_description.infoText}: [merge 2 files]\n${path.basename(fileVA)} + ${path.basename(fileA)}`,
			});

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

			// Картинка не имеет собственной длительности — стоп-кадр тянем на всю длину аудио.
			if (typeVA === 'image') {
				duration = infoA.durationInSeconds;
			}

			const basePath = createPathForFileByPattern(curPath, _description, fileVA);
			const fileTo = path.join(path.dirname(basePath), path.basename(basePath, path.extname(basePath)) + '.' + outputFormat);

			sendToMW('log', { level: 'info', text: `outputFile:\n${fileTo}` });

			let speedFilter = '';
			if (changeSpeed && typeVA === 'video' && infoVA.durationInSeconds > 0 && duration > 0) {
				const ratio = infoVA.durationInSeconds / duration;
				speedFilter = `[0:v]setpts=${(1 / ratio).toFixed(4)}*PTS[v]`;
			}

			let ffmpegArgs: string[] = [];
			// Картинку нужно зациклить как видеовход, чтобы стоп-кадр держался всю длину аудио.
			const inputVAArgs: string[] = typeVA === 'image' ? ['-loop', '1'] : [];

			if (typeVA === 'image') {
				// Стоп-кадр + аудио → видео. Чётные размеры + yuv420p для совместимости проигрывателей.
				ffmpegArgs = [
					'-filter_complex',
					'[0:v]scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p[v]',
					'-map',
					'[v]',
					'-map',
					'1:a',
					'-c:v',
					'libx264',
					'-tune',
					'stillimage',
					'-c:a',
					'aac',
					'-t',
					String(duration),
				];
			} else if (typeVA === 'video') {
				if (mixAudio && infoVA.hasAudio) {
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
				// Оба — аудио, mix
				ffmpegArgs = ['-filter_complex', '[0:a][1:a]amix=inputs=2[a]', '-map', '[a]', '-t', String(duration)];
			}

			await fs.mkdir(path.dirname(fileTo));
			await ffmpeg.run({
				text: `${_description.infoText}: [merge 2 files]\n${path.basename(fileVA)} + ${path.basename(fileA)}`,
				duration,
				nodeId: _item.id,
				command: ['-y', ...inputVAArgs, '-i', fileVA, '-i', fileA, ...ffmpegArgs, fileTo],
			});

			finalFile.push(fileTo);
		}
	}

	sendToMW('log', { level: 'info', text: `Result:\n${finalFile.join('\n')}` });
	return finalFile;
}
