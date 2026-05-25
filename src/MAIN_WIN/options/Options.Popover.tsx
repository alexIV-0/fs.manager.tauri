import { cyanColor, greyColor } from '@/Store/Color/grayColor';
import { Box, Button, Modal, Tab, Tabs } from '@mui/material';
import { File, FolderCog, Plug, Save, Settings, Waypoints } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { PluginSortableList } from './plugin/PluginSortableList';
import TabMain from './tabs/TabMain';
import TabNodes from './tabs/TabNodes';
import TabPaths from './tabs/TabPaths';
import TabTypes from './tabs/TabTypes';
import { appSettings_client } from '@/Store/Settings/appSettings_client';
import type { AppSettings } from '@/types/appSettings';
import { getVersion } from '@tauri-apps/api/app';
import { plugin_Store } from '@/Store/MainWin/plugin_store';
import { useStore } from 'zustand';

const modalStyle = {
	position: 'absolute',
	top: '50%',
	left: '50%',
	transform: 'translate(-50%, -50%)',
	width: '90%',
	height: '90%',
	border: '2px solid rgba(113, 113, 113, 0.75)',
	borderRadius: '4px',
	boxShadow: 24,
	bgcolor: greyColor(18),
	display: 'flex',
	flexDirection: 'column',
	overflow: 'hidden',
};

const scrollbarStyles = {
	'&::-webkit-scrollbar': { width: '8px' },
	'&::-webkit-scrollbar-track': { background: greyColor(10), borderRadius: '4px' },
	'&::-webkit-scrollbar-thumb': {
		background: greyColor(30),
		borderRadius: '4px',
		'&:hover': { background: greyColor(40) },
	},
	scrollbarWidth: 'thin',
	scrollbarColor: `${greyColor(30)} ${greyColor(10)}`,
};

interface TabPanelProps {
	children?: React.ReactNode;
	index: number;
	value: number;
}

function CustomTabPanel(props: TabPanelProps) {
	const { children, value, index, ...other } = props;

	return (
		<div
			role='tabpanel'
			hidden={value !== index}
			id={`simple-tabpanel-${index}`}
			aria-labelledby={`simple-tab-${index}`}
			style={{ height: '100%', overflow: 'hidden' }}
			{...other}
		>
			{value === index && (
				<Box
					sx={{
						p: '10px 36px',
						borderBottom: 0.5,
						borderColor: 'divider',
						minHeight: '100%',
						height: '100%',
						overflow: 'auto',
						...scrollbarStyles,
						'&:hover': {
							'&::-webkit-scrollbar-thumb': { background: greyColor(30) },
						},
					}}
				>
					{children}
				</Box>
			)}
		</div>
	);
}

interface OptionsPopoverProps {
	open: boolean;
	handleClose: () => void;
}

export default function OptionsPopover({ open, handleClose }: OptionsPopoverProps) {
	const [tabIndex, setTabIndex] = useState(0);
	const [version, setVersion] = useState('');

	const settings = appSettings_client((s) => s.settings);
	const setFull = appSettings_client((s) => s.setFull);

	const plugins = useStore(plugin_Store, (s) => s.plugins);
	const hasUpdaterPlugin = plugins.some((p) => p.id === 'updater' && p.enabled && p.exists);
	const loaded = appSettings_client((s) => s.loaded);
	const load = appSettings_client((s) => s.load);
	const [draft, setDraft] = useState<AppSettings>(settings);
	// Ref всегда содержит свежий draft — исключает stale-closure при асинхронном сохранении.
	const draftRef = useRef(draft);
	draftRef.current = draft;

	useEffect(() => {
		if (!loaded) load();
	}, [loaded, load]);

	// При открытии модалки синхронизируем черновик с актуальным стором.
	useEffect(() => {
		if (open) setDraft(settings);
	}, [open, settings]);

	useEffect(() => {
		getVersion()
			.then(setVersion)
			.catch(() => {});
	}, []);

	const handleChange = (_event: React.SyntheticEvent, newValue: number) => {
		setTabIndex(newValue);
	};

	const commitAndClose = async () => {
		try {
			await setFull(draftRef.current);
		} catch (e) {
			console.warn('[Options] failed to save settings on close:', e);
		}
		handleClose();
	};

	// Сохраняем при любом закрытии модалки (включая Esc).
	const handleModalClose = (_event: object, _reason: string) => {
		void commitAndClose();
	};

	return (
		<Modal open={open} onClose={handleModalClose}>
			<Box sx={modalStyle}>
				<Box sx={{ flexShrink: 0, position: 'relative' }}>
					{version && (
						<Box
							sx={{
								position: 'absolute',
								left: 12,
								top: '18px',
								transform: 'translateY(-50%)',
								opacity: 0.35,
								fontSize: '0.72rem',
								color: 'white',
								pointerEvents: 'none',
								userSelect: 'none',
							}}
						>
							v{version}
						</Box>
					)}
					<Tabs
						value={tabIndex}
						onChange={handleChange}
						centered
						slotProps={{ indicator: { style: { display: 'none' } } }}
						sx={{
							borderBottom: 0.5,
							borderColor: 'divider',
							'& .MuiTab-root': {
								color: greyColor(50),
								'&.Mui-selected': { color: cyanColor(80) },
							},
						}}
					>
						<Tab disableRipple label='Main' id='tab-0' aria-controls='tabpanel-0' icon={<Settings strokeWidth={0.8} size={42} />} />
						<Tab disableRipple label='Paths' id='tab-1' aria-controls='tabpanel-1' icon={<FolderCog strokeWidth={0.8} size={42} />} />
						<Tab disableRipple label='Types' id='tab-2' aria-controls='tabpanel-2' icon={<File strokeWidth={0.8} size={42} />} />
						<Tab disableRipple label='Nodes' id='tab-3' aria-controls='tabpanel-3' icon={<Waypoints strokeWidth={0.8} size={42} />} />
						<Tab disableRipple label={hasUpdaterPlugin ? 'Plug & Update' : 'Plug'} id='tab-4' aria-controls='tabpanel-4' icon={<Plug strokeWidth={0.8} size={42} />} />
					</Tabs>
					<Button
						variant='contained'
						size='small'
						startIcon={<Save size={14} />}
						onClick={commitAndClose}
						sx={{
							position: 'absolute',
							right: 12,
							top: '50%',
							transform: 'translateY(-50%)',
							textTransform: 'none',
							fontSize: '0.8rem',
							py: 0.5,
							bgcolor: cyanColor(60),
							'&:hover': { bgcolor: cyanColor(75) },
						}}
					>
						Сохранить
					</Button>
				</Box>

				<Box sx={{ flexGrow: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
					<CustomTabPanel value={tabIndex} index={0}>
						<TabMain draft={draft} setDraft={setDraft} />
					</CustomTabPanel>
					<CustomTabPanel value={tabIndex} index={1}>
						<TabPaths />
					</CustomTabPanel>
					<CustomTabPanel value={tabIndex} index={2}>
						<TabTypes />
					</CustomTabPanel>
					<CustomTabPanel value={tabIndex} index={3}>
						<TabNodes />
					</CustomTabPanel>
					<CustomTabPanel value={tabIndex} index={4}>
						<PluginSortableList />
					</CustomTabPanel>
				</Box>
			</Box>
		</Modal>
	);
}
