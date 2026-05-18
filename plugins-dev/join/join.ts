import path from 'path';
import fs from 'fs';
import { nanoid } from 'nanoid';
import { isFile } from '../../electron/main/fileSistem/operation/isFile';
import { getFileTypeByExt } from '../../electron/main/utilits/getFileTypeByExt';
import { getFullInfoFromVideoFile, FullVideoInfo } from '../../electron/main/processing/ffmpeg/getFullInfoFromVideoFile';
import { spawnFFmpegCommand } from '../../electron/main/processing/ffmpeg/spawnFFmpegCommand';
import { createPathForFileByPattern } from '../../electron/main/utilits/createPathForFileByPattern';
import { testAndCreateFolder } from '../../electron/main/fileSistem/testAndCreateFolder';
import { sendToMW } from '../_template/pluginSender';

export { onLoad } from '../_template/pluginSender';

// ─── Проверка нужна ли конвертация ───────────────────────────────────────────

function needsConversion(file: FullVideoInfo, reference: FullVideoInfo): boolean {
	const differsBy = (a: number, b: number, epsilon = 0.01) => Math.abs(a - b) > epsilon;

	let needsConv = false;

	// Базовые критичные параметры
	needsConv ||= file.codec_name !== reference.codec_name;
	needsConv ||= differsBy(file.fps, reference.fps, 0.01);
	needsConv ||= file.avg_frame_rate !== reference.avg_frame_rate;
	needsConv ||= file.r_frame_rate !== reference.r_frame_rate;
	needsConv ||= file.time_base !== reference.time_base;
	needsConv ||= file.pix_fmt !== reference.pix_fmt;
	needsConv ||= file.hasAudio !== reference.hasAudio;

	// Аудио параметры
	if (file.hasAudio && reference.hasAudio) {
		needsConv ||= file.audioCodec !== reference.audioCodec;
		needsConv ||= file.audioSampleRate !== reference.audioSampleRate;
		needsConv ||= file.audioChannels !== reference.audioChannels;
		needsConv ||= file.audioChannelLayout !== reference.audioChannelLayout;
	}

	// Размер и цвет (strict)
	needsConv ||= file.width !== reference.width;
	needsConv ||= file.height !== reference.height;
	needsConv ||= file.sar !== reference.sar;
	needsConv ||= file.color_range !== reference.color_range;
	needsConv ||= file.color_space !== reference.color_space;
	needsConv ||= file.color_primaries !== reference.color_primaries;
	needsConv ||= file.color_transfer !== reference.color_transfer;

	return needsConv;
}

// ─── Определяем эталонный файл (самая большая группа одинаковых параметров) ──

function findReferenceFile(allFileInfo: FullVideoInfo[]): FullVideoInfo {
	const key = (info: FullVideoInfo) =>
		`${info.codec_name}_${info.pix_fmt}_${info.avg_frame_rate}_${info.r_frame_rate}_` +
		`${info.time_base}_${info.width}_${info.height}_` +
		`${info.hasAudio ? `${info.audioCodec}_${info.audioSampleRate}_${info.audioChannels}` : 'noaudio'}`;

	const groups: Record<string, FullVideoInfo[]> = {};
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

	// Если 2 файла и группы равны — берём файл с наименьшей длительностью для конвертации
	// значит эталон — тот что длиннее
	if (allFileInfo.length === 2 && maxGroupSize === 1) {
		reference = allFileInfo[0].durationInSeconds >= allFileInfo[1].durationInSeconds ? allFileInfo[0] : allFileInfo[1];
	}

	return reference;
}

// ─── Конвертация одного файла под эталон ─────────────────────────────────────

