import { SubtitleCue, WordToken } from './parsers';

// ─── Output types ─────────────────────────────────────────────────────────────

export interface PhraseWord {
	text: string;
	fromMs: number;
	toMs: number;
	lineIndex: number;
}

/** Ширина строки в пикселях кадра — та же функция, что меряет превью. */
export type MeasureWidth = (text: string) => number;

export interface DisplayPhrase {
	fromMs: number;
	toMs: number;
	lines: string[]; // ready lines, e.g. ['Gotta love when noodles', 'come with their own topics.']
	words?: PhraseWord[]; // word-level timing (jsonfull only)
}

// ─── Internal word type (flat, before line assignment) ───────────────────────

interface FlatWord {
	text: string;
	fromMs: number;
	toMs: number;
}

// ─── Sentence ending detection ────────────────────────────────────────────────

const SENTENCE_ENDINGS = new Set(['.', '?', '!', '…', '"', '»', '\u201d', '\u300d', '\uff09']);

function isSentenceEnding(word: FlatWord): boolean {
	return SENTENCE_ENDINGS.has(word.text.slice(-1));
}

/**
 * Пауза между словами, которая закрывает фразу (мс).
 *
 * Слова внутри одной реплики идут встык (для SRT/VTT время размазано
 * пропорционально внутри cue), поэтому порог срабатывает ровно на границах реплик.
 */
const PAUSE_BREAK_MS = 500;

function startsWithUppercase(text: string): boolean {
	const ch = text.charAt(0);
	return ch.length > 0 && ch === ch.toUpperCase() && ch !== ch.toLowerCase();
}

// ─── Line fitting ─────────────────────────────────────────────────────────────

/**
 * Влезет ли слово в текущую строку.
 *
 * Мерим РЕАЛЬНУЮ ширину тем же шрифтом, что и превью в панели (см. measure.ts).
 * Раньше здесь считались символы по оценке «ширина ≈ 0.55 × кегль», и у
 * пропорционального шрифта строка ломалась не там, где в панели: одна и та же
 * фраза показывалась в две строки, а рендерилась в три — а от числа строк
 * зависит вся вертикальная геометрия блока.
 *
 * Uses \r as line separator (same as original).
 */
function shouldStartNewLine(currentText: string, wordText: string, maxWidthPx: number, measure: MeasureWidth): boolean {
	if (maxWidthPx <= 0) return false;
	const lines = currentText.split('\r');
	const lastLine = lines[lines.length - 1];
	const candidate = lastLine.length > 0 ? `${lastLine} ${wordText}` : wordText;
	return measure(candidate) > maxWidthPx;
}

// ─── Collect flat words from JSONFull tokens ──────────────────────────────────

/**
 * Ported from collectFullWords().
 * Joins sub-word tokens (Whisper splits words like "It" + "'s"),
 * filters special tokens [_BEG_], [_TT_xxx],
 * filters music symbols, parenthetical content.
 */
function collectWordsFromCues(cues: SubtitleCue[]): FlatWord[] {
	const words: FlatWord[] = [];
	const specialTokensRegex = /^\[_.*?_?\]$/;
	const rareSymbolsRegex = /[♪♫♩♬♭♮♯¶§©®™℗]/g;

	let currentWord: FlatWord | null = null;
	let bracketDepth = 0;

	for (const cue of cues) {
		const tokens = cue.words ?? [];

		for (const token of tokens) {
			let text = token.text;

			// Skip special tokens
			if (specialTokensRegex.test(text)) continue;

			// Track bracket depth — skip content inside brackets
			const openBrackets = text.match(/[\(\[\{<]/g);
			const closeBrackets = text.match(/[\)\]\}>]/g);

			if (bracketDepth > 0) {
				if (closeBrackets) bracketDepth -= closeBrackets.length;
				if (openBrackets) bracketDepth += openBrackets.length;
				continue;
			}
			if (openBrackets) {
				bracketDepth += openBrackets.length;
				continue;
			}
			if (closeBrackets) {
				bracketDepth = Math.max(0, bracketDepth - closeBrackets.length);
				continue;
			}

			// Clean rare symbols
			let clean = text.replace(rareSymbolsRegex, '');
			if (!clean.trim()) continue;

			if (clean.startsWith(' ')) {
				// Space = new word boundary
				if (currentWord) words.push(currentWord);
				const withoutSpace = clean.substring(1);
				if (withoutSpace.trim()) {
					currentWord = {
						text: withoutSpace,
						fromMs: token.fromMs,
						toMs: token.toMs,
					};
				} else {
					currentWord = null;
				}
			} else {
				// No leading space = continuation of current word (e.g. "'s", ".", ",")
				if (currentWord) {
					currentWord.text += clean;
					currentWord.toMs = token.toMs;
				} else {
					// Edge case: token without preceding space
					currentWord = { text: clean, fromMs: token.fromMs, toMs: token.toMs };
				}
			}
		}
	}

	if (currentWord) words.push(currentWord);

	return words;
}

