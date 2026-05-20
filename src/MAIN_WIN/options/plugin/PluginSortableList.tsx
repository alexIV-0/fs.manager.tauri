import React, { useMemo } from 'react';
import {
	DndContext,
	closestCenter,
	KeyboardSensor,
	PointerSensor,
	useSensor,
	useSensors,
	DragEndEvent,
	DragStartEvent,
	DragMoveEvent,
} from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Box, IconButton, List } from '@mui/material';
import { plugin_Store } from '@/Store/MainWin/plugin_store';
import { Plus } from 'lucide-react';

import { MyStyledSearch } from '@/MAIN_WIN/Universal/MyStyledSearch';
import { defGray, greyColor } from '@/Store/Color/grayColor';
import { AppUpdaterAccordion } from './AppUpdaterAccordion';
import { useStore } from 'zustand';

import { PluginSortableGroup } from './PluginSortableGroup';

export const PluginSortableList: React.FC = () => {
	// Реактивное состояние
	const plugins = useStore(plugin_Store, (state) => state.plugins);
	const searchQuery = useStore(plugin_Store, (state) => state.searchQuery);
	const isLoading = useStore(plugin_Store, (state) => state.isLoading);

	// Получаем методы из стора
	const { setSearchQuery, movePluginGroup, getFilteredGroups, addOrUpdatePlugin } = plugin_Store();

	// Получаем отфильтрованные группы
	const filteredGroups = useMemo(() => {
		// console.log('[PluginSortableList] Recalculating filtered groups:', {
		// 	pluginsCount: plugins.length,
		// 	searchQuery,
		// 	groupsCount: getFilteredGroups().length,
		// });
		return getFilteredGroups();
	}, [plugins, searchQuery, getFilteredGroups]);

	// ID групп для SortableContext
	const groupIds = useMemo(() => {
		const ids = filteredGroups.map((group) => group.id);
		// console.log('[PluginSortableList] Group IDs for SortableContext:', ids);
		return ids;
	}, [filteredGroups]);

	// Настройка сенсоров для DnD
	const sensors = useSensors(
		useSensor(PointerSensor, {
			activationConstraint: {
				distance: 1, // Уменьшил с 5 до 1 для теста
			},
		}),
		useSensor(KeyboardSensor, {
			coordinateGetter: sortableKeyboardCoordinates,
		}),
	);

	// Обработчик начала перетаскивания
	const handleDragStart = (event: DragStartEvent) => {
		// console.log('[DnD] Drag started:', {
		// 	activeId: event.active.id,
		// 	activeData: event.active.data.current,
		// });
	};

	// Обработчик процесса перетаскивания
	const handleDragMove = (event: DragMoveEvent) => {
		// console.log('[DnD] Dragging:', {
		// 	activeId: event.active.id,
		// 	overId: event.over?.id,
		// });
	};

	// Обработчик окончания перетаскивания
	const handleDragEnd = (event: DragEndEvent) => {
		// console.log('[DnD] Drag ended:', {
		// 	activeId: event.active.id,
		// 	overId: event.over?.id,
		// 	delta: event.delta,
		// });

		const { active, over } = event;

		if (!over) {
			// console.log('[DnD] No target - drag cancelled');
			return;
		}

		if (active.id === over.id) {
			// console.log('[DnD] Same target - no movement');
			return;
		}

		// console.log('[DnD] Attempting to move group:', {
		// 	fromId: active.id,
		// 	toId: over.id,
		// });

		const oldIndex = filteredGroups.findIndex((group) => group.id === active.id);
		const newIndex = filteredGroups.findIndex((group) => group.id === over.id);

		// console.log('[DnD] Indexes:', {
		// 	oldIndex,
		// 	newIndex,
		// 	filteredGroupsCount: filteredGroups.length,
		// 	filteredGroupsIds: filteredGroups.map((g) => g.id),
		// });

		if (oldIndex !== -1 && newIndex !== -1) {
			// console.log('[DnD] Moving group from index', oldIndex, 'to', newIndex);
			movePluginGroup(oldIndex, newIndex);
		} else {
			// console.log('[DnD] Invalid indexes - group not found');
		}
	};

	// Обработчик отмены перетаскивания
	const handleDragCancel = () => {
		// console.log('[DnD] Drag cancelled');
	};

	// Поиск
	const handleSearch = (query: string) => {
		// console.log('[PluginSortableList] Search query changed:', query);
		setSearchQuery(query);
	};

	// Добавление тестового плагина
	const handleAddPlugin = async () => {
		const filePaths = await window.electronAPI.invoke<string[]>('selectFiles', {
			multiSelect: true,
			filters: [{ name: 'FSM Plugin', extensions: ['fsmplug'] }],
		});

		if (!filePaths || filePaths.length === 0) return;

		for (const filePath of filePaths) {
			try {
				const pluginInfo = await window.plugins.installPlugin(filePath);
				addOrUpdatePlugin(pluginInfo);
				console.log(`[PluginSortableList] Installed: ${pluginInfo.id}@${pluginInfo.version}`);
			} catch (err) {
				console.error(`[PluginSortableList] Failed to install plugin from ${filePath}:`, err);
			}
		}
	};

	// Если идет загрузка, показываем скелетон или заглушку
	if (isLoading) {
		return <Box sx={{ p: 2, textAlign: 'center', color: 'text.secondary' }}>Загрузка плагинов...</Box>;
	}

	return (
		<Box
			sx={{
				width: '100%',
				height: '100%',
				display: 'flex',
				flexDirection: 'column',
				overflow: 'hidden',
			}}
		>
			{/* App updater accordion — above plugin search */}
			<Box sx={{ px: 2, pt: 2, flexShrink: 0 }}>
				<AppUpdaterAccordion />
			</Box>

			{/* Шапка с поиском и добавлением */}
			<Box
				sx={{
					p: 2,
					display: 'flex',
					gap: 1,
					alignItems: 'center',
					borderBottom: '1px solid',
					borderColor: 'divider',
					flexShrink: 0,
				}}
			>
				<MyStyledSearch value={searchQuery} onChange={handleSearch} placeholder='Поиск плагинов...' />
				<IconButton
					onClick={handleAddPlugin}
					disableRipple
					sx={{
						p: 0.5,
						color: defGray,
						'&:hover': {
							color: greyColor(75),
							backgroundColor: 'transparent !important',
						},
						'&.Mui-disabled': {
							color: greyColor(30),
						},
					}}
					title='Добавить плагин (.fsmplug)'
				>
					<Plus strokeWidth={2} size={24} />
				</IconButton>
			</Box>

			{/* Список групп с DnD */}
			<Box
				sx={{
					flex: 1,
					overflow: 'auto',
					p: 2,
					'&::-webkit-scrollbar': {
						width: '8px',
					},
					'&::-webkit-scrollbar-thumb': {
						backgroundColor: 'rgba(0,0,0,0.2)',
						borderRadius: '4px',
					},
				}}
			>
				{filteredGroups.length > 0 ? (
					<DndContext
						sensors={sensors}
						collisionDetection={closestCenter}
						onDragStart={handleDragStart}
						onDragMove={handleDragMove}
						onDragEnd={handleDragEnd}
						onDragCancel={handleDragCancel}
					>
						<SortableContext items={groupIds} strategy={verticalListSortingStrategy}>
							<List
								disablePadding
								sx={{
									display: 'flex',
									flexDirection: 'column',
									gap: 0.1,
								}}
							>
								{filteredGroups.map((group) => (
									<PluginSortableGroup key={group.id} groupId={group.id} plugins={group.plugins} />
								))}
							</List>
						</SortableContext>
					</DndContext>
				) : (
					<Box
						sx={{
							p: 4,
							textAlign: 'center',
							color: 'text.secondary',
							bgcolor: 'background.paper',
							borderRadius: 1,
							border: '1px dashed',
							borderColor: 'divider',
						}}
					>
						{searchQuery ? 'Ничего не найдено' : 'Список плагинов пуст. Нажмите + чтобы добавить тестовый плагин'}
					</Box>
				)}
			</Box>
		</Box>
	);
};
