/**
 * Расширения Tiptap под НАШ формат описания.
 *
 * Готовые расширения пишут то, что удобно им (`style="text-align:center"`,
 * `data-type="taskList"`, `<span style="color:…">`), а нам нужен закрытый набор
 * классов из `ideasAndTest/DESCRIPTION_FORMAT_CONTRACT.md`. Поэтому здесь всё,
 * что отвечает за соответствие контракту:
 *
 *   • `TextColor`   — один mark с двумя атрибутами → один `<span class="fg-… bg-…">`;
 *   • `BlockAttrs`  — выравнивание и красная строка как атрибуты абзаца/заголовка;
 *   • `Details`     — спойлер;
 *   • правки парсинга у таблиц и чеклистов, чтобы читался markdown-HTML.
 *
 * Ни одно из них не выдаёт `style`, `width` или `height` — это условие контракта,
 * а не вкус.
 */

import { Extension, Mark, Node, mergeAttributes } from '@tiptap/core';
import { TableCell, TableHeader } from '@tiptap/extension-table';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { COLOR_KEYS } from './markdownFormat';

// ─── Цвет текста и заливка ──────────────────────────────────────────────────

/** Достаёт ключ цвета из класса вида `fg-blue-2` / `bg-gray-3`. */
function colorFromClass(el: HTMLElement, prefix: 'fg' | 'bg'): string | null {
	for (const cls of Array.from(el.classList)) {
		if (!cls.startsWith(`${prefix}-`)) continue;
		const key = cls.slice(prefix.length + 1);
		if (COLOR_KEYS.includes(key)) return key;
	}
	return null;
}

export interface TextColorAttrs {
	fg: string | null;
	bg: string | null;
}

/**
 * Один mark на цвет и заливку — не два. Иначе `<span>` вкладывался бы в `<span>`
 * при каждом втором нажатии, и файл зарастал бы обёртками (та же причина, по
 * которой в текстовом режиме `applySpanClass` правит существующий span).
 */
export const TextColor = Mark.create({
	name: 'textColor',

	addAttributes() {
		return {
			fg: {
				default: null,
				parseHTML: (el) => colorFromClass(el as HTMLElement, 'fg'),
				renderHTML: () => ({}), // класс собираем целиком в renderHTML ниже
			},
			bg: {
				default: null,
				parseHTML: (el) => colorFromClass(el as HTMLElement, 'bg'),
				renderHTML: () => ({}),
			},
		};
	},

	parseHTML() {
		return [
			{
				tag: 'span',
				getAttrs: (el) => {
					const node = el as HTMLElement;
					const fg = colorFromClass(node, 'fg');
					const bg = colorFromClass(node, 'bg');
					return fg || bg ? { fg, bg } : false;
				},
			},
		];
	},

	renderHTML({ HTMLAttributes, mark }) {
		const attrs = mark.attrs as TextColorAttrs;
		const classes = [attrs.fg ? `fg-${attrs.fg}` : '', attrs.bg ? `bg-${attrs.bg}` : ''].filter(Boolean).join(' ');
		return ['span', mergeAttributes(HTMLAttributes, { class: classes }), 0];
	},
});

// ─── Выравнивание и красная строка ──────────────────────────────────────────

const ALIGNS = ['left', 'center', 'right', 'justify'];

function alignFromClass(el: HTMLElement): string | null {
	for (const a of ALIGNS) if (el.classList.contains(`align-${a}`)) return a;
	return null;
}

/**
 * В файле выравнивание — это блочная обёртка `<div class="align-center">`, а в
 * документе редактора удобнее атрибут абзаца. Перевод между этими видами:
 * при чтении `div` разворачивается в классы на детях (`prepareHtml`), при записи
 * сериализатор снова оборачивает блок в `div`.
 */
