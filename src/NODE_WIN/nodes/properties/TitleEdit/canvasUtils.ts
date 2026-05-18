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
}

export function drawTextBlock({ ctx, s, text, vx, vy, scale }: DrawTextParams) {
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

	// Реальные метрики шрифта
	const metrics = ctx.measureText('Hy');
	const ascent = metrics.actualBoundingBoxAscent;
	const descent = metrics.actualBoundingBoxDescent;
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

	// ── Фон — один общий прямоугольник ────────────────────────────────────────
	if (s.background.enabled) {
		const bgPad = s.background.padding * scale;

		let maxLineWidth = 0;
		lines.forEach((line) => {
			const w = ctx.measureText(line).width;
			if (w > maxLineWidth) maxLineWidth = w;
		});

		const bgW = maxLineWidth + bgPad * 2;
		const bgH = totalTextHeight + bgPad * 2;

		let bgX: number;
		switch (s.position.hAlign) {
			case 'left':
				bgX = textX - bgPad;
				break;
			case 'right':
				bgX = textX - maxLineWidth - bgPad;
				break;
			default:
				bgX = textX - maxLineWidth / 2 - bgPad;
				break;
		}
		const bgY = blockTop - bgPad;

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
	lines.forEach((line, i) => {
		const lineBaseline = blockTop + i * lineHeight + ascent;

		if (s.shadow.enabled) {
			ctx.save();
			ctx.shadowColor = s.shadow.color;
			ctx.shadowOffsetX = s.shadow.offsetX * scale;
			ctx.shadowOffsetY = s.shadow.offsetY * scale;
			ctx.shadowBlur = s.shadow.blur * scale;
		}

		if (s.outline.enabled) {
			ctx.strokeStyle = s.outline.color;
			ctx.lineWidth = s.outline.width * scale * 2;
			ctx.lineJoin = 'round';
			ctx.strokeText(line, textX, lineBaseline);
		}

		ctx.fillStyle = s.text.color;
		ctx.fillText(line, textX, lineBaseline);

		if (s.shadow.enabled) ctx.restore();
	});
}