async function convertFileToReference(
	curFile: string,
	curInfo: FullVideoInfo,
	reference: FullVideoInfo,
	workDir: string,
	ffmpegComm: { text: string; duration: number },
	_description: any,
): Promise<string> {
	const tmpFile = path.join(workDir, `${path.basename(curFile, path.extname(curFile))}_conv_${nanoid(3)}${path.extname(curFile)}`);

	const vfFilters: string[] = [];

	// FPS и PTS
	vfFilters.push(`fps=${reference.fps}`);
	vfFilters.push(`settb=1/${reference.fps}`);
	vfFilters.push(`setpts=N/(${reference.fps}*TB)`);

	// Масштабирование если нужно
	if (curInfo.width !== reference.width || curInfo.height !== reference.height) {
		vfFilters.push(`scale=${reference.width}:${reference.height}:force_original_aspect_ratio=decrease`);
	}

	// SAR
	if (reference.sar) {
		vfFilters.push(`setsar=${reference.sar}`);
	}

	const command: string[] = [
		'-i',
		curFile,
		'-c:v',
		String(reference.codec_name),
		'-pix_fmt',
		String(reference.pix_fmt),
		'-vf',
		vfFilters.join(','),
	];

	// Цвет
	if (reference.color_primaries) command.push('-color_primaries', reference.color_primaries);
	if (reference.color_transfer) command.push('-color_trc', reference.color_transfer);
	if (reference.color_space) command.push('-colorspace', reference.color_space);

	// Timebase
	if (reference.time_base) {
		const den = reference.time_base.split('/')[1];
		if (den) command.push('-video_track_timescale', den);
	}

	// Аудио
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

	// faststart для mp4
	if (path.extname(curFile).toLowerCase() === '.mp4') {
		command.push('-movflags', '+faststart');
	}

	command.push(tmpFile);

	const convComm = { ...ffmpegComm, duration: curInfo.durationInSeconds || 100 };
	await spawnFFmpegCommand(convComm, _description, sendToMW);

	// Перезаписываем command в spawnFFmpegCommand — передаём как объект с command
	// spawnFFmpegCommand ожидает { text, duration, command }
	const convCommand = { text: ffmpegComm.text, duration: curInfo.durationInSeconds || 100, command };
	await spawnFFmpegCommand(convCommand, _description, sendToMW);

	return tmpFile;
}

// ─── Склейка с fade-переходом через filter_complex ───────────────────────────

async function concatWithFade(
	processedFiles: string[],
	fileInfos: FullVideoInfo[],
	fadeDuration: number,
	finalF: string,
	outputDuration: number,
	reference: FullVideoInfo,
	ffmpegComm: { text: string; duration: number },
	_description: any,
): Promise<void> {
	const hasVideo = reference.hasVideo;
	const hasAudio = reference.hasAudio;
	const n = processedFiles.length;

	// Входные файлы
	const inputs = processedFiles.flatMap((fp) => ['-i', fp]);
	const filters: string[] = [];

	// ── Видео: цепочка xfade ──
	if (hasVideo && n > 1) {
		let prevLabel = '[0:v]';
		let xfadeOffset = 0;
		for (let i = 0; i < n - 1; i++) {
			xfadeOffset += fileInfos[i].durationInSeconds - fadeDuration;
			const outLabel = `[vout${i}]`;
			filters.push(`${prevLabel}[${i + 1}:v]xfade=transition=fade:duration=${fadeDuration}:offset=${xfadeOffset.toFixed(3)}${outLabel}`);
			prevLabel = outLabel;
		}
	}

	// ── Аудио: цепочка acrossfade ──
	if (hasAudio && n > 1) {
		let prevLabel = '[0:a]';
		for (let i = 0; i < n - 1; i++) {
			const outLabel = `[aout${i}]`;
			filters.push(`${prevLabel}[${i + 1}:a]acrossfade=d=${fadeDuration}:o=1${outLabel}`);
			prevLabel = outLabel;
		}
	}

	const command = [...inputs];

	if (filters.length > 0) {
		command.push('-filter_complex', filters.join(';'));
	}

	// Маппинг выходных потоков
	if (hasVideo) {
		const finalVLabel = n > 1 ? `[vout${n - 2}]` : '[0:v]';
		command.push('-map', finalVLabel);
	}
	if (hasAudio) {
		const finalALabel = n > 1 ? `[aout${n - 2}]` : '[0:a]';
		command.push('-map', finalALabel);
	}

	// Кодеки (xfade/acrossfade требуют перекодирования)
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

	// Обрезка до целевой длительности
	if (outputDuration > 0) {
		command.push('-t', outputDuration.toFixed(3));
	}

	if (path.extname(finalF).toLowerCase() === '.mp4') {
		command.push('-movflags', '+faststart');
	}

	command.push(finalF);

	await spawnFFmpegCommand({ ...ffmpegComm, command }, _description, sendToMW);
}