export const BlockAttrs = Extension.create({
	name: 'blockAttrs',

	addGlobalAttributes() {
		return [
			{
				types: ['paragraph', 'heading'],
				attributes: {
					align: {
						default: null,
						parseHTML: (el) => alignFromClass(el as HTMLElement),
						renderHTML: (attrs) => (attrs.align ? { class: `align-${attrs.align}` } : {}),
					},
					indent: {
						default: false,
						parseHTML: (el) => (el as HTMLElement).classList.contains('indent'),
						renderHTML: (attrs) => (attrs.indent ? { class: 'indent' } : {}),
					},
				},
			},
		];
	},
});

// ─── Спойлер ────────────────────────────────────────────────────────────────

export const DetailsSummary = Node.create({
	name: 'detailsSummary',
	content: 'inline*',
	defining: true,
	parseHTML() {
		return [{ tag: 'summary' }];
	},
	renderHTML({ HTMLAttributes }) {
		return ['summary', HTMLAttributes, 0];
	},
});

export const Details = Node.create({
	name: 'details',
	group: 'block',
	content: 'detailsSummary block+',
	defining: true,
	parseHTML() {
		return [{ tag: 'details' }];
	},
	renderHTML({ HTMLAttributes }) {
		// `open` в редакторе всегда: иначе содержимое не видно и его нельзя править.
		return ['details', mergeAttributes(HTMLAttributes, { open: 'open' }), 0];
	},
});

// ─── Таблицы: выравнивание колонок ──────────────────────────────────────────

/**
 * GFM-выравнивание (`|:---:|`) приезжает в HTML атрибутом `align` на `th`/`td` —
 * единственное место, где атрибут `align` разрешён контрактом. Без этих правок
 * оно теряется при первом же пересохранении.
 */
const alignAttr = {
	align: {
		default: null,
		parseHTML: (el: HTMLElement) => el.getAttribute('align'),
		renderHTML: (attrs: Record<string, unknown>) => (attrs.align ? { align: String(attrs.align) } : {}),
	},
};

export const DescTableHeader = TableHeader.extend({
	addAttributes() {
		return { ...this.parent?.(), ...alignAttr };
	},
});

export const DescTableCell = TableCell.extend({
	addAttributes() {
		return { ...this.parent?.(), ...alignAttr };
	},
});

// ─── Чеклисты из markdown-HTML ──────────────────────────────────────────────

/**
 * `remark-gfm` отдаёт чеклист как `ul.contains-task-list` с `li.task-list-item` и
 * `input[type=checkbox]`, а Tiptap по умолчанию ищет `data-type="taskList"`.
 * Добавляем распознавание разметки markdown, своя остаётся рабочей.
 */
export const DescTaskList = TaskList.extend({
	parseHTML() {
		return [{ tag: 'ul[data-type="taskList"]', priority: 60 }, { tag: 'ul.contains-task-list', priority: 55 }];
	},
});

export const DescTaskItem = TaskItem.extend({
	parseHTML() {
		return [
			{ tag: 'li[data-type="taskItem"]', priority: 60 },
			{
				tag: 'li.task-list-item',
				priority: 55,
				getAttrs: (el) => ({ checked: !!(el as HTMLElement).querySelector('input[checked]') }),
			},
		];
	},
});

/**
 * Подготовка HTML перед загрузкой в редактор: переносим выравнивание с обёртки
 * `<div class="align-*">` на сами блоки, потому что в документе это атрибут
 * абзаца. Обёртку после этого разворачиваем — иначе ProseMirror выбросил бы её
 * вместе с выравниванием.
 *
 * Чекбоксы из markdown-чеклиста трогать не надо: `input` — не узел схемы и без
 * текста внутри, ProseMirror его просто игнорирует, а галочку рисует `TaskItem`.
 */
export function prepareHtml(html: string): string {
	const doc = new DOMParser().parseFromString(`<div id="root">${html}</div>`, 'text/html');
	const root = doc.getElementById('root');
	if (!root) return html;

	root.querySelectorAll('div').forEach((div) => {
		const align = alignFromClass(div);
		if (!align) return;
		Array.from(div.children).forEach((child) => child.classList.add(`align-${align}`));
		div.replaceWith(...Array.from(div.childNodes));
	});

	return root.innerHTML;
}
