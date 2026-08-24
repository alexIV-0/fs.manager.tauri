// src/Utils/canvasFilters.ts
//
// WebView-safe эмуляции ffmpeg-фильтров на канвасе. Две причины, почему тут ручная
// работа с пикселями, а не `ctx.filter` / `ctx.shadow*`:
//   1. `ctx.filter` в WKWebView (Tauri на macOS) — no-op, блюр/цвет просто не применяются;
//   2. CSS-семантика и ffmpeg-семантика РАЗНЫЕ. Превью должно показывать то, что даст
//      финальный рендер, поэтому здесь считается ровно то же, что делает ffmpeg.
//
// Соответствия (проверено сравнением с ffmpeg на тестовых кадрах):
//   applyFfmpegEq      ↔ eq=brightness=…:contrast=…:saturation=…:gamma=…
//   applyBoxBlur       ↔ boxblur=radius:power
//   applyGaussianBlur  ↔ gblur=sigma=…
//   makeShadowLayer    ↔ color+pad(прозрачный)+boxblur — слой тени под FG
//
// Главная грабля, из-за которой превью врало: `eq.brightness` у ffmpeg — АДДИТИВНЫЙ
// сдвиг яркости (−1…+1 к нормированной Y), а не множитель, как `brightness()` в CSS.
// На brightness=-0.39 разница доходила до 50/255 — картинка в превью была заметно
// светлее финала. Плюс eq работает по Y'CbCr в limited range (16…235), а не по RGB.

// ── Общие мелочи ─────────────────────────────────────────────────────────────

const clamp255 = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : v);

/**
 * Один проход box-блюра по плоскости (сумма по бегущему окну, окно сужается у границ —
 * как в vf_boxblur). Считает НА МЕСТЕ: `src` перезаписывается и возвращается он же.
 * `power` у ffmpeg = столько же вызовов подряд.
 */
function blurPlane(src: Float32Array, w: number, h: number, radius: number, passes = 1): Float32Array {
	const a = src; // результат каждого полного прохода оказывается здесь
	const b = new Float32Array(w * h);
	for (let p = 0; p < passes; p++) {
		// по горизонтали
		for (let y = 0; y < h; y++) {
			const row = y * w;
			let sum = 0;
			let n = 0;
			const preload = Math.min(radius, w - 1);
			for (let x = 0; x <= preload; x++) {
				sum += a[row + x];
				n++;
			}
			for (let x = 0; x < w; x++) {
				b[row + x] = sum / n;
				const add = x + radius + 1;
				const rem = x - radius;
				if (add < w) {
					sum += a[row + add];
					n++;
				}
				if (rem >= 0) {
					sum -= a[row + rem];
					n--;
				}
			}
		}
		// по вертикали
		for (let x = 0; x < w; x++) {
			let sum = 0;
			let n = 0;
			const preload = Math.min(radius, h - 1);
			for (let y = 0; y <= preload; y++) {
				sum += b[y * w + x];
				n++;
			}
			for (let y = 0; y < h; y++) {
				a[y * w + x] = sum / n;
				const add = y + radius + 1;
				const rem = y - radius;
				if (add < h) {
					sum += b[add * w + x];
					n++;
				}
				if (rem >= 0) {
					sum -= b[rem * w + x];
					n--;
				}
			}
		}
	}
	return a;
}

/**
 * Размывает RGB (альфу не трогает — вход считается непрозрачным) прямо в ImageData.
 * `radii` — серия box-проходов: `[r, r]` = `boxblur=r:2`, три разных радиуса = гауссиана.
 * Плоскость канала вынимается один раз на все проходы.
 */
function blurRgbInPlace(data: Uint8ClampedArray, w: number, h: number, radii: number[]): void {
	const plane = new Float32Array(w * h);
	for (let c = 0; c < 3; c++) {
		for (let i = 0, p = c; i < plane.length; i++, p += 4) plane[i] = data[p];
		for (const r of radii) blurPlane(plane, w, h, r);
		for (let i = 0, p = c; i < plane.length; i++, p += 4) data[p] = plane[i];
	}
}

