// src/Utils/ffmpegGraphs/ffSwitchGraph.ts
//
// Shared ffSwitch filter_complex builder — the SINGLE SOURCE OF TRUTH for the graph,
// imported by BOTH the ffSwitch plugin (export) and the VideoAdjust preview (accurate
// frame). Keeping one builder guarantees preview == export.
//
// Pure & self-contained: no ffmpeg/fs/React/alias imports, so it bundles cleanly into
// both the vite app and the esbuild-built plugin. Inputs are just settings + per-input
// dimensions + duration; output is the filtergraph string and the inputs it expects.
//
// The settings interface is structurally identical to VideoAdjustSettings
// (src/NODE_WIN/nodes/properties/VideoAdjustEdit/types.ts) so callers pass theirs directly.

export interface FfSwitchBgAdjust {
	blur: number;
	brightness: number;
	contrast: number;
	saturation: number;
	hFlip: boolean;
}

export interface FfSwitchFgShadow {
	enabled: boolean;
	blur: number;
	offsetX: number;
	offsetY: number;
	opacity: number;
	color: string;
}

export interface FfSwitchSettings {
	finalFormat: [number, number];
	autoFormat?: boolean;
	useFgAsBg: boolean;
	bgColor: string;
	fg: { copies: number; fitPercent: number; shadow?: FfSwitchFgShadow };
	bg: { copies: number; adjust: FfSwitchBgAdjust };
}

export interface Dim { width: number; height: number; }

export interface FfSwitchGraphParams {
	settings: FfSwitchSettings;
	/** Dimensions per FG slot (length = fg.copies). For the preview all slots = the FG video. */
	fgDims: Dim[];
	/** BG source dims, or null when there's no BG file (solid-colour BG). */
	bgDims: Dim | null;
	/** Output duration (sec) — only affects the `color=` source length; any ≥frame value is fine for a still. */
	duration: number;
}

export interface FfSwitchGraph {
	filterComplex: string;
	/** Mapped output pad. */
	outLabel: string;
	/** Resolved final format after autoFormat. */
	finalFormat: [number, number];
	/** Number of FG inputs the graph references ([0:v]…[fgCopies-1:v]). */
	fgInputCount: number;
	/** Whether the graph references a trailing BG input ([fgCopies:v]). */
	hasBgInput: boolean;
}

export function calcFinalFormat(
	autoFormat: boolean | undefined,
	fgW: number,
	fgH: number,
	fixedFormat: [number, number],
): [number, number] {
	if (!autoFormat) return fixedFormat;
	if (fgH > fgW) return [1920, 1080];
	return [1080, 1920];
}

function hexToRgb(hex: string): [number, number, number] {
	const h = (hex || '#000000').replace('#', '').padEnd(6, '0');
	return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function buildBgAdjustFilter(adj: FfSwitchBgAdjust): string {
	const parts: string[] = [];
	if (adj.blur > 0) parts.push(`boxblur=${adj.blur}:1`);
	const eqParts: string[] = [];
	if (adj.brightness !== 0) eqParts.push(`brightness=${adj.brightness.toFixed(3)}`);
	if (adj.contrast !== 1) eqParts.push(`contrast=${adj.contrast.toFixed(3)}`);
	if (adj.saturation !== 1) eqParts.push(`saturation=${adj.saturation.toFixed(3)}`);
	if (eqParts.length) parts.push(`eq=${eqParts.join(':')}`);
	if (adj.hFlip) parts.push('hflip');
	return parts.join(',');
}

/**
 * Build the ffSwitch filter_complex. Extracted verbatim from the plugin so the export
 * and the preview produce byte-identical graphs (given the same dims + duration).
 */
export function buildFfSwitchGraph(p: FfSwitchGraphParams): FfSwitchGraph {
	const { settings, fgDims, bgDims, duration } = p;
	const { useFgAsBg, fg, bg, bgColor } = settings;
	const fgCopies = Math.max(1, fg.copies);
	const bgCopies = Math.max(1, bg.copies);
	const fitPercent = Math.min(100, Math.max(0, fg.fitPercent)) / 100;
	const bgAdjFilter = buildBgAdjustFilter(bg.adjust);

	const fgInfo0 = fgDims[0];
	const [finalW, finalH] = calcFinalFormat(settings.autoFormat, fgInfo0.width, fgInfo0.height, settings.finalFormat);
	const isPortrait = finalH >= finalW;

	const areaW = isPortrait ? finalW : finalW / fgCopies;
	const areaH = isPortrait ? finalH / fgCopies : finalH;

	const slotsRaw = fgDims.map((info) => {
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

	const filterParts: string[] = [];
	const ptsReset = 'setpts=PTS-STARTPTS';
	const bgInputIdx = fgCopies;
	const bgCellW = isPortrait ? finalW : Math.round(finalW / bgCopies);
	const bgCellH = isPortrait ? Math.round(finalH / bgCopies) : finalH;

	if (!bgDims) {
		const hex = (bgColor || '#000000').replace('#', '');
		const colorVal = `0x${hex.padEnd(6, '0')}ff`;
		const extra = bgAdjFilter ? `,${bgAdjFilter}` : '';
		filterParts.push(`color=color=${colorVal}:size=${finalW}x${finalH}:d=${duration}${extra}[bg_final]`);
	} else if (bgCopies === 1) {
		const bgScale = bgDims.width / bgDims.height > bgCellW / bgCellH ? `scale=-1:${bgCellH}` : `scale=${bgCellW}:-1`;
		const extra = bgAdjFilter ? `,${bgAdjFilter}` : '';
		filterParts.push(`[${bgInputIdx}:v]${ptsReset},${bgScale},crop=${bgCellW}:${bgCellH}${extra}[bg_final]`);
	} else {
		const splitLabels = Array.from({ length: bgCopies }, (_, i) => `[bgsrc${i}]`).join('');
		filterParts.push(`[${bgInputIdx}:v]${ptsReset},split=${bgCopies}${splitLabels}`);
		const bgScale = bgDims.width / bgDims.height > bgCellW / bgCellH ? `scale=-1:${bgCellH}` : `scale=${bgCellW}:-1`;
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
			filterParts.push(`[${i}:v]${ptsReset},${scaleFilter},${cropFilter},format=rgba[fgraw${i}]`);
			filterParts.push(`[fgraw${i}]split=2[fgmain${i}][fgsrc${i}]`);
			filterParts.push(`[fgsrc${i}]geq=r=${sr}:g=${sg}:b=${sb}:a=${sa},boxblur=${blurVal}:1[fgshad${i}]`);
			filterParts.push(`[${curBase}][fgshad${i}]overlay=${shadX}:${shadY}[${afterShad}]`);
			filterParts.push(`[${afterShad}][fgmain${i}]overlay=${fgX}:${fgY}${outLabel}`);
		} else {
			filterParts.push(`[${i}:v]${ptsReset},${scaleFilter},${cropFilter}[fg${i}]`);
			filterParts.push(`[${curBase}][fg${i}]overlay=${fgX}:${fgY}${outLabel}`);
		}
		curBase = isLast ? 'vout' : `vtmp${i}`;
	}

	return {
		filterComplex: filterParts.join(';'),
		outLabel: '[vout]',
		finalFormat: [finalW, finalH],
		fgInputCount: fgCopies,
		hasBgInput: bgDims !== null,
	};
}
