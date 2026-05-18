import path from 'path';
import fs from 'fs';
import { getFullInfoFromVideoFile } from '../../electron/main/processing/ffmpeg/getFullInfoFromVideoFile';
import { spawnFFmpegCommand } from '../../electron/main/processing/ffmpeg/spawnFFmpegCommand';
import { createPathForFileByPattern } from '../../electron/main/utilits/createPathForFileByPattern';
import { testAndCreateFolder } from '../../electron/main/fileSistem/testAndCreateFolder';
import { sendToMW } from '../_template/pluginSender';

export { onLoad } from '../_template/pluginSender';

// ── Типы (зеркалят VideoAdjustEdit/types.ts в renderer) ──────────────────────

interface BgAdjustSettings {
	blur: number;
	brightness: number; // -1..+1, 0 = без изменений
	contrast: number; // 1 = без изменений
	saturation: number; // 1 = без изменений
	hFlip: boolean;
}

interface FgShadowSettings {
	enabled: boolean;
	blur: number; // 0–60 px
	offsetX: number; // -100..100
	offsetY: number; // -100..100
	opacity: number; // 0..1
	color: string; // hex '#rrggbb'
}

interface VideoAdjustSettings {
	finalFormat: [number, number];
	/** Если true — финальный формат вычисляется per-file как противоположный */
	autoFormat?: boolean;
	useFgAsBg: boolean;
	bgColor: string;
	fg: { copies: number; fitPercent: number; shadow?: FgShadowSettings };
	bg: { copies: number; adjust: BgAdjustSettings };
}

// ── Вспомогательные ───────────────────────────────────────────────────────────

function calcFinalFormat(autoFormat: boolean | undefined, fgW: number, fgH: number, fixedFormat: [number, number]): [number, number] {
	if (!autoFormat) return fixedFormat;
	// горизонтальный → вертикальный 1080×1920; вертикальный → горизонтальный 1920×1080; квадрат → 1080×1920
	if (fgH > fgW) return [1920, 1080];
	return [1080, 1920];
}

