import { mainFolders_stor } from '@/Store/MainWin/mainFolders_store';
import { commands, unwrap } from '@/Utils/specta';
import { options_store } from '@/Store/MainWin/options_store';
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { restrictToParentElement } from '@dnd-kit/modifiers';
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Box, Button, IconButton, InputBase, List, Tooltip } from '@mui/material';
import { ChevronDown, ChevronUp, Cloud, Search, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { setActiveFolders_store } from '@/Store/MainWin/activeFolder_store';
import { useColumnFocus_store } from '@/Store/MainWin/columnFocus_store';
import { useKeyboardShortcut } from '@/hooks/useKeyboardShortcut';
import { columnBorder } from '../columnFocusStyle';
import { isScanningStore } from '@/Store/MainWin/isScaning_store';

import { storage_store } from '@/Store/MainWin/storage_store';
import { AddOnlineFolderDialog } from '../Storage/AddOnlineFolderDialog';
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
	const [filter, setFilter] = useState('');
	const [addOnlineOpen, setAddOnlineOpen] = useState(false);

	const getBasename = (p: string) => p.replace(/\\/g, '/').split('/').pop() || p;

	// Фильтр по колонке. Именно по колонке, а не по всему хранилищу: кросс-проектный
	// поиск уже есть в отдельной модалке, и дублировать его тут значит сделать
	// непонятными оба.
	const matches = (name: string) => !filter.trim() || name.toLowerCase().includes(filter.trim().toLowerCase());

	const sortedFolders =
		sortMode === 'asc'
			? [...mainFolderArr].sort((a, b) => getBasename(a.path).localeCompare(getBasename(b.path)))
			: sortMode === 'desc'
				? [...mainFolderArr].sort((a, b) => getBasename(b.path).localeCompare(getBasename(a.path)))
				: mainFolderArr;

	const displayedFolders = sortedFolders.filter((f) => matches(getBasename(f.path)));

	const cycleSortMode = () => {
		setSortMode((prev) => (prev === 'manual' ? 'asc' : prev === 'asc' ? 'desc' : 'manual'));
	};
	const { activeMainFolder, activeProjectFolder, setActiveProjectFolder, setMainFolderId } = setActiveFolders_store();
	const boxRef = useRef<HTMLDivElement>(null);

	// Хранилище подключено — значит кнопку «добавить онлайн папку» есть смысл
	// показывать. Отдельной секции для облачных папок нет: они лежат в общем
	// списке и ведут себя как все остальные, отличаясь только значком.
	const storageStatus = storage_store((s) => s.status);

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
				// Отсекаем уже добавленные пути — одну и ту же папку нельзя держать в списке дважды.
				const norm = (p: string) => p.replace(/\/+$/, '');
				const existing = new Set(mainFolders_stor.getState().mainFolderArr.map((f) => norm(f.path)));
				const newPaths = folderPaths.filter((p) => !existing.has(norm(p)));
				const skipped = folderPaths.length - newPaths.length;
				if (skipped > 0) {
					console.warn(`Пропущено уже добавленных папок: ${skipped} из ${folderPaths.length}`);
				}
				if (newPaths.length === 0) return;

				for (const folderPath of newPaths) {
					addFolderToMainArr(folderPath);
				}

				const batch = unwrap(await commands.listSubfolders(newPaths)) as unknown as Record<string, string[]>;

				const { mainFolderArr, updateParameters } = mainFolders_stor.getState();
				for (const folderPath of newPaths) {
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

			<InputBase
				value={filter}
				onChange={(e) => setFilter(e.target.value)}
				placeholder='фильтр'
				startAdornment={<Search size={12} strokeWidth={1} style={{ opacity: 0.4, marginRight: 4 }} />}
				endAdornment={
					filter ? (
						<X
							size={12}
							strokeWidth={1}
							style={{ opacity: 0.5, cursor: 'pointer' }}
							onClick={() => setFilter('')}
						/>
					) : null
				}
				sx={{ px: 1, py: '1px', fontSize: 12, borderBottom: '1px solid', borderColor: 'divider' }}
			/>

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

			{/* Две кнопки добавления одинаковой ширины. Отдельной кнопки обновления
			    здесь нет намеренно: у каждой папки своя, на строке при наведении, и
			    для облачной она заодно обновляет каталог.

			    Без подключённого хранилища облачной кнопки нет совсем (раньше висела
			    погашенной): тому, кто облаком не пользуется, она не объясняет ничего,
			    а «+ папка» при этом занимает всю ширину. */}
			<Box sx={{ ...bottomBoxStyle, ...bottomShadowStyle, display: 'flex', alignItems: 'center' }}>
				<Tooltip title='Добавить локальную папку с диска' placement='top' arrow>
					<span style={{ flex: 1, display: 'flex' }}>
						<Button onClick={addNewFolder} sx={{ p: 0, flex: 1, minWidth: 0 }} disabled={isScanning}>
							+ папка
						</Button>
					</span>
				</Tooltip>

				{storageStatus.connected && (
					<Tooltip title='Добавить папку из облака' placement='top' arrow>
						<span style={{ flex: 1, display: 'flex' }}>
							<Button
								onClick={() => setAddOnlineOpen(true)}
								sx={{ p: 0, flex: 1, minWidth: 0 }}
								disabled={isScanning}
								startIcon={<Cloud size={13} strokeWidth={1} />}
							>
								+ из облака
							</Button>
						</span>
					</Tooltip>
				)}
			</Box>

			<AddOnlineFolderDialog open={addOnlineOpen} onClose={() => setAddOnlineOpen(false)} />
			<Box sx={{ ...resizeHandleStyle, ...resizeHandleStyleLeft }} onMouseDown={startResizing} />
		</Box>
	);
}
