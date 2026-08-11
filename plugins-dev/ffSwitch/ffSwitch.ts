// ffSwitch — переключение формата кадра (16:9 ↔ 9:16) с FG-слотами и BG-тайлами.
// Tauri-port: ffmpeg/fs через @plugin-api/tauri helper.

import path from 'path';
import type { PluginContext } from '../../src/PluginAPI/host';
import { createPathForFileByPattern } from '../../src/Utils/createPathForFileByPattern';
import { buildFfSwitchGraph } from '../../src/Utils/ffmpegGraphs/ffSwitchGraph';
import { buildEncodeArgs, defaultEncodeSettings, type EncodeSettings } from '../../src/Utils/ffmpegCaps';


// ── Типы (зеркалят VideoAdjustEdit/types.ts в renderer) ──────────────────────

interface BgAdjustSettings {
	blur: number;
	brightness: number;
	contrast: number;
	saturation: number;
	hFlip: boolean;
}

interface FgShadowSettings {
	enabled: boolean;
	blur: number;
	offsetX: number;
	offsetY: number;
	opacity: number;
	color: string;
}

interface VideoAdjustSettings {
	finalFormat: [number, number];
	autoFormat?: boolean;
	useFgAsBg: boolean;
	bgColor: string;
	fg: { copies: number; fitPercent: number; shadow?: FgShadowSettings };
	bg: { copies: number; adjust: BgAdjustSettings };
	encode?: EncodeSettings;
}

// calcFinalFormat / hexToRgb / buildBgAdjustFilter + the whole filter_complex builder
// moved to the shared module src/Utils/ffmpegGraphs/ffSwitchGraph.ts (single source of
// truth — the VideoAdjust preview renders the accurate frame with the same builder).

export async function ffSwitchFunc(_item: any, _description: any, ctx: PluginContext): Promise<string[]> {
	const { fs, ffmpeg, sendToMW } = ctx;
	const label = `${_description.infoText}: [ffSwitch]`;

	const fgFiles: string[] = (_item.import?.inputFG ?? []).filter(Boolean);
	const bgFiles: string[] = (_item.import?.inputBG ?? []).filter(Boolean);

	if (fgFiles.length === 0) {
		sendToMW('statusbar', { text: `${label} no FG files, skipping` });
		return [];
	}

	let settings: VideoAdjustSettings;
	try {
		settings = JSON.parse(_item.videoAdjustSettings) as VideoAdjustSettings;
	} catch {
		sendToMW('statusbar', { text: `${label} ERROR: videoAdjustSettings not configured` });
		return [];
	}

	const { useFgAsBg } = settings;
	const enc = settings.encode ?? defaultEncodeSettings();
	const fgCopies = Math.max(1, settings.fg.copies);

	const curPath: string[] = (_item.targetPath?.length ?? 0) === 0 ? ['$clearName (switch $random(3))'] : [...(_item.targetPath ?? [])];
	if (_item.import?.targetPath?.length) {
		curPath.unshift(..._item.import.targetPath);
	} else {
		curPath.unshift('$localFolder', '$mainFolderName', '$projectName', '$findTime');
	}

	// Распределяем FG-файлы по слотам циклически
	const fgSlots: string[] = Array.from({ length: fgCopies }, (_, i) => fgFiles[i % fgFiles.length]);

	const hasBgFile = useFgAsBg || bgFiles.length > 0;
	const bgFile: string | null = useFgAsBg ? fgSlots[0] : (bgFiles[0] ?? null);

	sendToMW('statusbar', { text: `${label} analyze ${fgSlots.length} slot(s)` });

	const uniqueFgFiles = [...new Set(fgSlots)];
	const uniqueFgInfos = await Promise.all(uniqueFgFiles.map((f) => ffmpeg.getInfo(f)));
	const fgInfoByFile = new Map(uniqueFgFiles.map((f, i) => [f, uniqueFgInfos[i]]));
	const fgInfos = fgSlots.map((f) => fgInfoByFile.get(f)!);
	const bgInfo = hasBgFile && bgFile ? await ffmpeg.getInfo(bgFile) : null;

	const importedTimecode = _item.import?.ddm?.[0];
	let duration: number;
	if (importedTimecode != null && importedTimecode !== '') {
		duration = Number(importedTimecode);
	} else {
		const durationMode = (_item.ddm as string) ?? 'Min';
		duration =
			durationMode === 'Max'
				? Math.max(...fgInfos.map((i) => i.durationInSeconds || 1))
				: Math.min(...fgInfos.map((i) => i.durationInSeconds || 1));
	}

	let audioSlotIndex: number | null = null;
	let bestAudioDiff = Infinity;
	for (let i = 0; i < fgInfos.length; i++) {
		if (!fgInfos[i].hasAudio) continue;
		const diff = Math.abs((fgInfos[i].durationInSeconds || 0) - duration);
		if (diff < bestAudioDiff) {
			bestAudioDiff = diff;
			audioSlotIndex = i;
		}
	}

	// Граф строится общим builder'ом (тот же, что рендерит точный кадр в превью).
	const { filterComplex } = buildFfSwitchGraph({
		settings,
		fgDims: fgInfos.map((i) => ({ width: i.width, height: i.height })),
		bgDims: bgInfo ? { width: bgInfo.width, height: bgInfo.height } : null,
		duration,
	});

	const audioMap: string[] = audioSlotIndex !== null ? ['-map', `${audioSlotIndex}:a`, '-c:a', 'aac'] : ['-an'];

	const basePath = createPathForFileByPattern(curPath, _description, fgSlots[0]);
	const dirPath = path.dirname(basePath);
	const fName = path.basename(basePath, path.extname(basePath));
	const outExt = enc.container === 'original' ? (path.extname(fgSlots[0]).slice(1) || 'mp4') : enc.container;
	const outFile = path.join(dirPath, `${fName}.${outExt}`);
	await fs.mkdir(dirPath);

	const inputFlags: string[] = fgSlots.flatMap((f) => ['-i', f]);
	if (bgFile) inputFlags.push('-i', bgFile);

	const ffmpegArgs: string[] = [
		'-y',
		...inputFlags,
		'-filter_complex',
		filterComplex,
		'-map',
		'[vout]',
		...audioMap,
		'-t',
		String(duration),
		...buildEncodeArgs(enc),
		'-threads',
		'0',
		outFile,
	];

	sendToMW('statusbar', { text: `${label} render → ${path.basename(outFile)}` });
	await ffmpeg.run({
		text: `${label} ${path.basename(fgSlots[0])}`,
		duration,
		nodeId: _item.id,
		command: ffmpegArgs,
	});

	sendToMW('log', { level: 'info', text: `Result:\n${outFile}` });
	return [outFile];
}
