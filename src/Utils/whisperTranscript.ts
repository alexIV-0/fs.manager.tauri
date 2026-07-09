// ── whisperTranscript ────────────────────────────────────────────────────────────
// Переиспользуемые функции разбора «жирного» пословного JSON whisper (--output-json-full
// --max-len 1 --split-on-word) в лёгкий сигнальный вид: список слов + предложения/титр-
// блоки. Используются нодой transcriptJSONnormalize (и на будущее — audioSignal, титр-
// нодой для AE и т.п.). transcribeVA этот файл НЕ импортит и не зависит от него.
//
// Единица времени везде — целые миллисекунды (как отдаёт whisper), без float-секунд:
// на джойне сигналов сравнение точное, деление на 1000 делается на краю (ffmpeg).

// Слово — единственный источник правды по таймингам.
export type Word = {
	from: number; // мс, DTW-точный старт
	to: number;   // мс, DTW-точный конец
	t: string;    // очищенный текст слова
};

// Предложение (при maxLineLength>0 — «титр-блок» с переносами \r под текстовый слой AE).
export type Sentence = {
	from: number;
	to: number;
	t: string;                // текст; при переносах строки разделены lineBreak (по умолч. \r)
	len: number;              // длина текста без символов переноса (удобно для подгонки титра)
	lines: number;            // сколько строк вышло
	w?: [number, number];     // [start, end) — диапазон слов в массиве words (как words.slice)
};

export type Gap = { from: number; to: number; dur: number }; // пауза между словами, мс

// Конец предложения: . ! ? … (+ возможная закрывающая кавычка/скобка).
const SENTENCE_ENDINGS = new Set(['.', '!', '?', '…', '"', '»', '”', "'", '’', ')', ']']);
// Спец-токены whisper: [_BEG_], [_TT_123] и т.п.
const SPECIAL_TOKEN = /^\[_.*?_?\]$/;
// Редкие символы (муз. знаки, типографика) — вычищаем из текста слова.
const RARE_SYMBOLS = /[♪♫♩♬♭♮♯¶§©®™℗]/g;
const OPEN_BRACKETS = /[([{<]/g;
const CLOSE_BRACKETS = /[)\]}>]/g;

// ── Разбор jsonFull → слова ──────────────────────────────────────────────────────
// Идём по transcription[] (каждый сегмент = одно слово из-за --max-len 1). Читаем
// seg.offsets (DTW-точные) и seg.text. Чистим спец-токены, редкие символы и содержимое
// скобок ([Music]/(applause)) — bracket-depth считаем сквозь сегменты на случай, когда
// --split-on-word разнёс «[MUSIC PLAYING]» на несколько слов.
export function collectWords(data: any): Word[] {
	const words: Word[] = [];
	let bracketDepth = 0;

	for (const seg of data?.transcription ?? []) {
		const from = seg?.offsets?.from;
		const to = seg?.offsets?.to;
		if (typeof from !== 'number' || typeof to !== 'number') continue;

		let text = String(seg?.text ?? '');
		const bare = text.trim();
		if (!bare) continue;
		if (SPECIAL_TOKEN.test(bare)) continue;

		const opens = bare.match(OPEN_BRACKETS)?.length ?? 0;
		const closes = bare.match(CLOSE_BRACKETS)?.length ?? 0;

		// Уже внутри скобок — слово пропускаем, только обновляем глубину.
		if (bracketDepth > 0) {
			bracketDepth = Math.max(0, bracketDepth - closes) + opens;
			continue;
		}
		// Слово открывает больше скобок, чем закрывает → вошли внутрь, пропускаем.
		if (opens > closes) {
			bracketDepth += opens - closes;
			continue;
		}
		// Самозакрытая скобка внутри слова ((word)) или закрытие без открытия — пропускаем.
		if (opens > 0 || closes > 0) continue;

		const clean = text.replace(RARE_SYMBOLS, '').trim();
		if (!clean) continue;

		words.push({ from, to, t: clean });
	}
	return words;
}

