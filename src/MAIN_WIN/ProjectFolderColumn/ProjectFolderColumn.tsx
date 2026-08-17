import { isScanningStore } from '@/Store/MainWin/isScaning_store';
import { mainFolders_stor } from '@/Store/MainWin/mainFolders_store';
import { options_store } from '@/Store/MainWin/options_store';
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { restrictToParentElement } from '@dnd-kit/modifiers';
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Box, Button, IconButton, List } from '@mui/material';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { FolderItem } from '../MainFolderColumn/FolderItem';
import { SortableItem } from '../MainFolderColumn/SortableItem';
import {
	automationListStyle,
	bottomBoxStyle,
	bottomShadowStyle,
	listStyle,
	mainBoxStyle,
	resizeHandleStyle,
	resizeHandleStyleLeft,
	topButtonStyle,
	topShadowFor,
} from '../mainStyles';
import { setActiveFolders_store } from '@/Store/MainWin/activeFolder_store';
import { persistEnabled } from '@/Utils/folderState';
import { setProjectPaused, ensureDir } from '@/Utils/storageSeam';
import { useColumnFocus_store } from '@/Store/MainWin/columnFocus_store';
import { useColumnView_Store } from '@/Store/MainWin/useColumnView_store';
import { useKeyboardShortcut } from '@/hooks/useKeyboardShortcut';
import { columnBorder } from '../columnFocusStyle';
import { useActiveFolderIsOnline } from '../hooks/useActiveFolderIsOnline';
import { ProjectFolderItem } from './ProjectFolderItem';
import { getUniqueFolderName } from '@/Utils/getUniqueFolderName';
import { saveToLocalStorage } from '@/Utils/loadSaveToLS';
import { joinPath } from '@/Utils/joinPath';
import { commands, unwrap } from '@/Utils/specta';

