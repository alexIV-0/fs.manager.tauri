// overlayAndOffset — наложение FG на BG c унифицированной нормализацией FG.
// Tauri-port: execFFmpegCommand → ffmpeg.run (массив args, без shell-escape);
// getFullInfoFromVideoFile → ffmpeg.getInfo; fs/path → helper.

import path from 'path';
import { fs, ffmpeg, sendToMW, VideoFileInfo } from '../_template/tauri';
import { createPathForFileByPattern } from '../../src/Utils/createPathForFileByPattern';

export { onLoad } from '../_template/tauri';

// ── Типы (зеркало OverlayEdit/types.ts) ──────────────────────────────────────

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

function isYuvaFormat(pix_fmt?: string): boolean {
	return !!pix_fmt && pix_fmt.startsWith('yuva');
}

function isRgbAlphaFormat(pix_fmt?: string): boolean {
	if (!pix_fmt) return false;
	if (pix_fmt.startsWith('gbrap')) return true;
	return ['rgba', 'argb', 'bgra', 'abgr', 'rgba64be', 'rgba64le'].includes(pix_fmt);
}

function hasAlphaChannel(pix_fmt?: string): boolean {
	return isYuvaFormat(pix_fmt) || isRgbAlphaFormat(pix_fmt);
}

// Унифицированная нормализация FG (setparams ВСЕГДА первым, см. оригинальный плагин).
function buildFgNormalizationFilter(info: VideoFileInfo): string {
	const pix = info.pix_fmt || '';
	const setparams = 'setparams=color_trc=bt709:color_primaries=bt709:colorspace=bt709';
	if (isYuvaFormat(pix)) return `${setparams},format=yuva420p,format=rgba`;
	if (isRgbAlphaFormat(pix)) return `${setparams},format=rgba`;
	return `${setparams},format=rgba`;
}

function getFormatType(width: number, height: number): keyof OverlaySettings {
	if (width > height) return 'landscape';
	if (height > width) return 'portrait';
	return 'square';
}

// ── Pipeline для одной пары BG+FG ────────────────────────────────────────────

async function processSinglePair(
	bgFile: string,
	fgFile: string,
	overlaySettings: OverlaySettings,
	opts: { fgAudio: boolean; bgAudio: boolean; offsetBG: boolean },
	targetPath: string,
	_description: any,
	nodeId?: string,
): Promise<string> {
	const label = `${_description.infoText}: [overlay]`;

	sendToMW('statusbar', { text: `${label} analyze\n${path.basename(bgFile)}` });
	const bgInfo = await ffmpeg.getInfo(bgFile);

	sendToMW('statusbar', { text: `${label} analyze\n${path.basename(fgFile)}` });
	const fgInfo = await ffmpeg.getInfo(fgFile);

	const formatType = getFormatType(bgInfo.width, bgInfo.height);
	const fmt = overlaySettings[formatType];

	const scaleFactorX = bgInfo.width / fmt.bgWidth;
	const scaleFactorY = bgInfo.height / fmt.bgHeight;

	const fgW = Math.round(fmt.scaleW * scaleFactorX);
	const fgH = Math.round(fmt.scaleH * scaleFactorY);
	const fgX = Math.round(fmt.posX * scaleFactorX);
	const fgY = Math.round(fmt.posY * scaleFactorY);

	const bgW = bgInfo.width;
	const bgH = bgInfo.height;
	const finalDuration = bgInfo.durationInSeconds > 0 ? bgInfo.durationInSeconds : fgInfo.durationInSeconds;

	const fgScaleFilter = `scale=${fgW}:${fgH}`;
	let rotateFilter = '';
	if (fmt.rotation !== 0) {
		const rotRad = (fmt.rotation * Math.PI) / 180;
		rotateFilter = `,rotate=${rotRad.toFixed(6)}:ow='rotw(${rotRad.toFixed(6)})':oh='roth(${rotRad.toFixed(6)})'`;
	}

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

		videoFilter =
			`[0:v]crop=w=${croppedW}:h=${croppedH}:x=${cropX}:y=${cropY},` +
			`pad=w=${bgW}:h=${bgH}:x=${padX}:y=${padY}:color=black[bg];` +
			`[1:v]${fgColorFilter}${fgScaleFilter}${rotateFilter}[fg];` +
			`[bg][fg]overlay=${fgX + padX}:${fgY + padY},format=yuv420p[v]`;
	} else {
		videoFilter = `[1:v]${fgColorFilter}${fgScaleFilter}${rotateFilter}[fg];[0:v][fg]overlay=${fgX}:${fgY},format=yuv420p[v]`;
	}

	// Аудио
	const useBgAudio = opts.bgAudio && bgInfo.hasAudio;
	const useFgAudio = opts.fgAudio && fgInfo.hasAudio;

	let audioFilterComplex = '';
	const audioMap: string[] = [];

	if (useBgAudio && useFgAudio) {
		audioFilterComplex = ';[0:a][1:a]amix=inputs=2[a]';
		audioMap.push('-map', '[a]');
	} else if (useFgAudio) {
		audioMap.push('-map', '1:a');
	} else if (useBgAudio) {
		audioMap.push('-map', '0:a');
	} else {
		audioMap.push('-an');
	}

	await fs.mkdir(path.dirname(targetPath));

	sendToMW('statusbar', { text: `${label} render → ${path.basename(targetPath)}` });
	await ffmpeg.run({
		text: `${label} ${path.basename(targetPath)}`,
		duration: finalDuration || 10,
		nodeId,
		command: [
			'-y',
			'-i',
			bgFile,
			'-i',
			fgFile,
			'-filter_complex',
			`${videoFilter}${audioFilterComplex}`,
			'-map',
			'[v]',
			...audioMap,
			'-t',
			String(finalDuration),
			'-c:v',
			'libx264',
			'-preset',
			'faster',
			'-crf',
			'22',
			targetPath,
		],
	});

	return targetPath;
}