/**
 * For SRT/VTT: extract flat words from cue.text, keeping cue timestamps.
 * No sub-word timing available, so each word gets proportional time.
 */
function collectWordsFromSegments(cues: SubtitleCue[]): FlatWord[] {
	const words: FlatWord[] = [];

	for (const cue of cues) {
		const rawWords = cue.text.trim().split(/\s+/).filter(Boolean);
		if (rawWords.length === 0) continue;

		const duration = cue.toMs - cue.fromMs;
		const wordDur = Math.floor(duration / rawWords.length);

		rawWords.forEach((w, i) => {
			words.push({
				text: w,
				fromMs: cue.fromMs + i * wordDur,
				toMs: cue.fromMs + (i + 1) * wordDur,
			});
		});
	}

	return words;
}

// ─── Core sentence builder (ported from buildSentences) ───────────────────────

interface SentenceBlock {
	text: string; // lines joined by \r
	fromMs: number | null;
	toMs: number | null;
	byWord: FlatWord[];
}

function buildSentenceBlocks(words: FlatWord[], maxWidthPx: number, maxLine: number, measure: MeasureWidth): SentenceBlock[] {
	const result: SentenceBlock[] = [];
	let current: SentenceBlock = { text: '', fromMs: null, toMs: null, byWord: [] };

	const pushCurrent = () => {
		const trimmed = current.text.trim();
		if (trimmed && current.fromMs !== null) {
			result.push({ ...current, text: trimmed });
		}
		current = { text: '', fromMs: null, toMs: null, byWord: [] };
	};

	for (let i = 0; i < words.length; i++) {
		const word = words[i];
		const nextWord = words[i + 1] ?? null;

		// Try to add word to current block
		if (current.text.length === 0) {
			// First word of block
			current.text = word.text;
			current.fromMs = word.fromMs;
			current.toMs = word.toMs;
			current.byWord.push(word);
		} else if (shouldStartNewLine(current.text, word.text, maxWidthPx, measure)) {
			// Word doesn't fit on current line
			const lineCount = current.text.split('\r').length;

			if (lineCount >= maxLine) {
				// Block is full — flush and start new block with this word
				pushCurrent();
				current.text = word.text;
				current.fromMs = word.fromMs;
				current.toMs = word.toMs;
				current.byWord.push(word);
			} else {
				// Start new line within same block
				current.text += `\r${word.text}`;
				current.toMs = word.toMs;
				current.byWord.push(word);
			}
		} else {
			// Fits on current line
			current.text += ` ${word.text}`;
			current.toMs = word.toMs;
			current.byWord.push(word);
		}

		// Check sentence ending
		let shouldEnd = false;

		if (isSentenceEnding(word)) {
			shouldEnd = true;
		} else if (nextWord && current.text.trim()) {
			// Next word starts with uppercase AND current text ends with letter/digit
			if (startsWithUppercase(nextWord.text) && /[\p{L}\p{N}]$/u.test(current.text.trim())) {
				// Auto-add period to current block.
				// Конец фразы НЕ двигаем: следующая фраза начинается ровно там, где
				// эта кончается, и любой сдвиг вперёд давал перекрытие (было +50 мс —
				// на 25 fps это 1–2 кадра, в которых видны сразу оба титра).
				current.text += '.';
				shouldEnd = true;
			}
		}

		// Пауза в речи закрывает фразу. Без этого блок набирается только по ширине
		// строки и заглавным буквам, а тишина между репликами попадает ВНУТРЬ фразы:
		// титр повисает на всю паузу (в замере — с 2.8 до 20.5 секунды) и склеивает
		// текст двух разных реплик.
		if (nextWord && nextWord.fromMs - word.toMs > PAUSE_BREAK_MS) shouldEnd = true;

		if (shouldEnd) pushCurrent();
	}

	// Flush last block
	pushCurrent();

	return result;
}

