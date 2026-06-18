import { ListItem, ListItemText, Checkbox, Box, Chip } from '@mui/material';
import { memo, useState, useEffect } from 'react';
import { setActiveFolders_store } from '@/Store/MainWin/activeFolder_store';
import { greyColor } from '@/Store/Color/grayColor';
import { complimentColor } from '@/NODE_WIN/utils/complimentColor';
import { useProjectPlugins, PluginInfo } from '../hooks/useProjectPlugins';
import useFoldersFromLS from '../hooks/useFoldersFromLS';
import type { ColorTypesMap } from '@/Store/Color/colorTypes_store';

// Функция для добавления прозрачности к цвету любого формата
function withAlpha(color: string, alpha: number): string {
	if (!color) return `rgba(102, 102, 102, ${alpha})`;

	// Если это hex
	if (color.startsWith('#')) {
		const hex = color.replace('#', '');
		const r = parseInt(hex.substring(0, 2), 16);
		const g = parseInt(hex.substring(2, 4), 16);
		const b = parseInt(hex.substring(4, 6), 16);
		return `rgba(${r}, ${g}, ${b}, ${alpha})`;
	}

	// Если это rgb/rgba
	if (color.startsWith('rgb')) {
		return color.replace(/[\d.]+\s*\)/, `${alpha})`);
	}

	// Если это hsl/hsla
	if (color.startsWith('hsl')) {
		return color.replace(/[\d.]+\s*\)/, `${alpha})`);
	}

	// Fallback
	return `rgba(102, 102, 102, ${alpha})`;
}

interface ProjectListItemProps {
	projectName: string;
	mainFolderPath: string;
	mainFolderId: string;
	selectedPlugins: string[];
	onSelectProject: () => void;
	onTogglePlugin: (pluginId: string) => void;
	isVisible: boolean;
	colorTypes: ColorTypesMap;
}

export const ProjectListItem = memo(function ProjectListItem({
	projectName,
	mainFolderPath,
	mainFolderId,
	selectedPlugins,
	onSelectProject,
	onTogglePlugin,
	isVisible,
	colorTypes,
}: ProjectListItemProps) {
	const [plugins, setPlugins] = useState<PluginInfo[]>([]);
	const [loading, setLoading] = useState(false);
	const [shouldHide, setShouldHide] = useState(false);
	const { getPluginsForProject } = useProjectPlugins();
	// Получаем статус включения папки
	const { folders: disabledFolders } = useFoldersFromLS(mainFolderId);
	const isActive = !disabledFolders.includes(projectName);

	// Загружаем плагины только если элемент видим
	useEffect(() => {
		if (!isVisible) {
			setPlugins([]);
			setShouldHide(false);
			return;
		}

		const loadPlugins = async () => {
			setLoading(true);
			try {
				const projectPlugins = await getPluginsForProject(mainFolderPath, projectName);
				setPlugins(projectPlugins);

				// Если выбраны плагины, проверяем есть ли они в этой папке
				if (selectedPlugins.length > 0) {
					const pluginIds = projectPlugins.map((p) => p.id);
					const hasAnySelected = selectedPlugins.some((selected) => pluginIds.includes(selected));
					setShouldHide(!hasAnySelected);
				} else {
					setShouldHide(false);
				}
			} catch (err) {
				console.error(`Failed to load plugins for ${projectName}:`, err);
				setPlugins([]);
				setShouldHide(false);
			} finally {
				setLoading(false);
			}
		};

		loadPlugins();
	}, [isVisible, projectName, mainFolderPath, getPluginsForProject, selectedPlugins]);

	const handleSelectProject = () => {
		setActiveFolders_store.getState().setActiveProjectFolder(projectName);
		onSelectProject();
	};

	if (shouldHide) {
		return null;
	}

	return (
		<ListItem
			onClick={handleSelectProject}
			sx={{
				cursor: 'pointer',
				borderBottom: `1px solid ${greyColor(80)}`,
				'&:last-child': { borderBottom: 'none' },
				'&:hover': { backgroundColor: 'rgba(0, 0, 0, 0.25)' },
				py: 1,
				display: 'flex',
				alignItems: 'flex-start',
				gap: 1,
			}}
			disablePadding
		>
			<Checkbox
				checked={isActive}
				onClick={(e) => e.stopPropagation()}
				sx={{ mr: 0.5, flexShrink: 0, mt: 0.25 }}
				size='small'
				readOnly
			/>

			{/* Левая часть - имя папки (250-350px)*/}
			<Box sx={{ minWidth: '250px', maxWidth: '350px', flexShrink: 0 }}>
				<ListItemText
					primary={projectName}
					sx={{
						m: 0,
						'& .MuiListItemText-primary': {
							fontSize: '14px',
							overflow: 'hidden',
							textOverflow: 'ellipsis',
							whiteSpace: 'nowrap',
						},
					}}
				/>
			</Box>

			{/* Правая часть - плагины на всю оставшуюся ширину */}
			<Box
				sx={{
					display: 'flex',
					gap: 0.5,
					flexWrap: 'wrap',
					alignContent: 'flex-start',
					flex: 1,
					minHeight: '24px',
				}}
				onClick={(e) => e.stopPropagation()}
			>
				{loading ? (
					<Box sx={{ fontSize: '11px', color: greyColor(40) }}>загрузка...</Box>
				) : (
					plugins.map((plugin) => {
						const isSelected = selectedPlugins.includes(plugin.id);
						const bgColor = colorTypes[plugin.colorType] || '#666666';
						const textColor = complimentColor(bgColor);

						return (
							<Chip
								key={plugin.id}
								label={plugin.id}
								size='small'
								onClick={() => onTogglePlugin(plugin.id)}
								sx={{
									cursor: 'pointer',
									backgroundColor: isSelected ? bgColor : withAlpha(bgColor, 0.25),
									color: textColor,
									border: 'none',
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
