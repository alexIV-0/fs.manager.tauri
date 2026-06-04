import { greyColor } from '@/Store/Color/grayColor';
import { typeOfFile_store } from '@/Store/MainWin/pathPattern_store';
import { clipboardFs_store } from '@/Store/MainWin/clipboardFs_store';
import { ListItem, ListItemButton, ListItemText, TextField } from '@mui/material';
import { File, FileAudio, FileBadge2, FileImage, FileKey2, FileSpreadsheet, FileText, FileType2, FileVideo, FolderOpenDot } from 'lucide-react';
import { useMemo, useRef } from 'react';
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
	openFile,
	pasteFromClipboardFs,
	renameFile,
	showInFinder,
} from '@/PROCESSING/utils/fileSystemActions';
import { joinPath } from '@/Utils/joinPath';
import { dirname } from '@/Utils/path';
import { useColumnView_Store } from '@/Store/MainWin/useColumnView_store';
import { handleDragOutMouseDown } from '@/Utils/dragOut';

interface CurrentFileItemProps {
	name: string;
	path: string;
	isSelected: boolean;
	isActiveSelection?: boolean;
	isMultiSelected?: boolean;
	onSelect: () => void;
	onMultiSelectToggle?: () => void;
	onMultiSelectRange?: () => void;
	onRenamed?: (oldName: string, newName: string) => void;
}

export function CurrentFileItem({
	name,
	path,
	isSelected,
	isActiveSelection = true,
	isMultiSelected,
	onSelect,
	onMultiSelectToggle,
	onMultiSelectRange,
	onRenamed,
}: CurrentFileItemProps) {
	const { isEditing, startEditing, inputProps } = useEditableField({
		initialValue: name,
		onSave: async (newName) => {
			const parentPath = dirname(path);
			const newPath = joinPath(parentPath, newName);
			await renameFile(path, newPath, onRenamed);
		},
	});

	const listItemRef = useRef<HTMLLIElement>(null);

	// Enter/F2 на выделенном файле — начать переименование
	useKeyboardShortcut({
		key: ['Enter', 'F2'],
		enabled: isSelected,
		skipOnInput: true,
		callback: (e) => {
			e.preventDefault();
			setTimeout(() => startEditing(), 0);
		},
	});

	const menuId = `file-${path}`;
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

	// Вставить рядом (в ту же папку что и файл)
	const handlePaste = async () => {
		const parentPath = dirname(path);
		await pasteFromClipboardFs(parentPath);
	};

	const menuItems = useMenuItems({
		type: 'file',
		onOpen: () => openFile(path),
		onRename: () => {
			handleMenuClose();
			setTimeout(() => startEditing(), 0);
		},
		onCopyPath: () => copyPath(path),
		onShowInFinder: () => showInFinder(path),
		onDelete: () => deleteItem(path),
		onCopy: () => copyToClipboardFs(getMultiPaths()),
		onCut: () => cutToClipboardFs(getMultiPaths()),
		onPaste: handlePaste,
		hasClipboard,
	});

	const { type: detectedType, color: iconColor } = useMemo(() => {
		const fileTypes = typeOfFile_store.getState().patternStore;
		const ext = name.includes('.') ? name.split('.').pop()?.toLowerCase() : '';
		const matchedType = fileTypes.find((t) => t.path.length > 0 && t.path.some((p) => p.toLowerCase() === ext));

		if (!matchedType) return { type: 'other', color: '#838bffff' };

		return {
			type: matchedType.id,
			color: matchedType.color || '#838bffff',
		};
	}, [name]);

	const getIconByType = () => {
		const iconProps = { style: { flexShrink: 0, opacity: isCut ? 0.4 : 1, transition: 'opacity 0.2s ease' }, size: 22, color: iconColor };

		switch (detectedType) {
			case 'video':
				return <FileVideo {...iconProps} />;
			case 'audio':
				return <FileAudio {...iconProps} />;
			case 'image':
				return <FileImage {...iconProps} />;
			case 'text':
				return <FileText {...iconProps} />;
			case 'title':
				return <FileType2 {...iconProps} />;
			case 'xlsx':
				return <FileSpreadsheet {...iconProps} />;
			case 'aep':
				return <FileKey2 {...iconProps} />;
			case 'moho':
				return <FileBadge2 {...iconProps} />;
			case 'folders':
				return <FolderOpenDot {...iconProps} />;
			default:
				return <File {...iconProps} />;
		}
	};

	return (
		<>
			<ListItem
				disablePadding
				ref={listItemRef}
				data-item-path={path}
				onContextMenu={(e) => handleContextMenu(e, isMultiSelected ? undefined : onSelect)}
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
					onDoubleClick={() => openFile(path)}
					dense
					disableRipple
					sx={{
						gap: 1,
						py: 0.3,
						minHeight: 32,
						'&:hover .file-icon': { color: '#007bff' },
					}}
				>
					{getIconByType()}

					{isEditing ? (
						<TextField
							{...inputProps}
							onKeyDown={(e) => {
								inputProps.onKeyDown(e);
								e.stopPropagation();
							}}
							variant='standard'
							size='small'
							onFocus={(e) => e.target.select()}
							sx={{
								flex: 1,
								'& .MuiInputBase-input': { py: 0.2 },
							}}
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
								color: greyColor(80),
								opacity: isCut ? 0.4 : 1,
								cursor: 'pointer',
								transition: 'color 0.2s ease, opacity 0.2s ease',
								'&:hover': { color: '#ffffff' },
							}}
						/>
					)}
				</ListItemButton>
			</ListItem>

			<FileFolderContextMenu
				open={isMenuOpen}
				position={menuPosition}
				onClose={handleMenuClose}
				items={menuItems}
				type='file'
				menuId={menuId}
			/>
		</>
	);
}
