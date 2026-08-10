import { Box, IconButton, Tooltip } from '@mui/material';
import { SyncStatusButton } from './Storage/SyncStatusButton';
import { commands } from '@/Utils/specta';
import { AlertTriangle, Blocks, BookOpen, Hammer, Settings, Wrench, Search } from 'lucide-react';
import OptionsPopover from './options/Options.Popover';
import { useState, useEffect } from 'react';
import { isScanningStore } from '@/Store/MainWin/isScaning_store';
import { defGray, greyColor } from '@/Store/Color/grayColor';
import { plugin_Store } from '@/Store/MainWin/plugin_store';
import { PluginBuilderModal } from './options/plugin/PluginBuilderModal';
import DocModal from '@/NODE_WIN/layout/DocModal';
import { buildNodeDefinitions, isNodeDefinitionsInitialized } from '@/NODE_WIN/definitions';
import { loadAllUINodes } from '@/Utils/loadAllUINodes';
import { useProcessingStats_store } from '@/Store/Processing/useProcessingStats_store';
import { ProjectSearchModal } from './ProjectSearch/ProjectSearchModal';
import { useProjectSearch_store } from '@/Store/MainWin/projectSearch_store';

export function MainTopPanel() {
	const { isScanning } = isScanningStore();
	const [open, setOpen] = useState(false);
	const [builderOpen, setBuilderOpen] = useState(false);
	const [docOpen, setDocOpen] = useState(false);
	const [isDev, setIsDev] = useState(false);
	const { getFilteredGroups } = plugin_Store();
	const { iterationCount, successCount, errorItemsCount } = useProcessingStats_store();
	const { isOpen: projectSearchOpen, setIsOpen: setProjectSearchOpen } = useProjectSearch_store();

	const defGrayColor = defGray;

	useEffect(() => {
		window.plugins.getState().then((s) => setIsDev(s.isDev));
	}, []);

	const handleOpenDoc = async () => {
		if (!isNodeDefinitionsInitialized()) {
			try {
				const nodes = await loadAllUINodes();
				buildNodeDefinitions(nodes);
			} catch (err) {
				console.error('[MainTopPanel] Failed to init node definitions for docs:', err);
				buildNodeDefinitions([]);
			}
		}
		setDocOpen(true);
	};

	const openDevTools = () => window.tauriAPI.openDevTools();
	const openLogWindow = () => commands.logWindowOpen();

	const hasMissingPlugins = getFilteredGroups().some((group) => group.plugins.some((p) => !p.exists));

	return (
		<Box
			sx={{
				height: '38px',
				borderBottom: `solid 1px ${greyColor(75)}`,
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'space-between',
				zIndex: 1,
				mb: '6px',
			}}
		>
			{/* Левая группа кнопок */}
			<Box sx={{ display: 'flex', alignItems: 'center' }}>
				<IconButton sx={{ p: 0, margin: '0 10px' }} size='small' onClick={() => setOpen(true)} disabled={isScanning}>
					<Settings strokeWidth={1} />
				</IconButton>

				<Tooltip title='Документация'>
					<IconButton sx={{ p: 0, margin: '0 10px' }} size='small' onClick={handleOpenDoc}>
						<BookOpen strokeWidth={1} />
					</IconButton>
				</Tooltip>

				<Tooltip title='Поиск проектов'>
					<IconButton sx={{ p: 0, margin: '0 10px' }} size='small' onClick={() => setProjectSearchOpen(true)}>
						<Search strokeWidth={1} />
					</IconButton>
				</Tooltip>

				{hasMissingPlugins && (
					<Box sx={{ display: 'flex', alignItems: 'center', mr: 1, color: 'warning.main' }} title='В группе есть отсутствующие плагины'>
						<AlertTriangle size={18} strokeWidth={2} />
					</Box>
				)}
			</Box>

			{/* Правая группа кнопок */}
			<Box sx={{ display: 'flex', alignItems: 'center' }}>
				{/* Синхронизация — перед счётчиком итераций: сначала «что происходит
				    с файлами», потом «что происходит с обработкой». */}
				<SyncStatusButton />

				<Tooltip title='iterations / success / errors'>
					<Box
						onClick={openLogWindow}
						sx={{
							display: 'flex',
							alignItems: 'center',
							mr: '10px',
							px: '10px',
							py: '2px',
							border: `0.5px solid ${errorItemsCount > 0 ? '#f85149' : defGray}`,
							borderRadius: '3px',
							backgroundColor: 'rgba(0,0,0,0.35)',
							cursor: 'pointer',
							fontSize: '15px',
							fontWeight: 700,
							fontFamily: 'monospace',
							userSelect: 'none',
							// lineHeight: 1.4,
							'&:hover': { opacity: 0.75 },
						}}
					>
						<span style={{ color: '#d4a017' }}>{iterationCount}</span>
						<span style={{ color: defGrayColor, margin: '0 4px' }}>/</span>
						<span style={{ color: '#3fb950' }}>{successCount}</span>
						<span style={{ color: defGrayColor, margin: '0 4px' }}>/</span>
						<span style={{ color: '#f85149' }}>{errorItemsCount}</span>
					</Box>
				</Tooltip>
				{isDev && (
					<Tooltip title='Plugin Builder (dev)'>
						<IconButton
							sx={{ p: 0, margin: '0 10px', opacity: 0.7, '&:hover': { opacity: 1 } }}
							size='small'
							onClick={() => setBuilderOpen(true)}
						>
							<Blocks strokeWidth={1} size={20} />
						</IconButton>
					</Tooltip>
				)}
				{/*
				<Tooltip title='Open devTools'>
					<IconButton sx={{ p: 0, margin: '0 10px', opacity: 0.7, '&:hover': { opacity: 1 } }} size='small' onClick={openDevTools}>
						<Wrench strokeWidth={1} />
					</IconButton>
				</Tooltip>
				<Tooltip title='Open logWindows'>
					<IconButton sx={{ p: 0, margin: '0 10px', opacity: 0.7, '&:hover': { opacity: 1 } }} size='small' onClick={openLogWindow}>
						<Hammer strokeWidth={1} />
					</IconButton>
				</Tooltip>
				*/}
			</Box>

			<OptionsPopover open={open} handleClose={() => setOpen(false)} />
			{isDev && <PluginBuilderModal open={builderOpen} onClose={() => setBuilderOpen(false)} />}
			<DocModal open={docOpen} onClose={() => setDocOpen(false)} />
			<ProjectSearchModal open={projectSearchOpen} onClose={() => setProjectSearchOpen(false)} />
		</Box>
	);
}
