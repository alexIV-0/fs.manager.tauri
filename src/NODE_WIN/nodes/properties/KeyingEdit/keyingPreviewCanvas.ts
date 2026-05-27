// src/NODE_WIN/nodes/properties/KeyingEdit/keyingPreviewCanvas.ts
//
// Client-side canvas keyer for the Keying "Keying Preview" — same client-render
// approach as the Convert / ffSwitch previews (no ffmpeg). Approximates ffmpeg's
// chromakey / colorkey / lumakey / despill / edge filters on pixels.
//
// Requires the source <video>/<img> to have crossOrigin="anonymous" so getImageData
// doesn't throw on a tainted canvas (Tauri's asset protocol returns CORS headers).

import { KeyingSettings } from './types';

type Source = CanvasImageSource;

function hexToRgb(hex: string): [number, number, number] {
	const h = hex.replace('#', '').padEnd(6, '0');
	return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

// BT.601 full-range; U/V centred at 128.
function rgbToUv(r: number, g: number, b: number): [number, number] {
	const u = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
	const v = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
	return [u, v];
}

const clip01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Box-blur the alpha channel only (edge softening), in place. */
function blurAlpha(data: Uint8ClampedArray, w: number, h: number, radius: number): void {
	const r = Math.max(1, Math.round(radius));
	const src = new Float32Array(w * h);
	for (let i = 0, p = 3; i < w * h; i++, p += 4) src[i] = data[p];
	const tmp = new Float32Array(w * h);
	const div = r * 2 + 1;
	// horizontal
	for (let y = 0; y < h; y++) {
		let acc = 0;
		const row = y * w;
		for (let x = -r; x <= r; x++) acc += src[row + Math.min(w - 1, Math.max(0, x))];
		for (let x = 0; x < w; x++) {
			tmp[row + x] = acc / div;
			const add = src[row + Math.min(w - 1, x + r + 1)];
			const sub = src[row + Math.max(0, x - r)];
			acc += add - sub;
		}
	}
	// vertical
	for (let x = 0; x < w; x++) {
		let acc = 0;
		for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
		for (let y = 0; y < h; y++) {
			data[(y * w + x) * 4 + 3] = acc / div;
			const add = tmp[Math.min(h - 1, y + r + 1) * w + x];
			const sub = tmp[Math.max(0, y - r) * w + x];
			acc += add - sub;
		}
	}
}

/** Morphological min (erosion) or max (dilation) on the alpha channel, in place. */
function morphAlpha(data: Uint8ClampedArray, w: number, h: number, radius: number, erode: boolean): void {
	const r = Math.max(1, Math.round(radius));
	const src = new Float32Array(w * h);
	for (let i = 0, p = 3; i < w * h; i++, p += 4) src[i] = data[p];
	const pick = erode ? Math.min : Math.max;
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			let val = src[y * w + x];
			for (let dy = -r; dy <= r; dy++) {
				const yy = Math.min(h - 1, Math.max(0, y + dy));
				for (let dx = -r; dx <= r; dx++) {
					const xx = Math.min(w - 1, Math.max(0, x + dx));
					val = pick(val, src[yy * w + xx]);
				}
			}
			data[(y * w + x) * 4 + 3] = val;
		}
	}
}

/**
 * Renders the keyed result onto a fresh canvas with an alpha channel. Returns null
 * if the source has no dimensions or the canvas is tainted (getImageData blocked).
 */
export function renderKeyingPreview(
	source: Source,
	w: number,
	h: number,
	s: KeyingSettings,
): HTMLCanvasElement | null {
	if (!w || !h) return null;

	const canvas = document.createElement('canvas');
	canvas.width = w;
	canvas.height = h;
	const ctx = canvas.getContext('2d');
	if (!ctx) return null;
	ctx.drawImage(source, 0, 0, w, h);

	let img: ImageData;
	try {
		img = ctx.getImageData(0, 0, w, h);
	} catch {
		return null; // tainted — source missing crossOrigin / CORS
	}
	const d = img.data;

	const ck = s.chromakey;
	const col = s.colorkey;
	const lk = s.lumakey;
	const dsp = s.despill;

	const [ckr, ckg, ckb] = hexToRgb(ck.color);
	const [cku, ckv] = rgbToUv(ckr, ckg, ckb);
	const [cor, cog, cob] = hexToRgb(col.color);
	const [dr2, dg2, db2] = hexToRgb(dsp.color);
	const despillBlue = db2 > dg2 && db2 > dr2;

	const CHROMA_NORM = 255 * 255 * 2;
	const COLOR_NORM = 3 * 255 * 255;

	for (let i = 0; i < d.length; i += 4) {
		let r = d[i];
		let g = d[i + 1];
		let b = d[i + 2];
		let alpha = d[i + 3];

		if (ck.enabled) {
			const [u, v] = rgbToUv(r, g, b);
			const diff = Math.sqrt(((u - cku) ** 2 + (v - ckv) ** 2) / CHROMA_NORM);
			let a: number;
			if (diff < ck.similarity) a = 0;
			else if (ck.blend > 0.0001) a = clip01((diff - ck.similarity) / ck.blend) * 255;
			else a = 255;
			if (a < alpha) alpha = a;
		}

		if (col.enabled) {
			const diff = Math.sqrt(((r - cor) ** 2 + (g - cog) ** 2 + (b - cob) ** 2) / COLOR_NORM);
			let a: number;
			if (diff < col.similarity) a = 0;
			else if (col.blend > 0.0001) a = clip01((diff - col.similarity) / col.blend) * 255;
			else a = 255;
			if (a < alpha) alpha = a;
		}

		if (lk.enabled) {
			const luma = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
			const dist = Math.abs(luma - lk.threshold);
			let a: number;
			if (dist <= lk.tolerance) a = 0;
			else if (lk.softness > 0.0001) a = clip01((dist - lk.tolerance) / lk.softness) * 255;
			else a = 255;
			if (a < alpha) alpha = a;
		}

		if (dsp.enabled) {
			if (despillBlue) {
				const spill = b - (r + g) / 2;
				if (spill > 0) b -= spill * dsp.mix;
			} else {
				const spill = g - (r + b) / 2;
				if (spill > 0) g -= spill * dsp.mix;
			}
		}

		d[i] = r;
		d[i + 1] = g;
		d[i + 2] = b;
		d[i + 3] = alpha;
	}

	// Edge refinement on the alpha channel (approximation of ffmpeg erosion/dilation/blur).
	if (s.edge.erosion > 0) morphAlpha(d, w, h, s.edge.erosion, true);
	if (s.edge.dilation > 0) morphAlpha(d, w, h, s.edge.dilation, false);
	if (s.edge.blur > 0) blurAlpha(d, w, h, s.edge.blur);

	ctx.putImageData(img, 0, 0);
	return canvas;
}
