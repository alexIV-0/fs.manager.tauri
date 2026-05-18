import {
	FolderOpenDot,
	Pencil,
	Copy,
	Trash2,
	FolderPlus,
	Scissors,
	Clipboard,
	FilePlus,
	LucideIcon,
} from 'lucide-react';
import { ContextMenuItem } from '../FileExplorerColumn/ContextMenu/FileFolderContextMenu';

const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform);
const showInSystemLabel = isMac ? 'Показать в Finder' : 'Показать в Проводнике';

// ─── Пункты для файла ───────────────────────────────────────────────────────
interface UseFileMenuItemsProps {
	type: 'file';
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

type UseMenuItemsProps = UseFileMenuItemsProps | UseFolderMenuItemsProps | UseEmptyMenuItemsProps;

export function useMenuItems(props: UseMenuItemsProps): ContextMenuItem[] {
	if (props.type === 'file') {
		const { onOpen, onRename, onCopyPath, onShowInFinder, onDelete, onCopy, onCut, onPaste, hasClipboard } = props;

		const items: ContextMenuItem[] = [
			{
				id: 'open',
				label: 'Открыть',
				icon: FolderOpenDot,
				onClick: onOpen,
			},
			{
				id: 'rename',
				label: 'Переименовать',
				icon: Pencil,
				onClick: onRename,
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
		];

		if (hasClipboard && onPaste) {
			items.push({
				id: 'paste',
				label: 'Вставить',
				icon: Clipboard,
				onClick: onPaste,
			});
		}

		items.push({
			id: 'delete',
			label: 'Удалить файл',
			icon: Trash2,
			onClick: onDelete,
			dividerBefore: true,
			color: '#f56565',
		});

		return items;
	}

	if (props.type === 'folder') {
		const { onRename, onCopyPath, onShowInFinder, onDelete, onCreateFolder, onCopy, onCut, onPaste, hasClipboard } = props;

		const items: ContextMenuItem[] = [
			{
				id: 'rename',
				label: 'Переименовать',
				icon: Pencil,
				onClick: onRename,
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