function hexToRgb(hex: string): [number, number, number] {
	const h = (hex || '#000000').replace('#', '').padEnd(6, '0');
	return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function buildBgAdjustFilter(adj: BgAdjustSettings): string {
	const parts: string[] = [];
	if (adj.blur > 0) parts.push(`boxblur=${adj.blur}:1`);

	// eq= принимает brightness (-1..+1), contrast (>0), saturation (0..3)
	const eqParts: string[] = [];
	if (adj.brightness !== 0) eqParts.push(`brightness=${adj.brightness.toFixed(3)}`);
	if (adj.contrast !== 1) eqParts.push(`contrast=${adj.contrast.toFixed(3)}`);
	if (adj.saturation !== 1) eqParts.push(`saturation=${adj.saturation.toFixed(3)}`);
	if (eqParts.length) parts.push(`eq=${eqParts.join(':')}`);

	if (adj.hFlip) parts.push('hflip');
	return parts.join(',');
}

// ── Основная функция ──────────────────────────────────────────────────────────

export async function ffSwitchFunc(_item: any, _description: any): Promise<string[]> {
	const label = `${_description.infoText}: [ffSwitch]`;

	// ── 1. Входные файлы ──────────────────────────────────────────────────────

	const fgFiles: string[] = (_item.import?.inputFG ?? []).filter(Boolean);
	const bgFiles: string[] = (_item.import?.inputBG ?? []).filter(Boolean);

	if (fgFiles.length === 0) {
		sendToMW('statusbar', `${label} no FG files, skipping`);
		return [];
	}

	// ── 2. Настройки ─────────────────────────────────────────────────────────

	let settings: VideoAdjustSettings;
	try {
		settings = JSON.parse(_item.videoAdjustSettings) as VideoAdjustSettings;
	} catch {
		sendToMW('statusbar', `${label} ERROR: videoAdjustSettings not configured`);
		return [];
	}

	const { useFgAsBg, fg, bg, bgColor } = settings;

	const fgCopies = Math.max(1, fg.copies);
	const bgCopies = Math.max(1, bg.copies);
	const fitPercent = Math.min(100, Math.max(0, fg.fitPercent)) / 100;

	const bgAdjFilter = buildBgAdjustFilter(bg.adjust);

	// ── 3. Целевой путь ───────────────────────────────────────────────────────

	const curPath: string[] = _item.targetPath?.length === 0 ? ['$clearName (switch $random(3))'] : [...(_item.targetPath ?? [])];

	if (_item.import?.targetPath) {
		curPath.unshift(..._item.import.targetPath);
	} else {
		curPath.unshift('$localFolder', '$mainFolderName', '$projectName', '$findTime');
	}

	// ── 4. Распределяем FG-файлы по слотам ────────────────────────────────────
	// Всегда ровно fgCopies слотов. Файлы циклически заполняют слоты:
	//   1 файл, 2 копии  → [f1, f1]
	//   2 файла, 2 копии → [f1, f2]
	//   3 файла, 2 копии → [f1, f2]      (f3 отбрасывается)
	//   2 файла, 3 копии → [f1, f2, f1]  (цикл с начала)

	const fgSlots: string[] = Array.from({ length: fgCopies }, (_, i) => fgFiles[i % fgFiles.length]);

	// Если useFgAsBg=true → BG из первого слота FG.
	// Если bgFiles пуст → используем цвет (bgFile будет null, обрабатываем ниже).
	const hasBgFile = useFgAsBg || bgFiles.length > 0;
	const bgFile = useFgAsBg ? fgSlots[0] : (bgFiles[0] ?? null);

	sendToMW('statusbar', `${label} analyze ${fgSlots.length} slot(s)`);

	// Пробуем только уникальные файлы (один файл может быть в нескольких слотах)
	const uniqueFgFiles = [...new Set(fgSlots)];
	const uniqueFgInfos = await Promise.all(uniqueFgFiles.map((f) => getFullInfoFromVideoFile(f, _description)));
	const fgInfoByFile = new Map(uniqueFgFiles.map((f, i) => [f, uniqueFgInfos[i]]));
	const fgInfos = fgSlots.map((f) => fgInfoByFile.get(f)!);

	const bgInfo = hasBgFile && bgFile ? await getFullInfoFromVideoFile(bgFile, _description) : null;

	const fgInfo0 = fgInfos[0];

	// ── Длительность финального ролика ────────────────────────────────────────
	const importedTimecode = _item.import?.ddm?.[0];
	let duration: number;

	if (importedTimecode != null && importedTimecode !== '') {
		duration = Number(importedTimecode);
	} else {
		const durationMode = (_item.ddm as string) ?? 'Min';
		duration = durationMode === 'Max'
			? Math.max(...fgInfos.map((i) => i.durationInSeconds || 1))
			: Math.min(...fgInfos.map((i) => i.durationInSeconds || 1));
	}

	// ── Аудио-слот: ближайший к duration среди слотов с аудио-дорожкой ────────
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

	const [finalW, finalH] = calcFinalFormat(settings.autoFormat, fgInfo0.width, fgInfo0.height, settings.finalFormat);
	const isPortrait = finalH >= finalW;

	// Площадь одного слота (равные ячейки)
	const areaW = isPortrait ? finalW : finalW / fgCopies;
	const areaH = isPortrait ? finalH / fgCopies : finalH;

	// Per-slot scale/crop: считается индивидуально для каждого файла в слоте
	const slotsRaw = fgInfos.map((info) => {
		const fgW = info.width;
		const fgH = info.height;
		const scaleFit = Math.min(areaW / fgW, areaH / fgH);
		const scaleFill = Math.max(areaW / fgW, areaH / fgH);
		const fgScale = scaleFit + (scaleFill - scaleFit) * fitPercent;
		const fgRenderW = Math.round(fgW * fgScale);
		const fgRenderH = Math.round(fgH * fgScale);
		const cropW = Math.min(fgRenderW, Math.round(areaW));
		const cropH = Math.min(fgRenderH, Math.round(areaH));
		const cropX = Math.max(0, Math.round((fgRenderW - cropW) / 2));
		const cropY = Math.max(0, Math.round((fgRenderH - cropH) / 2));
		return { fgRenderW, fgRenderH, cropW, cropH, cropX, cropY };
	});

	// Space-evenly позиции (работает и при разных cropW/cropH в слотах)
	const sumCropW = slotsRaw.reduce((s, x) => s + x.cropW, 0);
	const sumCropH = slotsRaw.reduce((s, x) => s + x.cropH, 0);
	const gapX = isPortrait ? 0 : (finalW - sumCropW) / (fgCopies + 1);
	const gapY = isPortrait ? (finalH - sumCropH) / (fgCopies + 1) : 0;

	const slotLayouts = slotsRaw.map((s, i) => {
		let fgX: number;
		let fgY: number;
		if (isPortrait) {
			const beforeH = slotsRaw.slice(0, i).reduce((acc, x) => acc + x.cropH, 0);
			fgX = Math.round((finalW - s.cropW) / 2);
			fgY = Math.round(gapY * (i + 1) + beforeH);
		} else {
			const beforeW = slotsRaw.slice(0, i).reduce((acc, x) => acc + x.cropW, 0);
			fgX = Math.round(gapX * (i + 1) + beforeW);
			fgY = Math.round((finalH - s.cropH) / 2);
		}
		return { ...s, fgX, fgY };
	});

	// ── Строим filter_complex ─────────────────────────────────────────────────
	// Входы: [0..fgCopies-1] — FG (по одному -i на слот, даже если файл повторяется).
	// [fgCopies] — BG-файл, только если bgFile != null.

	const filterParts: string[] = [];
	const bgInputIdx = fgCopies;

	// ── BG тайлы ──────────────────────────────────────────────────────────────

	const bgCellW = isPortrait ? finalW : Math.round(finalW / bgCopies);
	const bgCellH = isPortrait ? Math.round(finalH / bgCopies) : finalH;

	if (!bgFile || !bgInfo) {
		// Цвет заливки (нет BG-файла)
		const hex = (bgColor || '#000000').replace('#', '');
		const colorVal = `0x${hex.padEnd(6, '0')}ff`;
		const extra = bgAdjFilter ? `,${bgAdjFilter}` : '';
		filterParts.push(`color=color=${colorVal}:size=${finalW}x${finalH}:d=${duration}${extra}[bg_final]`);
	} else if (bgCopies === 1) {
		// 1 тайл — простой cover
		const bgScale = bgInfo.width / bgInfo.height > bgCellW / bgCellH ? `scale=-1:${bgCellH}` : `scale=${bgCellW}:-1`;
		const extra = bgAdjFilter ? `,${bgAdjFilter}` : '';
		filterParts.push(`[${bgInputIdx}:v]${bgScale},crop=${bgCellW}:${bgCellH}${extra}[bg_final]`);
	} else {
		// N тайлов через split + overlay
		const splitLabels = Array.from({ length: bgCopies }, (_, i) => `[bgsrc${i}]`).join('');
		filterParts.push(`[${bgInputIdx}:v]split=${bgCopies}${splitLabels}`);

		const bgScale = bgInfo.width / bgInfo.height > bgCellW / bgCellH ? `scale=-1:${bgCellH}` : `scale=${bgCellW}:-1`;
		const extra = bgAdjFilter ? `,${bgAdjFilter}` : '';
		for (let i = 0; i < bgCopies; i++) {
			filterParts.push(`[bgsrc${i}]${bgScale},crop=${bgCellW}:${bgCellH}${extra}[bgcell${i}]`);
		}

		const hex = (bgColor || '#000000').replace('#', '');
		const colorVal = `0x${hex.padEnd(6, '0')}ff`;
		filterParts.push(`color=color=${colorVal}:size=${finalW}x${finalH}:d=${duration}[bg_base]`);

		let bgBase = 'bg_base';
		for (let i = 0; i < bgCopies; i++) {
			const tileX = isPortrait ? 0 : i * bgCellW;
			const tileY = isPortrait ? i * bgCellH : 0;
			const outLabel = i === bgCopies - 1 ? 'bg_final' : `bg_tmp${i}`;
			filterParts.push(`[${bgBase}][bgcell${i}]overlay=${tileX}:${tileY}[${outLabel}]`);
			bgBase = outLabel;
		}
	}

	// ── FG слоты ──────────────────────────────────────────────────────────────

	const shadow = fg.shadow;
	const hasShadow = !!(shadow?.enabled && (shadow.blur > 0 || shadow.opacity > 0));

	let curBase = 'bg_final';

	for (let i = 0; i < fgCopies; i++) {
		const { fgRenderW, fgRenderH, cropW, cropH, cropX, cropY, fgX, fgY } = slotLayouts[i];
		const scaleFilter = `scale=${fgRenderW}:${fgRenderH}`;
		const cropFilter = `crop=${cropW}:${cropH}:${cropX}:${cropY}`;
		const isLast = i === fgCopies - 1;
		const outLabel = isLast ? '[vout]' : `[vtmp${i}]`;

		if (hasShadow && shadow) {
			const [sr, sg, sb] = hexToRgb(shadow.color);
			const sa = Math.round(Math.min(1, Math.max(0, shadow.opacity)) * 255);
			const blurVal = Math.max(1, Math.round(shadow.blur));
			const shadX = Math.round(fgX + shadow.offsetX);
			const shadY = Math.round(fgY + shadow.offsetY);
			const afterShad = `vshadbase${i}`;

			filterParts.push(`[${i}:v]${scaleFilter},${cropFilter},format=rgba[fgraw${i}]`);
			filterParts.push(`[fgraw${i}]split=2[fgmain${i}][fgsrc${i}]`);
			filterParts.push(`[fgsrc${i}]geq=r=${sr}:g=${sg}:b=${sb}:a=${sa},boxblur=${blurVal}:1[fgshad${i}]`);
			filterParts.push(`[${curBase}][fgshad${i}]overlay=${shadX}:${shadY}[${afterShad}]`);
			filterParts.push(`[${afterShad}][fgmain${i}]overlay=${fgX}:${fgY}${outLabel}`);
		} else {
			filterParts.push(`[${i}:v]${scaleFilter},${cropFilter}[fg${i}]`);
			filterParts.push(`[${curBase}][fg${i}]overlay=${fgX}:${fgY}${outLabel}`);
		}

		curBase = isLast ? 'vout' : `vtmp${i}`;
	}

	const filterComplex = filterParts.join(';');

	// ── Аудио ────────────────────────────────────────────────────────────────
	// Берём из первого FG-слота (input [0:a]).

	const audioMap: string[] = audioSlotIndex !== null ? ['-map', `${audioSlotIndex}:a`, '-c:a', 'aac'] : ['-an'];

	// ── Финальная команда ─────────────────────────────────────────────────────

	const basePath = createPathForFileByPattern(curPath, _description, fgSlots[0]);
	const dirPath = path.dirname(basePath);
	const fName = path.basename(basePath, path.extname(basePath));
	const outFile = path.join(dirPath, `${fName}.mp4`);
	testAndCreateFolder(dirPath);

	// Один -i на каждый слот (один и тот же файл может подаваться несколько раз —
	// FFmpeg создаёт независимые входные потоки).
	const inputFlags: string[] = fgSlots.flatMap((f) => ['-i', f]);
	if (bgFile) inputFlags.push('-i', bgFile);

	const ffmpegArgs: string[] = [
		...(fs.existsSync(outFile) ? ['-y'] : []),
		...inputFlags,
		'-filter_complex',
		filterComplex,
		'-map',
		'[vout]',
		...audioMap,
		'-t',
		String(duration),
		'-c:v',
		'libx264',
		'-preset',
		'faster',
		'-crf',
		'22',
		'-threads',
		'0',
		outFile,
	];

	sendToMW('statusbar', `${label} render → ${path.basename(outFile)}`);

	await spawnFFmpegCommand({ text: `${label} ${path.basename(fgSlots[0])}`, duration, command: ffmpegArgs }, _description, sendToMW);

	sendToMW('log', { level: 'info', text: `Result:\n${outFile}` });
	return [outFile];
}
