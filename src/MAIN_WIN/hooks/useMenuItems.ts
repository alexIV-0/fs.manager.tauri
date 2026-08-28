import {
	FolderOpenDot,
	Pencil,
	Copy,
	Trash2,
	FolderPlus,
	Scissors,
	Clipboard,
	FilePlus,
	Workflow,
	BarChart3,
	FileText,
	LucideIcon,
} from 'lucide-react';
import { ContextMenuItem } from '../FileExplorerColumn/ContextMenu/FileFolderContextMenu';
import type { FileItem } from '@/Store/helpers/readDirContent';
import { plural } from '../Storage/syncText';

const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform);
const showInSystemLabel = isMac ? 'Показать в Finder' : 'Показать в Проводнике';

/**
 * Сколько строк тронет пункт меню — и как это назвать.
 *
 * Меню вызывают по ОДНОЙ строке, а работает оно по всему выделению (см.
 * `selectionTargets`). Значит человек обязан видеть охват до нажатия: «Удалить» и
 * «Удалить 10 файлов» — разные решения, и узнавать разницу после нажатия поздно.
 */
export interface MenuSelection {
	count: number;
	/** «4 файла», «2 папки», «5 объектов» — в винительном падеже, для подстановки. */
	text: string;
}

/** Состав выделения по-русски. Пусто (одна строка) — подписи остаются прежними. */
export function menuSelection(items: FileItem[]): MenuSelection | undefined {
	if (items.length <= 1) return undefined;
	const forms: [string, string, string] = items.every((i) => i.isDir)
		? ['папку', 'папки', 'папок']
		: items.every((i) => !i.isDir)
			? ['файл', 'файла', 'файлов']
			: ['объект', 'объекта', 'объектов'];
	return { count: items.length, text: plural(items.length, forms) };
}

/** «Копировать» → «Копировать 4 файла». Одна строка — подпись как была. */
function много(base: string, sel?: MenuSelection): string {
	return sel ? `${base} ${sel.text}` : base;
}

// ─── Пункты для файла ───────────────────────────────────────────────────────
interface UseFileMenuItemsProps {
	type: 'file';
	/** Охват действия, если выделена не одна строка. */
	selection?: MenuSelection;
	onOpen: () => void;
	onRename: () => void;
	onCopyPath: () => void;
	onShowInFinder: () => void;
	onDelete: () => void;
	onCopy: () => void;
	onCut: () => void;
	onPaste?: () => void;
	hasClipboard?: boolean;
}

// ─── Пункты для папки ───────────────────────────────────────────────────────
interface UseFolderMenuItemsProps {
	type: 'folder';
	/** Охват действия, если выделена не одна строка. */
	selection?: MenuSelection;
	onRename: () => void;
	onCopyPath: () => void;
	onShowInFinder: () => void;
	onDelete: () => void;
	onCreateFolder: () => void;
	onCopy: () => void;
	onCut: () => void;
	onPaste: () => void;
	hasClipboard?: boolean;
}

// ─── Пункты для пустого места в колонке ─────────────────────────────────────
interface UseEmptyMenuItemsProps {
	type: 'empty';
	onCreateFolder: () => void;
	onCreateTextFile: () => void;
	onPaste: () => void;
	hasClipboard?: boolean;
}

// ─── Пункты для проектной папки (2-я колонка) ───────────────────────────────
interface UseProjectMenuItemsProps {
	type: 'project';
	// Специфичные для 2-й колонки
	onOpenNodes: () => void;
	onOpenStats: () => void;
	onOpenDescription: () => void;
	// Зеркало пунктов папки из 3-й колонки
	onRename: () => void;
	onCopyPath: () => void;
	onShowInFinder: () => void;
	onDelete: () => void;
	onCreateFolder: () => void;
	onCopy: () => void;
	onCut: () => void;
	onPaste: () => void;
	hasClipboard?: boolean;
}

type UseMenuItemsProps =
	| UseFileMenuItemsProps
	| UseFolderMenuItemsProps
	| UseEmptyMenuItemsProps
	| UseProjectMenuItemsProps;

