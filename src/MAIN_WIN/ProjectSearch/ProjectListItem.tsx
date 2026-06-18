import { ListItem, ListItemText, Checkbox, Box, Chip } from '@mui/material';
import { memo, useState, useEffect } from 'react';
import { setActiveFolders_store } from '@/Store/MainWin/activeFolder_store';
import { greyColor } from '@/Store/Color/grayColor';
import { useProjectPlugins, PluginInfo } from '../hooks/useProjectPlugins';

interface ProjectListItemProps {
	projectName: string;
	mainFolderPath: string;
	isActive: boolean;
	selectedPlugins: string[];
	onSelectProject: (projectName: string) => void;
	onTogglePlugin: (pluginId: string) => void;
	isVisible: boolean;
}

export const ProjectListItem = memo(function ProjectListItem({
	projectName,
	mainFolderPath,
	isActive,
	selectedPlugins,
	onSelectProject,
	onTogglePlugin,
	isVisible,
}: ProjectListItemProps) {
	const [plugins, setPlugins] = useState<PluginInfo[]>([]);
	const [loading, setLoading] = useState(false);
	const { getPluginsForProject } = useProjectPlugins();

	// Загружаем плагины только если элемент видим
	useEffect(() => {
		if (!isVisible) {
			setPlugins([]);
			return;
		}

		const loadPlugins = async () => {
			setLoading(true);
			try {
				const projectPlugins = await getPluginsForProject(mainFolderPath, projectName);
				setPlugins(projectPlugins);
			} catch (err) {
				console.error(`Failed to load plugins for ${projectName}:`, err);
				setPlugins([]);
			} finally {
				setLoading(false);
			}
		};

		loadPlugins();
	}, [isVisible, projectName, mainFolderPath, getPluginsForProject]);

	const handleSelectProject = () => {
		setActiveFolders_store.getState().setActiveProjectFolder(projectName);
		onSelectProject(projectName);
	};

	return (
		<ListItem
			onClick={handleSelectProject}
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
					minHeight: '24px',
					alignItems: 'center',
				}}
				onClick={(e) => e.stopPropagation()}
			>
				{loading ? (
					<Box sx={{ fontSize: '11px', color: greyColor(40) }}>загрузка...</Box>
				) : (
					plugins.map((plugin) => (
						<Chip
							key={plugin.id}
							label={plugin.id}
							size='small'
							variant={selectedPlugins.includes(plugin.id) ? 'filled' : 'outlined'}
							color={selectedPlugins.includes(plugin.id) ? 'primary' : 'default'}
							onClick={() => onTogglePlugin(plugin.id)}
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
					))
				)}
			</Box>
		</ListItem>
	);
});