// ── Plugin entry ─────────────────────────────────────────────────────────────

export async function overlayAndOffsetFunc(_item: any, _description: any): Promise<string[]> {
	const finalFiles: string[] = [];

	const bgFiles: string[] = (_item.import?.inputBG ?? []).filter(Boolean);
	const fgFiles: string[] = (_item.import?.inputFG ?? []).filter(Boolean);
	if (bgFiles.length === 0 || fgFiles.length === 0) {
		sendToMW('statusbar', { text: `${_description.infoText}: [overlay] no input files, skipping` });
		return finalFiles;
	}

	if (!_item.overlaySettings) {
		sendToMW('statusbar', { text: `${_description.infoText}: [overlay] ERROR: overlaySettings not configured` });
		return finalFiles;
	}

	let overlaySettings: OverlaySettings;
	try {
		overlaySettings = JSON.parse(_item.overlaySettings) as OverlaySettings;
	} catch {
		sendToMW('statusbar', { text: `${_description.infoText}: [overlay] ERROR: failed to parse overlaySettings` });
		return finalFiles;
	}

	const opts = {
		fgAudio: _item.originalSoundFG === true,
		bgAudio: _item.originalSoundBG !== false,
		offsetBG: _item.offsetBG === true,
	};

	const curPath: string[] = (_item.targetPath?.length ?? 0) === 0 ? ['$clearName (overlay $random(3))'] : [...(_item.targetPath ?? [])];
	if (_item.import?.targetPath?.length) {
		curPath.unshift(..._item.import.targetPath);
	} else {
		curPath.unshift('$localFolder', '$mainFolderName', '$projectName', '$findTime');
	}

	const totalPairs = Math.max(bgFiles.length, fgFiles.length);
	for (let i = 0; i < totalPairs; i++) {
		const bgFile = bgFiles[Math.min(i, bgFiles.length - 1)];
		const fgFile = fgFiles[Math.min(i, fgFiles.length - 1)];

		sendToMW('statusbar', { text: `${_description.infoText}: [overlay] pair ${i + 1}/${totalPairs}` });

		const basePath = createPathForFileByPattern(curPath, _description, bgFile);
		const dirPath = path.dirname(basePath);
		const fName = path.basename(basePath, path.extname(basePath));
		const outFile = path.join(dirPath, `${fName}.mp4`);

		const result = await processSinglePair(bgFile, fgFile, overlaySettings, opts, outFile, _description, _item.id);
		finalFiles.push(result);
	}

	sendToMW('log', { level: 'info', text: `Result:\n${finalFiles.join('\n')}` });
	return finalFiles;
}
