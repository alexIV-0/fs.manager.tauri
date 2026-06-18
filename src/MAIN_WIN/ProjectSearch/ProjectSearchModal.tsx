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
import { complimentColor } from '@/NODE_WIN/utils/complimentColor';
import useFoldersFromLS from '../hooks/useFoldersFromLS';
import { ProjectListItem } from './ProjectListItem';
import { commands, unwrap } from '@/Utils/specta';
import { basename } from '@/Utils/path';

interface ProjectWithMain {
	mainFolderName: string;
	mainFolderId: string;
	mainFolderPath: string;
	projectName: string;
	isActive: boolean;
}

export const ProjectSearchModal = ({ open, onClose }: { open: boolean; onClose: () => void }) => {
	const { searchQuery, selectedPlugins, setSearchQuery, togglePlugin, clearFilters } = useProjectSearch_store();
	const { mainFolderArr } = mainFolders_stor();
	const { plugins: installedPlugins } = plugin_Store();
	const { colorTypes } = colorTypes_store();

	const [projects, setProjects] = useState<ProjectWithMain[]>([]);
	const disabledFoldersMap = new Map<string, Set<string>>();

	// Получаем список отключённых папок для каждой главной папки
	useEffect(() => {
		mainFolderArr.forEach((mainFolder) => {
			const { folders: disabledFolders } = useFoldersFromLS(mainFolder.id);
			disabledFoldersMap.set(mainFolder.id, new Set(disabledFolders));
		});
	}, [mainFolderArr]);

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

	// При открытии модала - загружаем все подпапки из всех главных папок
	useEffect(() => {
		if (!open) return;

		const loadAllProjects = async () => {
			try {
				const allProjects: ProjectWithMain[] = [];

				for (const mainFolder of mainFolderArr) {
					try {
						// Читаем все папки в главной папке
						const allFolders = unwrap(
							await commands.getSomeFromFolder(mainFolder.path, [{ type: 'folders', ext: [] }]),
						) as unknown as { folders: string[] };

						const folderList = allFolders.folders || [];
						const disabledSet = disabledFoldersMap.get(mainFolder.id) || new Set<string>();

						// Добавляем каждую папку с информацией о главной папке
						folderList.forEach((folderName) => {
							allProjects.push({
								mainFolderName: basename(mainFolder.path),
								mainFolderId: mainFolder.id,
								mainFolderPath: mainFolder.path,
								projectName: folderName,
								isActive: !disabledSet.has(folderName),
							});
						});
					} catch (err) {
						console.error(`Failed to load folders from ${mainFolder.path}:`, err);
					}
				}

				setProjects(allProjects);
			} catch (err) {
				console.error('Failed to load projects:', err);
				setProjects([]);
			}
		};

		loadAllProjects();
	}, [open, mainFolderArr]);

	// Фильтруем проекты по поиску
	const filteredProjects = useMemo(() => {
		const queryLower = searchQuery.toLowerCase();
		return projects.filter((proj) => {
			// Ищем по имени папки или имени главной папки
			const projectMatch = proj.projectName.toLowerCase().includes(queryLower);
			const mainMatch = proj.mainFolderName.toLowerCase().includes(queryLower);
			return projectMatch || mainMatch;
		});
	}, [projects, searchQuery]);

	// Группируем отфильтрованные проекты по главным папкам для отображения
	const groupedProjects = useMemo(() => {
		const groups = new Map<string, ProjectWithMain[]>();
		filteredProjects.forEach((proj) => {
			if (!groups.has(proj.mainFolderId)) {
				groups.set(proj.mainFolderId, []);
			}
			groups.get(proj.mainFolderId)!.push(proj);
		});
		return groups;
	}, [filteredProjects]);

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
								placeholder='Поиск по имени папки или главной папки...'
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
										const textColor = complimentColor(bgColor);
										return (
											<Chip
												key={plugin.id}
												label={plugin.id}
												onClick={() => togglePlugin(plugin.id)}
												size='small'
												sx={{
													cursor: 'pointer',
													backgroundColor: isSelected ? bgColor : `${bgColor}40`,
													color: textColor,
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

							{/* Список папок сгруппированный по главным папкам */}
							<Box sx={{ border: `1px solid ${greyColor(50)}`, borderRadius: '4px', flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
								{filteredProjects.length > 0 ? (
									<List sx={{ p: 0, flex: 1, overflow: 'auto' }}>
										{Array.from(groupedProjects.entries()).map(([mainFolderId, projectsInMain]) => (
											<Box key={mainFolderId}>
												{/* Заголовок главной папки */}
												<Box
													sx={{
														px: 2,
														py: 1,
														backgroundColor: greyColor(25),
														borderBottom: `1px solid ${greyColor(40)}`,
														fontSize: '12px',
														fontWeight: 600,
														color: greyColor(60),
													}}
												>
													📁 {projectsInMain[0].mainFolderName}
												</Box>

												{/* Проекты в этой главной папке */}
												{projectsInMain.map((proj) => (
													<ProjectListItem
														key={`${proj.mainFolderId}-${proj.projectName}`}
														projectName={proj.projectName}
														mainFolderPath={proj.mainFolderPath}
														mainFolderId={proj.mainFolderId}
														isActive={proj.isActive}
														selectedPlugins={selectedPlugins}
														onSelectProject={onClose}
														onTogglePlugin={togglePlugin}
														isVisible={true}
													/>
												))}
											</Box>
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