// ─── Главная функция плагина ─────────────────────────────────────────────────

export async function joinFileFunc(_item: any, _description: any) {
	const finalFile: string[] = [];

	// ── 1. Фильтруем входящие файлы — только video/audio ──
	const inputFiles: string[] = [];
	for (const curItem of _item.import.inputFile) {
		if (!isFile(curItem)) continue;
		const itemType = getFileTypeByExt(curItem, _description.typeOfFile);
		if (!['video', 'audio'].includes(itemType)) continue;
		inputFiles.push(curItem);
	}

	if (inputFiles.length === 0) return finalFile;

	// ── Параметры из интерфейса ──
	// Приоритет для таймкода: входящая нода → поле на самой ноде
	const importedTimecode = _item.import.finalTimecode?.[0];
	const targetDuration: number = importedTimecode != null ? Number(importedTimecode) : Number(_item.finalTimecode ?? 0);

	const fadeDuration: number = Math.max(0, Number(_item.autoFade ?? 0));
	const joinType: string = _item.joinType ?? 'Sequentially';

	sendToMW('statusbar', `${_description.infoText}: [join VA] collecting info...`);

	// ── 2. Один файл без targetDuration — конвертация не нужна, просто копируем путь ──
	if (inputFiles.length === 1 && targetDuration <= 0) {
		finalFile.push(inputFiles[0]);
		return finalFile;
	}

	// ── 3. Получаем параметры всех уникальных файлов ──
	const allFileInfo: FullVideoInfo[] = [];
	const fileInfoMap = new Map<string, FullVideoInfo>();

	for (const file of inputFiles) {
		sendToMW('statusbar', `${_description.infoText}: [join VA] analyze\n${path.basename(file)}`);
		const info = await getFullInfoFromVideoFile(file, _description);
		allFileInfo.push(info);
		fileInfoMap.set(file, info);
	}

	// ── 4. Находим эталонный файл ──
	const reference = findReferenceFile(allFileInfo);

	// ── 5. Формируем порядок файлов по joinType ──
	let orderedFiles = [...inputFiles];
	if (joinType === 'Random') {
		orderedFiles = [...orderedFiles].sort(() => Math.random() - 0.5);
	}

	// ── 6. Строим список файлов для склейки ──
	// Если targetDuration задан — добавляем файлы циклически пока не наберём нужную длительность.
	// Эффективная длительность = сумма файлов - (N-1) * fadeDuration (перекрытие между файлами).
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
			// Защита от бесконечного цикла если файл нулевой длины
			if (cycleIdx > 10000) break;
		}
	} else {
		filesForJoin = [...orderedFiles];
	}

	// ── 7. Определяем путь для финального файла ──
	const fileForName = inputFiles[0];

	let curPath = _item.targetPath?.length === 0 ? ['$clearName (join $random(3))'] : [..._item.targetPath];

	if (_item.import.targetPath) {
		curPath.unshift(..._item.import.targetPath);
	} else {
		curPath.unshift('$localFolder', '$mainFolderName', '$projectName', '$findTime');
	}

	const finalExt = path.extname(inputFiles[0]);
	const basePath = createPathForFileByPattern(curPath, _description, fileForName);
	const dir = path.dirname(basePath);
	const fName = path.basename(basePath, path.extname(basePath));

	const finalF = path.join(dir, `${fName}${finalExt}`);

	testAndCreateFolder(path.dirname(finalF));

	// ── 8. Определяем какие файлы нужно конвертировать ──
	const filesForJoinInfo = filesForJoin.map((f) => fileInfoMap.get(f)!);
	const needConvertFlags = filesForJoinInfo.map((info) => needsConversion(info, reference));
	const anyNeedsConversion = needConvertFlags.some(Boolean);

	// ── 9. Конвертация файлов которые не совпадают с эталоном ──
	const processedFiles: string[] = [];
	const workDir = path.dirname(finalF);
	const tempFilesToDelete: string[] = [];

	for (let i = 0; i < filesForJoin.length; i++) {
		const curFile = filesForJoin[i];
		const curInfo = filesForJoinInfo[i];

		sendToMW('statusbar', `${_description.infoText}: [join VA] ${i + 1}/${filesForJoin.length}\n${path.basename(curFile)}`);

		if (anyNeedsConversion && needConvertFlags[i]) {
			const tmpFile = await convertFileToReference(
				curFile,
				curInfo,
				reference,
				workDir,
				{
					text: `${_description.infoText}: [join VA] convert ${i + 1}/${filesForJoin.length} ${path.basename(curFile)}`,
					duration: curInfo.durationInSeconds || 100,
				},
				_description,
			);
			processedFiles.push(tmpFile);
			tempFilesToDelete.push(tmpFile);
		} else {
			processedFiles.push(curFile);
		}
	}

	// ── 10. Эффективная длительность результата ──
	const effectiveDuration =
		filesForJoinInfo.reduce((acc, info) => acc + info.durationInSeconds, 0) - Math.max(0, filesForJoin.length - 1) * fadeDuration;

	// Длительность для прогресса ffmpeg и для обрезки по таймкоду
	const outputDuration = targetDuration > 0 ? targetDuration : 0;

	sendToMW('statusbar', `${_description.infoText}: [join VA] concat → ${path.basename(finalF)}`);

	// ── 11. Склейка ──
	if (fadeDuration > 0 && processedFiles.length > 1) {
		// ── Склейка с fade-переходом через filter_complex ──
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
			},
			_description,
		);
	} else {
		// ── Простая склейка через concat demuxer (без fade) ──
		const textFile = path.join(workDir, `_concat_list_${nanoid(4)}.txt`);
		const inputFilesText = processedFiles.map((fp) => `file '${fp.replace(/'/g, "'\\''")}'`).join('\n');
		fs.writeFileSync(textFile, inputFilesText, { encoding: 'utf8' });

		const rawDuration = filesForJoinInfo.reduce((acc, info) => acc + info.durationInSeconds, 0);

		const concatArgs: string[] = ['-f', 'concat', '-safe', '0', '-i', textFile, '-c:v', 'copy', '-c:a', 'copy'];

		// Обрезка до targetDuration прямо при склейке
		if (outputDuration > 0) {
			concatArgs.push('-t', outputDuration.toFixed(3));
		}

		concatArgs.push(finalF);

		const concatCommand = {
			text: `${_description.infoText}: [join VA] concat → ${path.basename(finalF)}`,
			duration: rawDuration || 100,
			command: concatArgs,
		};

		await spawnFFmpegCommand(concatCommand, _description, sendToMW);

		try {
			fs.unlinkSync(textFile);
		} catch {}
	}

	// ── 12. Удаляем временные конвертированные файлы ──
	for (const tmp of tempFilesToDelete) {
		try {
			fs.unlinkSync(tmp);
		} catch {}
	}

	finalFile.push(finalF);
	sendToMW('log', { level: 'info', text: `Result:\n${finalFile}` });
	return finalFile;
}
