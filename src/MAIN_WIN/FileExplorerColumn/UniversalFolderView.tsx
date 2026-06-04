// components/columnViewFolder/UniversalFolderView.tsx
import { setActiveFolders_store } from '@/Store/MainWin/activeFolder_store';
import { localFolders_stor } from '@/Store/MainWin/localFolders_store';
import { mainFolders_stor } from '@/Store/MainWin/mainFolders_store';
import { Box, Button, Typography } from '@mui/material';
import { useEffect, useRef } from 'react';
import { useKeyboardShortcut } from '@/hooks/useKeyboardShortcut';
import { ColumnFolderView } from './ColumnFoldersViewProps';

import { useColumnView_Store } from '@/Store/MainWin/useColumnView_store';
import { invalidateDirCache } from '@/Store/helpers/readDirContent';
import { TopPanelLocal } from './TopPanelLocal';
import { TopPanelGD } from './TopPanelGD';
import { deleteItemWithTrimColumns } from '@/PROCESSING/utils/deleteIteWithTrimColumn';
import { copyToClipboardFs, cutToClipboardFs, pasteFromClipboardFs } from '@/PROCESSING/utils/fileSystemActions';
import { clipboardFs_store } from '@/Store/MainWin/clipboardFs_store';
import { joinPath } from '@/Utils/joinPath';
import { commands, unwrap } from '@/Utils/specta';
import { basename } from '@/Utils/path';

interface UniversalFolderViewProps {
	type: 'gd' | 'local';
	containerHeight?: string | number;
	onStartResize?: (e: React.MouseEvent) => void;
}

