/**
 * Общий интерфейс для тулбара: один набор кнопок водит два разных редактора.
 *
 * Режимов два — WYSIWYG (Tiptap) и правка текстом. Кнопки при этом одни и те же,
 * поэтому они не знают, кто внизу: вызывают `EditorApi`, а реализаций две —
 * `createTextApi` здесь и `createTiptapApi` в `tiptapApi.ts`.
 */

import type { AlignKind } from './markdownFormat';
import {
	applySpanClass,
	changeIndent,
	insertFence,
	insertHr,
	insertImage,
	insertLink,
	insertTable,
	insertText,
	setHeading,
	stripFormatting,
	toggleLinePrefix,
	toggleTag,
	toggleWrap,
	wrapAlign,
	wrapDetails,
	wrapIndentParagraph,
	type TextState,
} from './markdownCommands';

export type ListKind = 'ul' | 'ol' | 'check';

export interface EditorApi {
	bold(): void;
	italic(): void;
	underline(): void;
	strike(): void;
	inlineCode(): void;
	/** `key = null` снимает цвет или заливку. */
	color(kind: 'fg' | 'bg', key: string | null): void;
	clearFormat(): void;
	heading(level: 0 | 1 | 2 | 3 | 4): void;
	indentParagraph(): void;
	align(kind: AlignKind): void;
	quote(): void;
	hr(): void;
	details(): void;
	list(kind: ListKind): void;
	indent(delta: 1 | -1): void;
	link(text: string, url: string): void;
	image(alt: string, src: string): void;
	table(cols: number, rows: number, header: boolean): void;
	codeBlock(lang: string): void;
	mermaid(): void;
	insert(text: string): void;
	/** Выделенный текст — для подстановки в диалог ссылки. */
	selection(): string;
	/** Подсветка активной кнопки; в текстовом режиме честно возвращает false. */
	isActive(name: string): boolean;
}

const MERMAID_SKELETON = 'flowchart LR\n  A[начало] --> B[конец]';

/** Реализация поверх чистых функций `markdownCommands` (правка текстом). */
export function createTextApi(apply: (fn: (s: TextState) => TextState) => void, read: () => TextState): EditorApi {
	return {
		bold: () => apply((s) => toggleWrap(s, '**')),
		italic: () => apply((s) => toggleWrap(s, '*')),
		underline: () => apply((s) => toggleTag(s, 'u')),
		strike: () => apply((s) => toggleWrap(s, '~~')),
		inlineCode: () => apply((s) => toggleWrap(s, '`')),
		color: (kind, key) => apply((s) => applySpanClass(s, kind, key)),
		clearFormat: () => apply(stripFormatting),
		heading: (level) => apply((s) => setHeading(s, level)),
		indentParagraph: () => apply(wrapIndentParagraph),
		align: (kind) => apply((s) => wrapAlign(s, `align-${kind}`)),
		quote: () => apply((s) => toggleLinePrefix(s, 'quote')),
		hr: () => apply(insertHr),
		details: () => apply(wrapDetails),
		list: (kind) => apply((s) => toggleLinePrefix(s, kind)),
		indent: (delta) => apply((s) => changeIndent(s, delta)),
		link: (text, url) => apply((s) => insertLink(s, text, url)),
		image: (alt, src) => apply((s) => insertImage(s, alt, src)),
		table: (cols, rows, header) => apply((s) => insertTable(s, cols, rows, header)),
		codeBlock: (lang) => apply((s) => insertFence(s, lang)),
		mermaid: () => apply((s) => insertFence(s, 'mermaid', MERMAID_SKELETON)),
		insert: (text) => apply((s) => insertText(s, text)),
		selection: () => {
			const s = read();
			return s.value.slice(s.selStart, s.selEnd);
		},
		isActive: () => false,
	};
}

export { MERMAID_SKELETON };
