import path from 'path';
import fs from 'fs';
import { getFullInfoFromVideoFile, FullVideoInfo } from '../../electron/main/processing/ffmpeg/getFullInfoFromVideoFile';
import { execFFmpegCommand } from '../../electron/main/processing/ffmpeg/execFFmpegCommand';
import { createPathForFileByPattern } from '../../electron/main/utilits/createPathForFileByPattern';
import { testAndCreateFolder } from '../../electron/main/fileSistem/testAndCreateFolder';
import { sendToMW } from '../_template/pluginSender';

export { onLoad } from '../_template/pluginSender';

// ── Типы настроек (совпадают с OverlayEdit/types.ts в renderer) ──────────────

interface OverlayFormatSettings {
	bgWidth: number;
	bgHeight: number;
	posX: number;
	posY: number;
	scaleW: number;
	scaleH: number;
	rotation: number;
}

interface OverlaySettings {
	landscape: OverlayFormatSettings;
	portrait: OverlayFormatSettings;
	square: OverlayFormatSettings;
}

// ── Классификация pixel format ───────────────────────────────────────────────

function isYuvaFormat(pix_fmt?: string): boolean {
	return !!pix_fmt && pix_fmt.startsWith('yuva');
}

function isRgbAlphaFormat(pix_fmt?: string): boolean {
	if (!pix_fmt) return false;
	if (pix_fmt.startsWith('gbrap')) return true; // GBRAP, GBRAP10/12/16 (CineForm и т.п.)
	return ['rgba', 'argb', 'bgra', 'abgr', 'rgba64be', 'rgba64le'].includes(pix_fmt);
}

function hasAlphaChannel(pix_fmt?: string): boolean {
	return isYuvaFormat(pix_fmt) || isRgbAlphaFormat(pix_fmt);
}

// ── Унифицированная нормализация FG перед наложением ─────────────────────────
// Стратегия: привести FG к 8-bit rgba с предсказуемой цветовой меткой (bt709)
// независимо от исходного кодека (ProRes 4444, HAP Alpha, PNG, VP9-alpha и др.)
// — иначе swscale падает на yuva*p10/12le + smpte432/trc=reserved и т.п.
//
// Порядок фильтров КРИТИЧЕН: setparams ВСЕГДА первым. Иначе любой format=
// до него триггерит swscale с исходными «дырявыми» метаданными
// (prim:smpte432 + trc:reserved у ProRes 4444) — и swscale падает с
// "Unsupported input (Error number -129)".
function buildFgNormalizationFilter(info: FullVideoInfo): string {
	const pix = info.pix_fmt || '';
	// setparams правит ТОЛЬКО метаданные цвета (AVFrame side-data),
	// пиксели и альфу не трогает. Должен идти ПЕРВЫМ — до любого format=,
	// чтобы swscale на следующем шаге увидел уже нормализованные метки.
	const setparams = 'setparams=color_trc=bt709:color_primaries=bt709:colorspace=bt709';

	if (isYuvaFormat(pix)) {
		// ProRes 4444 (yuva444p10/12le), VP9-alpha (yuva420p), CineForm yuva и т.п.
		// Промежуточный yuva420p понижает битность до 8 (без потери альфы) и
		// надёжнее проходит через swscale при экзотических primaries.
		return `${setparams},format=yuva420p,format=rgba`;
	}

	if (isRgbAlphaFormat(pix)) {
		// HAP Alpha, PNG, QuickTime PNG, GBRAP/GBRAP10/12/16 — уже RGB-семейство,
		// конверсия в rgba дешёвая, но setparams оставляем для согласования с BG.
		return `${setparams},format=rgba`;
	}

	// FG без альфы (обычный mp4/h264) — оверлей будет непрозрачным прямоугольником.
	return `${setparams},format=rgba`;
}

// ── Определяем тип формата по соотношению сторон реального BG ─────────────────

function getFormatType(width: number, height: number): keyof OverlaySettings {
	if (width > height) return 'landscape';
	if (height > width) return 'portrait';
	return 'square';
}

// ── Обработка одной пары BG + FG ──────────────────────────────────────────────

