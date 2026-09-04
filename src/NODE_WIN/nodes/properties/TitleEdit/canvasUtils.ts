// src/NODE_WIN/nodes/properties/TitleEdit/canvasUtils.ts

import { TitleFormatSettings } from './types';

// ── Перенос текста ─────────────────────────────────────────────────────────────

export function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
	const words = text.split(' ');
	const lines: string[] = [];
	let currentLine = '';

	for (const word of words) {
		const testLine = currentLine ? `${currentLine} ${word}` : word;
		if (ctx.measureText(testLine).width > maxWidth && currentLine) {
			lines.push(currentLine);
			currentLine = word;
			if (lines.length >= maxLines) break;
		} else {
			currentLine = testLine;
		}
	}

	if (currentLine && lines.length < maxLines) {
		lines.push(currentLine);
	}

	return lines;
}

// ── Скруглённый прямоугольник ──────────────────────────────────────────────────

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
	ctx.beginPath();
	ctx.moveTo(x + r, y);
	ctx.lineTo(x + w - r, y);
	ctx.quadraticCurveTo(x + w, y, x + w, y + r);
	ctx.lineTo(x + w, y + h - r);
	ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
	ctx.lineTo(x + r, y + h);
	ctx.quadraticCurveTo(x, y + h, x, y + h - r);
	ctx.lineTo(x, y + r);
	ctx.quadraticCurveTo(x, y, x + r, y);
	ctx.closePath();
}

// ── Рисуем шахматный фон (имитация прозрачности) ──────────────────────────────

export function drawChecker(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	w: number,
	h: number,
	scale: number,
	colorLight: string,
	colorDark: string,
) {
	const size = Math.max(4, Math.round(20 * scale));
	for (let cx = 0; cx < w; cx += size) {
		for (let cy = 0; cy < h; cy += size) {
			ctx.fillStyle = (Math.floor(cx / size) + Math.floor(cy / size)) % 2 === 0 ? colorLight : colorDark;
			ctx.fillRect(x + cx, y + cy, Math.min(size, w - cx), Math.min(size, h - cy));
		}
	}
}

// ── Основной рендер текста ─────────────────────────────────────────────────────

export interface DrawTextParams {
	ctx: CanvasRenderingContext2D;
	s: TitleFormatSettings;
	text: string;
	vx: number;
	vy: number;
	scale: number;
	/** Рисовать всё, кроме самих букв: их во время правки показывает textarea,
	 *  а плашка должна жить и подстраиваться под набираемый текст. */
	skipText?: boolean;
}

/** Геометрия текстового блока в экранных координатах канваса. */
export interface TextBlockLayout {
	lines: string[];
	/** Строка шрифта, годная и для `ctx.font`, и для CSS. */
	fontStyle: string;
	fontSize: number;
	lineHeight: number;
	ascent: number;
	realLineH: number;
	totalTextHeight: number;
	/** Y верха блока. */
	blockTop: number;
	/** X точки привязки (смысл зависит от hAlign). */
	textX: number;
	/** Предельная ширина строки. */
	wrapWidth: number;
	maxLineWidth: number;
}

/**
 * Считает раскладку блока, ничего не рисуя.
 *
 * Вынесено из `drawTextBlock`, потому что тем же нужен и редактор текста поверх
 * канваса: он обязан встать ровно на место нарисованных строк, иначе при двойном
 * клике текст прыгает.
 */