/**
 * Серия box-проходов по канвасу. Большие радиусы считаются на уменьшенной копии: сам
 * блюр линеен, но при `radius ≥ 4·k` уменьшение в `k` раз добавляет собственного размытия
 * порядка `k/2` px — единицы процентов от итоговой мягкости, зато цена падает в k² раз
 * (важно: превью крутится в RAF). Уменьшение делается ОДИН раз на всю серию, иначе
 * добавка накапливалась бы с каждым проходом.
 */
function blurCanvas(canvas: HTMLCanvasElement, radii: number[]): void {
	const rs = radii.map((r) => Math.floor(r)).filter((r) => r >= 1);
	if (rs.length === 0 || canvas.width === 0 || canvas.height === 0) return;
	const ctx = canvas.getContext('2d');
	if (!ctx) return;

	const w = canvas.width;
	const h = canvas.height;
	const k = Math.max(1, Math.floor(Math.max(...rs) / 4));

	if (k === 1) {
		const img = ctx.getImageData(0, 0, w, h);
		blurRgbInPlace(img.data, w, h, rs);
		ctx.putImageData(img, 0, 0);
		return;
	}

	const sw = Math.max(1, Math.round(w / k));
	const sh = Math.max(1, Math.round(h / k));
	const small = document.createElement('canvas');
	small.width = sw;
	small.height = sh;
	const sctx = small.getContext('2d');
	if (!sctx) return;
	sctx.imageSmoothingEnabled = true;
	sctx.imageSmoothingQuality = 'high';
	sctx.drawImage(canvas, 0, 0, w, h, 0, 0, sw, sh);

	const img = sctx.getImageData(0, 0, sw, sh);
	blurRgbInPlace(
		img.data,
		sw,
		sh,
		rs.map((r) => Math.max(1, Math.round(r / k))),
	);
	sctx.putImageData(img, 0, 0);

	ctx.clearRect(0, 0, w, h);
	ctx.imageSmoothingEnabled = true;
	ctx.imageSmoothingQuality = 'high';
	ctx.drawImage(small, 0, 0, sw, sh, 0, 0, w, h);
}

// ── boxblur ──────────────────────────────────────────────────────────────────

/**
 * `boxblur=radius:power`. Радиус целый: ffmpeg отбрасывает дробную часть (проверено —
 * `boxblur=17.5` == `boxblur=17`), поэтому и здесь floor.
 */
export function applyBoxBlur(canvas: HTMLCanvasElement, radius: number, power = 1): void {
	if (power < 1) return;
	blurCanvas(canvas, new Array(Math.floor(power)).fill(radius));
}

// ── gblur ────────────────────────────────────────────────────────────────────

/** Радиусы трёх box-проходов, дающих гауссиану с заданной sigma (классический boxesForGauss). */
function boxesForGauss(sigma: number, n: number): number[] {
	const wIdeal = Math.sqrt((12 * sigma * sigma) / n + 1);
	let wl = Math.floor(wIdeal);
	if (wl % 2 === 0) wl--;
	const wu = wl + 2;
	const mIdeal = (12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4);
	const m = Math.round(mIdeal);
	return Array.from({ length: n }, (_, i) => ((i < m ? wl : wu) - 1) / 2);
}

/** `gblur=sigma=…` — гауссиана тремя box-проходами (расхождение с ffmpeg ~1.4/255). */
export function applyGaussianBlur(canvas: HTMLCanvasElement, sigma: number): void {
	if (sigma <= 0) return;
	blurCanvas(canvas, boxesForGauss(sigma, 3));
}

// ── eq ───────────────────────────────────────────────────────────────────────

