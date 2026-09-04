import { TitleFormatSettings } from './types';
import { DisplayPhrase } from './buildPhrases';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** ms → ASS timestamp H:MM:SS.cc */
function ms2ass(ms: number): string {
	const totalCs = Math.round(ms / 10);
	const cs = totalCs % 100;
	const totalSec = Math.floor(totalCs / 100);
	const sec = totalSec % 60;
	const totalMin = Math.floor(totalSec / 60);
	const min = totalMin % 60;
	const hour = Math.floor(totalMin / 60);
	return `${hour}:${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

/** hex #rrggbb → ASS &HAABBGGRR (BGR order, alpha first) */
function hexToASS(hex: string, opacity: number = 1): string {
	const h = hex.replace('#', '').padEnd(6, '0');
	const r = h.slice(0, 2);
	const g = h.slice(2, 4);
	const b = h.slice(4, 6);
	const alpha = Math.round((1 - opacity) * 255)
		.toString(16)
		.padStart(2, '0')
		.toUpperCase();
	return `&H${alpha}${b}${g}${r}`;
}

function escapeAss(text: string): string {
	// Only escape { and } — do NOT escape backslash,
	// because \N (line break) is added after escaping
	return text.replace(/\{/g, '\\{').replace(/\}/g, '\\}');
}

/** Escapes each line individually, then joins with ASS \N hard line break */
function assLines(lines: string[]): string {
	// '\\N' = два символа (backslash + N) — это hard line break в ASS.
	// '\N' в JS не валидный escape и схлопывается в одиночную букву 'N'.
	return lines.map(escapeAss).join('\\N');
}

/** \pos(x,y) tag — anchor point based on alignment */
function posTag(s: TitleFormatSettings): string {
	const x = Math.round(s.videoWidth * (s.position.x / 100));
	const y = Math.round(s.videoHeight * (s.position.y / 100));
	return `{\\pos(${x},${y})}`;
}

// ─── ASS Alignment numpad ─────────────────────────────────────────────────────
// 7 8 9  top-left / top-center / top-right
// 4 5 6  mid-left / mid-center / mid-right
// 1 2 3  bot-left / bot-center / bot-right

function calcAlignment(hAlign: string, vAlign: string): number {
	const h = hAlign === 'left' ? 0 : hAlign === 'right' ? 2 : 1;
	const v = vAlign === 'top' ? 6 : vAlign === 'center' ? 3 : 0;
	return 1 + h + v;
}

// ─── ASS header ───────────────────────────────────────────────────────────────

function buildHeader(s: TitleFormatSettings, fontName: string): string {
	const alignment = calcAlignment(s.position.hAlign, s.position.vAlign);
	const borderStyle = s.background.enabled ? 3 : 1;
	const outline = s.outline.enabled ? Math.round(s.outline.width / 2) : 0;
	const shadow = s.shadow.enabled ? Math.round(Math.sqrt(s.shadow.offsetX ** 2 + s.shadow.offsetY ** 2)) : 0;

	const primaryColor = hexToASS(s.text.color);
	const outlineColor = s.outline.enabled ? hexToASS(s.outline.color) : '&H00000000';
	const shadowColor = s.shadow.enabled ? hexToASS(s.shadow.color) : '&H00000000';
	const backColor = s.background.enabled ? hexToASS(s.background.color, s.background.opacity) : '&H00000000';
	const bold = s.text.bold ? -1 : 0;
	const italic = s.text.italic ? -1 : 0;

	// MarginV: distance from edge (bottom/top) in px
	const mv = s.position.padding;

	return `[Script Info]
ScriptType: v4.00+
PlayResX: ${s.videoWidth}
PlayResY: ${s.videoHeight}
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${fontName},${Math.round(s.text.size)},${primaryColor},${primaryColor},${outlineColor},${backColor},${bold},${italic},0,0,100,100,0,0,${borderStyle},${outline},${shadow},${alignment},0,0,${mv},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`;
}

// ─── Animation: none ──────────────────────────────────────────────────────────

function buildNoneDialogues(phrases: DisplayPhrase[], s: TitleFormatSettings): string[] {
	const pos = posTag(s);
	const result: string[] = [];

	for (const phrase of phrases) {
		const text = pos + assLines(phrase.lines);
		result.push(`Dialogue: 0,${ms2ass(phrase.fromMs)},${ms2ass(phrase.toMs)},Default,,0,0,0,,${text}`);
	}

	return result;
}

function buildWordHighlightDialogues(phrases: DisplayPhrase[], s: TitleFormatSettings): string[] {
	const pos = posTag(s);
	const dimColor = hexToASS(s.animation.wordColor);
	const hlColor = hexToASS(s.animation.highlightColor);
	const result: string[] = [];

	for (const phrase of phrases) {
		// No word data → single static line in dim color
		if (!phrase.words?.length) {
			result.push(
				`Dialogue: 0,${ms2ass(phrase.fromMs)},${ms2ass(phrase.toMs)},Default,,0,0,0,,` +
					pos +
					`{\\1c${dimColor}}` +
					assLines(phrase.lines),
			);
			continue;
		}

		// Layer 0: base dim text visible for full phrase duration
		result.push(
			`Dialogue: 0,${ms2ass(phrase.fromMs)},${ms2ass(phrase.toMs)},Default,,0,0,0,,` +
				pos +
				`{\\1c${dimColor}}` +
				assLines(phrase.lines),
		);

		// Layer 1: per-word — full phrase with that word in highlight color
		for (let i = 0; i < phrase.words.length; i++) {
			const w = phrase.words[i];
			let flatTagged = pos;
			let prevLineIdx = -1;

			for (let j = 0; j < phrase.words.length; j++) {
				const pw = phrase.words[j];

				if (pw.lineIndex !== prevLineIdx && prevLineIdx !== -1) {
					flatTagged += '\\N';
				}
				prevLineIdx = pw.lineIndex;

				if (j === i) {
					flatTagged += `{\\1c${hlColor}}${escapeAss(pw.text)}{\\1c${dimColor}} `;
				} else {
					flatTagged += escapeAss(pw.text) + ' ';
				}
			}

			result.push(`Dialogue: 1,${ms2ass(w.fromMs)},${ms2ass(w.toMs)},Default,,0,0,0,,` + flatTagged.trimEnd());
		}
	}

	return result;
}

function buildBgRevealDialogues(phrases: DisplayPhrase[], s: TitleFormatSettings): string[] {
	const pos = posTag(s);
	const hlColor = hexToASS(s.animation.highlightColor);
	const result: string[] = [];

	for (const phrase of phrases) {
		// Base text layer (no box background)
		result.push(
			`Dialogue: 0,${ms2ass(phrase.fromMs)},${ms2ass(phrase.toMs)},Default,,0,0,0,,` +
				pos +
				`{\\3a&HFF&}` +
				assLines(phrase.lines),
		);

		// No word data → single bg box for full phrase
		if (!phrase.words?.length) {
			result.push(
				`Dialogue: 1,${ms2ass(phrase.fromMs)},${ms2ass(phrase.toMs)},Default,,0,0,0,,` +
					pos +
					`{\\1a&HFF&\\3a&H00&\\4c${hlColor}}` +
					assLines(phrase.lines),
			);
			continue;
		}

		// Per-word background boxes
		const avgCharW = s.text.size * 0.55;
		const { size, lineSpacing } = s.text;
		const lineHeight = size + lineSpacing;
		const totalHeight = lineHeight * phrase.lines.length - lineSpacing;
		const baseY = Math.round(s.videoHeight * (s.position.y / 100));

		for (const w of phrase.words) {
			// X position
			const lineText = phrase.lines[w.lineIndex] ?? '';
			const wordsInLine = lineText.split(/\s+/);
			let charOffset = 0;
			for (const lw of wordsInLine) {
				if (lw === w.text) break;
				charOffset += lw.length + 1;
			}
			const pixelOffset = Math.round(charOffset * avgCharW);

			let wx = 0;
			switch (s.position.hAlign) {
				case 'center': {
					const lineW = Math.round(lineText.length * avgCharW);
					wx = Math.round(s.videoWidth * (s.position.x / 100) - lineW / 2) + pixelOffset;
					break;
				}
				case 'right': {
					const lineW = Math.round(lineText.length * avgCharW);
					const endX = Math.round(s.videoWidth * (s.position.x / 100) - s.position.padding);
					wx = endX - lineW + pixelOffset;
					break;
				}
				default:
					wx = Math.round(s.videoWidth * (s.position.x / 100) + s.position.padding) + pixelOffset;
			}

			// Y position
			let wy = 0;
			switch (s.position.vAlign) {
				case 'top':
					wy = baseY + s.position.padding + w.lineIndex * lineHeight;
					break;
				case 'center':
					wy = baseY - Math.round(totalHeight / 2) + w.lineIndex * lineHeight;
					break;
				default:
					wy = baseY - s.position.padding - totalHeight + w.lineIndex * lineHeight;
			}

			result.push(
				`Dialogue: 1,${ms2ass(w.fromMs)},${ms2ass(w.toMs)},Default,,0,0,0,,` +
					`{\\pos(${wx},${wy})\\1a&HFF&\\3a&H00&\\4c${hlColor}\\bord${Math.round(s.background.padding)}}` +
					escapeAss(w.text),
			);
		}
	}

	return result;
}

// ─── Main entry point ─────────────────────────────────────────────────────────

/**
 * Builds complete ASS file content from ready DisplayPhrases.
 *
 * @param phrases  - output of buildPhrases()
 * @param settings - adapted format settings (already scaled to real video)
 * @param fontName - font family name for ASS Style header
 */
export function buildAssFile(phrases: DisplayPhrase[], settings: TitleFormatSettings, fontName: string): string {
	const header = buildHeader(settings, fontName);

	const animType = settings.animation.type;
	let dialogues: string[];

	switch (animType) {
		case 'word_highlight':
			dialogues = buildWordHighlightDialogues(phrases, settings);
			break;
		case 'bg_reveal':
			dialogues = buildBgRevealDialogues(phrases, settings);
			break;
		case 'none':
		default:
			dialogues = buildNoneDialogues(phrases, settings);
			break;
	}

	return header + '\n' + dialogues.join('\n') + '\n';
}
