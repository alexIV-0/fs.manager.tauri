import { ListItem, ListItemText, Checkbox, Box, Chip } from '@mui/material';
import { memo, useState, useEffect, useMemo } from 'react';
import { setActiveFolders_store } from '@/Store/MainWin/activeFolder_store';
import { colorTypes_store } from '@/Store/Color/colorTypes_store';
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
	const { colorTypes } = colorTypes_store();

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
					flex: 1,
					minHeight: '24px',
					alignItems: 'center',
				}}
				onClick={(e) => e.stopPropagation()}
			>
				{loading ? (
					<Box sx={{ fontSize: '11px', color: greyColor(40) }}>загрузка...</Box>
				) : (
					plugins.map((plugin) => {
						const isSelected = selectedPlugins.includes(plugin.id);
						const bgColor = colorTypes[plugin.colorType] || '#666666';
						return (
							<Chip
								key={plugin.id}
								label={plugin.id}
								size='small'
								onClick={() => onTogglePlugin(plugin.id)}
								sx={{
									cursor: 'pointer',
									backgroundColor: isSelected ? bgColor : `${bgColor}40`, // 40 hex = ~25% opacity
									color: '#fff',
									border: `1px solid ${bgColor}`,
									'&:hover': { opacity: 0.9 },
									fontSize: '11px',
									height: '24px',
									fontWeight: isSelected ? 600 : 400,
									'& .MuiChip-label': {
										px: '6px',
									},
								}}
							/>
						);
					})
				)}
			</Box>
		</ListItem>
	);
});
