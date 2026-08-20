/**
 * Операции тулбара над текстом — чистые функции без React и без DOM.
 *
 * Каждая получает состояние поля (текст + выделение) и возвращает новое. Вынесено
 * отдельно, потому что это единственная часть редактора, которую нельзя проверить
 * глазами по разметке: тесты фронта в проекте не настроены, зато чистую функцию
 * видно целиком.
 *
 * Правило контракта, которое здесь зашито: блочные HTML-обёртки вставляются с
 * ПУСТЫМИ СТРОКАМИ вокруг содержимого. Без них markdown внутри блока не
 * разбирается — `<div class="align-center">**жирный**</div>` покажет звёздочки.
 */

export interface TextState {
	value: string;
	selStart: number;
	selEnd: number;
}

/** Что подставляем, когда кнопку нажали без выделения. */
export const PLACEHOLDER = 'текст';

const selected = (s: TextState) => s.value.slice(s.selStart, s.selEnd);

/** Границы строк, задетых выделением. */
function lineBounds(value: string, from: number, to: number): [number, number] {
	const start = value.lastIndexOf('\n', from - 1) + 1;
	const nl = value.indexOf('\n', to);
	const end = nl === -1 ? value.length : nl;
	return [start, end];
}

/** Замена куска текста с явным указанием, что выделить после. */
function splice(value: string, from: number, to: number, insert: string, selFrom: number, selTo: number): TextState {
	return {
		value: value.slice(0, from) + insert + value.slice(to),
		selStart: selFrom,
		selEnd: selTo,
	};
}

// ─── Строчное форматирование ────────────────────────────────────────────────

/** Парные markdown-маркеры: `**`, `*`, `~~`, `` ` ``. Повторное нажатие снимает. */
export function toggleWrap(s: TextState, marker: string): TextState {
	const { value, selStart, selEnd } = s;
	const before = value.slice(Math.max(0, selStart - marker.length), selStart);
	const after = value.slice(selEnd, selEnd + marker.length);

	// Обёртка снаружи выделения — снимаем её.
	if (before === marker && after === marker) {
		const inner = value.slice(selStart, selEnd);
		return splice(value, selStart - marker.length, selEnd + marker.length, inner, selStart - marker.length, selStart - marker.length + inner.length);
	}

	const inner = selected(s);
	// Обёртка попала внутрь выделения — тоже снимаем.
	if (inner.length >= marker.length * 2 && inner.startsWith(marker) && inner.endsWith(marker)) {
		const bare = inner.slice(marker.length, inner.length - marker.length);
		return splice(value, selStart, selEnd, bare, selStart, selStart + bare.length);
	}

	const text = inner || PLACEHOLDER;
	return splice(value, selStart, selEnd, marker + text + marker, selStart + marker.length, selStart + marker.length + text.length);
}

/** Простые теги без атрибутов: `<u>`, `<mark>`. Повторное нажатие снимает. */
export function toggleTag(s: TextState, tag: string): TextState {
	const { value, selStart, selEnd } = s;
	const open = `<${tag}>`;
	const close = `</${tag}>`;

	if (value.slice(Math.max(0, selStart - open.length), selStart) === open && value.slice(selEnd, selEnd + close.length) === close) {
		const inner = value.slice(selStart, selEnd);
		return splice(value, selStart - open.length, selEnd + close.length, inner, selStart - open.length, selStart - open.length + inner.length);
	}

	const inner = selected(s);
	if (inner.startsWith(open) && inner.endsWith(close)) {
		const bare = inner.slice(open.length, inner.length - close.length);
		return splice(value, selStart, selEnd, bare, selStart, selStart + bare.length);
	}

	const text = inner || PLACEHOLDER;
	return splice(value, selStart, selEnd, open + text + close, selStart + open.length, selStart + open.length + text.length);
}

const OPEN_SPAN = /<span class="([^"]*)">$/;

/**
 * Цвет текста (`fg-*`) и заливка фона (`bg-*`).
 *
 * Если выделение уже обёрнуто в `<span class="…">`, правим список классов, а не
 * вкладываем span в span: иначе после трёх нажатий получается каша, в которой
 * не разобраться ни человеку, ни санитайзеру. `hue = null` снимает свойство, а
 * когда классов не остаётся — обёртка убирается целиком.
 */