export interface FfmpegEq {
	/** Аддитивный сдвиг яркости, −1…+1 (0 = без изменений). */
	brightness?: number;
	/** Контраст вокруг серого, 1 = без изменений. */
	contrast?: number;
	/** Насыщенность (масштаб хромы), 1 = без изменений. */
	saturation?: number;
	/** Гамма, 1 = без изменений. */
	gamma?: number;
}

function isEqNoop(e: FfmpegEq): boolean {
	return (e.brightness ?? 0) === 0 && (e.contrast ?? 1) === 1 && (e.saturation ?? 1) === 1 && (e.gamma ?? 1) === 1;
}

/**
 * Эмуляция `eq` фильтра ffmpeg прямо по пикселям канваса.
 *
 * Что важно повторить один-в-один (иначе превью врёт):
 *   • brightness аддитивный: v = contrast·(v−0.5) + 0.5 + brightness (см. vf_eq create_lut);
 *   • всё считается по Y'CbCr в limited range (Y 16…235): ffmpeg применяет eq к yuv-кадру,
 *     а не к RGB, и обрезка чёрного/белого происходит именно в этой шкале;
 *   • контраст/яркость/гамма — только к Y, saturation — только к хроме (Cb/Cr вокруг 128).
 *
 * Матрица BT.709 (HD-материал). На плавном градиенте средняя ошибка против ffmpeg ≈ 2.6/255
 * (у прежней CSS-версии с множителем было ≈ 51/255).
 */
export function applyFfmpegEq(canvas: HTMLCanvasElement, e: FfmpegEq): void {
	if (isEqNoop(e)) return;
	const ctx = canvas.getContext('2d');
	if (!ctx || canvas.width === 0 || canvas.height === 0) return;

	const brightness = e.brightness ?? 0;
	const contrast = e.contrast ?? 1;
	const sat = e.saturation ?? 1;
	const gamma = e.gamma ?? 1;

	// LUT яркости: индекс — Y в limited range, значение — Y после eq (тоже limited).
	const lumaLut = new Float32Array(256);
	for (let i = 0; i < 256; i++) {
		let v = contrast * (i / 255 - 0.5) + 0.5 + brightness;
		if (v <= 0) {
			lumaLut[i] = 0;
			continue;
		}
		if (gamma !== 1) v = Math.pow(v, 1 / gamma);
		lumaLut[i] = clamp255(Math.round(Math.min(1, v) * 255));
	}
	// Y (limited) → яркостная часть RGB.
	const yLut = new Float32Array(256);
	for (let i = 0; i < 256; i++) yLut[i] = (255 / 219) * (lumaLut[i] - 16);
	// Хрома: масштаб вокруг 128 + перевод в полный диапазон.
	const cLut = new Float32Array(256);
	for (let i = 0; i < 256; i++) cLut[i] = ((clamp255(Math.round((i - 128) * sat + 128)) - 128) * 255) / 224;

	// RGB → Y'CbCr таблицами по каналам: цикл идёт по миллионам пикселей, и девять
	// умножений на пиксель тут заметно дороже девяти чтений из таблицы.
	const rY = new Float32Array(256);
	const gY = new Float32Array(256);
	const bY = new Float32Array(256);
	const rCb = new Float32Array(256);
	const gCb = new Float32Array(256);
	const bCb = new Float32Array(256);
	const rCr = new Float32Array(256);
	const gCr = new Float32Array(256);
	const bCr = new Float32Array(256);
	for (let i = 0; i < 256; i++) {
		rY[i] = (65.481 * i) / 255;
		gY[i] = (128.553 * i) / 255;
		bY[i] = (24.966 * i) / 255;
		rCb[i] = (-37.797 * i) / 255;
		gCb[i] = (-74.203 * i) / 255;
		bCb[i] = (112.0 * i) / 255;
		rCr[i] = (112.0 * i) / 255;
		gCr[i] = (-93.786 * i) / 255;
		bCr[i] = (-18.214 * i) / 255;
	}

	const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
	const d = img.data;
	for (let i = 0; i < d.length; i += 4) {
		const r = d[i];
		const g = d[i + 1];
		const b = d[i + 2];
		// Индексы гарантированно в диапазоне (Y 16…235, хрома 16…240) — clamp не нужен.
		const yy = yLut[(16.5 + rY[r] + gY[g] + bY[b]) | 0];
		const cb = cLut[(128.5 + rCb[r] + gCb[g] + bCb[b]) | 0];
		const cr = cLut[(128.5 + rCr[r] + gCr[g] + bCr[b]) | 0];
		const nr = yy + 1.5748 * cr;
		const ng = yy - 0.1873 * cb - 0.4681 * cr;
		const nb = yy + 1.8556 * cb;
		d[i] = nr < 0 ? 0 : (nr + 0.5) | 0;
		d[i + 1] = ng < 0 ? 0 : (ng + 0.5) | 0;
		d[i + 2] = nb < 0 ? 0 : (nb + 0.5) | 0;
	}
	ctx.putImageData(img, 0, 0);
}

