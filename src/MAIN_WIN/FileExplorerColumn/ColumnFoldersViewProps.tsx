// ColumnFolderView.tsx
import { Box, List } from '@mui/material';
import { useState, useRef, useEffect, useCallback } from 'react';
import { useKeyboardShortcut } from '@/hooks/useKeyboardShortcut';
import { greyColor } from '@/Store/Color/grayColor';
import { contentStyle, resizeHandleStyle, resizeHandleStyleBottom, resizeHandleStyleLeft } from '../mainStyles';
import { DraggableFileItem } from './DraggableFileItem';
import { DraggableFolderItem } from './DraggableFolderItem';
import { DroppableColumn } from './DroppableColumn';
import { COLUMN_DEFAULT_WIDTH, useColumnView_Store } from '@/Store/MainWin/useColumnView_store';
import { useColumnFocus_store } from '@/Store/MainWin/columnFocus_store';
import { FileFolderContextMenu } from './ContextMenu/FileFolderContextMenu';
import { useMenuItems } from '../hooks/useMenuItems';
import { clipboardFs_store } from '@/Store/MainWin/clipboardFs_store';
import { createFolder, createTextFile, pasteFromClipboardFs } from '@/PROCESSING/utils/fileSystemActions';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';

interface ColumnFolderViewProps {
	columns: any[];
	selectItem: (colIndex: number, item: any) => void;
	setColumnWidth: (colIndex: number, width: number) => void;
	minLastColumnWidth?: number;
	topPanel?: React.ReactNode;
	bottomResizeHandle?: boolean;
	containerHeight?: number | string;
	startResizingHeight?: (e: React.MouseEvent) => void;
	sourceType: 'gd' | 'local';
	multiSelectedPaths?: string[];
	onMultiSelectToggle?: (colIndex: number, item: any) => void;
	onMultiSelectRange?: (colIndex: number, item: any, colItems: any[]) => void;
}