export function layoutTextBlock(
	ctx: CanvasRenderingContext2D,
	s: TitleFormatSettings,
	text: string,
	vx: number,
	vy: number,
	scale: number,
): TextBlockLayout {
	const { videoWidth, videoHeight } = s;

	const fontSize = s.text.size * scale;
	const wrapWidth = ((videoWidth * s.text.wrapWidth) / 100) * scale;
	const padding = s.position.padding * scale;

	// Шрифт
	const fontStyle = [s.text.italic ? 'italic' : '', s.text.bold ? 'bold' : '', `${fontSize}px`, `"${s.text.font}", Arial`]
		.filter(Boolean)
		.join(' ');

	ctx.font = fontStyle;
	ctx.textAlign = s.position.hAlign;
	ctx.textBaseline = 'alphabetic';

	const lines = wrapText(ctx, text, wrapWidth, s.text.maxLines);

	// Межстрочный интервал
	const lineSpacing = (s.text.lineSpacing ?? 0) * scale;
	const lineHeight = fontSize * 1.2 + lineSpacing;

	// Метрики ШРИФТА, а не чернильные границы конкретных букв: строчная коробка
	// (ascender/descender) — ровно то, по чему libass ставит строку в рендере
	// (`@/Utils/titleAss/buildAss.ts`, тег \an7). actualBoundingBox* прыгал
	// от того, есть ли в тексте выносные элементы, и превью уезжало от рендера.
	const metrics = ctx.measureText('Hy');
	const ascent = metrics.fontBoundingBoxAscent || metrics.actualBoundingBoxAscent;
	const descent = metrics.fontBoundingBoxDescent || metrics.actualBoundingBoxDescent;
	const realLineH = ascent + descent;

	// Высота всего блока текста
	const totalTextHeight = (lines.length - 1) * lineHeight + realLineH;

	// Точка привязки Y
	const anchorY = vy + ((videoHeight * s.position.y) / 100) * scale;

	// Верх текстового блока
	let blockTop: number;
	switch (s.position.vAlign) {
		case 'top':
			blockTop = anchorY + padding;
			break;
		case 'bottom':
			blockTop = anchorY - totalTextHeight - padding;
			break;
		default: // middle
			blockTop = anchorY - totalTextHeight / 2;
			break;
	}

	// Позиция X
	const textX = vx + ((videoWidth * s.position.x) / 100) * scale;

	let maxLineWidth = 0;
	lines.forEach((line) => {
		const w = ctx.measureText(line).width;
		if (w > maxLineWidth) maxLineWidth = w;
	});

	return {
		lines,
		fontStyle,
		fontSize,
		lineHeight,
		ascent,
		realLineH,
		totalTextHeight,
		blockTop,
		textX,
		wrapWidth,
		maxLineWidth,
	};
}

/** Рисует блок целиком: фон, тень, обводку, текст. */
export function drawTextBlock({ ctx, s, text, vx, vy, scale, skipText }: DrawTextParams) {
	const { lines, ascent, lineHeight, totalTextHeight, blockTop, textX, maxLineWidth } = layoutTextBlock(
		ctx,
		s,
		text,
		vx,
		vy,
		scale,
	);

	// ── Фон — один общий прямоугольник ────────────────────────────────────────
	if (s.background.enabled) {
		const bgPadX = s.background.paddingX * scale;
		const bgPadY = s.background.paddingY * scale;

		const bgW = maxLineWidth + bgPadX * 2;
		const bgH = totalTextHeight + bgPadY * 2;

		let bgX: number;
		switch (s.position.hAlign) {
			case 'left':
				bgX = textX - bgPadX;
				break;
			case 'right':
				bgX = textX - maxLineWidth - bgPadX;
				break;
			default:
				bgX = textX - maxLineWidth / 2 - bgPadX;
				break;
		}
		const bgY = blockTop - bgPadY;

		ctx.save();
		ctx.globalAlpha = s.background.opacity;
		ctx.fillStyle = s.background.color;
		if (s.background.borderRadius > 0) {
			roundRect(ctx, bgX, bgY, bgW, bgH, s.background.borderRadius * scale);
			ctx.fill();
		} else {
			ctx.fillRect(bgX, bgY, bgW, bgH);
		}
		ctx.restore();
	}

	// ── Строки текста ──────────────────────────────────────────────────────────
	//
	// Тень кладём ОТДЕЛЬНЫМ проходом под весь силуэт. Раньше `shadowColor` был
	// включён и на обводке, и на заливке: тень заливки рисовалась ПОВЕРХ уже
	// нарисованной обводки и ложилась на неё пятном. В ASS тень — отдельный
	// нижний слой (см. buildAss), так что заодно это и приводит превью к рендеру.
	const strokeLine = (line: string, baseline: number) => {
		if (!s.outline.enabled) return;
		ctx.strokeStyle = s.outline.color;
		ctx.lineWidth = s.outline.width * scale * 2;
		ctx.lineJoin = 'round';
		ctx.strokeText(line, textX, baseline);
	};

	if (skipText) return;

	lines.forEach((line, i) => {
		const lineBaseline = blockTop + i * lineHeight + ascent;

		if (s.shadow.enabled) {
			// Первый проход рисует силуэт вместе с его тенью; второй кладёт поверх
			// чистые обводку и заливку, так что видна остаётся только тень.
			ctx.save();
			ctx.shadowColor = s.shadow.color;
			ctx.shadowOffsetX = s.shadow.offsetX * scale;
			ctx.shadowOffsetY = s.shadow.offsetY * scale;
			ctx.shadowBlur = s.shadow.blur * scale;
			strokeLine(line, lineBaseline);
			ctx.fillStyle = s.text.color;
			ctx.fillText(line, textX, lineBaseline);
			ctx.restore();
		}

		strokeLine(line, lineBaseline);
		ctx.fillStyle = s.text.color;
		ctx.fillText(line, textX, lineBaseline);
	});
}
