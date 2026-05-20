// join — склейка видео/аудио файлов с опциональным fade-переходом.
// Перед склейкой проверяет совместимость параметров (fps, разрешение, codec),
// конвертирует несовместимые файлы под эталонный.
// Tauri-port: все ffmpeg/fs операции через @plugin-api/tauri helper.

import path from 'path';
import { nanoid } from 'nanoid';
import { fs, ffmpeg, sendToMW, VideoFileInfo } from '../_template/tauri';
import { getFileTypeByExt } from '../../electron/main/utilits/getFileTypeByExt';
import { createPathForFileByPattern } from '../../electron/main/utilits/createPathForFileByPattern';

export { onLoad } from '../_template/tauri';

// ── Нужна ли конвертация под эталон ──────────────────────────────────────────

function needsConversion(file: VideoFileInfo, reference: VideoFileInfo): boolean {
	const differsBy = (a: number, b: number, epsilon = 0.01) => Math.abs(a - b) > epsilon;
	let needsConv = false;

	needsConv ||= file.codec_name !== reference.codec_name;
	needsConv ||= differsBy(file.fps, reference.fps, 0.01);
	needsConv ||= file.avg_frame_rate !== reference.avg_frame_rate;
	needsConv ||= file.r_frame_rate !== reference.r_frame_rate;
	needsConv ||= file.time_base !== reference.time_base;
	needsConv ||= file.pix_fmt !== reference.pix_fmt;
	needsConv ||= file.hasAudio !== reference.hasAudio;

	if (file.hasAudio && reference.hasAudio) {
		needsConv ||= file.audioCodec !== reference.audioCodec;
		needsConv ||= file.audioSampleRate !== reference.audioSampleRate;
		needsConv ||= file.audioChannels !== reference.audioChannels;
		needsConv ||= file.audioChannelLayout !== reference.audioChannelLayout;
	}

	needsConv ||= file.width !== reference.width;
	needsConv ||= file.height !== reference.height;
	needsConv ||= file.sar !== reference.sar;
	needsConv ||= file.color_range !== reference.color_range;
	needsConv ||= file.color_space !== reference.color_space;
	needsConv ||= file.color_primaries !== reference.color_primaries;
	needsConv ||= file.color_transfer !== reference.color_transfer;

	return needsConv;
}

// ── Эталонный файл (самая большая группа одинаковых параметров) ──────────────

function findReferenceFile(allFileInfo: VideoFileInfo[]): VideoFileInfo {
	const key = (info: VideoFileInfo) =>
		`${info.codec_name}_${info.pix_fmt}_${info.avg_frame_rate}_${info.r_frame_rate}_` +
		`${info.time_base}_${info.width}_${info.height}_` +
		`${info.hasAudio ? `${info.audioCodec}_${info.audioSampleRate}_${info.audioChannels}` : 'noaudio'}`;

	const groups: Record<string, VideoFileInfo[]> = {};
	for (const info of allFileInfo) {
		const k = key(info);
		if (!groups[k]) groups[k] = [];
		groups[k].push(info);
	}

	let reference = allFileInfo[0];
	let maxGroupSize = 0;
	for (const g of Object.values(groups)) {
		if (g.length > maxGroupSize) {
			maxGroupSize = g.length;
			reference = g[0];
		}
	}

	// Если 2 файла, и группы равны — берём более длинный (короткий пойдёт на конвертацию).
	if (allFileInfo.length === 2 && maxGroupSize === 1) {
		reference = allFileInfo[0].durationInSeconds >= allFileInfo[1].durationInSeconds
			? allFileInfo[0]
			: allFileInfo[1];
	}

	return reference;
}

// ── Конвертация одного файла под эталон ──────────────────────────────────────

