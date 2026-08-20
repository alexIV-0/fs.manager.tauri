/**
 * Документ редактора (JSON ProseMirror/Tiptap) → markdown нашего формата.
 *
 * Это вторая половина WYSIWYG: в редактор документ попадает через HTML
 * (`markdownToHtml` + правила `parseHTML` расширений), а обратно в файл — только
 * здесь. Поэтому именно этот файл отвечает за соблюдение контракта
 * `ideasAndTest/DESCRIPTION_FORMAT_CONTRACT.md`: набор тегов закрыт, `style` и
 * размеры не пишем никогда, блочные обёртки идут с пустыми строками (без них
 * markdown внутри блока не разбирается).
 *
 * Проверяется прогоном эталонного файла: md → html → документ → md, второй
 * прогон должен дать тот же текст (идемпотентность).
 */

export interface DocMark {
	type: string;
	attrs?: Record<string, unknown>;
}

export interface DocNode {
	type: string;
	attrs?: Record<string, unknown>;
	content?: DocNode[];
	marks?: DocMark[];
	text?: string;
}

// ─── Текст и строчные марки ─────────────────────────────────────────────────

/** Экранируем только то, что действительно может быть прочитано как разметка. */
function escapeInline(text: string): string {
	return text.replace(/([\\`*_[\]<>])/g, '\\$1');
}

/** Экранирование в начале строки: `#`, `-`, `>`, `1.` иначе станут блоком. */
function escapeLineStart(text: string): string {
	return text.replace(/^(\s*)(#{1,6}\s|[-*+]\s|>\s|\d+\.\s)/, (_m, pad: string, token: string) => `${pad}\\${token}`);
}

const MARK_WRAP: Record<string, [string, string]> = {
	bold: ['**', '**'],
	italic: ['*', '*'],
	strike: ['~~', '~~'],
	code: ['`', '`'],
	underline: ['<u>', '</u>'],
	highlight: ['<mark>', '</mark>'],
};

/** Порядок важен: цветовой span снаружи, текстовые маркеры внутри. */
const MARK_ORDER = ['textColor', 'underline', 'highlight', 'bold', 'italic', 'strike', 'code', 'link'];

function sortMarks(marks: DocMark[]): DocMark[] {
	return [...marks].sort((a, b) => MARK_ORDER.indexOf(a.type) - MARK_ORDER.indexOf(b.type));
}

/** Ключ для сравнения набора марок у соседних текстовых узлов. */
function marksKey(marks: DocMark[] = []): string {
	return sortMarks(marks)
		.map((m) => `${m.type}:${JSON.stringify(m.attrs ?? {})}`)
		.join('|');
}

/**
 * Цвет и заливка живут на одном `<span>`, если стоят вместе: так же, как это
 * делает текстовый редактор (`applySpanClass`), и так же требует контракт.
 */
function wrapSpanClasses(text: string, marks: DocMark[]): string {
	const attrs = marks.find((m) => m.type === 'textColor')?.attrs;
	if (!attrs) return text;
	const classes: string[] = [];
	if (attrs.fg) classes.push(`fg-${String(attrs.fg)}`);
	if (attrs.bg) classes.push(`bg-${String(attrs.bg)}`);
	if (classes.length === 0) return text;
	return `<span class="${classes.join(' ')}">${text}</span>`;
}

function inlineToMarkdown(nodes: DocNode[] = [], inTable = false): string {
	let out = '';
	let i = 0;

	while (i < nodes.length) {
		const node = nodes[i];

		if (node.type === 'hardBreak') {
			// Внутри таблицы перевод строки ломает ряд — только тег.
			out += inTable ? '<br>' : '<br>\n';
			i += 1;
			continue;
		}

		if (node.type === 'image') {
			out += imageToMarkdown(node);
			i += 1;
			continue;
		}

		if (node.type !== 'text') {
			i += 1;
			continue;
		}

		// Собираем подряд идущие куски с одинаковыми марками — иначе получится
		// «**жир**​**ный**» вместо «**жирный**».
		const key = marksKey(node.marks);
		let text = '';
		while (i < nodes.length && nodes[i].type === 'text' && marksKey(nodes[i].marks) === key) {
			text += nodes[i].text ?? '';
			i += 1;
		}

		const marks = sortMarks(node.marks ?? []);
		const isCode = marks.some((m) => m.type === 'code');
		let piece = isCode ? text : escapeInline(text);
		if (inTable) piece = piece.replace(/\|/g, '\\|');

		for (const mark of [...marks].reverse()) {
			if (mark.type === 'link') {
				const href = String(mark.attrs?.href ?? '');
				const title = mark.attrs?.title ? ` "${String(mark.attrs.title)}"` : '';
				piece = `[${piece}](${href}${title})`;
				continue;
			}
			const wrap = MARK_WRAP[mark.type];
			if (wrap) piece = wrap[0] + piece + wrap[1];
		}

		out += wrapSpanClasses(piece, marks);
	}

	return out;
}

function imageToMarkdown(node: DocNode): string {
	const src = String(node.attrs?.src ?? '');
	const alt = String(node.attrs?.alt ?? '');
	const title = node.attrs?.title ? ` "${String(node.attrs.title)}"` : '';
	return `![${alt}](${src}${title})`;
}

// ─── Блоки ──────────────────────────────────────────────────────────────────

const ALIGN_CLASS: Record<string, string> = {
	left: 'align-left',
	center: 'align-center',
	right: 'align-right',
	justify: 'align-justify',
};

/** Блочная обёртка обязана иметь пустые строки вокруг содержимого. */
function alignWrap(body: string, align?: unknown): string {
	const cls = typeof align === 'string' ? ALIGN_CLASS[align] : undefined;
	if (!cls) return body;
	return `<div class="${cls}">\n\n${body}\n\n</div>`;
}

function prefixLines(text: string, first: string, rest: string): string {
	return text
		.split('\n')
		.map((line, idx) => (idx === 0 ? first + line : rest + (line ? line : '')))
		.join('\n');
}

function tableToMarkdown(node: DocNode): string {
	const rows = node.content ?? [];
	if (rows.length === 0) return '';

	const cells = (row: DocNode) =>
		(row.content ?? []).map((cell) => ({
			text: (cell.content ?? []).map((b) => blockToMarkdown(b, true)).join(' ').replace(/\n+/g, ' ').trim(),
			align: typeof cell.attrs?.align === 'string' ? (cell.attrs.align as string) : null,
			header: cell.type === 'tableHeader',
		}));

	const first = cells(rows[0]);
	const width = Math.max(...rows.map((r) => (r.content ?? []).length));
	const pad = (arr: { text: string }[]) => {
		const copy = arr.map((c) => c.text);
		while (copy.length < width) copy.push('');
		return copy;
	};

	// GFM без шапки не бывает: если первый ряд обычный, шапку отдаём пустой.
	const headerIsHeader = first.every((c) => c.header);
	const header = headerIsHeader ? pad(first) : Array.from({ length: width }, () => '');
	const bodyRows = (headerIsHeader ? rows.slice(1) : rows).map((r) => pad(cells(r)));

	const sep = Array.from({ length: width }, (_, i) => {
		const a = first[i]?.align;
		if (a === 'center') return ':---:';
		if (a === 'right') return '---:';
		if (a === 'left') return ':---';
		return '---';
	});

	return [`| ${header.join(' | ')} |`, `| ${sep.join(' | ')} |`, ...bodyRows.map((r) => `| ${r.join(' | ')} |`)].join('\n');
}

function listToMarkdown(node: DocNode, ordered: boolean): string {
	const start = ordered ? Number(node.attrs?.start ?? 1) : 1;
	return (node.content ?? [])
		.map((item, idx) => {
			const inner = (item.content ?? []).map((b) => blockToMarkdown(b)).join('\n\n');
			const marker = ordered ? `${start + idx}. ` : '- ';
			const check = item.type === 'taskItem' ? (item.attrs?.checked ? '[x] ' : '[ ] ') : '';
			return prefixLines(inner, marker + check, ' '.repeat(marker.length + check.length));
		})
		.join('\n');
}

function blockToMarkdown(node: DocNode, inTable = false): string {
	switch (node.type) {
		case 'paragraph': {
			const body = escapeLineStart(inlineToMarkdown(node.content, inTable));
			if (node.attrs?.indent) return alignWrap(`<p class="indent">${body}</p>`, node.attrs?.align);
			return alignWrap(body, node.attrs?.align);
		}
		case 'heading': {
			const level = Math.min(6, Math.max(1, Number(node.attrs?.level ?? 1)));
			return alignWrap(`${'#'.repeat(level)} ${inlineToMarkdown(node.content, inTable)}`, node.attrs?.align);
		}
		case 'blockquote': {
			const inner = (node.content ?? []).map((b) => blockToMarkdown(b)).join('\n\n');
			return prefixLines(inner, '> ', '> ');
		}
		case 'bulletList':
			return listToMarkdown(node, false);
		case 'orderedList':
			return listToMarkdown(node, true);
		case 'taskList':
			return listToMarkdown(node, false);
		case 'codeBlock': {
			const lang = String(node.attrs?.language ?? '');
			const text = (node.content ?? []).map((c) => c.text ?? '').join('');
			return '```' + lang + '\n' + text + '\n```';
		}
		case 'horizontalRule':
			return '---';
		case 'image':
			return imageToMarkdown(node);
		case 'table':
			return tableToMarkdown(node);
		case 'details': {
			const parts = node.content ?? [];
			const summary = parts.find((p) => p.type === 'detailsSummary');
			const rest = parts.filter((p) => p.type !== 'detailsSummary');
			const title = summary ? inlineToMarkdown(summary.content) : 'Подробности';
			const body = rest.map((b) => blockToMarkdown(b)).join('\n\n');
			return `<details>\n<summary>${title}</summary>\n\n${body}\n\n</details>`;
		}
		default: {
			// Незнакомый узел — отдаём его текст, лучше чем потерять содержимое.
			if (node.content) return node.content.map((b) => blockToMarkdown(b, inTable)).join('\n\n');
			return node.text ?? '';
		}
	}
}

/** Документ редактора → текст файла. */
export function docToMarkdown(doc: DocNode): string {
	const blocks = (doc.content ?? []).map((b) => blockToMarkdown(b)).filter((b) => b !== '');
	// Ровно одна пустая строка между блоками и перевод в конце файла.
	return blocks.join('\n\n').replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '') + '\n';
}