// ── Разбор с метаданными ───────────────────────────────────────────────────────────
export function parseTranscript(jsonText: string): { lang: string | null; dur: number; words: Word[] } {
	const data = JSON.parse(jsonText);
	const words = collectWords(data);
	const lang = data?.result?.language ?? data?.params?.language ?? null;
	const dur = words.length ? words[words.length - 1].to : 0;
	return { lang, dur, words };
}

// ── Слова → предложения / титр-блоки ────────────────────────────────────────────────
// maxLineLength=0 → без переносов: чистые предложения по пунктуации (для LLM).
// maxLineLength>0 → упаковка в строки ≤N символов, максимум maxLine строк на блок (титры AE).
// Помимо конца предложения по знаку, есть эвристика: следующее слово с ЗАГЛАВНОЙ +
// текущее оканчивается на букву/цифру → ставим точку и закрываем (ловит потерянные точки).
export function buildSentences(
	words: Word[],
	opts: { maxLineLength?: number; maxLine?: number; lineBreak?: string } = {},
): Sentence[] {
	const maxLineLength = Math.max(0, opts.maxLineLength ?? 0);
	const maxLine = typeof opts.maxLine === 'number' && opts.maxLine >= 1 ? Math.floor(opts.maxLine) : 1;
	const BR = opts.lineBreak ?? '\r';

	const result: Sentence[] = [];
	let text = '';
	let from: number | null = null;
	let to = 0;
	let startIdx = 0;

	// Не влезает ли слово в текущую (последнюю) строку блока.
	const needsWrap = (cur: string, word: string): boolean => {
		if (maxLineLength <= 0) return false;
		const lines = cur.split(BR);
		const lastLine = lines[lines.length - 1];
		const add = word.length + (lastLine.length > 0 ? 1 : 0);
		return lastLine.length + add > maxLineLength;
	};

	const push = (endExclusive: number) => {
		const trimmed = text.trim();
		if (!trimmed) return;
		const lines = trimmed.split(BR);
		result.push({
			from: from ?? 0,
			to,
			t: trimmed,
			len: lines.join('').length,
			lines: lines.length,
			w: [startIdx, endExclusive],
		});
	};

	for (let i = 0; i < words.length; i++) {
		const word = words[i];
		const next = i + 1 < words.length ? words[i + 1] : null;

		if (text.length === 0) {
			text = word.t;
			startIdx = i;
		} else if (needsWrap(text, word.t)) {
			if (text.split(BR).length >= maxLine) {
				// Блок заполнен по строкам — закрываем; слово i начинает новый блок.
				push(i);
				text = word.t;
				from = null;
				startIdx = i;
			} else {
				text += BR + word.t;
			}
		} else {
			text += ' ' + word.t;
		}
		if (from === null) from = word.from;
		to = word.to;

		// Конец предложения?
		let endSentence = false;
		if (SENTENCE_ENDINGS.has(word.t.trim().slice(-1))) {
			endSentence = true;
		} else if (next) {
			const firstChar = next.t.charAt(0);
			const isUpper = firstChar && firstChar === firstChar.toUpperCase() && firstChar !== firstChar.toLowerCase();
			if (isUpper && /[\p{L}\p{N}]$/u.test(text.trim())) {
				text += '.';
				to += 50;
				endSentence = true;
			}
		}

		if (endSentence) {
			push(i + 1);
			text = '';
			from = null;
		}
	}
	if (text.trim()) push(words.length);
	return result;
}

// ── Паузы между словами (on-demand, порог задаёт потребитель) ───────────────────────
// Дешёвый «VAD-lite» прямо из таймингов слов. Это ГИПОТЕЗА о тишине (границы слов
// приблизительны ±20мс), для точного реза подтверждать аудио-слоем (ffmpeg silencedetect).
export function pauses(words: Word[], minGapMs = 0): Gap[] {
	const gaps: Gap[] = [];
	for (let i = 0; i + 1 < words.length; i++) {
		const gap = words[i + 1].from - words[i].to;
		if (gap >= minGapMs) gaps.push({ from: words[i].to, to: words[i + 1].from, dur: gap });
	}
	return gaps;
}