async function convertFileToReference(
	curFile: string,
	curInfo: VideoFileInfo,
	reference: VideoFileInfo,
	workDir: string,
	ffmpegComm: { text: string; duration: number; nodeId?: string },
): Promise<string> {
	const tmpFile = path.join(
		workDir,
		`${path.basename(curFile, path.extname(curFile))}_conv_${nanoid(3)}${path.extname(curFile)}`,
	);

	const vfFilters: string[] = [];
	vfFilters.push(`fps=${reference.fps}`);
	vfFilters.push(`settb=1/${reference.fps}`);
	vfFilters.push(`setpts=N/(${reference.fps}*TB)`);

	if (curInfo.width !== reference.width || curInfo.height !== reference.height) {
		vfFilters.push(`scale=${reference.width}:${reference.height}:force_original_aspect_ratio=decrease`);
	}
	if (reference.sar) vfFilters.push(`setsar=${reference.sar}`);

	const command: string[] = [
		'-y', '-i', curFile,
		'-c:v', String(reference.codec_name),
		'-pix_fmt', String(reference.pix_fmt),
		'-vf', vfFilters.join(','),
	];

	if (reference.color_primaries) command.push('-color_primaries', reference.color_primaries);
	if (reference.color_transfer) command.push('-color_trc', reference.color_transfer);
	if (reference.color_space) command.push('-colorspace', reference.color_space);

	if (reference.time_base) {
		const den = reference.time_base.split('/')[1];
		if (den) command.push('-video_track_timescale', den);
	}

	if (reference.hasAudio) {
		command.push('-c:a', reference.audioCodec || 'aac');
		if (reference.audioCodec === 'aac') {
			command.push('-b:a', reference.audioBitrate ? String(reference.audioBitrate) : '128k');
		}
		if (reference.audioChannels) command.push('-ac', String(reference.audioChannels));
		if (reference.audioSampleRate) command.push('-ar', String(reference.audioSampleRate));
	} else {
		command.push('-an');
	}

	if (path.extname(curFile).toLowerCase() === '.mp4') {
		command.push('-movflags', '+faststart');
	}
	command.push(tmpFile);

	await ffmpeg.run({
		text: ffmpegComm.text,
		duration: curInfo.durationInSeconds || 100,
		nodeId: ffmpegComm.nodeId,
		command,
	});

	return tmpFile;
}

// ── Склейка с fade-переходом через filter_complex ────────────────────────────

async function concatWithFade(
	processedFiles: string[],
	fileInfos: VideoFileInfo[],
	fadeDuration: number,
	finalF: string,
	outputDuration: number,
	reference: VideoFileInfo,
	ffmpegComm: { text: string; duration: number; nodeId?: string },
): Promise<void> {
	const hasVideo = reference.hasVideo;
	const hasAudio = reference.hasAudio;
	const n = processedFiles.length;

	const inputs = processedFiles.flatMap((fp) => ['-i', fp]);
	const filters: string[] = [];

	if (hasVideo && n > 1) {
		let prevLabel = '[0:v]';
		let xfadeOffset = 0;
		for (let i = 0; i < n - 1; i++) {
			xfadeOffset += fileInfos[i].durationInSeconds - fadeDuration;
			const outLabel = `[vout${i}]`;
			filters.push(
				`${prevLabel}[${i + 1}:v]xfade=transition=fade:duration=${fadeDuration}:offset=${xfadeOffset.toFixed(3)}${outLabel}`,
			);
			prevLabel = outLabel;
		}
	}

	if (hasAudio && n > 1) {
		let prevLabel = '[0:a]';
		for (let i = 0; i < n - 1; i++) {
			const outLabel = `[aout${i}]`;
			filters.push(`${prevLabel}[${i + 1}:a]acrossfade=d=${fadeDuration}:o=1${outLabel}`);
			prevLabel = outLabel;
		}
	}

	const command: string[] = ['-y', ...inputs];
	if (filters.length > 0) command.push('-filter_complex', filters.join(';'));

	if (hasVideo) {
		const finalVLabel = n > 1 ? `[vout${n - 2}]` : '[0:v]';
		command.push('-map', finalVLabel);
	}
	if (hasAudio) {
		const finalALabel = n > 1 ? `[aout${n - 2}]` : '[0:a]';
		command.push('-map', finalALabel);
	}

	if (hasVideo) {
		command.push('-c:v', reference.codec_name);
		if (reference.pix_fmt) command.push('-pix_fmt', reference.pix_fmt);
		if (reference.fps) command.push('-r', String(reference.fps));
	}
	if (hasAudio) {
		command.push('-c:a', reference.audioCodec || 'aac');
		if (reference.audioChannels) command.push('-ac', String(reference.audioChannels));
		if (reference.audioSampleRate) command.push('-ar', String(reference.audioSampleRate));
	}

	if (outputDuration > 0) command.push('-t', outputDuration.toFixed(3));
	if (path.extname(finalF).toLowerCase() === '.mp4') command.push('-movflags', '+faststart');
	command.push(finalF);

	await ffmpeg.run({ ...ffmpegComm, command });
}

