// ─── Unified subtitle types ───────────────────────────────────────────────────

export interface WordToken {
	text: string;
	fromMs: number;
	toMs: number;
}

export interface SubtitleCue {
	fromMs: number;
	toMs: number;
	text: string;
	words?: WordToken[]; // only available from jsonfull
}

export type SubtitleFormat = 'srt' | 'vtt' | 'jsonfull' | 'unknown';

// ─── Timestamp helpers ────────────────────────────────────────────────────────

function parseTimestamp(ts: string): number {
	const normalized = ts.trim().replace(',', '.');
	const parts = normalized.split(':');
	if (parts.length !== 3) return 0;

	const hours = parseInt(parts[0], 10);
	const minutes = parseInt(parts[1], 10);
	const secAndMs = parseFloat(parts[2]);
	const seconds = Math.floor(secAndMs);
	const ms = Math.round((secAndMs - seconds) * 1000);

	return hours * 3_600_000 + minutes * 60_000 + seconds * 1_000 + ms;
}

// ─── SRT parser ───────────────────────────────────────────────────────────────

export function parseSRT(content: string): SubtitleCue[] {
	const cues: SubtitleCue[] = [];
	const blocks = content.trim().split(/\n\s*\n/);

	for (const block of blocks) {
		const lines = block.trim().split('\n');
		if (lines.length < 2) continue;

		let timeLine = '';
		let textStartIndex = 0;

		for (let i = 0; i < lines.length; i++) {
			if (lines[i].includes('-->')) {
				timeLine = lines[i];
				textStartIndex = i + 1;
				break;
			}
		}

		if (!timeLine) continue;

		const timeMatch = timeLine.match(/(\d{2}:\d{2}:\d{2}[,.]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[,.]\d{3})/);
		if (!timeMatch) continue;

		const fromMs = parseTimestamp(timeMatch[1]);
		const toMs = parseTimestamp(timeMatch[2]);
		const text = lines
			.slice(textStartIndex)
			.join(' ')
			.replace(/<[^>]*>/g, '')
			.trim();

		if (!text) continue;
		cues.push({ fromMs, toMs, text });
	}

	return cues;
}

// ─── VTT parser ───────────────────────────────────────────────────────────────

export function parseVTT(content: string): SubtitleCue[] {
	const cues: SubtitleCue[] = [];

	const cleaned = content.replace(/^WEBVTT.*$/m, '').replace(/NOTE[\s\S]*?(?=\n\s*\n|$)/gm, '');

	const blocks = cleaned.trim().split(/\n\s*\n/);

	for (const block of blocks) {
		const lines = block.trim().split('\n');
		if (lines.length < 2) continue;

		let timeLine = '';
		let textStartIndex = 0;

		for (let i = 0; i < lines.length; i++) {
			if (lines[i].includes('-->')) {
				timeLine = lines[i];
				textStartIndex = i + 1;
				break;
			}
		}

		if (!timeLine) continue;

		const timeMatch = timeLine.match(/(\d{2}:\d{2}:\d{2}\.\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}\.\d{3})/);
		if (!timeMatch) continue;

		const fromMs = parseTimestamp(timeMatch[1]);
		const toMs = parseTimestamp(timeMatch[2]);
		const text = lines
			.slice(textStartIndex)
			.join(' ')
			.replace(/<[^>]*>/g, '')
			.replace(/&amp;/g, '&')
			.replace(/&lt;/g, '<')
			.replace(/&gt;/g, '>')
			.replace(/&nbsp;/g, ' ')
			.trim();

		if (!text) continue;
		cues.push({ fromMs, toMs, text });
	}

	return cues;
}

// ─── JSONFull (Whisper) parser ────────────────────────────────────────────────

export function parseJSONFull(content: string): SubtitleCue[] {
	let data: any;

	try {
		data = typeof content === 'string' ? JSON.parse(content) : content;
	} catch {
		console.error('[parseJSONFull] Failed to parse JSON');
		return [];
	}

	const transcription: any[] = data?.transcription ?? [];
	const cues: SubtitleCue[] = [];

	for (const segment of transcription) {
		const fromMs: number = segment.offsets?.from ?? 0;
		const toMs: number = segment.offsets?.to ?? 0;
		const text: string = (segment.text ?? '').trim();
		if (!text) continue;

		const words: WordToken[] = (segment.tokens ?? [])
			.filter((token: any) => {
				const t: string = token.text ?? '';
				return t && !t.startsWith('[') && t.trim() !== '';
			})
			.map(
				(token: any): WordToken => ({
					text: token.text,
					fromMs: token.offsets?.from ?? fromMs,
					toMs: token.offsets?.to ?? toMs,
				}),
			);

		cues.push({ fromMs, toMs, text, words });
	}

	return cues;
}

// ─── Auto-detect and parse ────────────────────────────────────────────────────

export function detectFormat(content: string): SubtitleFormat {
	const trimmed = content.trim();

	if (trimmed.startsWith('WEBVTT')) return 'vtt';

	try {
		const parsed = JSON.parse(trimmed);
		if (parsed && typeof parsed === 'object' && 'transcription' in parsed) {
			return 'jsonfull';
		}
	} catch {}

	if (/^\d+\s*\n\d{2}:\d{2}:\d{2}/.test(trimmed)) return 'srt';

	return 'unknown';
}

export function parseSubtitles(content: string, hint?: SubtitleFormat): SubtitleCue[] {
	const format = hint ?? detectFormat(content);

	switch (format) {
		case 'srt':
			return parseSRT(content);
		case 'vtt':
			return parseVTT(content);
		case 'jsonfull':
			return parseJSONFull(content);
		default:
			console.warn('[parseSubtitles] Unknown subtitle format');
			return [];
	}
}
