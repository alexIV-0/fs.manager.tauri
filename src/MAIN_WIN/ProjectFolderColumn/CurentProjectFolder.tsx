// CurentProjectFolder.tsx
import { Box } from '@mui/material';
import { mainBoxStyle } from '../mainStyles';
import { DndContext, DragEndEvent, DragStartEvent, PointerSensor, useSensor, useSensors, DragOverlay } from '@dnd-kit/core';
import { useState, useRef, useEffect } from 'react';
import { DragData } from '../hooks/useDnDContext';
import { greyColor } from '@/Store/Color/grayColor';
import { Plus } from 'lucide-react';
import { useColumnView_Store } from '@/Store/MainWin/useColumnView_store';
import { useColumnFocus_store } from '@/Store/MainWin/columnFocus_store';
import { columnBorder } from '../columnFocusStyle';
import { options_store } from '@/Store/MainWin/options_store';
import { CurrentFileItem } from '../FileExplorerColumn/CurentFileItem';
import { CurentFolderItem } from '../FileExplorerColumn/CurentFolderItem';
import { UniversalFolderView } from '../FileExplorerColumn/UniversalFolderView';
import { joinPath } from '@/Utils/joinPath';
import { invalidateDirCache } from '@/Store/helpers/readDirContent';

export function CurentProjectFolder() {
	const [activeItem, setActiveItem] = useState<{
		name: string;
		path: string;
		type: 'file' | 'folder';
	} | null>(null);

	const [dragIntent, setDragIntent] = useState<'move' | 'copy' | null>(null);
	const [multiDragCount, setMultiDragCount] = useState(1);
	const [isResizingHeight, setIsResizingHeight] = useState(false);

	const gray80 = greyColor(80);
	const gray40 = greyColor(40);

	// ✅ ПРАВИЛЬНО - используем хук в компоненте
	const { refreshAffectedColumns } = useColumnView_Store();
	// Рамка всей 3-й колонки подсвечивается, когда в фокусе любая из её панелей (gd/local)
	const isColumnFocused = useColumnFocus_store((s) => s.focusedColumn === 'gd' || s.focusedColumn === 'local');
	const { optionsObj, updateOptions } = options_store();

	const containerRef = useRef<HTMLDivElement>(null);

	const sensors = useSensors(
		useSensor(PointerSensor, {
			activationConstraint: {
				distance: 5,
			},
		}),
	);

	// ==============================
	// 🔹 Ресайз по высоте
	// ==============================
	const startResizingHeight = (e: React.MouseEvent) => {
		e.preventDefault();
		setIsResizingHeight(true);
	};

	const stopResizingHeight = () => setIsResizingHeight(false);

	const resizeHeight = (e: MouseEvent) => {
		if (!isResizingHeight || !containerRef.current) return;
		const containerRect = containerRef.current.getBoundingClientRect();

		const newHeight = e.clientY - containerRect.top;
		if (newHeight > 100 && newHeight < containerRect.height - 100) {
			updateOptions('gdFolderHeight', newHeight);
		}
	};

	useEffect(() => {
		if (!isResizingHeight) return;

		document.addEventListener('mousemove', resizeHeight);
		document.addEventListener('mouseup', stopResizingHeight);

		return () => {
			document.removeEventListener('mousemove', resizeHeight);
			document.removeEventListener('mouseup', stopResizingHeight);
		};
	}, [isResizingHeight]);

	const handleDragStart = (event: DragStartEvent) => {
		const { active, activatorEvent } = event;
		const dragData = active.data.current as DragData;

		const isShiftPressed = activatorEvent instanceof MouseEvent || activatorEvent instanceof PointerEvent ? activatorEvent.shiftKey : false;

		const intent = isShiftPressed ? 'copy' : 'move';
		const multiSelected = useColumnView_Store.getState().instances[dragData.source].multiSelectedPaths;
		const count = multiSelected.length > 0 && multiSelected.includes(dragData.path) ? multiSelected.length : 1;

		setMultiDragCount(count);
		setDragIntent(intent);
		setActiveItem({
			name: dragData.name,
			path: dragData.path,
			type: dragData.type,
		});
	};

	const handleDragEnd = async (event: DragEndEvent) => {
		const { active, over, activatorEvent } = event;

		console.log('[DnD] dragEnd', { activeId: active?.id, overId: over?.id });

		if (!over) {
			console.warn('[DnD] no drop target — drop ignored');
			resetDragState();
			return;
		}

		const dragData = active.data.current as DragData | undefined;
		const dropData = over.data.current as { targetPath: string; targetSource: 'gd' | 'local' } | undefined;

		// Учитываем актуальное состояние shift на момент отпускания —
		// если пользователь зажал/отпустил shift во время перетаскивания,
		// финальное решение copy vs move берём из текущего события.
		const shiftAtEnd =
			activatorEvent instanceof MouseEvent || activatorEvent instanceof PointerEvent
				? (activatorEvent as MouseEvent).shiftKey
				: false;
		const isCopy = shiftAtEnd || dragIntent === 'copy';

		try {
			if (!dragData) {
				console.warn('[DnD] dragData missing — drop ignored', active);
				return;
			}
			if (!dropData) {
				console.warn('[DnD] dropData missing — drop ignored', over);
				return;
			}

			const storeState = useColumnView_Store.getState();
			const multiSelected = storeState.instances[dragData.source].multiSelectedPaths;
			const isDraggingMultiSelected = multiSelected.length > 0 && multiSelected.includes(dragData.path);

			if (isDraggingMultiSelected) {
				for (const srcPath of multiSelected) {
					const name = srcPath.split(/[\\/]/).pop() ?? '';
					await handleFileOperation({ ...dragData, path: srcPath, name }, dropData, isCopy);
				}
				storeState.clearMultiSelection(dragData.source);
			} else {
				await handleFileOperation(dragData, dropData, isCopy);
			}
		} finally {
			resetDragState();
		}
	};

	const resetDragState = () => {
		setActiveItem(null);
		setDragIntent(null);
		setMultiDragCount(1);
	};

	const handleFileOperation = async (
		dragData: DragData,
		dropData: { targetPath: string; targetSource: 'gd' | 'local' },
		isCopy: boolean,
	) => {
		try {
			// Локальный dirname вместо IPC — устойчив к расхождениям POSIX/UNC
			// и убирает шанс упасть на сетевом таймауте перед самой операцией.
			const lastSep = Math.max(dragData.path.lastIndexOf('/'), dragData.path.lastIndexOf('\\'));
			const fromFolder = lastSep > 0 ? dragData.path.substring(0, lastSep) : dragData.path;

			console.log('[DnD] op', {
				op: isCopy ? 'copy' : 'move',
				from: dragData.path,
				fromFolder,
				to: dropData.targetPath,
				dragSource: dragData.source,
				targetSource: dropData.targetSource,
			});

			// Drop в ту же папку — нечего делать
			if (fromFolder === dropData.targetPath) {
				console.log('[DnD] same folder — skip');
				return;
			}

			const pathTo = joinPath(dropData.targetPath, dragData.name);

			if (isCopy) {
				await window.electronAPI.invoke('copyItem', dragData.path, pathTo, { overwrite: true });
			} else {
				await window.electronAPI.invoke('moveItem', dragData.path, pathTo, { overwrite: true });
			}

			// Сбрасываем кэш для папок, которых коснулась операция —
			// без этого refreshColumn вернёт устаревший cached список и UI не обновится.
			invalidateDirCache(fromFolder);
			invalidateDirCache(dropData.targetPath);

			// Обновляем оба экземпляра (gd и local), т.к. перенос мог быть между ними.
			refreshAffectedColumns('gd', [fromFolder, dropData.targetPath]);
			refreshAffectedColumns('local', [fromFolder, dropData.targetPath]);
		} catch (error) {
			console.error('❌ Ошибка при операции с файлом:', error);
		}
	};

	const gdHeight = optionsObj.gdFolderHeight || 300;

	return (
		<DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
			<Box
				ref={containerRef}
				sx={{
					...mainBoxStyle,
					flex: 1,
					// Рамка меняет цвет, когда фокус на gd/local (см. columnFocusStyle.ts)
					border: columnBorder(isColumnFocused),
					// Сдвиг на -1px: схлопываем стык с колонкой проектов в одну линию.
					ml: '-1px',
					zIndex: isColumnFocused ? 2 : 1,
					overflow: 'hidden',
					cursor: activeItem ? 'grabbing' : 'default',
					display: 'flex',
					flexDirection: 'column',
					position: 'relative',
				}}
			>
				{/* GD панель с фиксированной высотой */}
				<Box sx={{ height: gdHeight, flexShrink: 0 }}>
					<UniversalFolderView type='gd' containerHeight='100%' onStartResize={startResizingHeight} />
				</Box>

				{/* Ресайз хендл */}
				<Box
					sx={{
						height: '6px',
						backgroundColor: isResizingHeight ? 'primary.main' : 'transparent',
						cursor: 'row-resize',
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'center',
						position: 'relative',
						flexShrink: 0,
						'&:hover': {
							backgroundColor: 'primary.main',
						},
						'&::before': {
							content: '""',
							position: 'absolute',
							top: '2px',
							bottom: '-10px',
							left: 0,
							right: 0,
							zIndex: 1,
						},
					}}
					onMouseDown={startResizingHeight}
				/>

				{/* Local панель занимает оставшуюся высоту */}
				<Box sx={{ flex: 1, minHeight: 0 }}>
					<UniversalFolderView type='local' containerHeight='100%' />
				</Box>
			</Box>

			<DragOverlay
				style={{
					pointerEvents: 'none',
					cursor: 'grabbing',
				}}
			>
				{activeItem ? (
					<Box
						sx={{
							position: 'relative',
							opacity: 0.8,
							transform: 'scale(1.05)',
							backgroundColor: 'background.paper',
							borderRadius: 1.5,
							overflow: 'visible',
							border: dragIntent === 'copy' ? `2px solid ${gray80}` : `2px dashed ${gray80}`,
						}}
					>
						{dragIntent === 'copy' && (
							<Box
								sx={{
									position: 'absolute',
									top: 0,
									right: 0,
									width: 25,
									height: 25,
									borderRadius: '50%',
									backgroundColor: gray40,
									display: 'flex',
									alignItems: 'center',
									justifyContent: 'center',
									zIndex: 2147483647,
									transform: 'translate(50%, -50%)',
								}}
							>
								<Plus size={20} strokeWidth={3} />
							</Box>
						)}
						{multiDragCount > 1 && (
							<Box
								sx={{
									position: 'absolute',
									top: 0,
									left: 0,
									minWidth: 20,
									height: 20,
									px: 0.5,
									borderRadius: '10px',
									backgroundColor: '#1976d2',
									display: 'flex',
									alignItems: 'center',
									justifyContent: 'center',
									zIndex: 2147483647,
									transform: 'translate(-40%, -40%)',
									fontSize: 11,
									fontWeight: 700,
									color: 'white',
									lineHeight: 1,
								}}
							>
								{multiDragCount}
							</Box>
						)}

						{activeItem.type === 'folder' ? (
							<CurentFolderItem name={activeItem.name} path={activeItem.path} isSelected={false} onSelect={() => {}} />
						) : (
							<CurrentFileItem name={activeItem.name} path={activeItem.path} isSelected={false} onSelect={() => {}} />
						)}
					</Box>
				) : null}
			</DragOverlay>
		</DndContext>
	);
}
