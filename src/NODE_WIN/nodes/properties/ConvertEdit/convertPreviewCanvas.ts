// src/NODE_WIN/nodes/properties/ConvertEdit/convertPreviewCanvas.ts
//
// Client-side canvas renderer for the Convert "Converted Preview".
// Mirrors the geometry/colour part of the ffmpeg filter chain (see types.ts
// buildVideoFilterItems / buildVideoFilterString) so the modal can show a live
// preview WITHOUT calling ffmpeg — same approach as the ffSwitch (VideoAdjust)
// and overlayAndOffset previews.
//
// Filters that have no canvas/CSS equivalent (deinterlace, fps, pixfmt, unsharp,
// denoise) are passed through unchanged — they don't affect the visible preview.

import {
	ConvertSettings,
	VideoFilterItem,
	ImageFilterItem,
	FrameSettings,
	defaultFrameSettings,
} from './types';
import { applyFfmpegEq, applyGaussianBlur } from '@/Utils/canvasFilters';

type AnyFilter = VideoFilterItem | ImageFilterItem;
type Source = CanvasImageSource & { width?: number; height?: number };

function makeCanvas(w: number, h: number): HTMLCanvasElement {
	const c = document.createElement('canvas');
	c.width = Math.max(1, Math.round(w));
	c.height = Math.max(1, Math.round(h));
	return c;
}

function findBgColor(filters: AnyFilter[]): string {
	const f = (filters as VideoFilterItem[]).find((x) => x.type === 'bgcolor' && x.enabled !== false) as
		| { color: string }
		| undefined;
	return f?.color ?? '#000000';
}

/** Apply one filter to an input canvas, returning a new canvas. */
function applyFilter(
	input: HTMLCanvasElement,
	f: AnyFilter,
	frame: FrameSettings | undefined,
	bgColor: string,
): HTMLCanvasElement {
	const iw = input.width;
	const ih = input.height;

	switch (f.type) {
		case 'scale': {
			if (f.mode === 'original') return input;
			let ow: number;
			let oh: number;
			if (f.mode === 'pct') {
				const wp = f.widthPct / 100;
				ow = iw * wp;
				oh = f.lockAspect ? ih * wp : ih * (f.heightPct / 100);
			} else {
				ow = f.fixedW;
				oh = f.lockAspect ? f.fixedW * (ih / iw) : f.fixedH;
			}
			const out = makeCanvas(ow, oh);
			const ctx = out.getContext('2d')!;
			ctx.drawImage(input, 0, 0, out.width, out.height);
			return out;
		}
		case 'crop': {
			let cw: number, ch: number, cx: number, cy: number;
			if (f.unit === 'pct') {
				cw = iw * (f.w / 100);
				ch = ih * (f.h / 100);
				cx = iw * (f.x / 100);
				cy = ih * (f.y / 100);
			} else {
				cw = f.w;
				ch = f.h;
				cx = f.x;
				cy = f.y;
			}
			const out = makeCanvas(cw, ch);
			out.getContext('2d')!.drawImage(input, -cx, -cy);
			return out;
		}
		case 'blur': {
			// в графе это `gblur=sigma=…`
			applyGaussianBlur(input, f.sigma);
			return input;
		}
		case 'eq': {
			// Ровно та же арифметика, что у фильтра eq (аддитивный brightness, Y'CbCr limited).
			applyFfmpegEq(input, {
				brightness: f.brightness,
				contrast: f.contrast,
				saturation: f.saturation,
				gamma: f.gamma,
			});
			return input;
		}
		case 'hflip': {
			const out = makeCanvas(iw, ih);
			const ctx = out.getContext('2d')!;
			ctx.translate(iw, 0);
			ctx.scale(-1, 1);
			ctx.drawImage(input, 0, 0);
			return out;
		}
		case 'vflip': {
			const out = makeCanvas(iw, ih);
			const ctx = out.getContext('2d')!;
			ctx.translate(0, ih);
			ctx.scale(1, -1);
			ctx.drawImage(input, 0, 0);
			return out;
		}
		case 'rotate': {
			if (f.angle === 0) return input;
			const swap = f.angle === 90 || f.angle === 270;
			const out = makeCanvas(swap ? ih : iw, swap ? iw : ih);
			const ctx = out.getContext('2d')!;
			ctx.translate(out.width / 2, out.height / 2);
			ctx.rotate((f.angle * Math.PI) / 180);
			ctx.drawImage(input, -iw / 2, -ih / 2);
			return out;
		}
		case 'position': {
			if (!frame) return input;
			const W = frame.mode === 'fixed' ? frame.width : 0;
			const H = frame.mode === 'fixed' ? frame.height : 0;
			if (W <= 0 || H <= 0) return input;
			const out = makeCanvas(W, H);
			const ctx = out.getContext('2d')!;
			ctx.fillStyle = bgColor || '#000000';
			ctx.fillRect(0, 0, W, H);
			// xPct/yPct: 0 → left/top aligned, 50 → centered, 100 → right/bottom aligned.
			const left = (W - iw) * (f.xPct / 100);
			const top = (H - ih) * (f.yPct / 100);
			ctx.drawImage(input, left, top);
			return out;
		}
		// No canvas equivalent — passthrough (don't affect visible preview):
		case 'bgcolor':
		case 'deinterlace':
		case 'fps':
		case 'pixfmt':
		case 'unsharp':
		case 'denoise':
		default:
			return input;
	}
}