async function processSinglePair(
	bgFile: string,
	fgFile: string,
	overlaySettings: OverlaySettings,
	opts: { fgAudio: boolean; bgAudio: boolean; offsetBG: boolean },
	targetPath: string,
	_description: any,
): Promise<string> {
	const label = `${_description.infoText}: [overlay]`;

	sendToMW('statusbar', `${label} analyze\n${path.basename(bgFile)}`);
	const bgInfo = await getFullInfoFromVideoFile(bgFile, _description);

	sendToMW('statusbar', `${label} analyze\n${path.basename(fgFile)}`);
	const fgInfo = await getFullInfoFromVideoFile(fgFile, _description);

	// Выбираем нужный пресет по реальным размерам BG
	const formatType = getFormatType(bgInfo.width, bgInfo.height);
	const fmt = overlaySettings[formatType];

	// Масштабный коэффициент: реальный BG → настроечный BG (defaultSize)
	const scaleFactorX = bgInfo.width / fmt.bgWidth;
	const scaleFactorY = bgInfo.height / fmt.bgHeight;

	// Целевые размеры и позиция FG в пикселях реального BG
	const fgW = Math.round(fmt.scaleW * scaleFactorX);
	const fgH = Math.round(fmt.scaleH * scaleFactorY);
	const fgX = Math.round(fmt.posX * scaleFactorX);
	const fgY = Math.round(fmt.posY * scaleFactorY);

	const bgW = bgInfo.width;
	const bgH = bgInfo.height;

	// Длительность — берём BG (или FG если BG картинка / длительность 0)
	const finalDuration = bgInfo.durationInSeconds > 0 ? bgInfo.durationInSeconds : fgInfo.durationInSeconds;

	// ── Строим video filter ────────────────────────────────────────────────────

	const fgScaleFilter = `scale=${fgW}:${fgH}`;

	// Поворот (если ненулевой)
	let rotateFilter = '';
	if (fmt.rotation !== 0) {
		const rotRad = (fmt.rotation * Math.PI) / 180;
		rotateFilter = `,rotate=${rotRad.toFixed(6)}:ow='rotw(${rotRad.toFixed(6)})':oh='roth(${rotRad.toFixed(6)})'`;
	}

	// Унифицированная нормализация FG: учитывает кодек/pix_fmt/цветовые метки,
	// см. buildFgNormalizationFilter выше.
	const fgColorFilter = `${buildFgNormalizationFilter(fgInfo)},`;

	sendToMW('log', {
		level: 'info',
		text:
			`[overlay] FG normalize: codec=${fgInfo.codec_name}` +
			` pix_fmt=${fgInfo.pix_fmt}` +
			` primaries=${fgInfo.color_primaries ?? '-'}` +
			` trc=${fgInfo.color_transfer ?? '-'}` +
			` alpha=${hasAlphaChannel(fgInfo.pix_fmt)}` +
			` → ${fgColorFilter.replace(/,$/, '')}`,
	});

	let videoFilter: string;

	// Offset логика: когда FG перекрывает весь BG и нужно сдвинуть BG
	const needsOffset = opts.offsetBG && (fgW >= bgW || fgH >= bgH);

	if (needsOffset) {
		const overflowBottom = fgY + fgH - bgH;
		const overflowTop = -fgY;
		const overflowRight = fgX + fgW - bgW;
		const overflowLeft = -fgX;

		const freeSpaceAbove = fgY;
		const freeSpaceBelow = bgH - (fgY + fgH);
		const freeSpaceLeft = fgX;
		const freeSpaceRight = bgW - (fgX + fgW);

		let bgShiftY = 0;
		if (overflowBottom >= 0) bgShiftY = Math.round((freeSpaceAbove - freeSpaceBelow) / 2);
		else if (overflowTop >= 0) bgShiftY = Math.round((freeSpaceBelow - freeSpaceAbove) / 2);

		let bgShiftX = 0;
		if (overflowRight >= 0) bgShiftX = Math.round((freeSpaceLeft - freeSpaceRight) / 2);
		else if (overflowLeft >= 0) bgShiftX = Math.round((freeSpaceRight - freeSpaceLeft) / 2);

		const cropY = bgShiftY >= 0 ? bgShiftY / 2 : 0;
		const padY = bgShiftY <= 0 ? -bgShiftY / 2 : 0;
		const croppedH = bgH - Math.abs(bgShiftY) / 2;

		const cropX = bgShiftX >= 0 ? bgShiftX / 2 : 0;
		const padX = bgShiftX <= 0 ? -bgShiftX / 2 : 0;
		const croppedW = bgW - Math.abs(bgShiftX) / 2;

		videoFilter = [
			`[0:v]crop=w=${croppedW}:h=${croppedH}:x=${cropX}:y=${cropY},`,
			`pad=w=${bgW}:h=${bgH}:x=${padX}:y=${padY}:color=black[bg];`,
			`[1:v]${fgColorFilter}${fgScaleFilter}${rotateFilter}[fg];`,
			`[bg][fg]overlay=${fgX + padX}:${fgY + padY},format=yuv420p[v]`,
		].join('');
	} else {
		videoFilter = `[1:v]${fgColorFilter}${fgScaleFilter}${rotateFilter}[fg];[0:v][fg]overlay=${fgX}:${fgY},format=yuv420p[v]`;
	}

	// ── Аудио ─────────────────────────────────────────────────────────────────

	const useBgAudio = opts.bgAudio && bgInfo.hasAudio;
	const useFgAudio = opts.fgAudio && fgInfo.hasAudio;

	let audioFilter = '';
	let audioMapStr: string;

	if (useBgAudio && useFgAudio) {
		audioFilter = ';[0:a][1:a]amix=inputs=2[a]';
		audioMapStr = `-map "[a]"`;
	} else if (useFgAudio) {
		audioMapStr = `-map 1:a`;
	} else if (useBgAudio) {
		audioMapStr = `-map 0:a`;
	} else {
		audioMapStr = `-an`;
	}

	// ── Финальная команда ─────────────────────────────────────────────────────

	testAndCreateFolder(path.dirname(targetPath));

	const ffmpegBin = (_description.programmPath.ffmpeg[0] as string).trim();
	const overwriteFlag = fs.existsSync(targetPath) ? '-y' : '';

	const cmdParts = [
		overwriteFlag,
		`-i "${bgFile}"`,
		`-i "${fgFile}"`,
		`-filter_complex "${videoFilter}${audioFilter}"`,
		`-map "[v]"`,
		audioMapStr,
		`-t ${finalDuration}`,
		`-c:v libx264 -preset faster -crf 22`,
		`"${targetPath}"`,
	].filter(Boolean);

	const cmd = `"${ffmpegBin}" ${cmdParts.join(' ')}`;

	sendToMW('log', { text: `ffmpeg path: ${ffmpegBin}\nexec command: ${cmd}` });
	sendToMW('statusbar', `${label} render → ${path.basename(targetPath)}`);

	const { stderr } = await execFFmpegCommand(cmd).catch((err: any) => {
		const errText = [err?.stderr, err?.error?.message].filter(Boolean).join('\n');
		sendToMW('log', { level: 'error', text: `[overlay] ffmpeg error:\n${errText}` });
		throw new Error(errText || 'ffmpeg exec failed');
	});

	if (stderr) {
		sendToMW('log', { level: 'info', text: `[overlay] ffmpeg stderr:\n${stderr}` });
	}

	return targetPath;
}