// ── Главная функция плагина ──────────────────────────────────────────────────

export async function joinFileFunc(_item: any, _description: any): Promise<string[]> {
	const finalFile: string[] = [];

	// 1. Фильтруем входящие файлы — только video/audio
	const inputFiles: string[] = [];
	for (const curItem of _item.import.inputFile as string[]) {
		if (!(await fs.existsFile(curItem))) continue;
		const itemType = getFileTypeByExt(curItem, _description.typeOfFile);
		if (!['video', 'audio'].includes(itemType)) continue;
		inputFiles.push(curItem);
	}
	if (inputFiles.length === 0) return finalFile;

	// Параметры из интерфейса
	const importedTimecode = _item.import.finalTimecode?.[0];
	const targetDuration: number =
		importedTimecode != null ? Number(importedTimecode) : Number(_item.finalTimecode ?? 0);
	const fadeDuration: number = Math.max(0, Number(_item.autoFade ?? 0));
	const joinType: string = _item.joinType ?? 'Sequentially';

	sendToMW('statusbar', { text: `${_description.infoText}: [join VA] collecting info...` });

	// 2. Один файл без targetDuration — конвертация не нужна
	if (inputFiles.length === 1 && targetDuration <= 0) {
		finalFile.push(inputFiles[0]);
		return finalFile;
	}

	// 3. Получаем параметры всех файлов
	const allFileInfo: VideoFileInfo[] = [];
	const fileInfoMap = new Map<string, VideoFileInfo>();
	for (const file of inputFiles) {
		sendToMW('statusbar', { text: `${_description.infoText}: [join VA] analyze\n${path.basename(file)}` });
		const info = await ffmpeg.getInfo(file);
		allFileInfo.push(info);
		fileInfoMap.set(file, info);
	}

	// 4. Эталон
	const reference = findReferenceFile(allFileInfo);

	// 5. Порядок файлов по joinType
	let orderedFiles = [...inputFiles];
	if (joinType === 'Random') {
		orderedFiles = [...orderedFiles].sort(() => Math.random() - 0.5);
	}

	// 6. Список файлов для склейки (с учётом targetDuration через цикл)
	let filesForJoin: string[] = [];
	if (targetDuration > 0) {
		let accumulated = 0;
		let cycleIdx = 0;
		while (accumulated < targetDuration) {
			const curFile = orderedFiles[cycleIdx % orderedFiles.length];
			filesForJoin.push(curFile);
			const dur = fileInfoMap.get(curFile)!.durationInSeconds;
			const overlap = filesForJoin.length > 1 ? fadeDuration : 0;
			accumulated += dur - overlap;
			cycleIdx++;
			if (cycleIdx > 10000) break;
		}
	} else {
		filesForJoin = [...orderedFiles];
	}

	// 7. Путь для финального файла
	const fileForName = inputFiles[0];
	let curPath: string[] =
		(_item.targetPath?.length ?? 0) === 0 ? ['$clearName (join $random(3))'] : [..._item.targetPath];
	if (_item.import.targetPath?.length) {
		curPath.unshift(..._item.import.targetPath);
	} else {
		curPath.unshift('$localFolder', '$mainFolderName', '$projectName', '$findTime');
	}

	const finalExt = path.extname(inputFiles[0]);
	const basePath = createPathForFileByPattern(curPath, _description, fileForName);
	const dir = path.dirname(basePath);
	const fName = path.basename(basePath, path.extname(basePath));
	const finalF = path.join(dir, `${fName}${finalExt}`);

	await fs.mkdir(path.dirname(finalF));

	// 8. Какие файлы требуют конвертации
	const filesForJoinInfo = filesForJoin.map((f) => fileInfoMap.get(f)!);
	const needConvertFlags = filesForJoinInfo.map((info) => needsConversion(info, reference));
	const anyNeedsConversion = needConvertFlags.some(Boolean);

	// 9. Конвертация
	const processedFiles: string[] = [];
	const workDir = path.dirname(finalF);
	const tempFilesToDelete: string[] = [];

	for (let i = 0; i < filesForJoin.length; i++) {
		const curFile = filesForJoin[i];
		const curInfo = filesForJoinInfo[i];

		sendToMW('statusbar', {
			text: `${_description.infoText}: [join VA] ${i + 1}/${filesForJoin.length}\n${path.basename(curFile)}`,
		});

		if (anyNeedsConversion && needConvertFlags[i]) {
			const tmpFile = await convertFileToReference(
				curFile,
				curInfo,
				reference,
				workDir,
				{
					text: `${_description.infoText}: [join VA] convert ${i + 1}/${filesForJoin.length} ${path.basename(curFile)}`,
					duration: curInfo.durationInSeconds || 100,
					nodeId: _item.id,
				},
			);
			processedFiles.push(tmpFile);
			tempFilesToDelete.push(tmpFile);
		} else {
			processedFiles.push(curFile);
		}
	}

	// 10. Эффективная длительность
	const effectiveDuration =
		filesForJoinInfo.reduce((acc, info) => acc + info.durationInSeconds, 0) -
		Math.max(0, filesForJoin.length - 1) * fadeDuration;
	const outputDuration = targetDuration > 0 ? targetDuration : 0;

	sendToMW('statusbar', { text: `${_description.infoText}: [join VA] concat → ${path.basename(finalF)}` });

	// 11. Склейка
	if (fadeDuration > 0 && processedFiles.length > 1) {
		await concatWithFade(
			processedFiles,
			filesForJoinInfo,
			fadeDuration,
			finalF,
			outputDuration,
			reference,
			{
				text: `${_description.infoText}: [join VA] concat+fade → ${path.basename(finalF)}`,
				duration: effectiveDuration || 100,
				nodeId: _item.id,
			},
		);
	} else {
		// Простая склейка через concat demuxer
		const textFile = path.join(workDir, `_concat_list_${nanoid(4)}.txt`);
		const inputFilesText = processedFiles.map((fp) => `file '${fp.replace(/'/g, "'\\''")}'`).join('\n');
		await fs.write(textFile, inputFilesText);

		const rawDuration = filesForJoinInfo.reduce((acc, info) => acc + info.durationInSeconds, 0);
		const concatArgs: string[] = ['-y', '-f', 'concat', '-safe', '0', '-i', textFile, '-c:v', 'copy', '-c:a', 'copy'];
		if (outputDuration > 0) concatArgs.push('-t', outputDuration.toFixed(3));
		concatArgs.push(finalF);

		await ffmpeg.run({
			text: `${_description.infoText}: [join VA] concat → ${path.basename(finalF)}`,
			duration: rawDuration || 100,
			nodeId: _item.id,
			command: concatArgs,
		});

		await fs.remove(textFile).catch(() => {});
	}

	// 12. Удаляем временные файлы
	for (const tmp of tempFilesToDelete) {
		await fs.remove(tmp).catch(() => {});
	}

	finalFile.push(finalF);
	sendToMW('log', { level: 'info', text: `Result:\n${finalFile.join('\n')}` });
	return finalFile;
}
