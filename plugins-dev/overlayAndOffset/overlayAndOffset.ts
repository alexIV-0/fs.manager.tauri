// overlayAndOffset — наложение FG на BG c унифицированной нормализацией FG.
// Tauri-port: execFFmpegCommand → ffmpeg.run (массив args, без shell-escape);
// getFullInfoFromVideoFile → ffmpeg.getInfo; fs/path → helper.

import path from 'path';
import type { PluginContext } from '../../src/PluginAPI/host';
import { createPathForFileByPattern } from '../../src/Utils/createPathForFileByPattern';
import { buildEncodeArgs, encodeExt, encodeProfile, type EncodeSettings } from '../../src/Utils/ffmpegCaps';
import { buildOverlayGraph } from '../../src/Utils/ffmpegGraphs/overlayGraph';


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
	/** Render-настройки выхода: попап «настройки кодирования» в шапке ноды. */
	encode?: EncodeSettings;
}

// Нормализация FG + построение видео-filter_complex вынесены в общий модуль
// src/Utils/ffmpegGraphs/overlayGraph.ts (единый источник правды — превью overlay
// рендерит точный кадр тем же builder'ом).

// ── Pipeline для одной пары BG+FG ────────────────────────────────────────────

async function processSinglePair(
	bgFile: string,
	fgFile: string,
	overlaySettings: OverlaySettings,
	opts: { fgAudio: boolean; bgAudio: boolean; offsetBG: boolean },
	targetPath: string,
	_description: any,
	// ctx перед необязательным nodeId: host-сервисы приходят из него, поэтому у
	// модуля не остаётся состояния и загрузчик его кэширует.
	ctx: PluginContext,
	nodeId?: string,
): Promise<string> {
	const { fs, ffmpeg, sendToMW } = ctx;
	const label = `${_description.infoText}: [overlay]`;

	sendToMW('statusbar', { text: `${label} analyze\n${path.basename(bgFile)}` });
	const bgInfo = await ffmpeg.getInfo(bgFile);

	sendToMW('statusbar', { text: `${label} analyze\n${path.basename(fgFile)}` });
	const fgInfo = await ffmpeg.getInfo(fgFile);

	const finalDuration = bgInfo.durationInSeconds > 0 ? bgInfo.durationInSeconds : fgInfo.durationInSeconds;

	// Видео-граф строится общим builder'ом (тот же, что рендерит точный кадр в превью).
	const { videoFilter, fgNormalization } = buildOverlayGraph({
		overlaySettings,
		bgDims: { width: bgInfo.width, height: bgInfo.height },
		fgPixFmt: fgInfo.pix_fmt || '',
		offsetBG: opts.offsetBG,
	});

	sendToMW('log', {
		level: 'info',
		text:
			`[overlay] FG normalize: codec=${fgInfo.codec_name}` +
			` pix_fmt=${fgInfo.pix_fmt}` +
			` primaries=${fgInfo.color_primaries ?? '-'}` +
			` trc=${fgInfo.color_transfer ?? '-'}` +
			` → ${fgNormalization}`,
	});

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
			// Дефолт (`standard`) — тот же libx264 -preset faster -crf 22, что был зашит здесь.
			...buildEncodeArgs(overlaySettings.encode ?? encodeProfile('standard')),
			targetPath,
		],
	});

	return targetPath;
}

// ── Plugin entry ─────────────────────────────────────────────────────────────

export async function overlayAndOffsetFunc(_item: any, _description: any, ctx: PluginContext): Promise<string[]> {
	const { sendToMW } = ctx;
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
		const outFile = path.join(dirPath, `${fName}.${encodeExt(overlaySettings.encode ?? encodeProfile('standard'), bgFile)}`);

		const result = await processSinglePair(bgFile, fgFile, overlaySettings, opts, outFile, _description, ctx, _item.id);
		finalFiles.push(result);
	}

	sendToMW('log', { level: 'info', text: `Result:\n${finalFiles.join('\n')}` });
	return finalFiles;
}