export function ColumnFolderView({
	columns,
	selectItem,
	setColumnWidth,
	topPanel,
	bottomResizeHandle = false,
	minLastColumnWidth = 200,
	containerHeight = '100%',
	startResizingHeight,
	sourceType,
	multiSelectedPaths = [],
	onMultiSelectToggle,
	onMultiSelectRange,
}: ColumnFolderViewProps) {
	const [resizingColumnIndex, setResizingColumnIndex] = useState<number | null>(null);
	const [externalDropIndex, setExternalDropIndex] = useState<number | null>(null);
	const [emptyMenu, setEmptyMenu] = useState<{ pos: { mouseX: number; mouseY: number }; colPath: string } | null>(null);
	const boxRef = useRef<HTMLDivElement>(null);
	const contentRef = useRef<HTMLDivElement>(null);

	// ── Rubber band (marquee) selection ───────────────────────────────────────
	type RbState = { colIndex: number; startX: number; startY: number };
	const rbState = useRef<RbState | null>(null);
	const [rbRect, setRbRect] = useState<{ colIndex: number; left: number; top: number; width: number; height: number } | null>(null);

	const handleRbMouseDown = useCallback((e: React.MouseEvent, colIndex: number) => {
		if (e.button !== 0) return;
		// Клик в любом месте панели делает её фокусной колонкой (в т.ч. по пустому месту).
		useColumnFocus_store.getState().setFocusedColumn(sourceType);
		if ((e.target as Element).closest('[data-item-path]')) return;
		e.preventDefault();
		rbState.current = { colIndex, startX: e.clientX, startY: e.clientY };
	}, [sourceType]);

	useEffect(() => {
		const onMove = (e: MouseEvent) => {
			if (!rbState.current) return;
			const { startX, startY, colIndex } = rbState.current;
			const curX = Math.max(0, Math.min(e.clientX, window.innerWidth));
			const curY = Math.max(0, Math.min(e.clientY, window.innerHeight));
			setRbRect({
				colIndex,
				left: Math.min(startX, curX),
				top: Math.min(startY, curY),
				width: Math.abs(curX - startX),
				height: Math.abs(curY - startY),
			});
		};

		const onUp = (e: MouseEvent) => {
			if (!rbState.current) return;
			const { startX, startY, colIndex } = rbState.current;
			rbState.current = null;
			setRbRect(null);

			const minX = Math.min(startX, e.clientX);
			const minY = Math.min(startY, e.clientY);
			const maxX = Math.max(startX, e.clientX);
			const maxY = Math.max(startY, e.clientY);
			if (maxX - minX < 4 && maxY - minY < 4) return;

			const colEl = document.getElementById(`col-${sourceType}-${colIndex}`);
			if (!colEl) return;
			const selected: string[] = [];
			colEl.querySelectorAll('[data-item-path]').forEach((el) => {
				const itemPath = (el as HTMLElement).dataset.itemPath;
				if (!itemPath) return;
				const r = el.getBoundingClientRect();
				if (r.top < maxY && r.bottom > minY && r.left < maxX && r.right > minX) {
					selected.push(itemPath);
				}
			});
			if (selected.length > 0) {
				useColumnView_Store.getState().setMultiSelectedPaths(sourceType, selected, { colIndex, path: selected[0] });
			}
		};

		window.addEventListener('mousemove', onMove);
		window.addEventListener('mouseup', onUp);
		return () => {
			window.removeEventListener('mousemove', onMove);
			window.removeEventListener('mouseup', onUp);
		};
	}, [sourceType]);

	const addItemToColumn = useColumnView_Store((s) => s.addItemToColumn);
	const focusedColumn = useColumnFocus_store((s) => s.focusedColumn);
	const lastSelectedColIndex = useColumnView_Store((s) => s.lastSelectedItem?.colIndex ?? -1);
	const multiAnchorColIndex = useColumnView_Store((s) => s.instances[sourceType].multiSelectAnchor?.colIndex ?? -1);
	const cbType = clipboardFs_store((s) => s.type);
	const cbPaths = clipboardFs_store((s) => s.paths);
	const hasClipboard = cbType !== null && cbPaths.length > 0;

	// ── Tauri native drag-drop из Finder/Explorer ────────────────────────────
	// HTML5 onDrop в WebView НЕ получает File.path (это было Electron-only).
	// Tauri перехватывает файловые drops на нативном уровне и эмитит события
	// `tauri://drag-drop` с реальными путями. По позиции дропа находим элемент
	// и читаем колонку из data-source/data-col-index.
	useEffect(() => {
		const win = getCurrentWebviewWindow();
		let unlisten: (() => void) | undefined;

		const findColumnIndexAt = (x: number, y: number): number | null => {
			// Tauri DragDrop positions are PhysicalPosition (device pixels).
			// getBoundingClientRect returns logical (CSS) pixels.
			// We try divided-by-DPR first, then raw (in case Tauri already sends logical).
			const ratio = window.devicePixelRatio || 1;
			const cols = document.querySelectorAll(`[id^="col-${sourceType}-"]`);
			if (cols.length === 0) return null;

			for (const divisor of [ratio, 1]) {
				const lx = x / divisor;
				const ly = y / divisor;
				for (const col of cols) {
					const r = col.getBoundingClientRect();
					if (lx >= r.left && lx <= r.right && ly >= r.top && ly <= r.bottom) {
						const m = col.id.match(/^col-[^-]+-(\d+)$/);
						if (m) return Number(m[1]);
					}
				}
			}
			return null;
		};

		win.onDragDropEvent(async (event) => {
			const payload = event.payload as any;
			const type = payload?.type;
			console.log(`[DragDrop:${sourceType}] event:`, type, payload);
			if (type === 'enter' || type === 'over') {
				const { x, y } = payload.position ?? {};
				const idx = typeof x === 'number' && typeof y === 'number' ? findColumnIndexAt(x, y) : null;
				setExternalDropIndex(idx);
				return;
			}
			if (type === 'leave') {
				setExternalDropIndex(null);
				return;
			}
			if (type === 'drop') {
				setExternalDropIndex(null);
				const paths: string[] = Array.isArray(payload.paths) ? payload.paths : [];
				if (paths.length === 0) return;
				const { x, y } = payload.position ?? {};
				const ratio = window.devicePixelRatio || 1;
				const cols = document.querySelectorAll(`[id^="col-${sourceType}-"]`);
				console.log(`[DragDrop:${sourceType} drop] pos:`, x, y, 'dpr:', ratio, 'cols found:', cols.length);
				cols.forEach((c) => {
					const r = c.getBoundingClientRect();
					console.log('  col', c.id, 'rect:', r.left, r.top, r.right, r.bottom);
				});
				const idx = typeof x === 'number' && typeof y === 'number' ? findColumnIndexAt(x, y) : null;
				console.log(`[DragDrop:${sourceType} drop] idx:`, idx, 'columns.length:', columns.length, 'paths:', paths);
				if (idx === null || idx >= columns.length) return;

				const col = columns[idx];
				for (const filePath of paths) {
					try {
						const name = (await window.electronAPI.invoke('pathBasename', filePath)) as string;
						const info: any = await window.electronAPI.invoke('getFileInfo', filePath).catch(() => null);
						const destPath = (await window.electronAPI.invoke('pathJoin', col.path, name)) as string;

						addItemToColumn(sourceType, idx, {
							name,
							path: destPath,
							isDir: Boolean(info?.isDirectory),
						});

						await window.electronAPI.invoke('copyItem', filePath, destPath, { overwrite: false });
					} catch (error) {
						console.error('❌ Ошибка при копировании внешнего файла:', filePath, error);
					}
				}
			}
		}).then((u) => {
			unlisten = u;
		});

		return () => {
			unlisten?.();
		};
	}, [columns, sourceType, addItemToColumn]);

	const emptyMenuItems = useMenuItems({
		type: 'empty',
		onCreateFolder: () => {
			if (emptyMenu) createFolder(emptyMenu.colPath);
			setEmptyMenu(null);
		},
		onCreateTextFile: () => {
			if (emptyMenu) createTextFile(emptyMenu.colPath);
			setEmptyMenu(null);
		},
		onPaste: () => {
			if (emptyMenu) pasteFromClipboardFs(emptyMenu.colPath);
			setEmptyMenu(null);
		},
		hasClipboard,
	});

	// ==============================
	// 🔹 Ресайз по ширине конкретной колонки
	// ==============================
	const startResizingColumn = (index: number, e: React.MouseEvent) => {
		e.preventDefault();
		setResizingColumnIndex(index);
	};

	const stopResizingColumn = () => setResizingColumnIndex(null);

	const resizeColumn = (e: MouseEvent) => {
		if (resizingColumnIndex === null) return;

		const columnEl = document.getElementById(`col-${sourceType}-${resizingColumnIndex}`);
		if (!columnEl) return;

		const rect = columnEl.getBoundingClientRect();
		const newWidth = e.clientX - rect.left;

		if (newWidth > 100 && newWidth < 800) {
			setColumnWidth(resizingColumnIndex, newWidth);
		}
	};

	useEffect(() => {
		if (resizingColumnIndex !== null) {
			document.addEventListener('mousemove', resizeColumn);
			document.addEventListener('mouseup', stopResizingColumn);
		}
		return () => {
			document.removeEventListener('mousemove', resizeColumn);
			document.removeEventListener('mouseup', stopResizingColumn);
		};
	}, [resizingColumnIndex]);



	// Auto-scroll to the rightmost column whenever a new one is added
	useEffect(() => {
		if (contentRef.current) {
			contentRef.current.scrollLeft = contentRef.current.scrollWidth;
		}
	}, [columns.length]);

	// ── Keyboard navigation ───────────────────────────────────────────────────
	const scrollItemIntoView = (path: string) => {
		setTimeout(() => {
			const els = document.querySelectorAll<HTMLElement>('[data-item-path]');
			for (const el of els) {
				if (el.dataset.itemPath === path) {
					el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
					break;
				}
			}
		}, 30);
	};

	// Один и тот же KeyboardEvent приходит во все window-слушатели. Когда обработчик
	// меняет фокусную колонку (граничный переход), слушатель соседней колонки на том
	// же нажатии не должен сработать повторно — помечаем событие флагом.
	const navHandled = (e: KeyboardEvent) => (e as any).__navHandled === true;
	const markNav = (e: KeyboardEvent) => {
		(e as any).__navHandled = true;
	};

	useKeyboardShortcut({
		key: 'ArrowUp',
		skipOnInput: true,
		callback: (e) => {
			if (navHandled(e)) return;
			if (useColumnFocus_store.getState().focusedColumn !== sourceType) return;
			const state = useColumnView_Store.getState();
			const { lastSelectedItem } = state;
			if (!lastSelectedItem) return;
			const { colIndex, item } = lastSelectedItem;
			const col = state.instances[sourceType].columns[colIndex];
			if (!col) return;
			const idx = col.items.findIndex((i: any) => i.path === item.path);
			if (idx <= 0) {
				// В самом верху local — уходим в низ корневой колонки gd.
				if (sourceType === 'local') {
					const gdRoot = state.instances.gd.columns[0];
					const last = gdRoot?.items?.[gdRoot.items.length - 1];
					if (last) {
						e.preventDefault();
						markNav(e);
						state.selectItem('gd', 0, last);
						scrollItemIntoView(last.path);
					}
				}
				return;
			}
			e.preventDefault();
			markNav(e);
			selectItem(colIndex, col.items[idx - 1]);
			scrollItemIntoView(col.items[idx - 1].path);
		},
	});

	useKeyboardShortcut({
		key: 'ArrowDown',
		skipOnInput: true,
		callback: (e) => {
			if (navHandled(e)) return;
			if (useColumnFocus_store.getState().focusedColumn !== sourceType) return;
			const state = useColumnView_Store.getState();
			const { lastSelectedItem } = state;
			if (!lastSelectedItem) return;
			const { colIndex, item } = lastSelectedItem;
			const col = state.instances[sourceType].columns[colIndex];
			if (!col) return;
			const idx = col.items.findIndex((i: any) => i.path === item.path);
			if (idx === -1) return;
			if (idx >= col.items.length - 1) {
				// В самом низу gd — уходим в первую колонку local (первый элемент).
				if (sourceType === 'gd') {
					const localRoot = state.instances.local.columns[0];
					const first = localRoot?.items?.[0];
					if (first) {
						e.preventDefault();
						markNav(e);
						state.selectItem('local', 0, first);
						scrollItemIntoView(first.path);
					}
				}
				return;
			}
			e.preventDefault();
			markNav(e);
			selectItem(colIndex, col.items[idx + 1]);
			scrollItemIntoView(col.items[idx + 1].path);
		},
	});

	useKeyboardShortcut({
		key: 'ArrowRight',
		skipOnInput: true,
		callback: (e) => {
			if (navHandled(e)) return;
			if (useColumnFocus_store.getState().focusedColumn !== sourceType) return;
			const state = useColumnView_Store.getState();
			const { lastSelectedItem } = state;
			if (!lastSelectedItem) return;
			const { colIndex, item } = lastSelectedItem;
			if (!item.isDir) return;
			e.preventDefault();
			markNav(e);
			const cols = state.instances[sourceType].columns;
			if (cols.length > colIndex + 1) {
				const nextCol = cols[colIndex + 1];
				if (nextCol.items.length > 0) {
					selectItem(colIndex + 1, nextCol.items[0]);
					scrollItemIntoView(nextCol.items[0].path);
				}
			} else {
				selectItem(colIndex, item);
			}
		},
	});

	useKeyboardShortcut({
		key: 'ArrowLeft',
		skipOnInput: true,
		callback: (e) => {
			if (navHandled(e)) return;
			if (useColumnFocus_store.getState().focusedColumn !== sourceType) return;
			const state = useColumnView_Store.getState();
			const { lastSelectedItem } = state;
			if (!lastSelectedItem) return;
			const { colIndex } = lastSelectedItem;
			if (colIndex === 0) {
				// Левее корневой колонки содержимого — переходим в колонку проектов.
				e.preventDefault();
				markNav(e);
				useColumnFocus_store.getState().setFocusedColumn('project');
				return;
			}
			e.preventDefault();
			markNav(e);
			const cols = state.instances[sourceType].columns;
			const prevCol = cols[colIndex - 1];
			const prevItem = prevCol?.items.find((i: any) => i.name === prevCol.selected) ?? prevCol?.items[0];
			useColumnView_Store.setState((s) => ({
				lastActiveInstance: sourceType,
				lastSelectedItem: prevItem ? { colIndex: colIndex - 1, item: prevItem } : s.lastSelectedItem,
				instances: {
					...s.instances,
					[sourceType]: {
						...s.instances[sourceType],
						columns: cols.slice(0, colIndex),
					},
				},
			}));
		},
	});

	return (
		<Box
			ref={boxRef}
			sx={{
				display: 'flex',
				flexDirection: 'column',
				position: 'relative',
				borderBottom: `1px solid ${greyColor(80)}`,
				height: containerHeight,
			}}
		>
			{topPanel}

			{/* Rubber band overlay (position: fixed → не зависит от scroll) */}
			{rbRect && (
				<Box
					sx={{
						position: 'fixed',
						pointerEvents: 'none',
						zIndex: 9999,
						left: rbRect.left,
						top: rbRect.top,
						width: rbRect.width,
						height: rbRect.height,
						backgroundColor: 'rgba(0, 123, 255, 0.08)',
						border: '1px solid rgba(0, 123, 255, 0.45)',
						borderRadius: '2px',
					}}
				/>
			)}

			{/* Контент с колонками */}
			<Box
				ref={contentRef}
				sx={{
					...contentStyle,
					flex: 1,
					display: 'flex',
					overflowX: 'auto',
					overflowY: 'hidden',
					position: 'relative',
					'&::-webkit-scrollbar': { height: 8 },
					'&::-webkit-scrollbar-track': { background: 'transparent' },
					'&::-webkit-scrollbar-thumb': {
						backgroundColor: 'rgba(255,255,255,0.15)',
						borderRadius: 4,
					},
					'&:hover::-webkit-scrollbar-thumb': {
						backgroundColor: 'rgba(255,255,255,0.4)',
					},
				}}
			>
				{columns.map((col, i) => {
					const isLast = i === columns.length - 1;
					const width = col.width ?? COLUMN_DEFAULT_WIDTH;
					const isExternalOver = externalDropIndex === i;

					return (
						<Box
							key={col.path}
							sx={{ display: 'flex', position: 'relative', ...(isLast && { flex: 1, minWidth: minLastColumnWidth }) }}
							onDragOver={(e: React.DragEvent) => {
								if (!e.dataTransfer.types.includes('Files')) return;
								e.preventDefault();
								e.dataTransfer.dropEffect = 'copy';
								setExternalDropIndex(i);
							}}
							onDragLeave={(e: React.DragEvent) => {
								if (!e.currentTarget.contains(e.relatedTarget as Node)) {
									setExternalDropIndex(null);
								}
							}}
							onDrop={async (e: React.DragEvent) => {
								if (!e.dataTransfer.types.includes('Files')) return;
								e.preventDefault();
								setExternalDropIndex(null);

								const files = Array.from(e.dataTransfer.files);
								if (files.length === 0) return;

								for (const file of files) {
									try {
										const filePath = window.electronAPI.getPathForFile(file);
										if (!filePath) continue;
										const destPath = (await window.electronAPI.invoke('pathJoin', col.path, file.name)) as string;

										// Оптимистично добавляем в UI сразу
										const isDir = !file.type && !file.name.includes('.');
										addItemToColumn(sourceType, i, {
											name: file.name,
											path: destPath,
											isDir,
										});

										// Копируем в фоне
										await window.electronAPI.invoke('copyItem', filePath, destPath, { overwrite: false });
									} catch (error) {
										console.error('❌ Ошибка при копировании:', file.name, error);
									}
								}
							}}
						>
							{/* Droppable Column */}
							<DroppableColumn id={`column-${sourceType}-${i}`} path={col.path} source={sourceType} sx={isLast ? { flex: 1 } : undefined}>
								<Box
									id={`col-${sourceType}-${i}`}
									sx={{
										display: 'flex',
										flexDirection: 'column',
										...(isLast ? { flex: 1, minWidth: minLastColumnWidth } : { width, flexGrow: 0, flexShrink: 0, minWidth: width }),
										borderRight: isLast ? 'none' : `1px solid ${greyColor(50)}`,
										overflow: 'hidden',
										height: '100%',
										...(isLast && {
											'& .MuiListItemText-primary': {
												overflow: 'hidden',
												textOverflow: 'ellipsis',
												whiteSpace: 'nowrap',
											},
										}),
									}}
								>
									<Box
										onMouseDown={(e) => handleRbMouseDown(e, i)}
										onContextMenu={(e) => {
											// Показываем меню пустого места только если клик не попал на элемент списка
											if ((e.target as HTMLElement).closest('.MuiListItem-root')) return;
											e.preventDefault();
											e.stopPropagation();
											setEmptyMenu({
												pos: { mouseX: e.clientX + 2, mouseY: e.clientY - 6 },
												colPath: col.path,
											});
										}}
										sx={{
											flex: 1,
											minHeight: 0,
											display: 'flex',
											flexDirection: 'column',
											overflowY: 'auto',
											overflowX: 'hidden',
											'&::-webkit-scrollbar': { width: 8 },
											'&::-webkit-scrollbar-track': { background: 'transparent' },
											'&::-webkit-scrollbar-thumb': {
												backgroundColor: 'rgba(255,255,255,0)',
												borderRadius: 4,
											},
											'&:hover::-webkit-scrollbar-thumb': {
												backgroundColor: 'rgba(255,255,255,0.3)',
											},
											'&:active::-webkit-scrollbar-thumb': {
												backgroundColor: 'rgba(255,255,255,0.5)',
											},
										}}
									>
										{/* Папки */}
										<List dense disablePadding>
											{col.items
												.filter((item: { isDir: any }) => item.isDir)
												.map((item: any) => (
													<DraggableFolderItem
														key={item.path}
														name={item.name}
														path={item.path}
														isSelected={col.selected === item.name}
														isActiveSelection={
															sourceType === focusedColumn &&
															i === (multiSelectedPaths.length > 0 ? multiAnchorColIndex : lastSelectedColIndex)
														}
														isMultiSelected={multiSelectedPaths.includes(item.path)}
														onSelect={() => selectItem(i, item)}
														onMultiSelectToggle={() => onMultiSelectToggle?.(i, item)}
														onMultiSelectRange={() => onMultiSelectRange?.(i, item, col.items)}
														source={sourceType}
														columnIndex={i}
													/>
												))}
										</List>

										{/* Файлы */}
										<List dense disablePadding>
											{col.items
												.filter((item: { isDir: any }) => !item.isDir)
												.map((item: any) => (
													<DraggableFileItem
														key={item.path}
														name={item.name}
														path={item.path}
														isSelected={col.selected === item.name}
														isActiveSelection={
															sourceType === focusedColumn &&
															i === (multiSelectedPaths.length > 0 ? multiAnchorColIndex : lastSelectedColIndex)
														}
														isMultiSelected={multiSelectedPaths.includes(item.path)}
														onSelect={() => selectItem(i, item)}
														onMultiSelectToggle={() => onMultiSelectToggle?.(i, item)}
														onMultiSelectRange={() => onMultiSelectRange?.(i, item, col.items)}
														source={sourceType}
														columnIndex={i}
													/>
												))}
										</List>
									</Box>
								</Box>
							</DroppableColumn>

							{/* Визуальный индикатор внешнего drop */}
							{isExternalOver && (
								<Box
									sx={{
										position: 'absolute',
										top: 0,
										left: 0,
										right: 0,
										bottom: 0,
										// border: '2px solid #4caf50',
										backgroundColor: 'rgba(76, 175, 80, 0.05)',
										borderRadius: 1,
										pointerEvents: 'none',
										zIndex: 10,
										boxSizing: 'border-box',
									}}
								/>
							)}

							{/* Ручка ресайза справа */}
							{!isLast && (
								<Box
									sx={{
										...resizeHandleStyle,
										...resizeHandleStyleLeft,
										position: 'absolute',
										top: 0,
										bottom: 0,
										right: -3,
										zIndex: 100,
									}}
									onMouseDown={(e) => startResizingColumn(i, e)}
								/>
							)}
						</Box>
					);
				})}
			</Box>

			{bottomResizeHandle && <Box sx={{ ...resizeHandleStyle, ...resizeHandleStyleBottom }} onMouseDown={startResizingHeight} />}

			{/* Контекстное меню пустого места */}
			<FileFolderContextMenu
				menuId='column-empty-menu'
				type='folder'
				open={emptyMenu !== null}
				position={emptyMenu?.pos ?? null}
				onClose={() => setEmptyMenu(null)}
				items={emptyMenuItems}
			/>
		</Box>
	);
}
