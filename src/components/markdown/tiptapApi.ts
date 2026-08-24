/**
 * Реализация `EditorApi` поверх Tiptap — та же панель кнопок, но действия идут
 * в документ, а не в текст.
 *
 * Особое место — цвет: mark `textColor` один, атрибутов у него два (`fg`, `bg`),
 * поэтому «поставить заливку» обязано СЛИТЬ новое значение с текущим, иначе
 * выбор фона стирал бы уже выбранный цвет текста.
 */

import type { Editor } from '@tiptap/react';
import type { EditorApi, ListKind } from './editorApi';
import { MERMAID_SKELETON } from './editorApi';
import type { AlignKind } from './markdownFormat';

export function createTiptapApi(editor: Editor | null): EditorApi {
	const chain = () => editor!.chain().focus();
	const guard = (fn: () => void) => () => {
		if (editor) fn();
	};

	const setColor = (kind: 'fg' | 'bg', key: string | null) => {
		const current = editor!.getAttributes('textColor') as { fg?: string | null; bg?: string | null };
		const next = { fg: current.fg ?? null, bg: current.bg ?? null, [kind]: key };
		if (!next.fg && !next.bg) {
			chain().unsetMark('textColor').run();
			return;
		}
		chain().setMark('textColor', next).run();
	};

	const listCommand = (kind: ListKind) => {
		if (kind === 'ul') chain().toggleBulletList().run();
		else if (kind === 'ol') chain().toggleOrderedList().run();
		else chain().toggleTaskList().run();
	};

	const indentList = (delta: 1 | -1) => {
		// Отступ осмыслен только в списке: пробелы в WYSIWYG вложенность не задают.
		const item = editor!.isActive('taskItem') ? 'taskItem' : 'listItem';
		if (delta > 0) chain().sinkListItem(item).run();
		else chain().liftListItem(item).run();
	};

	return {
		bold: guard(() => chain().toggleBold().run()),
		italic: guard(() => chain().toggleItalic().run()),
		underline: guard(() => chain().toggleUnderline().run()),
		strike: guard(() => chain().toggleStrike().run()),
		inlineCode: guard(() => chain().toggleCode().run()),
		color: (kind, key) => {
			if (editor) setColor(kind, key);
		},
		clearFormat: guard(() => chain().unsetAllMarks().clearNodes().run()),
		heading: (level) =>
			guard(() => {
				if (level === 0) chain().setParagraph().run();
				else chain().toggleHeading({ level }).run();
			})(),
		indentParagraph: guard(() => {
			const current = Boolean(editor!.getAttributes('paragraph').indent);
			chain().updateAttributes('paragraph', { indent: !current }).run();
		}),
		align: (kind: AlignKind) =>
			guard(() => {
				const same = editor!.getAttributes('paragraph').align === kind || editor!.getAttributes('heading').align === kind;
				const value = same ? null : kind;
				chain().updateAttributes('paragraph', { align: value }).updateAttributes('heading', { align: value }).run();
			})(),
		quote: guard(() => chain().toggleBlockquote().run()),
		hr: guard(() => chain().setHorizontalRule().run()),
		details: guard(() =>
			chain()
				.insertContent({
					type: 'details',
					content: [
						{ type: 'detailsSummary', content: [{ type: 'text', text: 'Подробности' }] },
						{ type: 'paragraph' },
					],
				})
				.run(),
		),
		list: (kind) => {
			if (editor) listCommand(kind);
		},
		indent: (delta) => {
			if (editor) indentList(delta);
		},
		link: (text, url) =>
			guard(() => {
				const { from, to } = editor!.state.selection;
				if (from === to) {
					chain()
						.insertContent({ type: 'text', text: text || url, marks: [{ type: 'link', attrs: { href: url } }] })
						.run();
				} else {
					chain().setLink({ href: url }).run();
				}
			})(),
		image: (alt, src) => guard(() => chain().setImage({ src, alt }).run())(),
		table: (cols, rows, header) => guard(() => chain().insertTable({ rows, cols, withHeaderRow: header }).run())(),
		codeBlock: (lang) => guard(() => chain().toggleCodeBlock({ language: lang }).run())(),
		mermaid: guard(() =>
			chain()
				.insertContent({
					type: 'codeBlock',
					attrs: { language: 'mermaid' },
					content: [{ type: 'text', text: MERMAID_SKELETON }],
				})
				.run(),
		),
		insert: (text) => guard(() => chain().insertContent(text).run())(),
		selection: () => {
			if (!editor) return '';
			const { from, to } = editor.state.selection;
			return editor.state.doc.textBetween(from, to, ' ');
		},
		isActive: (name) => (editor ? editor.isActive(name) : false),
	};
}