// ─── Convert SentenceBlock → DisplayPhrase ────────────────────────────────────

function blockToPhrase(block: SentenceBlock, hasWordTiming: boolean): DisplayPhrase {
	// Split \r back into lines array
	const lines = block.text
		.split('\r')
		.map((l) => l.trim())
		.filter(Boolean);

	if (!hasWordTiming || block.byWord.length === 0) {
		return {
			fromMs: block.fromMs!,
			toMs: block.toMs!,
			lines,
		};
	}

	// Assign lineIndex to each word by replaying layout
	const words: PhraseWord[] = [];
	let lineIdx = 0;
	let lineWords = lines[0]?.split(/\s+/) ?? [];
	let wInLine = 0;

	for (const w of block.byWord) {
		words.push({
			text: w.text,
			fromMs: w.fromMs,
			toMs: w.toMs,
			lineIndex: lineIdx,
		});

		wInLine++;
		if (wInLine >= lineWords.length && lineIdx + 1 < lines.length) {
			lineIdx++;
			lineWords = lines[lineIdx]?.split(/\s+/) ?? [];
			wInLine = 0;
		}
	}

	return {
		fromMs: block.fromMs!,
		toMs: block.toMs!,
		lines,
		words,
	};
}

// ─── Main entry point ─────────────────────────────────────────────────────────

/**
 * Builds display phrases from parsed subtitle cues.
 *
 * Pipeline:
 *   cues → flat words → sentence blocks (with line breaking) → DisplayPhrase[]
 *
 * Works for all formats:
 *   - jsonfull: word-level timestamps, smart token joining, bracket filtering
 *   - srt/vtt:  segment-level timestamps split proportionally per word,
 *               same sentence ending logic applied
 *
 * @param cues       - parsed from parsers.ts
 * @param maxWidthPx - предельная ширина строки в px кадра (wrapWidth % от ширины видео)
 * @param maxLines   - max lines per display block
 * @param hasWords   - true for jsonfull (has word-level tokens)
 * @param measure    - измеритель ширины строки (см. measure.ts)
 */
export function buildPhrases(
	cues: SubtitleCue[],
	maxWidthPx: number,
	maxLines: number,
	hasWords: boolean,
	measure: MeasureWidth,
): DisplayPhrase[] {
	// Step 1: collect flat word list
	const words = hasWords ? collectWordsFromCues(cues) : collectWordsFromSegments(cues);

	if (words.length === 0) return [];

	// Step 2: build sentence blocks with line breaking
	const blocks = buildSentenceBlocks(words, maxWidthPx, maxLines, measure);

	// Step 3: convert to DisplayPhrase
	return blocks.map((b) => blockToPhrase(b, hasWords));
}

// ─── Превью панели ────────────────────────────────────────────────────────────

/**
 * Раскладывает произвольную строку по строкам ТЕМ ЖЕ правилом, что и рендер.
 *
 * Панель показывает не субтитры, а одну строку-образец, но ломать её обязана
 * так же, как плагин ломает реальную фразу, — иначе превью снова разъедется с
 * результатом. Разбиения по паузам и концам предложений тут нет: у образца нет
 * тайминга, и делить его не по чему.
 */
export function buildPreviewLines(text: string, maxWidthPx: number, maxLines: number, measure: MeasureWidth): string[] {
	const words = text.split(/\s+/).filter(Boolean);
	let acc = '';

	for (const word of words) {
		if (!acc) {
			acc = word;
			continue;
		}
		if (shouldStartNewLine(acc, word, maxWidthPx, measure)) {
			if (acc.split('\r').length >= Math.max(1, maxLines)) break;
			acc += `\r${word}`;
		} else {
			acc += ` ${word}`;
		}
	}

	return acc
		.split('\r')
		.map((l) => l.trim())
		.filter(Boolean);
}

/** Фраза-образец для превью: видна на любой позиции таймлайна. */
export function buildPreviewPhrase(lines: string[]): DisplayPhrase {
	return { fromMs: 0, toMs: 10 * 3600 * 1000, lines };
}
