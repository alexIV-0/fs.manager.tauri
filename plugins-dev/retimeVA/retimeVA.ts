import { getFileTypeByExt } from '../../electron/main/utilits/getFileTypeByExt';
import { getFullInfoFromVideoFile } from '../../electron/main/processing/ffmpeg/getFullInfoFromVideoFile';
import { spawnFFmpegCommand } from '../../electron/main/processing/ffmpeg/spawnFFmpegCommand';
import { createPathForFileByPattern } from '../../electron/main/utilits/createPathForFileByPattern';
import { testAndCreateFolder } from '../../electron/main/fileSistem/testAndCreateFolder';
import { sendToMW } from '../_template/pluginSender';
import path from 'path';
import fs from 'fs';

export { onLoad } from '../_template/pluginSender';

// ─── Вспомогательная функция для цепочки atempo ──────────────────────────────
// ffmpeg ограничивает atempo значениями 0.5..2.0,
// поэтому при коэффициентах за пределами этого диапазона строим цепочку фильтров
function buildAtempoChain(tempo: number): string {
	if (tempo === 1) return 'atempo=1';
	const chain: number[] = [];
	let t = tempo;
	while (t < 0.5) {
		chain.push(0.5);
		t /= 0.5;
	}
	while (t > 2) {
		chain.push(2);
		t /= 2;
	}
	chain.push(t);
	return chain.map((v) => `atempo=${v.toFixed(6)}`).join(',');
}

// ─── Подбор аудио-кодека по расширению ───────────────────────────────────────
// Чтобы не получить конфликт контейнера и кодека при перекодировании
function pickAudioCodec(ext: string): string {
	const e = ext.toLowerCase();
	if (e === '.wav') return 'pcm_s16le';
	if (e === '.mp3') return 'libmp3lame';
	if (e === '.flac') return 'flac';
	return 'aac';
}

