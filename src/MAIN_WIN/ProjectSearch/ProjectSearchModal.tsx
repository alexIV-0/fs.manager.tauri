import {
	Modal,
	TextField,
	Box,
	List,
	Chip,
	Typography,
} from '@mui/material';
import { X } from 'lucide-react';
import { useState, useEffect, useMemo } from 'react';
import { mainFolders_stor } from '@/Store/MainWin/mainFolders_store';
import { setActiveFolders_store } from '@/Store/MainWin/activeFolder_store';
import { useProjectSearch_store } from '@/Store/MainWin/projectSearch_store';
import { plugin_Store } from '@/Store/MainWin/plugin_store';
import { colorTypes_store } from '@/Store/Color/colorTypes_store';
import { greyColor, defGray } from '@/Store/Color/grayColor';
import useFoldersFromLS from '../hooks/useFoldersFromLS';
import { ProjectListItem } from './ProjectListItem';
import { commands, unwrap } from '@/Utils/specta';

export const ProjectSearchModal = ({ open, onClose }: { open: boolean; onClose: () => void }) => {
	const { searchQuery, selectedPlugins, setSearchQuery, togglePlugin, clearFilters } = useProjectSearch_store();
	const { mainFolderArr } = mainFolders_stor();
	const activeMainFolder = setActiveFolders_store((s) => s.activeMainFolder);
	const { plugins: installedPlugins } = plugin_Store();

	const [projects, setProjects] = useState<string[]>([]);
	const [projectsActive, setProjectsActive] = useState<Map<string, boolean>>(new Map());
	const [mainFolderPath, setMainFolderPath] = useState<string>('');
	const { colorTypes } = colorTypes_store();

	// Получаем список отключённых папок из LS (по activeMainFolder как ключ)
	const { folders: disabledFolders } = useFoldersFromLS(activeMainFolder || '');

	// Статичное облако плагинов - все установленные, кроме 'empty'
	const allPlugins = useMemo(() => {
		return installedPlugins
			.filter((p) => p.type && !p.type.includes('empty'))
			.map((p) => {
				const colorType = p.type?.[0] || 'unknown';
				return {
					id: p.id,
					name: p.name,
					colorType: colorType,
					color: colorTypes[colorType] || '#666666',
				};
			});
	}, [installedPlugins, colorTypes]);

	// При открытии модала - загружаем список ВСЕ папок в главной папке
	useEffect(() => {
		if (!open || !activeMainFolder) return;

		const activeMain = mainFolderArr.find((f) => f.id === activeMainFolder);
		if (!activeMain) return;

		const loadFolders = async () => {
			try {
				// Читаем все папки в главной папке
				const allFolders = unwrap(
					await commands.getSomeFromFolder(activeMain.path, [{ type: 'folders', ext: [] }]),
				) as unknown as { folders: string[] };

				const folderList = allFolders.folders || [];

				// Определяем активность каждой папки
				const activeMap = new Map<string, boolean>();
				folderList.forEach((folderName) => {
					activeMap.set(folderName, !disabledFolders.includes(folderName));
				});

				setMainFolderPath(activeMain.path);
				setProjects(folderList);
				setProjectsActive(activeMap);
			} catch (err) {
				console.error('Failed to load folders:', err);
				setProjects([]);
				setProjectsActive(new Map());
			}
		};

		loadFolders();
	}, [open, activeMainFolder, mainFolderArr, disabledFolders]);

	// Фильтруем проекты по поиску только (плагины фильтруются на уровне ProjectListItem)
	const filteredProjects = useMemo(() => {
		const queryLower = searchQuery.toLowerCase();
		return projects.filter((projectName) => {
			if (queryLower && !projectName.toLowerCase().includes(queryLower)) {
				return false;
			}
			return true;
		});
	}, [projects, searchQuery]);

	return (
		<Modal open={open} onClose={onClose}>
			<Box
				sx={{
					position: 'absolute',
					top: '50%',
					left: '50%',
					transform: 'translate(-50%, -50%)',
					width: '90%',
					height: '90%',
					display: 'flex',
					flexDirection: 'column',
					bgcolor: greyColor(18),
					border: `2px solid ${greyColor(40)}`,
					borderRadius: '4px',
					boxShadow: 24,
					overflow: 'hidden',
				}}
			>
				{/* Заголовок */}
				<Box
					sx={{
						display: 'flex',
						justifyContent: 'space-between',
						alignItems: 'center',
						p: 2,
						borderBottom: `1px solid ${greyColor(50)}`,
						flexShrink: 0,
					}}
				>
					<Typography sx={{ fontSize: 18, fontWeight: 600 }}>Поиск проектов</Typography>
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
				</Box>

				{/* Контент */}
				<Box
					sx={{
						flex: 1,
						display: 'flex',
						flexDirection: 'column',
						overflow: 'hidden',
						p: 2,
					}}
				>
					{projects.length === 0 ? (
						<Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', py: 8 }}>
							<Typography color={defGray}>Нет проектов</Typography>
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
								sx={{ mb: 2, flexShrink: 0 }}
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
										flexShrink: 0,
									}}
								>
									{allPlugins.map((plugin) => {
										const isSelected = selectedPlugins.includes(plugin.id);
										const bgColor = plugin.color || '#666666';
										return (
											<Chip
												key={plugin.id}
												label={plugin.id}
												onClick={() => togglePlugin(plugin.id)}
												size='small'
												sx={{
													cursor: 'pointer',
													backgroundColor: isSelected ? bgColor : `${bgColor}40`, // 40 hex = ~25% opacity
													color: '#fff',
													border: `1px solid ${bgColor}`,
													'&:hover': { opacity: 0.9 },
													fontWeight: isSelected ? 600 : 400,
												}}
											/>
										);
									})}
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
							<Box sx={{ border: `1px solid ${greyColor(50)}`, borderRadius: '4px', flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
								{filteredProjects.length > 0 ? (
									<List sx={{ p: 0, flex: 1, overflow: 'auto' }}>
										{filteredProjects.map((projectName) => (
											<ProjectListItem
												key={projectName}
												projectName={projectName}
												mainFolderPath={mainFolderPath}
												isActive={projectsActive.get(projectName) ?? true}
												selectedPlugins={selectedPlugins}
												onSelectProject={onClose}
												onTogglePlugin={togglePlugin}
												isVisible={true}
											/>
										))}
									</List>
								) : (
									<Box sx={{ p: 2, textAlign: 'center', color: defGray }}>
										Проекты не найдены
									</Box>
								)}
							</Box>
						</>
					)}
				</Box>
			</Box>
		</Modal>
	);
};