export function UniversalFolderView({ type, containerHeight = '100%', onStartResize }: UniversalFolderViewProps) {
	const { activeMainFolder, activeProjectFolder } = setActiveFolders_store();
	const { instances, openRoot, selectItem, setColumnWidth, toggleMultiSelect, setMultiSelectedPaths, clearMultiSelection } = useColumnView_Store();
	const { localFolder } = localFolders_stor();

	const refreshTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
	const pendingChangedPaths = useRef<Set<string>>(new Set());

	// Получаем данные для конкретного типа
	const instance = instances[type];
	const { columns, loading, error } = instance;

	// ==============================
	// 🔹 Загрузка содержимого при смене папки
	// ==============================
	useEffect(() => {
		const fetchData = async () => {
			if (!activeMainFolder || !activeProjectFolder) return;

			const t0 = performance.now();

			if (type === 'gd') {
				const { mainFolderArr } = mainFolders_stor.getState();
				const mainFolder = mainFolderArr.find((f) => f.id === activeMainFolder);
				if (mainFolder) {
					const folderPath = joinPath(mainFolder.path, activeProjectFolder);
					await openRoot('gd', folderPath);
				}
			} else if (type === 'local') {
				const { mainFolderArr } = mainFolders_stor.getState();
				const mainFolder = mainFolderArr.find((f) => f.id === activeMainFolder);

				if (localFolder && mainFolder) {
					const mainFolderName = basename(mainFolder.path);
					const localRootFolderPath = joinPath(localFolder, mainFolderName, activeProjectFolder);

					await openRoot('local', localRootFolderPath, { ensureDir: true });
				}
			}

			// console.log(`[perf] openRoot(${type}): ${(performance.now() - t0).toFixed(1)}ms`);
		};
		fetchData();
	}, [type, localFolder, activeMainFolder, activeProjectFolder]); // openRoot — стабильная функция стора, не нужна в deps

	// ==============================
	// 🔹 Хендлеры мультивыбора
	// ==============================
	const handleMultiSelectToggle = (colIndex: number, item: any) => {
		toggleMultiSelect(type, colIndex, item.path);
	};

	const handleMultiSelectRange = (colIndex: number, item: any, colItems: any[]) => {
		const anchor = useColumnView_Store.getState().instances[type].multiSelectAnchor;
		// Диапазон только в пределах одной колонки
		if (!anchor || anchor.colIndex !== colIndex) {
			// нет anchor в этой колонке — просто добавляем как toggle
			toggleMultiSelect(type, colIndex, item.path);
			return;
		}

		const allPaths = colItems.map((i: any) => i.path);
		const fromIdx = allPaths.indexOf(anchor.path);
		const toIdx = allPaths.indexOf(item.path);
		if (fromIdx === -1 || toIdx === -1) return;

		const start = Math.min(fromIdx, toIdx);
		const end = Math.max(fromIdx, toIdx);
		const rangePaths = allPaths.slice(start, end + 1);
		setMultiSelectedPaths(type, rangePaths, anchor);
	};

	// Cmd/Ctrl+C — копировать в буфер
	useKeyboardShortcut({
		key: 'c',
		modifiers: { ctrlOrMeta: true },
		skipOnInput: true,
		callback: (e) => {
			const state = useColumnView_Store.getState();
			if (state.lastActiveInstance !== type) return;
			e.preventDefault();
			const { multiSelectedPaths } = state.instances[type];
			const paths = multiSelectedPaths.length > 0 ? multiSelectedPaths : state.lastSelectedItem ? [state.lastSelectedItem.item.path] : [];
			if (paths.length > 0) copyToClipboardFs(paths);
		},
	});

	// Cmd/Ctrl+X — вырезать в буфер
	useKeyboardShortcut({
		key: 'x',
		modifiers: { ctrlOrMeta: true },
		skipOnInput: true,
		callback: (e) => {
			const state = useColumnView_Store.getState();
			if (state.lastActiveInstance !== type) return;
			e.preventDefault();
			const { multiSelectedPaths } = state.instances[type];
			const paths = multiSelectedPaths.length > 0 ? multiSelectedPaths : state.lastSelectedItem ? [state.lastSelectedItem.item.path] : [];
			if (paths.length > 0) cutToClipboardFs(paths);
		},
	});

	// Cmd/Ctrl+V — вставить в последнюю открытую колонку
	useKeyboardShortcut({
		key: 'v',
		modifiers: { ctrlOrMeta: true },
		skipOnInput: true,
		callback: async (e) => {
			const state = useColumnView_Store.getState();
			if (state.lastActiveInstance !== type) return;
			e.preventDefault();
			const cols = state.instances[type].columns;
			if (cols.length === 0) return;
			const pasteTarget = state.activeColumnPath && cols.some((c) => c.path === state.activeColumnPath) ? state.activeColumnPath : cols[cols.length - 1].path;
			await pasteFromClipboardFs(pasteTarget);
		},
	});

	// Escape — отмена операции cut
	useKeyboardShortcut({
		key: 'Escape',
		skipOnInput: true,
		callback: () => {
			const state = useColumnView_Store.getState();
			if (state.lastActiveInstance !== type) return;
			clipboardFs_store.getState().clear();
		},
	});

	// Delete — удаление выделенного файла/папки
	useKeyboardShortcut({
		key: 'Delete',
		skipOnInput: true,
		callback: async () => {
			const state = useColumnView_Store.getState();
			const { multiSelectedPaths } = state.instances[type];

			if (multiSelectedPaths.length > 0) {
				for (const path of multiSelectedPaths) {
					await deleteItemWithTrimColumns(path);
				}
				clearMultiSelection(type);
				return;
			}

			const { lastSelectedItem } = state;
			if (!lastSelectedItem) return;
			await deleteItemWithTrimColumns(lastSelectedItem.item.path);
		},
	});

	// Space — превью файла (как Quick Look в macOS)
	useKeyboardShortcut({
		key: ' ',
		skipOnInput: true,
		callback: async (e) => {
			const state = useColumnView_Store.getState();
			const { lastSelectedItem } = state;
			if (!lastSelectedItem) return;

			const myColumns = state.instances[type].columns;
			const belongsHere = myColumns.some((col) => lastSelectedItem.item.path.startsWith(col.path));
			if (!belongsHere) return;

			const item = lastSelectedItem.item;
			if (item.isDir) return;

			e.preventDefault();

			const fileType = await commands.getFileTypeByExtname(item.path.split('.').pop() || '');
			unwrap(await commands.previewOpen(JSON.stringify({ filePath: item.path, fileType })));
		},
	});

	// Запускаем watcher когда знаем корневой путь колонки
	useEffect(() => {
		const rootCol = instance.columns[0];
		if (!rootCol?.path) return;

		const rootPath = rootCol.path;

		// Стартуем слежку (типизированный specta-биндинг; fire-and-forget как раньше)
		commands.fsWatchStart(rootPath);

		// Подписываемся на изменения. Накопительный debounce:
		// одно перемещение/копирование папки эмитит десятки fs-событий —
		// собираем их все и в конце обновляем все затронутые колонки
		// (и источник, и приёмник), а не только последний путь.
		const unsubscribe = window.tauriAPI.onFsChanged((changedPath: string) => {
			if (!changedPath) return;
			pendingChangedPaths.current.add(changedPath);

			if (refreshTimeout.current) clearTimeout(refreshTimeout.current);

			refreshTimeout.current = setTimeout(() => {
				const changedPaths = Array.from(pendingChangedPaths.current);
				pendingChangedPaths.current.clear();

				const { instances } = useColumnView_Store.getState();
				const cols = instances[type].columns;
				cols.forEach((col, index) => {
					const affected = changedPaths.some((p) => p.startsWith(col.path) || col.path.startsWith(p));
					if (affected) {
						invalidateDirCache(col.path);
						useColumnView_Store.getState().refreshColumn(type, index);
					}
				});
			}, 300);
		});

		return () => {
			// При размонтировании — останавливаем watcher и отписываемся
			commands.fsWatchStop(rootPath);
			unsubscribe();
		};
	}, [instance.columns[0]?.path, type]);

	// ==============================
	// 🔹 Обработчик выбора папки для local
	// ==============================
	const handleSelectFolder = async () => {
		try {
			const folderPaths = unwrap(await commands.selectFolders({ multiSelect: false }));
			if (folderPaths && Array.isArray(folderPaths) && folderPaths.length > 0) {
				localFolders_stor.getState().updateLocalFolder(folderPaths[0]);
			}
		} catch (error) {
			console.error('Ошибка при выборе папок:', error);
		}
	};

	// ==============================
	// 🔹 Обработчики для колонок
	// ==============================
	const handleSelectItem = (colIndex: number, item: any) => {
		selectItem(type, colIndex, item);
	};

	const handleSetColumnWidth = (index: number, width: number) => {
		setColumnWidth(type, index, width);
	};

	// ==============================
	// 🔹 Рендер для local без выбранной папки
	// ==============================
	if (type === 'local' && !localFolder) {
		return (
			<Box
				sx={{
					display: 'flex',
					flexDirection: 'column',
					alignItems: 'center',
					justifyContent: 'center',
					height: '100%',
					gap: 2,
					p: 2,
				}}
			>
				<Typography variant='h6' align='center'>
					Выберите локальную папку.
					<br />
					В неё создасться такая же структура (главная папка/имя проекта).
					<br />
					И в неё будут копироваться все найденные файлы
					<br />и будет происходить вся обработка
				</Typography>
				<Button variant='contained' onClick={handleSelectFolder}>
					Выбрать папку
				</Button>
			</Box>
		);
	}

	if (!activeMainFolder || !activeProjectFolder) {
		return null;
	}

	// ==============================
	// 🔹 Рендер основного контента
	// ==============================
	return (
		<Box sx={{ height: containerHeight, display: 'flex', flexDirection: 'column' }}>
			<ColumnFolderView
				columns={columns}
				selectItem={handleSelectItem}
				setColumnWidth={handleSetColumnWidth}
				containerHeight='100%'
				bottomResizeHandle={type === 'gd'}
				startResizingHeight={onStartResize}
				multiSelectedPaths={instance.multiSelectedPaths}
				onMultiSelectToggle={handleMultiSelectToggle}
				onMultiSelectRange={handleMultiSelectRange}
				topPanel={type === 'gd' ? <TopPanelGD /> : <TopPanelLocal />}
				sourceType={type}
			/>
		</Box>
	);
}