export async function retimeVAFunc(_item: any, _description: any) {
	const finalFile: string[] = [];

	// ── Входные файлы ─────────────────────────────────────────────────────────
	const inputVA: string[] = _item.import.inputVA ?? [];

	if (inputVA.length === 0) {
		sendToMW('log', { level: 'warn', text: `[retimeVA] inputVA is empty, skipping` });
		return finalFile;
	}

	// ── Целевая длительность ──────────────────────────────────────────────────
	// Приоритет: входящая нода Timecode → поле timecode на самой ноде
	const importedTimecode = _item.import.timecode?.[0];
	const targetDuration: number = importedTimecode != null ? Number(importedTimecode) : Number(_item.timecode ?? 0);

	if (targetDuration <= 0) {
		sendToMW('log', { level: 'warn', text: `[retimeVA] targetDuration is 0 or not set, skipping` });
		return finalFile;
	}

	// ── Настройки ─────────────────────────────────────────────────────────────
	const speedUp: boolean = _item.speedUp ?? false;
	const slowDown: boolean = _item.SlowDown ?? false;

	// ── Путь для сохранения ───────────────────────────────────────────────────
	let curPath: string[] = _item.targetPath?.length > 0 ? [..._item.targetPath] : ['$clearName ($random(3))'];

	if (_item.import.targetPath?.length > 0) {
		curPath.unshift(..._item.import.targetPath);
	} else {
		curPath.unshift('$localFolder', '$mainFolderName', '$projectName', '$findTime');
	}

	// ── Основной цикл ─────────────────────────────────────────────────────────
	for (const curFile of inputVA) {
		const fileType = getFileTypeByExt(curFile, _description.typeOfFile);
		const isVideo = fileType === 'video';
		const isAudio = fileType === 'audio';

		if (!isVideo && !isAudio) {
			sendToMW('log', { level: 'warn', text: `[retimeVA] Unsupported file type, skipping: ${path.basename(curFile)}` });
			continue;
		}

		const info = await getFullInfoFromVideoFile(curFile, _description);
		const curDuration = info.durationInSeconds;

		if (curDuration <= 0) {
			sendToMW('log', { level: 'warn', text: `[retimeVA] Could not get duration for: ${path.basename(curFile)}` });
			continue;
		}

		sendToMW('statusbar', {
			text: `${_description.infoText}: [retime VA]\n${path.basename(curFile)}`,
		});

		// Путь финального файла — сохраняем оригинальное расширение.
		// createPathForFileByPattern сам добавляет исходное расширение к имени,
		// поэтому повторно его дописывать не нужно.
		const ext = path.extname(curFile);
		const fileTo = createPathForFileByPattern(curPath, _description, curFile);
		testAndCreateFolder(path.dirname(fileTo));

		const coefficient = curDuration / targetDuration;
		const hasAudio = info.hasAudio;
		const hasAlpha = info.pix_fmt?.toLowerCase().includes('a') ?? false;

		// ── Формируем аргументы ffmpeg ────────────────────────────────────────
		let ffmpegArgs: string[] = [];

		if (isAudio) {
			// ── Только аудиофайл ──────────────────────────────────────────────
			const audioCodec = pickAudioCodec(ext);
			const needSpeedUp = curDuration > targetDuration && speedUp;
			const needSlowDown = curDuration < targetDuration && slowDown;

			if (needSpeedUp || needSlowDown) {
				// Ускоряем или замедляем аудио — фильтр atempo работает в обе стороны
				const atempoChain = buildAtempoChain(coefficient);
				ffmpegArgs = ['-filter_complex', `[0:a]${atempoChain}[a]`, '-map', '[a]', '-c:a', audioCodec];
			} else if (curDuration < targetDuration) {
				// Продлеваем тишиной
				ffmpegArgs = ['-af', `apad=whole_dur=${targetDuration}`, '-c:a', audioCodec, '-t', String(targetDuration)];
			} else {
				// Просто обрезаем
				ffmpegArgs = ['-c:a', 'copy', '-t', String(targetDuration)];
			}
		} else {
			// ── Видеофайл ─────────────────────────────────────────────────────

			// Определяем кодек видео
			let videoCodec = '';
			if (info.codec_name === 'hap' && hasAlpha) {
				videoCodec = 'hap -format hap_alpha';
			} else if (info.codec_name) {
				videoCodec = info.codec_name;
			} else {
				videoCodec = hasAlpha ? 'qtrle' : 'prores_ks';
			}

			const pixFmt = info.pix_fmt && info.codec_name !== 'hap' ? (hasAlpha ? info.pix_fmt : info.pix_fmt) : hasAlpha ? 'argb' : 'yuv422p10le';

			if (curDuration > targetDuration && speedUp) {
				// Ускоряем видео
				if (hasAudio) {
					const atempoChain = buildAtempoChain(coefficient);
					ffmpegArgs = [
						'-filter_complex',
						`[0:v]setpts=${(1 / coefficient).toFixed(6)}*PTS${hasAlpha ? ',format=rgba' : ''}[v];[0:a]${atempoChain}[a]`,
						'-map',
						'[v]',
						'-map',
						'[a]',
						'-c:v',
						videoCodec,
						'-pix_fmt',
						pixFmt,
						'-c:a',
						'aac',
					];
				} else {
					ffmpegArgs = [
						'-filter_complex',
						`[0:v]setpts=${(1 / coefficient).toFixed(6)}*PTS${hasAlpha ? ',format=rgba' : ''}[v]`,
						'-map',
						'[v]',
						'-c:v',
						videoCodec,
						'-pix_fmt',
						pixFmt,
					];
				}
			} else if (curDuration < targetDuration && slowDown) {
				// Замедляем видео
				if (hasAudio) {
					const atempoChain = buildAtempoChain(coefficient);
					ffmpegArgs = [
						'-filter_complex',
						`[0:v]setpts=${(1 / coefficient).toFixed(6)}*PTS${hasAlpha ? ',format=rgba' : ''}[v];[0:a]${atempoChain}[a]`,
						'-map',
						'[v]',
						'-map',
						'[a]',
						'-c:v',
						videoCodec,
						'-pix_fmt',
						pixFmt,
						'-c:a',
						'aac',
					];
				} else {
					ffmpegArgs = [
						'-filter_complex',
						`[0:v]setpts=${(1 / coefficient).toFixed(6)}*PTS${hasAlpha ? ',format=rgba' : ''}[v]`,
						'-map',
						'[v]',
						'-c:v',
						videoCodec,
						'-pix_fmt',
						pixFmt,
					];
				}
			} else if (curDuration < targetDuration) {
				// Продлеваем последним кадром (без slowDown)
				const extend = targetDuration - curDuration;
				if (hasAudio) {
					ffmpegArgs = [
						'-vf',
						`tpad=stop_mode=clone:stop_duration=${extend}${hasAlpha ? ',format=rgba' : ''}`,
						'-af',
						`apad=whole_dur=${targetDuration}`,
						'-c:v',
						videoCodec,
						'-pix_fmt',
						pixFmt,
						'-c:a',
						'aac',
						'-t',
						String(targetDuration),
					];
				} else {
					ffmpegArgs = [
						'-vf',
						`tpad=stop_mode=clone:stop_duration=${extend}${hasAlpha ? ',format=rgba' : ''}`,
						'-c:v',
						videoCodec,
						'-pix_fmt',
						pixFmt,
						'-t',
						String(targetDuration),
					];
				}
			} else {
				// Просто обрезаем (curDuration >= targetDuration, speedUp не задан)
				ffmpegArgs = ['-c:v', 'copy', ...(hasAudio ? ['-c:a', 'copy'] : []), '-t', String(targetDuration)];
			}
		}

		const command = {
			text: `${_description.infoText}: [retime VA]\n${path.basename(curFile)}`,
			duration: targetDuration,
			command: ['-y', '-i', curFile, ...ffmpegArgs, fileTo],
		};

		await spawnFFmpegCommand(command, _description, sendToMW);

		if (fs.existsSync(fileTo)) {
			finalFile.push(fileTo);
		}
	}
	sendToMW('log', { level: 'info', text: `Result:\n${finalFile}` });
	return finalFile;
}