export function useMenuItems(props: UseMenuItemsProps): ContextMenuItem[] {
	if (props.type === 'file') {
		const { selection, onOpen, onRename, onCopyPath, onShowInFinder, onDelete, onCopy, onCut, onPaste, hasClipboard } = props;

		const items: ContextMenuItem[] = [
			{
				id: 'open',
				label: много('Открыть', selection),
				icon: FolderOpenDot,
				onClick: onOpen,
			},
			{
				id: 'rename',
				label: 'Переименовать',
				icon: Pencil,
				onClick: onRename,
				// Имя даётся одному файлу. Выделено десять — переименовывать нечего:
				// серый пункт честнее, чем молчаливое «переименую тот, по которому кликнул».
				disabled: Boolean(selection),
			},
			{
				id: 'copy-path',
				label: selection ? `Копировать пути (${selection.count})` : 'Копировать путь',
				icon: Copy,
				onClick: onCopyPath,
			},
			{
				id: 'show-in-finder',
				// Без счётчика намеренно: системе показывают ОДИН элемент — открывать
				// десять окон Finder'а никто не просил.
				label: showInSystemLabel,
				icon: FolderOpenDot,
				onClick: onShowInFinder,
			},
			{
				id: 'copy',
				label: много('Копировать', selection),
				icon: Copy,
				onClick: onCopy,
				dividerBefore: true,
			},
			{
				id: 'cut',
				label: много('Вырезать', selection),
				icon: Scissors,
				onClick: onCut,
			},
		];

		if (hasClipboard && onPaste) {
			items.push({
				id: 'paste',
				// Вставка кладёт в ПАПКУ файла, а она у всего выделения одна — счётчик
				// здесь был бы враньём, и запрещать пункт не за что.
				label: 'Вставить',
				icon: Clipboard,
				onClick: onPaste,
			});
		}

		items.push({
			id: 'delete',
			label: selection ? `Удалить ${selection.text}` : 'Удалить файл',
			icon: Trash2,
			onClick: onDelete,
			dividerBefore: true,
			color: '#f56565',
		});

		return items;
	}

	if (props.type === 'folder') {
		const { selection, onRename, onCopyPath, onShowInFinder, onDelete, onCreateFolder, onCopy, onCut, onPaste, hasClipboard } = props;

		const items: ContextMenuItem[] = [
			{
				id: 'rename',
				label: 'Переименовать',
				icon: Pencil,
				onClick: onRename,
				// См. файловую ветку: имя даётся одной папке.
				disabled: Boolean(selection),
			},
			{
				id: 'copy-path',
				label: selection ? `Копировать пути (${selection.count})` : 'Копировать путь',
				icon: Copy,
				onClick: onCopyPath,
			},
			{
				id: 'show-in-finder',
				label: showInSystemLabel,
				icon: FolderOpenDot,
				onClick: onShowInFinder,
			},
			{
				id: 'copy',
				label: много('Копировать', selection),
				icon: Copy,
				onClick: onCopy,
				dividerBefore: true,
			},
			{
				id: 'cut',
				label: много('Вырезать', selection),
				icon: Scissors,
				onClick: onCut,
			},
			{
				id: 'paste',
				// Вставка кладёт В папку, по которой кликнули: охват выделения к ней
				// отношения не имеет, поэтому счётчика здесь нет и быть не может.
				label: 'Вставить',
				icon: Clipboard,
				onClick: onPaste,
				disabled: !hasClipboard || Boolean(selection),
			},
			{
				id: 'create-folder',
				label: 'Создать папку',
				icon: FolderPlus,
				onClick: onCreateFolder,
				dividerBefore: true,
				disabled: Boolean(selection),
			},
			{
				id: 'delete',
				label: selection ? `Удалить ${selection.text}` : 'Удалить папку',
				icon: Trash2,
				onClick: onDelete,
				dividerBefore: true,
				color: '#f56565',
			},
		];

		return items;
	}

	if (props.type === 'project') {
		const {
			onOpenNodes,
			onOpenStats,
			onOpenDescription,
			onRename,
			onCopyPath,
			onShowInFinder,
			onDelete,
			onCreateFolder,
			onCopy,
			onCut,
			onPaste,
			hasClipboard,
		} = props;

		// ⚙️ ЕДИНОЕ МЕСТО настройки пунктов меню проектной папки.
		//    • добавить пункт   → дописать объект в массив;
		//    • убрать пункт     → удалить/закомментировать строку;
		//    • отключить пункт  → поставить `disabled: true` (станет серым, некликабельным).
		const items: ContextMenuItem[] = [
			// ── Специфичные для 2-й колонки ─────────────────────────────
			{
				id: 'open-nodes',
				label: 'Настройка нод',
				icon: Workflow,
				onClick: onOpenNodes,
			},
			{
				id: 'stats',
				label: 'Статистика',
				icon: BarChart3,
				onClick: onOpenStats,
			},
			{
				id: 'description',
				label: 'Описание',
				icon: FileText,
				onClick: onOpenDescription,
			},
			// ── Зеркало пунктов папки из 3-й колонки ────────────────────
			{
				id: 'rename',
				// Обычный пункт и у онлайн-проекта: меню одинаковое, механика разная,
				// результат один. Имя живёт в каталоге (`projects.name`), поэтому
				// переименование идёт командой в бэкенд, а папка зеркала переезжает
				// следом — человеку это знать не обязательно.
				label: 'Переименовать',
				icon: Pencil,
				onClick: onRename,
				dividerBefore: true,
			},
			{
				id: 'copy-path',
				label: 'Копировать путь',
				icon: Copy,
				onClick: onCopyPath,
			},
			{
				id: 'show-in-finder',
				label: showInSystemLabel,
				icon: FolderOpenDot,
				onClick: onShowInFinder,
			},
			{
				id: 'copy',
				label: 'Копировать',
				icon: Copy,
				onClick: onCopy,
				dividerBefore: true,
			},
			{
				id: 'cut',
				label: 'Вырезать',
				icon: Scissors,
				onClick: onCut,
			},
			{
				id: 'paste',
				label: 'Вставить',
				icon: Clipboard,
				onClick: onPaste,
				disabled: !hasClipboard,
			},
			{
				id: 'create-folder',
				label: 'Создать папку',
				icon: FolderPlus,
				onClick: onCreateFolder,
				dividerBefore: true,
			},
			{
				id: 'delete',
				label: 'Удалить папку',
				icon: Trash2,
				onClick: onDelete,
				dividerBefore: true,
				color: '#f56565',
			},
		];

		return items;
	}

	// type === 'empty'
	const { onCreateFolder, onCreateTextFile, onPaste, hasClipboard } = props;

	const items: ContextMenuItem[] = [
		{
			id: 'paste',
			label: 'Вставить',
			icon: Clipboard,
			onClick: onPaste,
			disabled: !hasClipboard,
		},
		{
			id: 'create-folder',
			label: 'Создать папку',
			icon: FolderPlus,
			onClick: onCreateFolder,
			dividerBefore: true,
		},
		{
			id: 'create-text-file',
			label: 'Создать текстовый файл',
			icon: FilePlus,
			onClick: onCreateTextFile,
		},
	];

	return items;
}
