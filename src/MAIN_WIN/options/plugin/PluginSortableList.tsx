import React, { useEffect, useMemo, useState } from 'react';
import { commands, unwrap } from '@/Utils/specta';
import { Box, IconButton, List } from '@mui/material';
import { plugin_Store, PluginItem } from '@/Store/MainWin/plugin_store';
import { typeOfNodes_store } from '@/Store/MainWin/pathPattern_store';
import { Plus } from 'lucide-react';

import { MyStyledSearch } from '@/MAIN_WIN/Universal/MyStyledSearch';
import { defGray, greyColor } from '@/Store/Color/grayColor';
import { compareNodeGroups } from '@/Utils/nodeGroupOrder';
import { AppUpdaterAccordion } from './AppUpdaterAccordion';
import { useStore } from 'zustand';

import { PluginSortableListItem } from './PluginSortableListItem';
import { PluginTypeAccordion } from './PluginTypeAccordion';
import { pluginKey, usePluginNodeTypes, UNTYPED_GROUP } from './usePluginNodeTypes';

/** Группа версий одного плагина (то, что отдаёт стор). */
type PluginGroup = { id: string; plugins: PluginItem[] };

/** Строка списка: конкретная версия плагина. */
type PluginRow = { plugin: PluginItem; isMainVersion: boolean };

const OPEN_TYPES_KEY = 'plugins-type-accordions';

export const PluginSortableList: React.FC = () => {
	// Реактивное состояние
	const plugins = useStore(plugin_Store, (state) => state.plugins);
	const searchQuery = useStore(plugin_Store, (state) => state.searchQuery);
	const isLoading = useStore(plugin_Store, (state) => state.isLoading);
	const patterns = typeOfNodes_store((s) => s.patternStore);

	const hasUpdaterPlugin = useMemo(
		() => plugins.some((p) => p.id === 'updater' && p.enabled && p.exists),
		[plugins],
	);

	// Получаем методы из стора
	const { setSearchQuery, getFilteredGroups, addOrUpdatePlugin } = plugin_Store();

	// Тип ноды каждого плагина — та же раскладка, что в боковой панели NODE_WIN
	const nodeTypes = usePluginNodeTypes(plugins);

	// Цвет группы берём у типа ноды в настройках (Nodes) — как в нодовом редакторе
	const typeColors = useMemo(() => {
		const map = new Map<string, string>();
		for (const pattern of patterns) {
			if (pattern.color) map.set(pattern.name, pattern.color);
		}
		return map;
	}, [patterns]);

	// Получаем отфильтрованные группы
	const filteredGroups = useMemo(() => getFilteredGroups(), [plugins, searchQuery, getFilteredGroups]);

	// Раскладка по типам нод: аккордеон = тип, внутри сразу плагины по алфавиту.
	// Версии одного плагина идут подряд — стор отдаёт их одной группой (свежая первой).
	const typeGroups = useMemo(() => {
		const byType = new Map<string, PluginGroup[]>();

		for (const group of filteredGroups) {
			// Тип берём у актуальной (самой свежей) версии — на неё смотрит и NODE_WIN
			const nodeType = nodeTypes.get(pluginKey(group.plugins[0])) ?? UNTYPED_GROUP;
			if (!byType.has(nodeType)) byType.set(nodeType, []);
			byType.get(nodeType)!.push(group);
		}

		return Array.from(byType.entries())
			.sort(([a], [b]) => compareNodeGroups(a, b))
			.map(([nodeType, groups]) => {
				const rows: PluginRow[] = [...groups]
					.sort((a, b) =>
						(a.plugins[0]?.name ?? a.id).toLowerCase().localeCompare((b.plugins[0]?.name ?? b.id).toLowerCase()),
					)
					.flatMap((group) =>
						group.plugins.map((plugin, index) => ({ plugin, isMainVersion: group.plugins.length > 1 && index === 0 })),
					);

				return { nodeType, color: typeColors.get(nodeType) ?? greyColor(45), rows };
			});
	}, [filteredGroups, nodeTypes, typeColors]);

	// Открытые/закрытые аккордеоны типов — помним между сессиями
	const [openTypes, setOpenTypes] = useState<Record<string, boolean>>(() => {
		try {
			const saved = localStorage.getItem(OPEN_TYPES_KEY);
			return saved ? JSON.parse(saved) : {};
		} catch {
			return {};
		}
	});

	useEffect(() => {
		try {
			localStorage.setItem(OPEN_TYPES_KEY, JSON.stringify(openTypes));
		} catch {}
	}, [openTypes]);

	// При активном поиске раскрываем все типы — иначе находки прячутся в закрытых
	const isTypeOpen = (nodeType: string) => {
		if (searchQuery.trim()) return true;
		return openTypes[nodeType] ?? true;
	};

	const toggleType = (nodeType: string) => {
		setOpenTypes((prev) => ({ ...prev, [nodeType]: !isTypeOpen(nodeType) }));
	};

	// Поиск
	const handleSearch = (query: string) => {
		setSearchQuery(query);
	};

	// Установка плагина из .fsmplug
	const handleAddPlugin = async () => {
		const filePaths = unwrap(await commands.selectFiles({
			multiSelect: true,
			filters: [{ name: 'FSM Plugin', extensions: ['fsmplug'] }],
		}));

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
			{/* App updater accordion — показывается только если установлен плагин updater */}
			{hasUpdaterPlugin && (
				<Box sx={{ px: 2, pt: 2, flexShrink: 0 }}>
					<AppUpdaterAccordion />
				</Box>
			)}

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

			{/* Список: аккордеон на каждый тип ноды */}
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
				{typeGroups.length > 0 ? (
					<List
						disablePadding
						sx={{
							display: 'flex',
							flexDirection: 'column',
							gap: 0.75,
						}}
					>
						{typeGroups.map(({ nodeType, color, rows }) => (
							<PluginTypeAccordion
								key={nodeType}
								nodeType={nodeType}
								color={color}
								count={rows.length}
								open={isTypeOpen(nodeType)}
								onToggle={() => toggleType(nodeType)}
							>
								{rows.map(({ plugin, isMainVersion }) => (
									<PluginSortableListItem
										key={pluginKey(plugin)}
										plugin={plugin}
										isMainVersion={isMainVersion}
									/>
								))}
							</PluginTypeAccordion>
						))}
					</List>
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
