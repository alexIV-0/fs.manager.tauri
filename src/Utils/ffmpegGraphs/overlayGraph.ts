// src/Utils/ffmpegGraphs/overlayGraph.ts
//
// Shared overlayAndOffset VIDEO filtergraph builder — the SINGLE SOURCE OF TRUTH for
// the composite, imported by BOTH the overlayAndOffset plugin (export) and the Overlay
// preview (accurate frame). Audio mapping stays in the plugin (preview is video-only).
//
// Pure & self-contained (no ffmpeg/fs/React/alias imports) so it bundles into both the
// vite app and the esbuild-built plugin. The format is chosen from the ACTUAL BG dims
// (same as export) — so the preview matches whatever format the real BG file resolves to.

export interface OverlayFormatSettings {
	bgWidth: number;
	bgHeight: number;
	posX: number;
	posY: number;
	scaleW: number;
	scaleH: number;
	rotation: number;
}

export interface OverlayAllFormats {
	landscape: OverlayFormatSettings;
	portrait: OverlayFormatSettings;
	square: OverlayFormatSettings;
}

export interface OverlayGraphParams {
	overlaySettings: OverlayAllFormats;
	/** Real BG dimensions (ffprobe) — picks the format and the scale factor. */
	bgDims: { width: number; height: number };
	/** FG pixel format (ffprobe) — drives alpha normalization. Empty string = unknown → rgba. */
	fgPixFmt: string;
	/** Node-level "offset BG" option (shifts BG when FG fills/exceeds it). */
	offsetBG: boolean;
}

export interface OverlayGraph {
	/** filter_complex producing the mapped [v] pad (video only). */
	videoFilter: string;
	outLabel: string;
	/** FG normalization chain (for logging). */
	fgNormalization: string;
}

function isYuvaFormat(pixFmt: string): boolean {
	return !!pixFmt && pixFmt.startsWith('yuva');
}

function isRgbAlphaFormat(pixFmt: string): boolean {
	if (!pixFmt) return false;
	if (pixFmt.startsWith('gbrap')) return true;
	return ['rgba', 'argb', 'bgra', 'abgr', 'rgba64be', 'rgba64le'].includes(pixFmt);
}

/** Unified FG normalization (setparams ALWAYS first — matches the original plugin). */
function buildFgNormalizationFilter(pixFmt: string): string {
	const setparams = 'setparams=color_trc=bt709:color_primaries=bt709:colorspace=bt709';
	if (isYuvaFormat(pixFmt)) return `${setparams},format=yuva420p,format=rgba`;
	if (isRgbAlphaFormat(pixFmt)) return `${setparams},format=rgba`;
	return `${setparams},format=rgba`;
}

export function getOverlayFormatType(width: number, height: number): keyof OverlayAllFormats {
	if (width > height) return 'landscape';
	if (height > width) return 'portrait';
	return 'square';
}

/** Build the overlayAndOffset video filter_complex (verbatim from the plugin). */
export function buildOverlayGraph(p: OverlayGraphParams): OverlayGraph {
	const { overlaySettings, bgDims, fgPixFmt, offsetBG } = p;

	const formatType = getOverlayFormatType(bgDims.width, bgDims.height);
	const fmt = overlaySettings[formatType];

	const scaleFactorX = bgDims.width / fmt.bgWidth;
	const scaleFactorY = bgDims.height / fmt.bgHeight;

	const fgW = Math.round(fmt.scaleW * scaleFactorX);
	const fgH = Math.round(fmt.scaleH * scaleFactorY);
	const fgX = Math.round(fmt.posX * scaleFactorX);
	const fgY = Math.round(fmt.posY * scaleFactorY);

	const bgW = bgDims.width;
	const bgH = bgDims.height;

	const fgScaleFilter = `scale=${fgW}:${fgH}`;
	let rotateFilter = '';
	if (fmt.rotation !== 0) {
		const rotRad = (fmt.rotation * Math.PI) / 180;
		rotateFilter = `,rotate=${rotRad.toFixed(6)}:ow='rotw(${rotRad.toFixed(6)})':oh='roth(${rotRad.toFixed(6)})'`;
	}

	const fgNormalization = buildFgNormalizationFilter(fgPixFmt);
	const fgColorFilter = `${fgNormalization},`;

	let videoFilter: string;
	const needsOffset = offsetBG && (fgW >= bgW || fgH >= bgH);

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

	return { videoFilter, outLabel: '[v]', fgNormalization };
}