/** Center-cover `input` into a W×H canvas (aspect preserved, overflow cropped). */
function coverInto(input: HTMLCanvasElement, W: number, H: number, bgColor: string): HTMLCanvasElement {
	const out = makeCanvas(W, H);
	const ctx = out.getContext('2d')!;
	ctx.fillStyle = bgColor || '#000000';
	ctx.fillRect(0, 0, W, H);
	const scale = Math.max(W / input.width, H / input.height);
	const rw = input.width * scale;
	const rh = input.height * scale;
	ctx.drawImage(input, (W - rw) / 2, (H - rh) / 2, rw, rh);
	return out;
}

/** Center `input` into a W×H canvas, padding gaps with bgColor and cropping overflow. */
function padCropInto(input: HTMLCanvasElement, W: number, H: number, bgColor: string): HTMLCanvasElement {
	const out = makeCanvas(W, H);
	const ctx = out.getContext('2d')!;
	ctx.fillStyle = bgColor || '#000000';
	ctx.fillRect(0, 0, W, H);
	ctx.drawImage(input, (W - input.width) / 2, (H - input.height) / 2);
	return out;
}

/**
 * Renders the converted result of `settings` applied to `source` onto a freshly
 * created canvas, returning it. The caller draws/scales this canvas into the view.
 * Returns null when the source has no dimensions yet.
 */
export function renderConvertPreview(
	source: Source,
	srcW: number,
	srcH: number,
	settings: ConvertSettings,
	outputMode: 'image' | 'video' | 'audio',
): HTMLCanvasElement | null {
	if (!srcW || !srcH || outputMode === 'audio') return null;

	// Draw the raw source frame into the working canvas.
	let canvas = makeCanvas(srcW, srcH);
	canvas.getContext('2d')!.drawImage(source, 0, 0, srcW, srcH);

	if (outputMode === 'image') {
		const filters = settings.image.filters.filter((f) => f.enabled !== false);
		const bgColor = findBgColor(filters);
		for (const f of filters) canvas = applyFilter(canvas, f, undefined, bgColor);
		return canvas;
	}

	// video
	if (!settings.video.enabled) return canvas;
	const rawFrame = settings.video.frame ?? defaultFrameSettings();
	// frame.mode 'original' → fixed with source dims (mirrors processItem & old preview).
	const frame: FrameSettings =
		rawFrame.mode === 'original' ? { ...rawFrame, mode: 'fixed', width: srcW, height: srcH } : rawFrame;

	const filters = settings.video.filters.filter((f) => f.enabled !== false);
	const bgColor = findBgColor(filters);
	const positionActive = filters.some((f) => f.type === 'position');
	const scaleActive = filters.some((f) => f.type === 'scale' && f.mode !== 'original');

	for (const f of filters) canvas = applyFilter(canvas, f, frame, bgColor);

	if (frame.mode === 'fixed') {
		const W = frame.width;
		const H = frame.height;
		if (W > 0 && H > 0) {
			if (positionActive) {
				// Position already placed the source into the frame canvas.
			} else if (scaleActive) {
				canvas = padCropInto(canvas, W, H, bgColor);
			} else {
				canvas = coverInto(canvas, W, H, bgColor);
			}
		} else if (W > 0 || H > 0) {
			// One dimension auto (0) → scale by the other, source aspect preserved (no crop/pad).
			const aspect = canvas.width / canvas.height;
			const tw = W > 0 ? W : Math.round(H * aspect);
			const th = H > 0 ? H : Math.round(W / aspect);
			const out = makeCanvas(tw, th);
			out.getContext('2d')!.drawImage(canvas, 0, 0, tw, th);
			canvas = out;
		}
		// both 0 → no frame scaling (leave canvas as-is)
	}

	return canvas;
}
