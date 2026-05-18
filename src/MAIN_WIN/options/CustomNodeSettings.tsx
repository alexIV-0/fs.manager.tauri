import { cyanColor, greyColor } from '@/Store/Color/grayColor';
import { closestCenter, DndContext, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Box, IconButton, List } from '@mui/material';
import { ListRestart, Plus } from 'lucide-react';
import { CustomSettinsElement } from '../FileExplorerColumn/CustomSettinsElement';
import { automationListStyle } from '../mainStyles';
import MarkdownText from './MarkdownText';
import { typeOfNodes_store } from '@/Store/MainWin/pathPattern_store';
import { useState, useMemo } from 'react';
import { plugin_Store, PluginItem } from '@/Store/MainWin/plugin_store';
import { useStore } from 'zustand';

type NodeData = {
	title: string;
	color?: string | null;
	restoreButton?: boolean;
	multiselect?: boolean;
	optionsOnly?: boolean;
	allowDuplicates?: boolean;
};

export function CustomNodeSettings(prop: NodeData) {
	const { title, color = null, restoreButton = false, multiselect = true, optionsOnly = false, allowDuplicates = false } = prop;

	const [isColorPickerOpen, setIsColorPickerOpen] = useState(false);

	// Получаем стор
	const store = typeOfNodes_store();
	const patternStore = store.patternStore;

	// Реактивно подписываемся на изменения плагинов
	const plugins = useStore(plugin_Store, (state) => state.plugins);

	const sensors = useSensors(
		useSensor(PointerSensor, {
			activationConstraint: { distance: 5 },
		}),
	);

	// Получаем ВСЕ опции в формате "name (version)" для обратной совместимости
	const allPluginOptions = useMemo(() => {
		// Фильтруем только включенные плагины с типом nodeui
		const filtered = plugins.filter(
			(plugin: PluginItem) =>
				plugin.enabled &&
				plugin.exists && // Только те, что есть на диске
				plugin.type.includes('nodeui'),
		);

		// Преобразуем в формат "name (version)" как ожидает CustomSettinsElement
		return filtered.map((plugin) => `${plugin.name} (${plugin.version})`);
	}, [plugins]);

	// Для КАЖДОГО паттерна вычисляем свои доступные опции
	// Это ключевое изменение! Больше нет единого availablePlugins для всех
	const getAvailableOptionsForPattern = (patternId: string, currentPath: string[]) => {
		if (allPluginOptions.length === 0) return [];
		if (allowDuplicates) return allPluginOptions;

		// Собираем ВСЕ используемые опции из ВСЕХ паттернов
		const allUsedOptions = new Set<string>();
		patternStore.forEach((pattern) => {
			pattern.path.forEach((option) => {
				allUsedOptions.add(option);
			});
		});

		// Удаляем из used опции, которые выбраны в ТЕКУЩЕМ паттерне
		// (чтобы они не исчезали из выпадающего списка текущего паттерна)
		currentPath.forEach((option) => {
			allUsedOptions.delete(option);
		});

		// Возвращаем все опции, кроме используемых в ДРУГИХ паттернах
		return allPluginOptions.filter((option) => !allUsedOptions.has(option));
	};

	const handleRestoreStore = () => {
		store.restoreDefault();
	};

	const handleDragEnd = (event: any) => {
		if (isColorPickerOpen) return;

		const { active, over } = event;
		if (!over || active.id === over.id) return;

		const oldIndex = patternStore.findIndex((el) => el.id === active.id);
		const newIndex = patternStore.findIndex((el) => el.id === over.id);

		if (oldIndex !== -1 && newIndex !== -1) {
			store.movePatternElement(oldIndex, newIndex);
		}
	};

	const handleAddNodePattern = () => {
		// Для нового паттерна показываем все опции, которые еще не используются НИГДЕ
		const usedOptions = new Set<string>();
		patternStore.forEach((pattern) => {
			pattern.path.forEach((option) => {
				usedOptions.add(option);
			});
		});

		const availableForNew = allPluginOptions.filter((option) => (allowDuplicates ? true : !usedOptions.has(option)));

		const defaultOption = !optionsOnly && availableForNew.length > 0 ? [availableForNew[0]] : [];
		store.addPatternElement('new', defaultOption, color || undefined);
	};

	return (
		<Box
			sx={{
				width: '100%',
				pb: 1.5,
				mb: 2,
				mt: 1,
				borderBottom: 1,
				borderColor: cyanColor(80),
				// bgcolor: greyColor(15),
			}}
		>
			<MarkdownText>{title}</MarkdownText>

			<DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
				<SortableContext items={patternStore.map((p) => p.id)} strategy={verticalListSortingStrategy} disabled={isColorPickerOpen}>
					<List disablePadding sx={automationListStyle}>
						{patternStore.map((pattern) => (
							<CustomSettinsElement
								key={pattern.id}
								id={pattern.id}
								name={pattern.name}
								store={store}
								useColor={color === undefined ? pattern.color : undefined}
								onColorPickerOpenChange={setIsColorPickerOpen}
								options={getAvailableOptionsForPattern(pattern.id, pattern.path)} // Динамические опции для каждого паттерна!
								optionsOnly={optionsOnly}
								multiSelect={multiselect}
								allowDuplicates={allowDuplicates}
							/>
						))}
					</List>
				</SortableContext>
			</DndContext>

			<Box
				sx={{
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'space-between',
					p: '0px 8px',
				}}
			>
				<IconButton
					size='small'
					onClick={handleAddNodePattern}
					disabled={!optionsOnly && allPluginOptions.length === 0}
					title={!optionsOnly && allPluginOptions.length === 0 ? 'Нет доступных плагинов' : 'Добавить паттерн'}
				>
					<Plus color={greyColor(80)} />
				</IconButton>

				{restoreButton && (
					<IconButton size='small' onClick={handleRestoreStore}>
						<ListRestart color={greyColor(80)} />
					</IconButton>
				)}
			</Box>
		</Box>
	);
}
