import { greyColor } from '@/Store/Color/grayColor';
import { prefetchDir } from '@/Store/helpers/readDirContent';
import { clipboardFs_store } from '@/Store/MainWin/clipboardFs_store';
import { ListItem, ListItemButton, ListItemText, TextField } from '@mui/material';
import { Folder } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { FileFolderContextMenu } from './ContextMenu/FileFolderContextMenu';
import { useContextMenu } from '../hooks/useContextMenu';
import { menuSelection, useMenuItems } from '../hooks/useMenuItems';
import { useEditableField } from '@/hooks/useEditableField';
import { useKeyboardShortcut } from '@/hooks/useKeyboardShortcut';
import {
	copyPath,
	copyToClipboardFs,
	cutToClipboardFs,
	deleteItems,
	pasteFromClipboardFs,
	renameFolder,
	showInFinder,
	createFolder,
} from '@/PROCESSING/utils/fileSystemActions';
import { joinPath } from '@/Utils/joinPath';
import { dirname } from '@/Utils/path';
import { StorageBadge } from '@/MAIN_WIN/Storage/StorageBadge';
import { downloadFolder, uploadFolder } from '@/MAIN_WIN/Storage/bulkActions';
import { storageSelectionItems } from '@/MAIN_WIN/Storage/useStorageMenuItems';
import { selectionTargets } from '@/Store/MainWin/useColumnView_store';
import type { FileItem } from '@/Store/helpers/readDirContent';
import { handleDragOutMouseDown } from '@/Utils/dragOut';

interface CurentFolderItemProps {
	name: string;
	path: string;
	isSelected: boolean;
	isActiveSelection?: boolean;
	isMultiSelected?: boolean;
	rename?: boolean;
	onSelect: () => void;
	onMultiSelectToggle?: () => void;
	onMultiSelectRange?: () => void;
	onRenamed?: (oldName: string, newName: string) => void;
	/** Агрегат по поддереву в облачном зеркале. У локальных папок поля нет. */
	storage?: import('@/Store/helpers/readDirContent').FileItem['storage'];
}

