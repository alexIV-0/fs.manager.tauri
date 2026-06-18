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
	const [allPlugins, setAllPlugins] = useState<PluginInfo[]>([]);
	const [projects, setProjects] = useState<string[]>([]);
	const [projectsPlugins, setProjectsPlugins] = useState<Map<string, PluginInfo[]>>(new Map());
	const [projectsActive, setProjectsActive] = useState<Map<string, boolean>>(new Map());

	// Получаем список отключённых папок из LS (по activeMainFolder как ключ)
	const { folders: disabledFolders } = useFoldersFromLS(activeMainFolder || '');

	// При открытии модала - загружаем список всех плагинов и папок
	useEffect(() => {
		if (!open || !activeMainFolder) return;

		const loadData = async () => {
			setLoading(true);
			try {
				const activeMain = mainFolderArr.find((f) => f.id === activeMainFolder);
				if (!activeMain) return;

				// Загружаем плагины для всех папок (получаем ассоциативный Map)
				const pluginsByProject = await getPluginsForMultipleProjects(activeMain.path, activeMain.projectFolders);

				// Собираем все уникальные плагины для статичного облака
				const pluginsMap = new Map<string, PluginInfo>();
				pluginsByProject.forEach((plugins) => {
					plugins.forEach((p) => {
						if (!pluginsMap.has(p.id)) {
							pluginsMap.set(p.id, p);
						}
					});
				});

				// Определяем активность каждой папки
				const activeMap = new Map<string, boolean>();
				activeMain.projectFolders.forEach((projectName) => {
					activeMap.set(projectName, !disabledFolders.includes(projectName));
				});

				setAllPlugins(Array.from(pluginsMap.values()));
				setProjects(activeMain.projectFolders);
				setProjectsPlugins(pluginsByProject);
				setProjectsActive(activeMap);
			} finally {
				setLoading(false);
			}
		};

		loadData();
	}, [open, activeMainFolder, mainFolderArr, getPluginsForMultipleProjects, disabledFolders]);

	// Фильтруем проекты по поиску и выбранным плагинам
	const filteredProjects = useMemo(() => {
		const queryLower = searchQuery.toLowerCase();

		return projects.filter((projectName) => {
			// Фильтр по имени
			if (queryLower && !projectName.toLowerCase().includes(queryLower)) {
				return false;
			}

			// Фильтр по плагинам (AND логика)
			if (selectedPlugins.length > 0) {
				const projectPlugins = projectsPlugins.get(projectName) || [];
				const projectPluginIds = projectPlugins.map((p) => p.id);
				const hasAllSelectedPlugins = selectedPlugins.every((pluginId) => projectPluginIds.includes(pluginId));
				return hasAllSelectedPlugins;
			}

			return true;
		});
	}, [projects, projectsPlugins, searchQuery, selectedPlugins]);

	const handleSelectProject = (projectName: string) => {
		setActiveFolders_store.getState().setActiveProjectFolder(projectName);
		onClose();
	};

	return (
		<Dialog
			open={open}
			onClose={onClose}
			PaperProps={{
				sx: {
					width: '96vw',
					height: '88vh',
					maxHeight: 'none',
				}
			}}
		>
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

			<DialogContent
				sx={{
					flex: 1,
					display: 'flex',
					flexDirection: 'column',
					overflow: 'hidden',
					p: 2,
				}}
			>
				{loading ? (
					<Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', py: 8 }}>
						<CircularProgress />
					</Box>
				) : (
					<>
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
						{allPlugins.length > 0 ? (
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
						<Box sx={{ mt: 2, border: `1px solid ${greyColor(50)}`, borderRadius: '4px', flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
							{filteredProjects.length > 0 ? (
								<List sx={{ p: 0, flex: 1, overflow: 'auto' }}>
									{filteredProjects.map((projectName) => {
										const isActive = projectsActive.get(projectName) ?? true;
										const projectPlugins = projectsPlugins.get(projectName) || [];

										return (
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
													checked={isActive}
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
													{projectPlugins.map((plugin) => (
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
										);
									})}
								</List>
							) : (
								<Box sx={{ p: 2, textAlign: 'center', color: defGray }}>
									{projects.length === 0 ? 'Нет проектов' : 'Проекты не найдены'}
								</Box>
							)}
						</Box>
					</>
				)}
			</DialogContent>
		</Dialog>
	);
};
