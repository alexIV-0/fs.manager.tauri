import { greyColor } from '@/Store/Color/grayColor';
import { prefetchDir } from '@/Store/helpers/readDirContent';
import { clipboardFs_store } from '@/Store/MainWin/clipboardFs_store';
import { ListItem, ListItemButton, ListItemText, TextField } from '@mui/material';
import { Folder } from 'lucide-react';
import { useRef } from 'react';
import { FileFolderContextMenu } from './ContextMenu/FileFolderContextMenu';
import { useContextMenu } from '../hooks/useContextMenu';
import { useMenuItems } from '../hooks/useMenuItems';
import { useEditableField } from '@/hooks/useEditableField';
import { useKeyboardShortcut } from '@/hooks/useKeyboardShortcut';
import {
	copyPath,
	copyToClipboardFs,
	cutToClipboardFs,
	deleteItem,
	pasteFromClipboardFs,
	renameFolder,
	showInFinder,
	createFolder,
} from '@/PROCESSING/utils/fileSystemActions';
import { joinPath } from '@/Utils/joinPath';
import { useColumnView_Store } from '@/Store/MainWin/useColumnView_store';

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
}

export function CurentFolderItem({
	name,
	path,
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
			const parentDir = (await window.electronAPI.invoke('pathDirname', path)) as string;
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

	const getMultiPaths = () => {
		if (!isMultiSelected) return [path];
		const s = useColumnView_Store.getState();
		if (s.instances.gd.multiSelectedPaths.includes(path)) return s.instances.gd.multiSelectedPaths;
		if (s.instances.local.multiSelectedPaths.includes(path)) return s.instances.local.multiSelectedPaths;
		return [path];
	};

	const menuItems = useMenuItems({
		type: 'folder',
		onRename: () => {
			handleMenuClose();
			// Откладываем до следующего тика, чтобы MUI Menu успел вернуть фокус,
			// иначе autoFocus на TextField немедленно потеряет фокус и onBlur скроет поле
			setTimeout(() => startEditing(), 0);
		},
		onCopyPath: () => copyPath(path),
		onShowInFinder: () => showInFinder(path),
		onDelete: () => deleteItem(path),
		onCreateFolder: () => createFolder(path),
		onCopy: () => copyToClipboardFs(getMultiPaths()),
		onCut: () => cutToClipboardFs(getMultiPaths()),
		onPaste: () => pasteFromClipboardFs(path),
		hasClipboard,
	});

	return (
		<>
			<ListItem
				disablePadding
				ref={listItemRef}
				data-item-path={path}
				onContextMenu={(e) => handleContextMenu(e, isMultiSelected ? undefined : onSelect)}
				onMouseEnter={() => prefetchDir(path)}
				sx={{
					height: 34,
					backgroundColor: isMultiSelected
						? '#007bff33'
						: isSelected
							? isActiveSelection
								? '#007bff4c'
								: 'rgba(255,255,255,0.08)'
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
								color: isSelected ? (isActiveSelection ? '#64afffff' : '#ffffffd9') : '#ffffffd9',
								opacity: isCut ? 0.4 : 1,
								cursor: 'pointer',
								transition: 'color 0.2s ease, opacity 0.2s ease',
								'&:hover': {
									color: isSelected && isActiveSelection ? '#91c8ffff' : '#ffffff',
								},
							}}
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
				items={menuItems}
			/>
		</>
	);
}