export function CurentFolderItem({
	name,
	path,
	storage,
	isSelected,
	isActiveSelection = true,
	isMultiSelected,
	rename = true,
	onSelect,
	onMultiSelectToggle,
	onMultiSelectRange,
	onRenamed,
}: CurentFolderItemProps) {
	const { isEditing, startEditing, inputProps } = useEditableField({
		initialValue: name,
		onSave: async (newName) => {
			const parentDir = dirname(path);
			const newPath = joinPath(parentDir, newName);
			await renameFolder(path, newPath, onRenamed);
		},
	});

	const grey = greyColor(80);
	const listItemRef = useRef<HTMLLIElement>(null);

	// Enter/F2 на выделенном элементе — начать переименование
	useKeyboardShortcut({
		key: ['Enter', 'F2'],
		enabled: isSelected,
		skipOnInput: true,
		callback: (e) => {
			e.preventDefault();
			setTimeout(() => startEditing(), 0);
		},
	});

	const menuId = `folder-${path}`;
	const { menuPosition, handleContextMenu, handleMenuClose, isMenuOpen } = useContextMenu(menuId);

	const hasClipboard = clipboardFs_store((s) => s.type !== null && s.paths.length > 0);
	const isCut = clipboardFs_store((s) => s.type === 'cut' && s.paths.includes(path));

	// Строка, по которой кликнули, — в том же виде, что и строки в колонке.
	const me: FileItem = useMemo(() => ({ name, path, isDir: true, storage }), [name, path, storage]);

	// На что подействует меню. Считается в момент ОТКРЫТИЯ, а не при отрисовке:
	// строки мемоизированы (`DraggableFolderItem` сравнивает пропсы вручную), и уже
	// выделенная строка не перерисовывается, когда к выделению добавляют соседнюю, —
	// посчитанный в рендере список остался бы коротким.
	const [targets, setTargets] = useState<FileItem[] | null>(null);
	const acting = targets ?? [me];
	const selection = menuSelection(acting);
	const actingPaths = acting.map((t) => t.path);

	const menuItems = useMenuItems({
		type: 'folder',
		selection,
		onRename: () => {
			handleMenuClose();
			// Откладываем до следующего тика, чтобы MUI Menu успел вернуть фокус,
			// иначе autoFocus на TextField немедленно потеряет фокус и onBlur скроет поле
			setTimeout(() => startEditing(), 0);
		},
		// Несколько путей — по строке на каждый: так их вставляют в терминал и в чат.
		onCopyPath: () => copyPath(actingPaths.join('\n')),
		// Системе показываем ОДНУ папку: десять окон Finder'а никто не просил.
		onShowInFinder: () => showInFinder(actingPaths[0]),
		onDelete: () => void deleteItems(actingPaths),
		// Создать и вставить можно только в ОДНУ папку — при выделении пункты серые.
		onCreateFolder: () => createFolder(path),
		onCopy: () => copyToClipboardFs(actingPaths),
		onCut: () => cutToClipboardFs(actingPaths),
		onPaste: () => pasteFromClipboardFs(path),
		hasClipboard,
	});

	// Облачные пункты — только у строк зеркала. Признак «облачная» берём из наличия
	// данных каталога у строки: они появляются только у того, что пришло из зеркала.
	const allMenuItems = [...menuItems, ...storageSelectionItems(acting)];

	// Клик по значку папки = рекурсивное действие над всем поддеревом, поэтому оно
	// всегда спрашивает подтверждение с числами (`bulkActions`). Там, где внутри
	// конфликт или ошибка, клика нет: массово это не решается, надо зайти внутрь.
	const aggregate = storage?.aggregate;
	const badgeAction = useMemo(() => {
		if (aggregate === 'allCloud' || aggregate === 'mixed') {
			return {
				hint: 'нажмите, чтобы скачать папку целиком',
				run: () => void downloadFolder(path),
			};
		}
		if (aggregate === 'needsUpload') {
			return {
				hint: 'нажмите, чтобы отправить незалитое в облако',
				run: () => void uploadFolder(path),
			};
		}
		return null;
	}, [aggregate, path]);

	return (
		<>
			<ListItem
				disablePadding
				ref={listItemRef}
				data-item-path={path}
				onContextMenu={(e) => {
					const t = selectionTargets(me);
					setTargets(t);
					// Клик по строке ВНЕ выделения — обычный выбор одной строки; клик
					// внутри выделения его не ломает.
					handleContextMenu(e, t.length > 1 ? undefined : onSelect);
				}}
				onMouseEnter={() => prefetchDir(path)}
				sx={{
					height: 34,
					backgroundColor: isMultiSelected
						? '#007bff33'
						: isSelected
							? isActiveSelection
								? '#007bff4c'
								: 'rgba(150,150,150,0.22)'
							: 'transparent',
					outline: isMultiSelected ? '1px solid #007bff66' : 'none',
					'&:hover': { backgroundColor: isMultiSelected ? '#007bff44' : '#ffffff0b' },
					transition: 'background-color 0.1s ease',
				}}
			>
				<ListItemButton
					onClick={(e) => {
						if (e.shiftKey) {
							e.preventDefault();
							onMultiSelectRange?.();
						} else if (e.ctrlKey || e.metaKey) {
							e.preventDefault();
							onMultiSelectToggle?.();
						} else {
							onSelect();
						}
					}}
					dense
					disableRipple
					sx={{
						gap: 1,
						'&:hover .folder-icon': { color: '#007bff' },
					}}
				>
					<Folder
						size={24}
						className='folder-icon'
						fill={isSelected && isActiveSelection ? '#007bff' : grey}
						color={isSelected && isActiveSelection ? '#007bff' : grey}
						style={{ flexShrink: 0, opacity: isCut ? 0.4 : 1, transition: 'opacity 0.2s ease' }}
					/>

					{isEditing && rename ? (
						<TextField
							{...inputProps}
							onKeyDown={(e) => {
								inputProps.onKeyDown(e);
								e.stopPropagation();
							}}
							onClick={(e) => e.stopPropagation()}
							size='small'
							sx={{ fontSize: 16 }}
						/>
					) : (
						<ListItemText
							primary={name}
							slots={{ primary: 'span' }}
							sx={{
								m: 0,
								whiteSpace: 'nowrap',
								overflow: 'hidden',
								textOverflow: 'ellipsis',
								fontWeight: isSelected ? 600 : 400,
								fontSize: '1.2rem',
								color: isSelected ? '#64afffff' : '#ffffffd9',
								opacity: isCut ? 0.4 : 1,
								cursor: 'pointer',
								transition: 'color 0.2s ease, opacity 0.2s ease',
								'&:hover': {
									color: isSelected && isActiveSelection ? '#91c8ffff' : '#ffffff',
								},
							}}
						/>
					)}

					{/* Агрегат поддерева: сразу видно, скачана папка целиком или нет.
					    Значок ещё и нажимается — это самый короткий путь «забери мне
					    эту папку», ради которого раньше приходилось обходить каждый файл. */}
					{storage?.aggregate && (
						<StorageBadge
							aggregate={storage.aggregate}
							onAction={badgeAction?.run}
							actionHint={badgeAction?.hint}
						/>
					)}
				</ListItemButton>
			</ListItem>

			<FileFolderContextMenu
				menuId={menuId}
				type='folder'
				position={menuPosition}
				open={isMenuOpen}
				onClose={handleMenuClose}
				items={allMenuItems}
			/>
		</>
	);
}
