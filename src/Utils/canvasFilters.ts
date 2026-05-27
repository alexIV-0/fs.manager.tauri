// src/Utils/canvasFilters.ts
//
// WebView-safe canvas filters. CanvasRenderingContext2D.filter is a no-op in the
// WKWebView that Tauri uses on macOS, so blur / colour adjustments applied via
// `ctx.filter` silently do nothing. These helpers process pixels directly instead,
// so previews look the same in every WebView.

export interface ColorAdjust {
	/** Multiplicative brightness (1 = no change). CSS-style: 1 + value. */
	brightnessMul?: number;
	/** Additive brightness in 0..255 units (0 = no change). ffmpeg eq-style. */
	brightnessAdd?: number;
	/** Contrast around mid-grey (1 = no change). */
	contrast?: number;
	/** Saturation (1 = no change, 0 = greyscale). */
	saturation?: number;
	/** Gamma (1 = no change). */
	gamma?: number;
}

function isColorNoop(a: ColorAdjust): boolean {
	return (
		(a.brightnessMul ?? 1) === 1 &&
		(a.brightnessAdd ?? 0) === 0 &&
		(a.contrast ?? 1) === 1 &&
		(a.saturation ?? 1) === 1 &&
		(a.gamma ?? 1) === 1
	);
}

/** Applies colour adjustments to the canvas in place (no-op if nothing changes). */
export function applyColorAdjust(canvas: HTMLCanvasElement, a: ColorAdjust): void {
	if (isColorNoop(a)) return;
	const ctx = canvas.getContext('2d');
	if (!ctx || canvas.width === 0 || canvas.height === 0) return;

	const bMul = a.brightnessMul ?? 1;
	const bAdd = a.brightnessAdd ?? 0;
	const contrast = a.contrast ?? 1;
	const sat = a.saturation ?? 1;
	const gamma = a.gamma ?? 1;
	const invGamma = gamma !== 1 ? 1 / gamma : 1;

	// Precompute a per-channel LUT for gamma/contrast/brightness (0..255 → 0..255).
	const lut = new Uint8ClampedArray(256);
	for (let i = 0; i < 256; i++) {
		let c = i / 255;
		if (gamma !== 1) c = Math.pow(c, invGamma);
		if (contrast !== 1) c = (c - 0.5) * contrast + 0.5;
		c = c * bMul + bAdd / 255;
		lut[i] = Math.max(0, Math.min(255, Math.round(c * 255)));
	}

	const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
	const d = img.data;
	const applySat = sat !== 1;
	for (let i = 0; i < d.length; i += 4) {
		let r = lut[d[i]];
		let g = lut[d[i + 1]];
		let b = lut[d[i + 2]];
		if (applySat) {
			const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
			r = lum + (r - lum) * sat;
			g = lum + (g - lum) * sat;
			b = lum + (b - lum) * sat;
		}
		d[i] = r;
		d[i + 1] = g;
		d[i + 2] = b;
	}
	ctx.putImageData(img, 0, 0);
}

/**
 * Approximate blur applied in place by downscaling then upscaling with image
 * smoothing — cheap, GPU-friendly and works in every WebView (unlike ctx.filter).
 * `radius` is in source pixels (matches the CSS blur(px) intent closely enough).
 */
export function applyBlur(canvas: HTMLCanvasElement, radius: number): void {
	if (radius <= 0 || canvas.width === 0 || canvas.height === 0) return;
	const ctx = canvas.getContext('2d');
	if (!ctx) return;

	const w = canvas.width;
	const h = canvas.height;
	// Bigger radius → stronger downscale. Factor tuned so it reads like a gaussian blur.
	const factor = Math.max(1, radius / 1.5);
	const sw = Math.max(1, Math.round(w / factor));
	const sh = Math.max(1, Math.round(h / factor));

	const tmp = document.createElement('canvas');
	tmp.width = sw;
	tmp.height = sh;
	const tctx = tmp.getContext('2d');
	if (!tctx) return;
	tctx.imageSmoothingEnabled = true;
	tctx.imageSmoothingQuality = 'high';
	tctx.drawImage(canvas, 0, 0, w, h, 0, 0, sw, sh);

	ctx.clearRect(0, 0, w, h);
	ctx.imageSmoothingEnabled = true;
	ctx.imageSmoothingQuality = 'high';
	ctx.drawImage(tmp, 0, 0, sw, sh, 0, 0, w, h);
}
