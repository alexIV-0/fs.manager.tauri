import {
	Dialog,
	DialogTitle,
	DialogContent,
	TextField,
	Box,
	List,
	ListItem,
	ListItemText,
	Checkbox,
	Chip,
	CircularProgress,
} from '@mui/material';
import { X } from 'lucide-react';
import { useState, useEffect, useMemo } from 'react';
import { mainFolders_stor } from '@/Store/MainWin/mainFolders_store';
import { setActiveFolders_store } from '@/Store/MainWin/activeFolder_store';
import { useProjectSearch_store } from '@/Store/MainWin/projectSearch_store';
import { useProjectPlugins, PluginInfo } from '../hooks/useProjectPlugins';
import { greyColor, defGray } from '@/Store/Color/grayColor';
import useFoldersFromLS from '../hooks/useFoldersFromLS';

export const ProjectSearchModal = ({ open, onClose }: { open: boolean; onClose: () => void }) => {
	const { searchQuery, selectedPlugins, setSearchQuery, togglePlugin, clearFilters } = useProjectSearch_store();
	const { mainFolderArr } = mainFolders_stor();
	const { getPluginsForProject, getPluginsForMultipleProjects } = useProjectPlugins();
	const activeMainFolder = setActiveFolders_store((s) => s.activeMainFolder);

	const [loading, setLoading] = useState(false);
	const [projectsWithPlugins, setProjectsWithPlugins] = useState<
		Map<string, { plugins: PluginInfo[]; active: boolean; mainFolderId: string; mainFolderPath: string }>
	>(new Map());

	// Получаем список отключённых папок из LS (по activeMainFolder как ключ)
	const { folders: disabledFolders } = useFoldersFromLS(activeMainFolder || '');

	// Загружаем плагины для всех папок активной главной папки
	useEffect(() => {
		if (!open || !activeMainFolder) return;

		const loadData = async () => {
			setLoading(true);
			try {
				const activeMain = mainFolderArr.find((f) => f.id === activeMainFolder);
				if (!activeMain) return;

				const pluginsByProject = await getPluginsForMultipleProjects(activeMain.path, activeMain.projectFolders);

				const newMap = new Map<
					string,
					{ plugins: PluginInfo[]; active: boolean; mainFolderId: string; mainFolderPath: string }
				>();

				activeMain.projectFolders.forEach((projectName) => {
					// Папка активна, если её НЕ в списке отключённых
					const isActive = !disabledFolders.includes(projectName);

					newMap.set(projectName, {
						plugins: pluginsByProject.get(projectName) || [],
						active: isActive,
						mainFolderId: activeMain.id,
						mainFolderPath: activeMain.path,
					});
				});

				setProjectsWithPlugins(newMap);
			} finally {
				setLoading(false);
			}
		};

		loadData();
	}, [open, activeMainFolder, mainFolderArr, getPluginsForMultipleProjects, disabledFolders]);

	// Собираем все уникальные плагины для облака тегов
	const allPlugins = useMemo(() => {
		const pluginsMap = new Map<string, PluginInfo>();
		projectsWithPlugins.forEach(({ plugins }) => {
			plugins.forEach((p) => {
				if (!pluginsMap.has(p.id)) {
					pluginsMap.set(p.id, p);
				}
			});
		});
		return Array.from(pluginsMap.values());
	}, [projectsWithPlugins]);

	// Фильтруем проекты по поиску и выбранным плагинам
	const filteredProjects = useMemo(() => {
		const queryLower = searchQuery.toLowerCase();
		const projects = Array.from(projectsWithPlugins.entries());

		return projects.filter(([projectName, data]) => {
			// Фильтр по имени
			if (queryLower && !projectName.toLowerCase().includes(queryLower)) {
				return false;
			}

			// Фильтр по плагинам (AND логика)
			if (selectedPlugins.length > 0) {
				const projectPluginIds = data.plugins.map((p) => p.id);
				const hasAllSelectedPlugins = selectedPlugins.every((pluginId) => projectPluginIds.includes(pluginId));
				return hasAllSelectedPlugins;
			}

			return true;
		});
	}, [projectsWithPlugins, searchQuery, selectedPlugins]);

	const handleSelectProject = (projectName: string) => {
		const data = projectsWithPlugins.get(projectName);
		if (data) {
			setActiveFolders_store.getState().setActiveProjectFolder(projectName);
			onClose();
		}
	};

	return (
		<Dialog open={open} onClose={onClose} maxWidth='sm' fullWidth>
			<DialogTitle
				sx={{
					display: 'flex',
					justifyContent: 'space-between',
					alignItems: 'center',
					pb: 1,
				}}
			>
				Поиск проектов
				<Box
					component='button'
					onClick={onClose}
					sx={{
						background: 'none',
						border: 'none',
						cursor: 'pointer',
						padding: '4px',
						display: 'flex',
						alignItems: 'center',
						'&:hover': { opacity: 0.7 },
					}}
				>
					<X size={20} />
				</Box>
			</DialogTitle>

			<DialogContent>
				{/* Поиск по имени */}
				<TextField
					fullWidth
					placeholder='Поиск по имени папки...'
					value={searchQuery}
					onChange={(e) => setSearchQuery(e.target.value)}
					size='small'
					sx={{ mb: 2 }}
				/>

				{/* Облако плагинов */}
				{loading ? (
					<Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
						<CircularProgress size={40} />
					</Box>
				) : allPlugins.length > 0 ? (
					<Box
						sx={{
							mb: 2,
							p: 1.5,
							backgroundColor: `rgba(0, 0, 0, 0.15)`,
							borderRadius: '4px',
							display: 'flex',
							flexWrap: 'wrap',
							gap: 1,
						}}
					>
						{allPlugins.map((plugin) => (
							<Chip
								key={plugin.id}
								label={plugin.id}
								onClick={() => togglePlugin(plugin.id)}
								variant={selectedPlugins.includes(plugin.id) ? 'filled' : 'outlined'}
								color={selectedPlugins.includes(plugin.id) ? 'primary' : 'default'}
								size='small'
								sx={{
									cursor: 'pointer',
									'&:hover': { opacity: 0.8 },
								}}
							/>
						))}
						{selectedPlugins.length > 0 && (
							<Chip
								icon={<X size={16} />}
								label='Очистить'
								onClick={clearFilters}
								size='small'
								variant='outlined'
								sx={{ cursor: 'pointer' }}
							/>
						)}
					</Box>
				) : null}

				{/* Список папок */}
				<Box sx={{ mt: 2, border: `1px solid ${greyColor(50)}`, borderRadius: '4px', maxHeight: '400px', overflowY: 'auto' }}>
					{filteredProjects.length > 0 ? (
						<List sx={{ p: 0 }}>
							{filteredProjects.map(([projectName, data]) => (
								<ListItem
									key={projectName}
									onClick={() => handleSelectProject(projectName)}
									sx={{
										cursor: 'pointer',
										borderBottom: `1px solid ${greyColor(80)}`,
										'&:last-child': { borderBottom: 'none' },
										'&:hover': { backgroundColor: 'rgba(0, 0, 0, 0.25)' },
										py: 1,
									}}
									disablePadding
								>
									<Checkbox
										checked={data.active}
										onClick={(e) => e.stopPropagation()}
										sx={{ mr: 1 }}
										size='small'
										readOnly
									/>
									<ListItemText
										primary={projectName}
										sx={{
											flex: 1,
											'& .MuiListItemText-primary': {
												fontSize: '14px',
												overflow: 'hidden',
												textOverflow: 'ellipsis',
												whiteSpace: 'nowrap',
											},
										}}
									/>
									{/* Плагины у папки */}
									<Box
										sx={{
											display: 'flex',
											gap: 0.5,
											flexWrap: 'wrap',
											justifyContent: 'flex-end',
											ml: 1,
											maxWidth: '200px',
										}}
										onClick={(e) => e.stopPropagation()}
									>
										{data.plugins.map((plugin) => (
											<Chip
												key={plugin.id}
												label={plugin.id}
												size='small'
												variant={selectedPlugins.includes(plugin.id) ? 'filled' : 'outlined'}
												color={selectedPlugins.includes(plugin.id) ? 'primary' : 'default'}
												onClick={() => togglePlugin(plugin.id)}
												sx={{
													cursor: 'pointer',
													'&:hover': { opacity: 0.8 },
													fontSize: '11px',
													height: '24px',
													'& .MuiChip-label': {
														px: '6px',
													},
												}}
											/>
										))}
									</Box>
								</ListItem>
							))}
						</List>
					) : (
						<Box sx={{ p: 2, textAlign: 'center', color: defGray }}>
							{projectsWithPlugins.size === 0 ? 'Нет проектов' : 'Проекты не найдены'}
						</Box>
					)}
				</Box>
			</DialogContent>
		</Dialog>
	);
};