// ── слой тени ────────────────────────────────────────────────────────────────

export interface ShadowLayerSpec {
	/** Цвет тени, hex ('#000000'). */
	color: string;
	/** Прозрачность 0…1. */
	opacity: number;
	/** Размер прямоугольника-источника тени (сам FG-слот). */
	width: number;
	height: number;
	/** Прозрачное поле вокруг — блюру нужно куда растекаться. */
	pad: number;
	/** Параметры box-блюра (те же, что уходят в ffmpeg). */
	radius: number;
	power: number;
}

/**
 * Канвас (width+2·pad)×(height+2·pad) с размытым прямоугольником — ровно то, что в графе
 * ffmpeg даёт `color=…, pad(прозрачный), boxblur=radius:power`.
 *
 * Считается аналитически: box-блюр разделим, а исходник — произведение двух «ступенек»,
 * поэтому альфа = произведение двух одномерных профилей. Быстро (нет 2D-проходов) и точно.
 *
 * RGB кладём постоянным по всему слою (как `pad` цветом тени с alpha=0) — иначе цветная
 * тень темнела бы к краям, размываясь в чёрный фон подложки.
 */
export function makeShadowLayer(spec: ShadowLayerSpec): HTMLCanvasElement {
	const { color, opacity, width, height, pad, radius, power } = spec;
	const w = Math.max(1, Math.round(width) + pad * 2);
	const h = Math.max(1, Math.round(height) + pad * 2);

	const profile = (len: number, start: number, size: number): Float32Array => {
		const src = new Float32Array(len);
		for (let i = start; i < Math.min(len, start + size); i++) src[i] = 1;
		return blurPlane(src, len, 1, radius, power);
	};
	const px = profile(w, pad, Math.round(width));
	const py = profile(h, pad, Math.round(height));

	const hex = (color || '#000000').replace('#', '').padEnd(6, '0');
	const cr = parseInt(hex.slice(0, 2), 16);
	const cg = parseInt(hex.slice(2, 4), 16);
	const cb = parseInt(hex.slice(4, 6), 16);
	const a0 = Math.max(0, Math.min(1, opacity)) * 255;

	const canvas = document.createElement('canvas');
	canvas.width = w;
	canvas.height = h;
	const ctx = canvas.getContext('2d');
	if (!ctx) return canvas;
	const img = ctx.createImageData(w, h);
	const d = img.data;
	for (let y = 0; y < h; y++) {
		const ay = py[y] * a0;
		let p = y * w * 4;
		for (let x = 0; x < w; x++) {
			d[p] = cr;
			d[p + 1] = cg;
			d[p + 2] = cb;
			d[p + 3] = ay * px[x];
			p += 4;
		}
	}
	ctx.putImageData(img, 0, 0);
	return canvas;
}