export function applySpanClass(s: TextState, kind: 'fg' | 'bg', hue: string | null): TextState {
	const { value, selStart, selEnd } = s;
	const m = OPEN_SPAN.exec(value.slice(0, selStart));
	const hasClose = value.slice(selEnd, selEnd + 7) === '</span>';

	if (m && hasClose) {
		const openStart = selStart - m[0].length;
		const rest = m[1].split(/\s+/).filter((c) => c && !c.startsWith(`${kind}-`));
		const classes = hue ? [...rest, `${kind}-${hue}`] : rest;
		const inner = value.slice(selStart, selEnd);

		if (classes.length === 0) {
			return splice(value, openStart, selEnd + 7, inner, openStart, openStart + inner.length);
		}
		const open = `<span class="${classes.join(' ')}">`;
		return splice(value, openStart, selEnd + 7, open + inner + '</span>', openStart + open.length, openStart + open.length + inner.length);
	}

	if (!hue) return s;

	const text = selected(s) || PLACEHOLDER;
	const open = `<span class="${kind}-${hue}">`;
	return splice(value, selStart, selEnd, open + text + '</span>', selStart + open.length, selStart + open.length + text.length);
}

/** Снять с выделения всё известное форматирование, оставив текст. */
export function stripFormatting(s: TextState): TextState {
	const raw = selected(s);
	if (!raw) return s;

	const clean = raw
		.replace(/<\/?(?:u|mark|span|br)\b[^>]*>/gi, '')
		.replace(/<\/?(?:div|p|details|summary)\b[^>]*>/gi, '')
		.replace(/(\*\*\*|\*\*|~~|__)/g, '')
		.replace(/(^|[\s(])[*_]([^*_]+)[*_]/g, '$1$2')
		.replace(/`+/g, '')
		.split('\n')
		.map((line) => line.replace(/^\s*(?:#{1,6}\s+|>\s?|[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+\.\s+)/, ''))
		.join('\n');

	return splice(s.value, s.selStart, s.selEnd, clean, s.selStart, s.selStart + clean.length);
}

// ─── Построчные операции ────────────────────────────────────────────────────

type LinePrefix = { kind: 'quote' | 'ul' | 'check' | 'ol' };

const PREFIX_RE: Record<LinePrefix['kind'], RegExp> = {
	quote: /^>\s?/,
	ul: /^[-*+]\s+(?!\[[ xX]\]\s)/,
	check: /^[-*+]\s+\[[ xX]\]\s+/,
	ol: /^\d+\.\s+/,
};

/** Список / цитата / чеклист: ставит префикс всем задетым строкам либо снимает. */
export function toggleLinePrefix(s: TextState, kind: LinePrefix['kind']): TextState {
	const [from, to] = lineBounds(s.value, s.selStart, s.selEnd);
	const lines = s.value.slice(from, to).split('\n');
	const re = PREFIX_RE[kind];
	const meaningful = lines.filter((l) => l.trim() !== '');
	const allHave = meaningful.length > 0 && meaningful.every((l) => re.test(l.trimStart()));

	let n = 0;
	const next = lines
		.map((line) => {
			if (line.trim() === '') return line;
			const indent = line.slice(0, line.length - line.trimStart().length);
			const body = line.trimStart();
			if (allHave) return indent + body.replace(re, '');
			// Сначала снимаем прежний маркер, иначе получится «- 1. текст».
			const bare = body.replace(/^(?:>\s?|[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+\.\s+)/, '');
			n += 1;
			const prefix = kind === 'quote' ? '> ' : kind === 'ul' ? '- ' : kind === 'check' ? '- [ ] ' : `${n}. `;
			return indent + prefix + bare;
		})
		.join('\n');

	return splice(s.value, from, to, next, from, from + next.length);
}

/** Стиль абзаца: 0 — обычный текст, 1…4 — заголовок. */
export function setHeading(s: TextState, level: 0 | 1 | 2 | 3 | 4): TextState {
	const [from, to] = lineBounds(s.value, s.selStart, s.selEnd);
	const next = s.value
		.slice(from, to)
		.split('\n')
		.map((line) => {
			const bare = line.replace(/^\s*#{1,6}\s*/, '');
			if (line.trim() === '') return line;
			return level === 0 ? bare : `${'#'.repeat(level)} ${bare}`;
		})
		.join('\n');
	return splice(s.value, from, to, next, from, from + next.length);
}

/** Отступ пункта списка: два пробела в начало каждой задетой строки. */
export function changeIndent(s: TextState, delta: 1 | -1): TextState {
	const [from, to] = lineBounds(s.value, s.selStart, s.selEnd);
	const next = s.value
		.slice(from, to)
		.split('\n')
		.map((line) => {
			if (line.trim() === '') return line;
			return delta > 0 ? '  ' + line : line.replace(/^ {1,2}/, '');
		})
		.join('\n');
	return splice(s.value, from, to, next, from, from + next.length);
}

// ─── Блочные вставки ────────────────────────────────────────────────────────

/**
 * Вставка блока с гарантией пустых строк вокруг. Возвращает готовое состояние;
 * `caretIn` — смещение внутри блока, куда поставить каретку (по умолчанию конец).
 */
function insertBlock(s: TextState, block: string, innerFrom?: number, innerTo?: number): TextState {
	const { value } = s;
	const [from, to] = lineBounds(value, s.selStart, s.selEnd);
	const beforeText = value.slice(0, from);
	const afterText = value.slice(to);

	const needBefore = beforeText.length > 0 && !beforeText.endsWith('\n\n');
	const needAfter = afterText.length > 0 && !afterText.startsWith('\n\n');
	const lead = needBefore ? (beforeText.endsWith('\n') ? '\n' : '\n\n') : '';
	const tail = needAfter ? (afterText.startsWith('\n') ? '\n' : '\n\n') : '';

	const insert = lead + block + tail;
	const base = from + lead.length;
	const selFrom = innerFrom === undefined ? base + block.length : base + innerFrom;
	const selTo = innerTo === undefined ? selFrom : base + innerTo;
	return splice(value, from, to, insert, selFrom, selTo);
}

/** Выравнивание блока: `<div class="align-*">` с пустыми строками внутри. */
export function wrapAlign(s: TextState, cls: string): TextState {
	const inner = selected(s) || PLACEHOLDER;
	const open = `<div class="${cls}">\n\n`;
	const block = `${open}${inner}\n\n</div>`;
	return insertBlock(s, block, open.length, open.length + inner.length);
}

/** Красная строка: отдельный абзац `<p class="indent">`. */
export function wrapIndentParagraph(s: TextState): TextState {
	const inner = selected(s) || PLACEHOLDER;
	const open = '<p class="indent">';
	return insertBlock(s, `${open}${inner}</p>`, open.length, open.length + inner.length);
}

/** Спойлер. */
export function wrapDetails(s: TextState): TextState {
	const inner = selected(s) || PLACEHOLDER;
	const open = '<details>\n<summary>Подробности</summary>\n\n';
	return insertBlock(s, `${open}${inner}\n\n</details>`, open.length, open.length + inner.length);
}

export function insertHr(s: TextState): TextState {
	return insertBlock(s, '---');
}

/** Каркас GFM-таблицы. */
export function insertTable(s: TextState, cols: number, rows: number, header: boolean): TextState {
	const width = Math.max(1, Math.min(12, cols));
	const height = Math.max(1, Math.min(50, rows));
	const head = header ? Array.from({ length: width }, (_, i) => `Столбец ${i + 1}`) : Array.from({ length: width }, () => '');
	const line = (cells: string[]) => `| ${cells.join(' | ')} |`;
	const body = Array.from({ length: height }, () => line(Array.from({ length: width }, () => '   ')));
	const block = [line(head), line(Array.from({ length: width }, () => '---')), ...body].join('\n');
	// Каретка — в первую ячейку шапки, чтобы сразу печатать название.
	return insertBlock(s, block, 2, 2 + head[0].length);
}

/** Блок кода или блок-схема (`mermaid`). */
export function insertFence(s: TextState, lang: string, body?: string): TextState {
	const inner = body ?? selected(s) ?? '';
	const open = '```' + lang + '\n';
	const text = inner || ' ';
	return insertBlock(s, `${open}${text}\n\`\`\``, open.length, open.length + text.length);
}

// ─── Строчные вставки ───────────────────────────────────────────────────────

export function insertText(s: TextState, text: string): TextState {
	return splice(s.value, s.selStart, s.selEnd, text, s.selStart + text.length, s.selStart + text.length);
}

export function insertLink(s: TextState, text: string, url: string): TextState {
	const label = text || url;
	const md = `[${label}](${url})`;
	return splice(s.value, s.selStart, s.selEnd, md, s.selStart + md.length, s.selStart + md.length);
}

/**
 * Картинка. **Единственное место**, где в файл попадает ссылка на изображение:
 * если однажды переедем с base64 на файлы в `_description/`, правка будет здесь
 * (контракт §4).
 */
export function insertImage(s: TextState, alt: string, src: string): TextState {
	const md = `![${alt}](${src})`;
	return insertBlock(s, md);
}