// ── Публичная функция плагина ─────────────────────────────────────────────────

export async function overlayAndOffsetFunc(_item: any, _description: any) {
	const finalFiles: string[] = [];

	// ── 1. Входные файлы ──────────────────────────────────────────────────────

	const bgFiles: string[] = (_item.import?.inputBG ?? []).filter(Boolean);
	const fgFiles: string[] = (_item.import?.inputFG ?? []).filter(Boolean);

	if (bgFiles.length === 0 || fgFiles.length === 0) {
		sendToMW('statusbar', `${_description.infoText}: [overlay] no input files, skipping`);
		return finalFiles;
	}

	// ── 2. Настройки наложения ────────────────────────────────────────────────

	if (!_item.overlaySettings) {
		sendToMW('statusbar', `${_description.infoText}: [overlay] ERROR: overlaySettings not configured`);
		return finalFiles;
	}

	let overlaySettings: OverlaySettings;
	try {
		overlaySettings = JSON.parse(_item.overlaySettings) as OverlaySettings;
	} catch {
		sendToMW('statusbar', `${_description.infoText}: [overlay] ERROR: failed to parse overlaySettings`);
		return finalFiles;
	}

	// ── 3. Опции аудио / offset ───────────────────────────────────────────────

	const opts = {
		fgAudio: _item.originalSoundFG === true,
		bgAudio: _item.originalSoundBG !== false, // true по умолчанию
		offsetBG: _item.offsetBG === true,
	};

	// ── 4. Целевой путь ───────────────────────────────────────────────────────

	const curPath: string[] = _item.targetPath?.length === 0 ? ['$clearName (overlay $random(3))'] : [...(_item.targetPath ?? [])];

	if (_item.import?.targetPath) {
		curPath.unshift(..._item.import.targetPath);
	} else {
		curPath.unshift('$localFolder', '$mainFolderName', '$projectName', '$findTime');
	}

	// ── 5. Итерируем по парам BG + FG ─────────────────────────────────────────

	const totalPairs = Math.max(bgFiles.length, fgFiles.length);

	for (let i = 0; i < totalPairs; i++) {
		const bgFile = bgFiles[Math.min(i, bgFiles.length - 1)];
		const fgFile = fgFiles[Math.min(i, fgFiles.length - 1)];

		sendToMW('statusbar', `${_description.infoText}: [overlay] pair ${i + 1}/${totalPairs}`);

		const basePath = createPathForFileByPattern(curPath, _description, bgFile);
		const dirPath = path.dirname(basePath);
		const fName = path.basename(basePath, path.extname(basePath));
		const outFile = path.join(dirPath, `${fName}.mp4`);
		testAndCreateFolder(dirPath);

		const result = await processSinglePair(bgFile, fgFile, overlaySettings, opts, outFile, _description);
		finalFiles.push(result);
	}
	sendToMW('log', { level: 'info', text: `Result:\n${finalFiles}` });
	return finalFiles;
}
