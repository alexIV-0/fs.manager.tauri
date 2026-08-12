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
import { openPreview } from '@/PROCESSING/utils/fileSystemActions';
import { copyToClipboardFs, cutToClipboardFs, pasteFromClipboardFs } from '@/PROCESSING/utils/fileSystemActions';
import { clipboardFs_store } from '@/Store/MainWin/clipboardFs_store';
import { joinPath } from '@/Utils/joinPath';
import { commands, unwrap } from '@/Utils/specta';
import { basename } from '@/Utils/path';
import { reloadFolders } from '@/PROCESSING/reloadFolders';

interface UniversalFolderViewProps {
	type: 'gd' | 'local';
	containerHeight?: string | number;
	onStartResize?: (e: React.MouseEvent) => void;
}

export function UniversalFolderView({ type, containerHeight = '100%', onStartResize }: UniversalFolderViewProps) {
	const { activeMainFolder, activeProjectFolder } = setActiveFolders_store();
	const { instances, openRoot, selectItem, setColumnWidth, toggleMultiSelect, setMultiSelectedPaths, clearMultiSelection } = useColumnView_Store();
	const lastActiveInstance = useColumnView_Store((s) => s.lastActiveInstance);
	const { localFolder } = localFolders_stor();

	const refreshTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
	const pendingChangedPaths = useRef<Set<string>>(new Set());
	// Пути колонок, за которыми сейчас следит watcher (по одному на открытую папку).
	const watchedPaths = useRef<Set<string>>(new Set());
	// Путь, для которого уже пробовали авто-пересборку — чтобы не дёргать её повторно,
	// если папку так и не удалось прочитать (например, корень недоступен).
	const lastHealedPath = useRef<string | null>(null);

	// Получаем данные для конкретного типа
	const instance = instances[type];
	const { columns, loading, error } = instance;

	// ==============================
	// 🔹 Загрузка содержимого при смене папки
	// ==============================
	useEffect(() => {
		const fetchData = async () => {
			// Показывать нечего — панель обязана опустеть, а не сохранять прошлое.
			// Раньше здесь был простой `return`, и содержимое предыдущей папки
			// оставалось на экране под заголовком уже другой папки.
			if (!activeMainFolder || !activeProjectFolder) {
				useColumnView_Store.getState().reset(type);
				return;
			}

			const { mainFolderArr } = mainFolders_stor.getState();
			const mainFolder = mainFolderArr.find((f) => f.id === activeMainFolder);
			if (!mainFolder) {
				useColumnView_Store.getState().reset(type);
				return;
			}

			// Защита от рассинхрона стора: при смене главной папки activeMainFolder обновляется
			// раньше, чем ProjectFolderColumn переставит activeProjectFolder на проект новой папки.
			// В этот момент activeProjectFolder ещё держит имя из ПРЕДЫДУЩЕЙ папки — если построить
			// путь из такой «чужой пары», выйдет несуществующий «новый_путь/чужой_проект» → Invalid
			// directory (а в local-ветке ensureDir ещё и создаст мусорную папку). Не открываем чужую
			// пару: дождёмся, пока выбор переставится на проект текущей папки (эффект перевыполнится).
			if (!mainFolder.projectFolders.includes(activeProjectFolder)) return;

			// Локальная панель без выбранной папки для обработки: очищаем, иначе в ней
			// останется дерево от прошлой главной папки.
			if (type === 'local' && !localFolder) {
				useColumnView_Store.getState().reset('local');
				return;
			}

			if (type === 'gd') {
				const folderPath = joinPath(mainFolder.path, activeProjectFolder);
				await openRoot('gd', folderPath);

				// Авто-пересборка: проект есть в списке, но на диске его уже нет (переименовали/удалили) —
				// openRoot вернул «Invalid directory». Прогоняем reloadFolders (она убирает мёртвое имя
				// из стора+LS mainFolders и из off-списка LS) и переключаемся на живую папку,
				// чтобы оно исчезло из интерфейса и перестало сыпать ошибкой.
				const err = useColumnView_Store.getState().instances.gd.error;
				if (err && /Invalid directory/i.test(err) && lastHealedPath.current !== folderPath) {
					lastHealedPath.current = folderPath;
					try {
						const finalArr = await reloadFolders(mainFolder);
						mainFolders_stor.getState().updateParameters({ id: mainFolder.id, projectFolders: finalArr });
						if (!finalArr.includes(activeProjectFolder)) {
							setActiveFolders_store.getState().setActiveProjectFolder(finalArr[0] ?? null);
						}
					} catch (e) {
						// Сам корень недоступен (нет прав / Google Drive не примонтирован) — лечить нечего.
						console.error('Авто-пересборка списка папок не удалась:', mainFolder.path, e);
					}
				} else if (!err) {
					lastHealedPath.current = null;
				}
			} else if (type === 'local') {
				if (localFolder) {
					const mainFolderName = basename(mainFolder.path);
					const localRootFolderPath = joinPath(localFolder, mainFolderName, activeProjectFolder);
					await openRoot('local', localRootFolderPath, { ensureDir: true });
				}
			}
		};
		fetchData();
	}, [type, localFolder, activeMainFolder, activeProjectFolder]); // openRoot — стабильная функция стора, не нужна в deps

	// Когда активной становится ДРУГАЯ панель (верх↔низ) — снимаем выделение в этой,
	// чтобы Enter/Delete и подсветка относились только к активной панели.
	useEffect(() => {
		if (lastActiveInstance && lastActiveInstance !== type) {
			const inst = useColumnView_Store.getState().instances[type];
			const hasSelection = inst.multiSelectedPaths.length > 0 || inst.columns.some((c) => c.selected);
			if (hasSelection) useColumnView_Store.getState().clearInstanceSelection(type);
		}
	}, [lastActiveInstance, type]);

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
			// Только активная панель реагирует на Delete (иначе удалялось бы
			// «остаточное» выделение и в верхней, и в нижней панели).
			if (state.lastActiveInstance !== type) return;
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

			// Через общий слой: облачный файл сначала скачивается, локальный открывается
			// как раньше. Логика одна на все точки вызова.
			await openPreview(item.path);
		},
	});

	// Подписка на fs-события. Делается один раз на маунт панели — обработчик читает
	// актуальные колонки из стора в момент срабатывания, поэтому колонки в deps не нужны.
	// Накопительный debounce: одно перемещение/копирование папки эмитит десятки
	// fs-событий — собираем их все и в конце обновляем все затронутые колонки
	// (и источник, и приёмник), а не только последний путь.
	useEffect(() => {
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
			unsubscribe();
			if (refreshTimeout.current) clearTimeout(refreshTimeout.current);
		};
	}, [type]);

	// Следим за КАЖДОЙ открытой колонкой по отдельности и НЕ рекурсивно: события
	// приходят только по прямым детям видимых папок, а не по всему дереву под корнем
	// (раньше один рекурсивный watcher на корне ловил лавину событий при синке/глубоких
	// изменениях). При навигации стартуем слежку за новыми путями и снимаем за закрытыми.
	const columnPathsKey = columns.map((c) => c.path).join('\n');
	useEffect(() => {
		const desired = new Set(columns.map((c) => c.path).filter(Boolean));

		// старт для вновь открытых колонок
		desired.forEach((p) => {
			if (!watchedPaths.current.has(p)) {
				commands.fsWatchStart(p, false); // non-recursive — только прямые дети
				watchedPaths.current.add(p);
			}
		});

		// стоп для закрытых (срезанных) колонок
		watchedPaths.current.forEach((p) => {
			if (!desired.has(p)) {
				commands.fsWatchStop(p);
				watchedPaths.current.delete(p);
			}
		});
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [columnPathsKey]);

	// На размонтировании панели — снимаем все наши watcher'ы.
	useEffect(() => {
		return () => {
			watchedPaths.current.forEach((p) => commands.fsWatchStop(p));
			watchedPaths.current.clear();
		};
	}, []);

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