export function ProjectFolderColumn() {
	const { optionsObj, updateOptions } = options_store();
	const { isScanning } = isScanningStore();
	const { mainFolderArr, moveFolderInMainArr, addFolderToMainArr, updateParameters } = mainFolders_stor();
	const { activeMainFolder, activeProjectFolder, setMainFolderId } = setActiveFolders_store();

	const [onOffVal, setOnOffVal] = useState(true);
	const [onOffRefreshKey, setOnOffRefreshKey] = useState(0);
	const [sortMode, setSortMode] = useState<'asc' | 'desc' | 'manual'>('manual');
	const [activeFolderArr, setActiveFolderArr] = useState<string[]>([]);

	const [isResizing, setIsResizing] = useState(false);
	// const [activeFolderId, setActiveFolderId] = useState<string | null>(null);
	// const [scrollToFolderId, setScrollToFolderId] = useState<string | null>(null);
	const boxRef = useRef<HTMLDivElement>(null);
	const isOnlineFolder = useActiveFolderIsOnline();

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

	// const handleFolderClick = (id: string) => {
	// 	setActiveFolderId(id);
	// 	setScrollToFolderId(id);
	// };


	const displayedFolders =
		sortMode === 'asc'
			? [...activeFolderArr].sort((a, b) => a.localeCompare(b))
			: sortMode === 'desc'
				? [...activeFolderArr].sort((a, b) => b.localeCompare(a))
				: activeFolderArr;

	const cycleSortMode = () => {
		setSortMode((prev) => (prev === 'manual' ? 'asc' : prev === 'asc' ? 'desc' : 'manual'));
	};

	// ==============================
	// 🔹 Навигация с клавиатуры (когда фокус на колонке проектов)
	// ==============================
	const isFocused = () => useColumnFocus_store.getState().focusedColumn === 'project';
	const isColumnFocused = useColumnFocus_store((s) => s.focusedColumn === 'project');

	const moveProjectSelection = (delta: number) => {
		if (displayedFolders.length === 0) return;
		const curIdx = displayedFolders.indexOf(activeProjectFolder || '');
		const nextIdx = curIdx === -1 ? 0 : Math.min(displayedFolders.length - 1, Math.max(0, curIdx + delta));
		const next = displayedFolders[nextIdx];
		setActiveFolders_store.getState().setActiveProjectFolder(next);
		setActiveFolders_store.getState().setScrollToProjectFolder(next);
	};

	useKeyboardShortcut({
		key: 'ArrowDown',
		skipOnInput: true,
		callback: (e) => {
			if ((e as any).__navHandled || !isFocused()) return;
			e.preventDefault();
			(e as any).__navHandled = true;
			moveProjectSelection(1);
		},
	});

	useKeyboardShortcut({
		key: 'ArrowUp',
		skipOnInput: true,
		callback: (e) => {
			if ((e as any).__navHandled || !isFocused()) return;
			e.preventDefault();
			(e as any).__navHandled = true;
			moveProjectSelection(-1);
		},
	});

	useKeyboardShortcut({
		key: 'ArrowLeft',
		skipOnInput: true,
		callback: (e) => {
			if ((e as any).__navHandled || !isFocused()) return;
			e.preventDefault();
			(e as any).__navHandled = true;
			useColumnFocus_store.getState().setFocusedColumn('main');
		},
	});

	useKeyboardShortcut({
		key: 'ArrowRight',
		skipOnInput: true,
		callback: (e) => {
			if ((e as any).__navHandled || !isFocused()) return;
			e.preventDefault();
			(e as any).__navHandled = true;
			useColumnView_Store.getState().focusInstance('gd');
		},
	});

	// Enter — переименование выбранной проектной папки
	useKeyboardShortcut({
		key: 'Enter',
		skipOnInput: true,
		callback: (e) => {
			if ((e as any).__navHandled || !isFocused() || !activeProjectFolder) return;
			e.preventDefault();
			(e as any).__navHandled = true;
			setActiveFolders_store.getState().setRenameProjectRequest(activeProjectFolder);
		},
	});

	const onOffAllAutomation = () => {
		const main = mainFolderArr.find((f) => f.id === activeMainFolder);
		const allFoldersArr: string[] = main?.projectFolders || [];
		// `onOffVal === true` означает «сейчас всё включено», то есть нажатие ВЫКЛючает.
		const enabling = onOffVal === true ? false : true;

		saveToLocalStorage(activeMainFolder || '', enabling ? [] : allFoldersArr);
		setOnOffVal(!onOffVal);
		setOnOffRefreshKey((k) => k + 1);

		// Раньше кнопка писала ТОЛЬКО LocalStorage — ни в каталог, ни в сайдкар. То есть
		// массовое включение/выключение не видел ни сайт, ни другая машина, а следующий
		// `/projects` возвращал прежние значения и «отменял» нажатие. Одиночный тумблер
		// это делал, массовый — нет: разница, которую никто не замечал.
		if (!main?.path) return;
		for (const name of allFoldersArr) {
			persistEnabled(main.id, name, enabling, 'manual');
		}
		if (!main.online) return;

		// По проекту за раз, последовательно: пачка параллельных запросов к бэкенду на
		// двадцати проектах ничего не ускорит, а лимиты подёргает.
		void (async () => {
			for (const name of allFoldersArr) {
				try {
					await setProjectPaused(joinPath(main.path, name), !enabling);
				} catch (err) {
					console.error('[ON/OFF ALL] каталог отказал:', name, err);
					window.alert(`Не удалось переключить «${name}» в облаке.\n\n${String(err)}`);
					return; // одна ошибка — дальше молотить бессмысленно
				}
			}
		})();
	};

	const addNewFolder = async () => {
		// тут будем просто добавлять новую папку в текущую main, т.е. создавать новую со всей структурой что для настройки
		const activeMain = mainFolderArr.find((f) => f.id === activeMainFolder);
		if (!activeMain) return;
		const allFoldersArr: any = unwrap(await commands.getSomeFromFolder(activeMain.path, [{ type: 'folders', ext: [] }]));

		const newFolderName = getUniqueFolderName('newFolder', allFoldersArr.folders);
		if (!activeMain) return;
		const newPath = joinPath(activeMain.path, newFolderName);
		// Через шов: в зеркале папка проекта обязана появиться в каталоге, иначе на
		// сайте её нет и переименовать/удалить её через API нельзя.
		await ensureDir(newPath);
		updateParameters({
			id: activeMain.id,
			projectFolders: [...activeMain.projectFolders, newFolderName],
		});
	};

	const handleDragEnd = (event: any) => {
		const { active, over } = event;
		if (!over || active.id === over.id) return;

		const activeMain = mainFolderArr.find((f) => f.id === activeMainFolder);
		if (!activeMain) return;

		const sourceArr = sortMode !== 'manual' ? displayedFolders : activeMain.projectFolders;
		const oldIndex = sourceArr.findIndex((name: string) => name === active.id);
		const newIndex = sourceArr.findIndex((name: string) => name === over.id);

		if (oldIndex === -1 || newIndex === -1) return;

		const updated = [...sourceArr];
		const [moved] = updated.splice(oldIndex, 1);
		updated.splice(newIndex, 0, moved);

		if (sortMode !== 'manual') setSortMode('manual');

		updateParameters({
			id: activeMain.id,
			projectFolders: updated,
		});
	};

	const startResizing = (e: React.MouseEvent) => {
		e.preventDefault();
		setIsResizing(true);
	};

	useEffect(() => {
		if (!isResizing) return;

		const onMove = (e: MouseEvent) => {
			if (!boxRef.current) return;
			const newWidth = e.clientX - boxRef.current.getBoundingClientRect().left;
			if (newWidth > 100) {
				updateOptions('projectFolderWidth', newWidth);
			}
		};

		const onUp = () => setIsResizing(false);

		document.addEventListener('mousemove', onMove);
		document.addEventListener('mouseup', onUp);

		return () => {
			document.removeEventListener('mousemove', onMove);
			document.removeEventListener('mouseup', onUp);
		};
	}, [isResizing]);

	useEffect(() => {
		const folders = mainFolderArr.find((f) => f.id === activeMainFolder)?.projectFolders || [];
		setActiveFolderArr(folders);

		const current = setActiveFolders_store.getState().activeProjectFolder;
		// Выбор сохраняем, если он принадлежит ЭТОЙ главной папке. Раньше эффект
		// безусловно ставил folders[0], а зависит он от всего `mainFolderArr` — любая
		// правка стора (галочка, пересборка списка проектов) сбрасывала выбор на
		// первый проект, и третья колонка не следовала за кликом.
		if (current && folders.includes(current)) return;

		// Иначе выбор чужой или устарел. `null` при пустом списке обязателен: иначе
		// в силе остаётся имя проекта от ПРЕДЫДУЩЕЙ главной папки, третья колонка
		// не проходит проверку «проект принадлежит папке» и продолжает показывать
		// содержимое прошлой папки — ровно то, что выглядит как «выбор не работает».
		setActiveFolders_store.getState().setActiveProjectFolder(folders[0] ?? null);
	}, [activeMainFolder, mainFolderArr]);

	return (
		<Box
			ref={boxRef}
			onMouseDown={() => useColumnFocus_store.getState().setFocusedColumn('project')}
			sx={{
				...mainBoxStyle,
				width: optionsObj.projectFolderWidth,
				// Рамка меняет цвет, когда колонка в фокусе (см. columnFocusStyle.ts)
				border: columnBorder(isColumnFocused),
				// Сдвиг на -1px: левая рамка накладывается на правую рамку соседней
				// колонки → на стыке одна линия вместо двух.
				ml: '-1px',
				zIndex: isColumnFocused ? 2 : 1,
				// pointerEvents: isScanning ? 'none' : 'auto',
			}}
		>
			<Box
				sx={{
					...bottomBoxStyle,
					...topShadowFor(isOnlineFolder),
					display: 'flex',
					flexDirection: 'row',
				}}
			>
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
				<DndContext
					sensors={sensors}
					collisionDetection={closestCenter}
					onDragEnd={handleDragEnd}
					modifiers={[restrictToParentElement]}
				>
					<SortableContext items={displayedFolders} strategy={verticalListSortingStrategy}>
						<List disablePadding sx={automationListStyle}>
							{displayedFolders.map((folder) => (
								<SortableItem key={folder} id={folder}>
									<ProjectFolderItem
										name={folder}
										isActive={folder === activeProjectFolder}
										refreshKey={onOffRefreshKey}
									/>
								</SortableItem>
							))}
						</List>
					</SortableContext>
				</DndContext>
			</Box>

			<Box sx={{ ...bottomBoxStyle, ...bottomShadowStyle }}>
				<Button fullWidth onClick={addNewFolder} sx={{ p: 0 }} disabled={isScanning}>
					add new folder
				</Button>
			</Box>
			<Box
				sx={{
					...resizeHandleStyle,
					...resizeHandleStyleLeft,
				}}
				onMouseDown={startResizing}
			/>
		</Box>
	);
}
