// retimeVA — ускоряет/замедляет/обрезает/продлевает видео или аудио файл
// до заданной целевой длительности. Tauri-port: ffmpeg через helper.

import path from 'path';
import { fs, ffmpeg, sendToMW } from '../_template/tauri';
import { getFileTypeByExt } from '../../electron/main/utilits/getFileTypeByExt';
import { createPathForFileByPattern } from '../../electron/main/utilits/createPathForFileByPattern';

export { onLoad } from '../_template/tauri';

// ffmpeg-фильтр atempo ограничен 0.5..2.0; для значений вне — строим цепочку.
function buildAtempoChain(tempo: number): string {
	if (tempo === 1) return 'atempo=1';
	const chain: number[] = [];
	let t = tempo;
	while (t < 0.5) { chain.push(0.5); t /= 0.5; }
	while (t > 2)   { chain.push(2);   t /= 2; }
	chain.push(t);
	return chain.map((v) => `atempo=${v.toFixed(6)}`).join(',');
}

function pickAudioCodec(ext: string): string {
	const e = ext.toLowerCase();
	if (e === '.wav') return 'pcm_s16le';
	if (e === '.mp3') return 'libmp3lame';
	if (e === '.flac') return 'flac';
	return 'aac';
}

export async function retimeVAFunc(_item: any, _description: any): Promise<string[]> {
	const finalFile: string[] = [];

	const inputVA: string[] = _item.import.inputVA ?? [];
	if (inputVA.length === 0) {
		sendToMW('log', { level: 'warn', text: `[retimeVA] inputVA is empty, skipping` });
		return finalFile;
	}

	const importedTimecode = _item.import.timecode?.[0];
	const targetDuration: number =
		importedTimecode != null ? Number(importedTimecode) : Number(_item.timecode ?? 0);
	if (targetDuration <= 0) {
		sendToMW('log', { level: 'warn', text: `[retimeVA] targetDuration is 0 or not set, skipping` });
		return finalFile;
	}

	const speedUp: boolean = _item.speedUp ?? false;
	const slowDown: boolean = _item.SlowDown ?? false;

	let curPath: string[] =
		_item.targetPath?.length > 0 ? [..._item.targetPath] : ['$clearName ($random(3))'];
	if (_item.import.targetPath?.length > 0) {
		curPath.unshift(..._item.import.targetPath);
	} else {
		curPath.unshift('$localFolder', '$mainFolderName', '$projectName', '$findTime');
	}

	for (const curFile of inputVA) {
		const fileType = getFileTypeByExt(curFile, _description.typeOfFile);
		const isVideo = fileType === 'video';
		const isAudio = fileType === 'audio';
		if (!isVideo && !isAudio) {
			sendToMW('log', { level: 'warn', text: `[retimeVA] Unsupported file type: ${path.basename(curFile)}` });
			continue;
		}

		const info = await ffmpeg.getInfo(curFile);
		const curDuration = info.durationInSeconds;
		if (curDuration <= 0) {
			sendToMW('log', { level: 'warn', text: `[retimeVA] No duration: ${path.basename(curFile)}` });
			continue;
		}

		sendToMW('statusbar', { text: `${_description.infoText}: [retime VA]\n${path.basename(curFile)}` });

		const ext = path.extname(curFile);
		const fileTo = createPathForFileByPattern(curPath, _description, curFile);
		await fs.mkdir(path.dirname(fileTo));

		const coefficient = curDuration / targetDuration;
		const hasAudio = info.hasAudio;
		const hasAlpha = info.pix_fmt?.toLowerCase().includes('a') ?? false;

		let ffmpegArgs: string[] = [];

		if (isAudio) {
			const audioCodec = pickAudioCodec(ext);
			const needSpeedUp = curDuration > targetDuration && speedUp;
			const needSlowDown = curDuration < targetDuration && slowDown;

			if (needSpeedUp || needSlowDown) {
				const atempoChain = buildAtempoChain(coefficient);
				ffmpegArgs = ['-filter_complex', `[0:a]${atempoChain}[a]`, '-map', '[a]', '-c:a', audioCodec];
			} else if (curDuration < targetDuration) {
				ffmpegArgs = ['-af', `apad=whole_dur=${targetDuration}`, '-c:a', audioCodec, '-t', String(targetDuration)];
			} else {
				ffmpegArgs = ['-c:a', 'copy', '-t', String(targetDuration)];
			}
		} else {
			let videoCodec = '';
			if (info.codec_name === 'hap' && hasAlpha) videoCodec = 'hap -format hap_alpha';
			else if (info.codec_name) videoCodec = info.codec_name;
			else videoCodec = hasAlpha ? 'qtrle' : 'prores_ks';

			const pixFmt =
				info.pix_fmt && info.codec_name !== 'hap'
					? info.pix_fmt
					: hasAlpha
						? 'argb'
						: 'yuv422p10le';

			if (curDuration > targetDuration && speedUp) {
				const atempoChain = buildAtempoChain(coefficient);
				ffmpegArgs = hasAudio
					? ['-filter_complex',
						`[0:v]setpts=${(1 / coefficient).toFixed(6)}*PTS${hasAlpha ? ',format=rgba' : ''}[v];[0:a]${atempoChain}[a]`,
						'-map', '[v]', '-map', '[a]',
						'-c:v', videoCodec, '-pix_fmt', pixFmt, '-c:a', 'aac']
					: ['-filter_complex',
						`[0:v]setpts=${(1 / coefficient).toFixed(6)}*PTS${hasAlpha ? ',format=rgba' : ''}[v]`,
						'-map', '[v]', '-c:v', videoCodec, '-pix_fmt', pixFmt];
			} else if (curDuration < targetDuration && slowDown) {
				const atempoChain = buildAtempoChain(coefficient);
				ffmpegArgs = hasAudio
					? ['-filter_complex',
						`[0:v]setpts=${(1 / coefficient).toFixed(6)}*PTS${hasAlpha ? ',format=rgba' : ''}[v];[0:a]${atempoChain}[a]`,
						'-map', '[v]', '-map', '[a]',
						'-c:v', videoCodec, '-pix_fmt', pixFmt, '-c:a', 'aac']
					: ['-filter_complex',
						`[0:v]setpts=${(1 / coefficient).toFixed(6)}*PTS${hasAlpha ? ',format=rgba' : ''}[v]`,
						'-map', '[v]', '-c:v', videoCodec, '-pix_fmt', pixFmt];
			} else if (curDuration < targetDuration) {
				const extend = targetDuration - curDuration;
				ffmpegArgs = hasAudio
					? ['-vf', `tpad=stop_mode=clone:stop_duration=${extend}${hasAlpha ? ',format=rgba' : ''}`,
						'-af', `apad=whole_dur=${targetDuration}`,
						'-c:v', videoCodec, '-pix_fmt', pixFmt, '-c:a', 'aac', '-t', String(targetDuration)]
					: ['-vf', `tpad=stop_mode=clone:stop_duration=${extend}${hasAlpha ? ',format=rgba' : ''}`,
						'-c:v', videoCodec, '-pix_fmt', pixFmt, '-t', String(targetDuration)];
			} else {
				ffmpegArgs = ['-c:v', 'copy', ...(hasAudio ? ['-c:a', 'copy'] : []), '-t', String(targetDuration)];
			}
		}

		await ffmpeg.run({
			text: `${_description.infoText}: [retime VA]\n${path.basename(curFile)}`,
			duration: targetDuration,
			nodeId: _item.id,
			command: ['-y', '-i', curFile, ...ffmpegArgs, fileTo],
		});

		if (await fs.existsFile(fileTo)) finalFile.push(fileTo);
	}

	sendToMW('log', { level: 'info', text: `Result:\n${finalFile.join('\n')}` });
	return finalFile;
}
