// src/NODE_WIN/nodes/properties/TitleEdit/TitleSettingsModal.tsx

import { useState, useRef, useCallback } from 'react';
import { Box, IconButton, Tabs, Tab, Typography, Tooltip } from '@mui/material';
import { LayoutList } from 'lucide-react';
import { greyColor } from '@/Store/Color/grayColor';
import { TitleSettings, TitleFormatSettings, VideoFormat, defaultTitleSettings } from './types';
import { DEFAULT_MODAL_SIZE, MIN_MODAL_WIDTH, MIN_MODAL_HEIGHT, DEFAULT_SETTINGS_WIDTH, MIN_SETTINGS_WIDTH, MAX_SETTINGS_WIDTH } from './constants';
import ModalShell from '../ModalShell';
import TitleCanvas from './TitleCanvas';
import TitleSettingsPanel from './TitleSettingsPanel';
import PresetsPanel from './PresetsPanel';

const FORMAT_TABS: { value: VideoFormat; label: string }[] = [
	{ value: 'landscape', label: 'Landscape' },
	{ value: 'portrait', label: 'Portrait' },
	{ value: 'square', label: 'Square' },
];

const DEFAULT_PLACEHOLDER = 'The quick brown fox jumps over the lazy dog';

const SHELL_CONFIG = {
	defaultSize: DEFAULT_MODAL_SIZE,
	minWidth: MIN_MODAL_WIDTH,
	minHeight: MIN_MODAL_HEIGHT,
	defaultPanelWidth: DEFAULT_SETTINGS_WIDTH,
	minPanelWidth: MIN_SETTINGS_WIDTH,
	maxPanelWidth: MAX_SETTINGS_WIDTH,
};

interface TitleSettingsModalProps {
	value: string;
	onSave: (value: string) => void;
	onClose: () => void;
}

export default function TitleSettingsModal({ value, onSave, onClose }: TitleSettingsModalProps) {
	const [settings, setSettings] = useState<TitleSettings>(() => {
		if (value) {
			try {
				return JSON.parse(value) as TitleSettings;
			} catch {}
		}
		return defaultTitleSettings();
	});

	const [activeFormat, setActiveFormat] = useState<VideoFormat>('landscape');
	const [placeholderText, setPlaceholderText] = useState(DEFAULT_PLACEHOLDER);
	const [presetsOpen, setPresetsOpen] = useState(false);
	const canvasRef = useRef<HTMLCanvasElement>(null);

	const currentFormatSettings = settings[activeFormat];

	const handleFormatChange = useCallback((format: VideoFormat) => setActiveFormat(format), []);

	const handleSettingsChange = useCallback(
		(newFormatSettings: TitleFormatSettings) =>
			setSettings((prev) => ({ ...prev, [activeFormat]: newFormatSettings })),
		[activeFormat],
	);

	const handleVideoSizeChange = useCallback(
		(width: number, height: number) =>
			setSettings((prev) => ({
				...prev,
				[activeFormat]: { ...prev[activeFormat], videoWidth: width, videoHeight: height },
			})),
		[activeFormat],
	);

	const handleSave = useCallback(() => {
		onSave(JSON.stringify(settings));
		onClose();
	}, [settings, onSave, onClose]);

	const defColor = greyColor(80);
	const labelColor = greyColor(55);

	return (
		<ModalShell
			title='Title Settings'
			onClose={onClose}
			onSave={handleSave}
			config={SHELL_CONFIG}
			headerLeft={
				<Tooltip title='Presets'>
					<IconButton
						size='small'
						onClick={() => setPresetsOpen((prev) => !prev)}
						sx={{
							color: presetsOpen ? defColor : labelColor,
							backgroundColor: presetsOpen ? greyColor(25) : 'transparent',
							borderRadius: 1,
							'&:hover': { color: defColor },
						}}
					>
						<LayoutList size={18} strokeWidth={1.5} />
					</IconButton>
				</Tooltip>
			}
			headerCenter={
				<Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
					<Typography fontSize={13} fontWeight={500} color={defColor} sx={{ whiteSpace: 'nowrap' }}>
						Title Settings
					</Typography>
					<Tabs
						value={activeFormat}
						onChange={(_, v) => handleFormatChange(v)}
						sx={{
							minHeight: 32,
							'& .MuiTabs-indicator': { height: 2, backgroundColor: greyColor(70) },
							'& .MuiTab-root': {
								minHeight: 32, py: 0, px: 1.5, fontSize: 11,
								color: labelColor, textTransform: 'none',
								'&.Mui-selected': { color: defColor },
							},
						}}
					>
						{FORMAT_TABS.map((tab) => (
							<Tab key={tab.value} value={tab.value} label={tab.label} disableRipple />
						))}
					</Tabs>
				</Box>
			}
			canvasSlot={
				<>
					<PresetsPanel
						isOpen={presetsOpen}
						currentSettings={settings}
						onLoad={(newSettings) => {
							// Пресет описывает ВИД титров, а `encode` в том же JSON — настройка выхода
							// ноды (попап в шапке). Загрузка пресета заменяет настройки целиком, и без
							// этой строки выбранный кодек молча возвращался бы к дефолту.
							setSettings((prev) => ({ ...newSettings, encode: prev.encode }));
							setPresetsOpen(false);
						}}
						onClose={() => setPresetsOpen(false)}
						canvasRef={canvasRef}
					/>
					<TitleCanvas
						settings={currentFormatSettings}
						placeholderText={placeholderText}
						onPlaceholderTextChange={setPlaceholderText}
						onVideoSizeChange={handleVideoSizeChange}
						canvasRef={canvasRef}
					/>
				</>
			}
			panelSlot={(panelWidth) => (
				<TitleSettingsPanel
					settings={currentFormatSettings}
					onChange={handleSettingsChange}
					width={panelWidth}
				/>
			)}
		/>
	);
}
