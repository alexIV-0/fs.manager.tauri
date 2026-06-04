import { mainFolders_stor } from '@/Store/MainWin/mainFolders_store';
import { commands, unwrap } from '@/Utils/specta';
import { options_store } from '@/Store/MainWin/options_store';
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { restrictToParentElement } from '@dnd-kit/modifiers';
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Box, Button, IconButton, List } from '@mui/material';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { setActiveFolders_store } from '@/Store/MainWin/activeFolder_store';
import { useColumnFocus_store } from '@/Store/MainWin/columnFocus_store';
import { useKeyboardShortcut } from '@/hooks/useKeyboardShortcut';
import { columnBorder } from '../columnFocusStyle';
import { isScanningStore } from '@/Store/MainWin/isScaning_store';

import { FolderItem } from './FolderItem';
import { SortableItem } from './SortableItem';
import {
	mainBoxStyle,
	topButtonStyle,
	topShadowStyle,
	listStyle,
	automationListStyle,
	bottomBoxStyle,
	bottomShadowStyle,
	resizeHandleStyle,
	resizeHandleStyleLeft,
} from '../mainStyles';

export function MainFolderColumn() {
	const { optionsObj, updateOptions } = options_store();
	const { isScanning } = isScanningStore();
	const { mainFolderArr, moveFolderInMainArr, addFolderToMainArr, updateParameters } = mainFolders_stor();

	const [onOffVal, setOnOffVal] = useState(true);
	const [sortMode, setSortMode] = useState<'asc' | 'desc' | 'manual'>('manual');
	const [isResizing, setIsResizing] = useState(false);
	const [activeFolderId, setActiveFolderId] = useState<string | null>(null);
	const [scrollToFolderId, setScrollToFolderId] = useState<string | null>(null);

	const getBasename = (p: string) => p.replace(/\\/g, '/').split('/').pop() || p;

	const displayedFolders =
		sortMode === 'asc'
			? [...mainFolderArr].sort((a, b) => getBasename(a.path).localeCompare(getBasename(b.path)))
			: sortMode === 'desc'
				? [...mainFolderArr].sort((a, b) => getBasename(b.path).localeCompare(getBasename(a.path)))
				: mainFolderArr;

	const cycleSortMode = () => {
		setSortMode((prev) => (prev === 'manual' ? 'asc' : prev === 'asc' ? 'desc' : 'manual'));
	};
	const { activeMainFolder, activeProjectFolder, setActiveProjectFolder, setMainFolderId } = setActiveFolders_store();
	const boxRef = useRef<HTMLDivElement>(null);

	// ==============================
	// 🔹 Навигация с клавиатуры (когда фокус на главной колонке)
	// ==============================
	const isFocused = () => useColumnFocus_store.getState().focusedColumn === 'main';
	const isColumnFocused = useColumnFocus_store((s) => s.focusedColumn === 'main');

	const moveMainSelection = (delta: number) => {
		if (displayedFolders.length === 0) return;
		const curIdx = displayedFolders.findIndex((f) => f.id === activeMainFolder);
		const nextIdx = curIdx === -1 ? 0 : Math.min(displayedFolders.length - 1, Math.max(0, curIdx + delta));
		const next = displayedFolders[nextIdx];
		setMainFolderId(next.id);
		setActiveFolders_store.getState().setScrollToMainFolder(next.id);
	};

	useKeyboardShortcut({
		key: 'ArrowDown',
		skipOnInput: true,
		callback: (e) => {
			if ((e as any).__navHandled || !isFocused()) return;
			e.preventDefault();
			(e as any).__navHandled = true;
			moveMainSelection(1);
		},
	});

	useKeyboardShortcut({
		key: 'ArrowUp',
		skipOnInput: true,
		callback: (e) => {
			if ((e as any).__navHandled || !isFocused()) return;
			e.preventDefault();
			(e as any).__navHandled = true;
			moveMainSelection(-1);
		},
	});

	useKeyboardShortcut({
		key: 'ArrowRight',
		skipOnInput: true,
		callback: (e) => {
			if ((e as any).__navHandled || !isFocused()) return;
			e.preventDefault();
			(e as any).__navHandled = true;
			useColumnFocus_store.getState().setFocusedColumn('project');
		},
	});

	const sensors = useSensors(
		useSensor(PointerSensor, {
			activationConstraint: {
				distance: 5, // 👈 drag активируется только после движения на 5px
			},
		}),
		useSensor(KeyboardSensor, {
			coordinateGetter: sortableKeyboardCoordinates,
		}),
	);

	const handleFolderClick = (id: string) => {
		setActiveFolderId(id);
		setScrollToFolderId(id);
	};

	const onOffAllAutomation = () => {
		mainFolderArr.forEach((folder: any) => {
			updateParameters({ id: folder.id, active: onOffVal });
		});
		setOnOffVal(!onOffVal);
	};

	// const openOptions = () => {
	//     setOpen(true);
	// };

	// const handleClose = () => {
	//     setOpen(false);
	// };

	const addNewFolder = async () => {
		try {
			const folderPaths = unwrap(await commands.selectFolders({ multiSelect: true }));
			if (folderPaths && Array.isArray(folderPaths) && folderPaths.length > 0) {
				for (const folderPath of folderPaths) {
					addFolderToMainArr(folderPath);
				}

				const batch = unwrap(await commands.listSubfolders(folderPaths)) as unknown as Record<string, string[]>;

				const { mainFolderArr, updateParameters } = mainFolders_stor.getState();
				for (const folderPath of folderPaths) {
					const foldersArr = (batch?.[folderPath] ?? []).slice();
					foldersArr.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
					const newMain = mainFolderArr.find((f) => f.path === folderPath);
					if (newMain) {
						updateParameters({ id: newMain.id, projectFolders: foldersArr });
					}
				}

				const latest = mainFolders_stor.getState().mainFolderArr;
				setMainFolderId(latest[latest.length - 1].id);
			}
		} catch (error) {
			console.error('Ошибка при выборе папок:', error);
		}
	};

	const handleDragEnd = (event: any) => {
		const { active, over } = event;
		if (!over || active.id === over.id) return;

		if (sortMode !== 'manual') {
			const oldIndex = displayedFolders.findIndex((f) => f.id === active.id);
			const newIndex = displayedFolders.findIndex((f) => f.id === over.id);
			if (oldIndex === -1 || newIndex === -1) return;
			const updated = [...displayedFolders];
			const [moved] = updated.splice(oldIndex, 1);
			updated.splice(newIndex, 0, moved);
			setSortMode('manual');
			mainFolders_stor.setState({ mainFolderArr: updated });
		} else {
			const oldIndex = mainFolderArr.findIndex((folder) => folder.id === active.id);
			const newIndex = mainFolderArr.findIndex((folder) => folder.id === over.id);
			moveFolderInMainArr(oldIndex, newIndex);
		}
	};

	const startResizing = (e: React.MouseEvent) => {
		e.preventDefault();
		setIsResizing(true);
	};

	const stopResizing = () => {
		setIsResizing(false);
	};

	const resize = (e: MouseEvent) => {
		if (!isResizing || !boxRef.current) return;
		const newWidth = e.clientX - boxRef.current.getBoundingClientRect().left;
		if (newWidth > 100) {
			updateOptions('mainFolderWidth', newWidth);
		}
	};

	useEffect(() => {
		if (isResizing) {
			document.addEventListener('mousemove', resize);
			document.addEventListener('mouseup', stopResizing);
		} else {
			document.removeEventListener('mousemove', resize);
			document.removeEventListener('mouseup', stopResizing);
		}
		return () => {
			document.removeEventListener('mousemove', resize);
			document.removeEventListener('mouseup', stopResizing);
		};
	}, [isResizing]);

	return (
		<Box
			ref={boxRef}
			onMouseDown={() => useColumnFocus_store.getState().setFocusedColumn('main')}
			sx={{
				...mainBoxStyle,
				width: optionsObj.mainFolderWidth,
				// Рамка меняет цвет, когда колонка в фокусе (см. columnFocusStyle.ts)
				border: columnBorder(isColumnFocused),
				// Фокусная колонка рисуется поверх соседних, чтобы её голубая рамка
				// перекрывала серую рамку соседа на стыке (колонки сдвинуты на -1px).
				zIndex: isColumnFocused ? 2 : 1,
				// pointerEvents: isScanning ? 'none' : 'auto',
			}}
		>
			<Box sx={{ ...bottomBoxStyle, ...topShadowStyle, display: 'flex', flexDirection: 'row' }}>
				<Button fullWidth onClick={onOffAllAutomation} sx={topButtonStyle}>
					on/off all
				</Button>
				<IconButton sx={{ p: 0, margin: '0 10px' }} size='small' onClick={cycleSortMode} disabled={isScanning}>
					{sortMode === 'manual' ? (
						<Box component='span' sx={{ fontSize: '13px', fontWeight: 'bold', lineHeight: 1, userSelect: 'none' }}>
							M
						</Box>
					) : sortMode === 'asc' ? (
						<ChevronDown size={20} />
					) : (
						<ChevronUp size={20} />
					)}
				</IconButton>
			</Box>

			<Box sx={listStyle}>
				<DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd} modifiers={[restrictToParentElement]}>
					<SortableContext items={displayedFolders} strategy={verticalListSortingStrategy}>
						<List disablePadding sx={automationListStyle}>
							{displayedFolders.map((folder) => (
								<SortableItem key={folder.id} id={folder.id}>
									<FolderItem obj={folder} isActive={folder.id === activeMainFolder} />
								</SortableItem>
							))}
						</List>
					</SortableContext>
				</DndContext>
			</Box>

			<Box sx={{ ...bottomBoxStyle, ...bottomShadowStyle }}>
				<Button fullWidth onClick={addNewFolder} sx={{ p: 0 }} disabled={isScanning}>
					import main folder
				</Button>
			</Box>
			<Box sx={{ ...resizeHandleStyle, ...resizeHandleStyleLeft }} onMouseDown={startResizing} />
		</Box>
	);
}
