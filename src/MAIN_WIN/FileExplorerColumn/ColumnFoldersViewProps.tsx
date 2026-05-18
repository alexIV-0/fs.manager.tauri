// ColumnFolderView.tsx
import { Box, List } from '@mui/material';
import { useState, useRef, useEffect } from 'react';
import { greyColor } from '@/Store/Color/grayColor';
import { contentStyle, resizeHandleStyle, resizeHandleStyleBottom, resizeHandleStyleLeft } from '../mainStyles';
import { DraggableFileItem } from './DraggableFileItem';
import { DraggableFolderItem } from './DraggableFolderItem';
import { DroppableColumn } from './DroppableColumn';
import { COLUMN_DEFAULT_WIDTH, useColumnView_Store } from '@/Store/MainWin/useColumnView_store';
import { FileFolderContextMenu } from './ContextMenu/FileFolderContextMenu';
import { useMenuItems } from '../hooks/useMenuItems';
import { clipboardFs_store } from '@/Store/MainWin/clipboardFs_store';
import { createFolder, createTextFile, pasteFromClipboardFs } from '@/PROCESSING/function/utils/fileSystemActions';

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
	const [isHovered, setIsHovered] = useState(false);
	const [externalDropIndex, setExternalDropIndex] = useState<number | null>(null);
	const [emptyMenu, setEmptyMenu] = useState<{ pos: { mouseX: number; mouseY: number }; colPath: string } | null>(null);
	const boxRef = useRef<HTMLDivElement>(null);
	const contentRef = useRef<HTMLDivElement>(null);

	const addItemToColumn = useColumnView_Store((s) => s.addItemToColumn);
	const cbType = clipboardFs_store((s) => s.type);
	const cbPaths = clipboardFs_store((s) => s.paths);
	const hasClipboard = cbType !== null && cbPaths.length > 0;

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

		const columnEl = document.getElementById(`col-${resizingColumnIndex}`);
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

	// ==============================
	// 🔹 Расчет ширины последней колонки
	// ==============================
	const calculateLastColumnWidth = () => {
		if (!contentRef.current || columns.length === 0) return 'auto';
		const containerWidth = contentRef.current.clientWidth;
		const fixedColumnsWidth = columns.slice(0, -1).reduce((total, col) => total + (col.width ?? COLUMN_DEFAULT_WIDTH), 0);
		const availableWidth = containerWidth - fixedColumnsWidth;
		return availableWidth >= minLastColumnWidth ? availableWidth : minLastColumnWidth;
	};

	const needsHorizontalScroll = () => {
		if (!contentRef.current || columns.length === 0) return false;
		const containerWidth = contentRef.current.clientWidth;
		const totalColumnsWidth = columns.reduce((total, col, index) => {
			if (index === columns.length - 1) {
				const lastColWidth = calculateLastColumnWidth();
				return total + (typeof lastColWidth === 'number' ? lastColWidth : minLastColumnWidth);
			}
			return total + (col.width ?? COLUMN_DEFAULT_WIDTH);
		}, 0);
		return totalColumnsWidth > containerWidth;
	};

	const shouldShowHorizontalScroll = needsHorizontalScroll() && isHovered;

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

			{/* Контент с колонками */}
			<Box
				ref={contentRef}
				onMouseEnter={() => setIsHovered(true)}
				onMouseLeave={() => setIsHovered(false)}
				sx={{
					...contentStyle,
					flex: 1,
					display: 'flex',
					overflowX: shouldShowHorizontalScroll ? 'auto' : 'hidden',
					overflowY: 'hidden',
					position: 'relative',
					'&::-webkit-scrollbar': { height: 8 },
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
				{columns.map((col, i) => {
					const isLast = i === columns.length - 1;
					const width = col.width ?? COLUMN_DEFAULT_WIDTH;
					const lastColumnWidth = isLast ? calculateLastColumnWidth() : width;
					const isExternalOver = externalDropIndex === i;

					return (
						<Box
							key={col.path}
							sx={{ display: 'flex', position: 'relative' }}
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
							<DroppableColumn id={`column-${sourceType}-${i}`} path={col.path} source={sourceType}>
								<Box
									id={`col-${i}`}
									sx={{
										display: 'flex',
										flexDirection: 'column',
										width: isLast ? lastColumnWidth : width,
										flexGrow: 0,
										flexShrink: 0,
										minWidth: isLast ? minLastColumnWidth : width,
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
