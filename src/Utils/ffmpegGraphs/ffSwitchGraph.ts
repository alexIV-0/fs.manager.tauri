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
	/**
	 * Раздувание прямоугольника тени — по этому числу пикселей В КАЖДУЮ сторону.
	 *
	 * Тень здесь не силуэт, а прямоугольник размером слота FG (у видеокадра нет альфы),
	 * поэтому «объём» — это буквально прямоугольник побольше, сдвинутый на столько же
	 * влево-вверх. Никакой морфологии не нужно: тот же `color` + `overlay`.
	 *
	 * При `blur = 0` даёт цветную рамку вокруг кадра, при `blur > 0` — более широкое
	 * свечение (сначала раздули жёсткий силуэт, потом размыли его край — как `spread`
	 * в фотошопной тени).
	 *
	 * Необязательное: у настроек, сохранённых до появления параметра, его нет — читать
	 * только через `?? 0`.
	 */
	spread?: number;
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

/** hex без решётки, ровно 6 знаков — в таком виде цвет уходит в ffmpeg. */
function hexRgb(hex: string): string {
	return (hex || '#000000').replace('#', '').padEnd(6, '0').slice(0, 6);
}

/**
 * Радиус блюра бэкграунда. ffmpeg отбрасывает дробную часть радиуса (`boxblur=17.5`
 * работает как `boxblur=17`) — округляем сами, чтобы канвас-превью считало ТОТ ЖЕ радиус.
 */
export function bgBlurRadius(blur: number): number {
	return Math.floor(blur);
}

export interface ShadowBlurParams {
	/** Радиус box-блюра. `0` — размытия нет вовсе, край жёсткий. */
	radius: number;
	/** Число проходов (`power` у boxblur) — два дают гладкое затухание вместо линейного. */
	power: number;
	/** Прозрачное поле вокруг прямоугольника тени: блюру нужно куда растекаться. */
	pad: number;
}

/**
 * Параметры размытия тени — ОДИН источник для графа ffmpeg и для канвас-превью
 * (`makeShadowLayer` в Utils/canvasFilters), иначе превью и рендер разойдутся.
 *
 * `pad` обязателен: без прозрачного поля boxblur размывает прямоугольник «сам в себя»
 * (края нечем размывать, окно у границы просто сужается) и тень выходит с ЖЁСТКИМ краем —
 * ровно этот баг и был виден в рендере, пока тень строилась через `geq` без pad.
 *
 * `blur = 0` — это ОТСУТСТВИЕ блюра, а не «блюр в один пиксель». Раньше здесь стоял
 * `max(1, …)`, и жёсткая тень всё равно приезжала с однопиксельной мыльной кромкой —
 * незаметно, пока тень просто выглядывала из-под кадра, и очень заметно на рамке от
 * `spread`, где эта кромка идёт по всему периметру. Ноль означает «ни `pad`, ни
 * `boxblur` в граф не ставим вовсе» — заодно дешевле.
 */
export function shadowBlurParams(blur: number): ShadowBlurParams {
	const radius = Math.max(0, Math.floor(blur));
	if (radius === 0) return { radius: 0, power: 0, pad: 0 };
	const power = 2;
	return { radius, power, pad: radius * power + 2 };
}

export interface ShadowGeometry extends ShadowBlurParams {
	/** Размер прямоугольника тени (уже с раздуванием, без прозрачного поля). */
	width: number;
	height: number;
	/** Смещение слоя тени от левого-верхнего угла FG: сюда входят offset, spread и pad. */
	dx: number;
	dy: number;
}

/**
 * Геометрия слоя тени — ОДИН источник для графа и для канвас-превью.
 *
 * Отдельная функция, а не три вычисления по месту: раздувание меняет и размер слоя, и
 * его позицию (раздули на 20 — сдвинули на 20 обратно, иначе прямоугольник вырастет
 * только вправо-вниз). Разъехаться этим двум местам нельзя — превью обещает совпадение
 * с рендером.
 *
 * Отрицательный `spread` допустим (тень уже объекта), но меньше пикселя прямоугольник
 * не бывает: `color=size=0x0` ffmpeg не примет.
 */
export function shadowGeometry(
	shadow: { blur: number; offsetX: number; offsetY: number; spread?: number },
	slotW: number,
	slotH: number,
): ShadowGeometry {
	const blur = shadowBlurParams(shadow.blur);
	const spread = Math.round(shadow.spread ?? 0);
	const width = Math.max(1, Math.round(slotW) + spread * 2);
	const height = Math.max(1, Math.round(slotH) + spread * 2);
	return {
		...blur,
		width,
		height,
		dx: Math.round(shadow.offsetX) - spread - blur.pad,
		dy: Math.round(shadow.offsetY) - spread - blur.pad,
	};
}

function buildBgAdjustFilter(adj: FfSwitchBgAdjust): string {
	const parts: string[] = [];
	const br = bgBlurRadius(adj.blur);
	if (br >= 1) parts.push(`boxblur=${br}:1`);
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
	// Тень с нулевой прозрачностью не видна — граф не засоряем.
	const hasShadow = !!(shadow?.enabled && shadow.opacity > 0);

	let curBase = 'bg_final';
	for (let i = 0; i < fgCopies; i++) {
		const { fgRenderW, fgRenderH, cropW, cropH, cropX, cropY, fgX, fgY } = slotLayouts[i];
		const scaleFilter = `scale=${fgRenderW}:${fgRenderH}`;
		const cropFilter = `crop=${cropW}:${cropH}:${cropX}:${cropY}`;
		const isLast = i === fgCopies - 1;
		const outLabel = isLast ? '[vout]' : `[vtmp${i}]`;

		filterParts.push(`[${i}:v]${ptsReset},${scaleFilter},${cropFilter}[fg${i}]`);

		let base = curBase;
		if (hasShadow && shadow) {
			// Тень — отдельный слой-заливка размером слота, а не копия кадра: содержимое FG
			// на неё не влияет, зато не нужен ни split, ни geq (последний вдвое дороже по CPU).
			// Раздувание (`spread`) — это просто прямоугольник побольше, сдвинутый на столько
			// же обратно; ни новых фильтров, ни морфологии.
			const { radius, power, pad, width: shadW, height: shadH, dx, dy } = shadowGeometry(shadow, cropW, cropH);
			const hex = hexRgb(shadow.color);
			const alphaHex = Math.round(Math.min(1, Math.max(0, shadow.opacity)) * 255)
				.toString(16)
				.padStart(2, '0');
			const shadX = Math.round(fgX) + dx;
			const shadY = Math.round(fgY) + dy;
			const afterShad = `vshadbase${i}`;
			// Жёсткая тень (`blur = 0`): ни прозрачного поля, ни boxblur — размывать нечего,
			// а лишний `pad` в графе стоит проход по кадру на каждый слот.
			const softPart =
				radius > 0
					? `pad=${shadW + pad * 2}:${shadH + pad * 2}:${pad}:${pad}:color=0x${hex}00,boxblur=${radius}:${power}`
					: '';
			filterParts.push(
				`color=color=0x${hex}${alphaHex}:size=${shadW}x${shadH}:d=${duration},format=rgba` +
					`${softPart ? `,${softPart}` : ''}[fgshad${i}]`,
			);
			filterParts.push(`[${curBase}][fgshad${i}]overlay=${shadX}:${shadY}[${afterShad}]`);
			base = afterShad;
		}

		filterParts.push(`[${base}][fg${i}]overlay=${fgX}:${fgY}${outLabel}`);
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
