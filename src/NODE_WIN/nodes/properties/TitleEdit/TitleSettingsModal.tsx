// src/NODE_WIN/nodes/properties/TitleEdit/TitleSettingsModal.tsx

import { useState, useRef, useCallback, useEffect } from 'react';
import { Box, IconButton, Tabs, Tab, Typography, Tooltip } from '@mui/material';
import { Check, Copy, LayoutList } from 'lucide-react';
import { greyColor } from '@/Store/Color/grayColor';
import { TitleSettings, TitleFormatSettings, VideoFormat, defaultTitleSettings } from './types';
import { normalizeTitleSettings } from '@/Utils/titleAss';
import { DEFAULT_MODAL_SIZE, MIN_MODAL_WIDTH, MIN_MODAL_HEIGHT, DEFAULT_SETTINGS_WIDTH, MIN_SETTINGS_WIDTH, MAX_SETTINGS_WIDTH } from './constants';
import ModalShell from '../ModalShell';
import TitlePreviewPane from './TitlePreviewPane';
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

/** Размер кадра — определение самого формата, общим он быть не может. */
const withFrameOf = (fmt: TitleFormatSettings, frame: TitleFormatSettings): TitleFormatSettings => ({
	...fmt,
	videoWidth: frame.videoWidth,
	videoHeight: frame.videoHeight,
});

interface TitleSettingsModalProps {
	value: string;
	onSave: (value: string) => void;
	onClose: () => void;
}

export default function TitleSettingsModal({ value, onSave, onClose }: TitleSettingsModalProps) {
	const [settings, setSettings] = useState<TitleSettings>(() => {
		if (value) {
			try {
				// Приводим старые записи к текущей форме (общий padding плашки → X/Y и т.п.).
				return normalizeTitleSettings(JSON.parse(value) as TitleSettings);
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

	// Правка всегда уходит только в открытый формат.
	const handleSettingsChange = useCallback(
		(next: TitleFormatSettings) => setSettings((prev) => ({ ...prev, [activeFormat]: next })),
		[activeFormat],
	);

	// Разовое действие: раскатать открытый формат на остальные два. Дальше форматы
	// живут независимо — связи с источником копирования не остаётся.
	const [justCopied, setJustCopied] = useState(false);
	useEffect(() => {
		if (!justCopied) return;
		const t = setTimeout(() => setJustCopied(false), 1400);
		return () => clearTimeout(t);
	}, [justCopied]);

	const handleCopyToAll = useCallback(() => {
		setSettings((prev) => {
			const base = prev[activeFormat];
			return {
				...prev,
				landscape: withFrameOf(base, prev.landscape),
				portrait: withFrameOf(base, prev.portrait),
				square: withFrameOf(base, prev.square),
			};
		});
		setJustCopied(true);
	}, [activeFormat]);

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

	const activeLabel = FORMAT_TABS.find((t) => t.value === activeFormat)?.label ?? '';

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
			headerExtra={
				<Tooltip title={`Скопировать настройки «${activeLabel}» в остальные форматы (размер кадра у каждого свой)`}>
					<Box
						component='button'
						onClick={handleCopyToAll}
						sx={{
							display: 'inline-flex',
							alignItems: 'center',
							gap: '4px',
							px: 1,
							py: '3px',
							borderRadius: '3px',
							fontSize: 11,
							cursor: 'pointer',
							whiteSpace: 'nowrap',
							border: `1px solid ${greyColor(28)}`,
							backgroundColor: 'transparent',
							color: justCopied ? defColor : labelColor,
							'&:hover': { color: defColor, backgroundColor: greyColor(25) },
						}}
					>
						{justCopied ? <Check size={14} strokeWidth={1.5} /> : <Copy size={14} strokeWidth={1.5} />}
						{justCopied ? 'Copied' : 'Copy to all formats'}
					</Box>
				</Tooltip>
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
							// Базу сравнения берём из пресета: старая описывала уже не эти форматы.
							setSettings((prev) => ({ ...newSettings, encode: prev.encode }));
							setPresetsOpen(false);
						}}
						onClose={() => setPresetsOpen(false)}
						canvasRef={canvasRef}
					/>
					<TitlePreviewPane
						settings={currentFormatSettings}
						format={activeFormat}
						placeholderText={placeholderText}
						onPlaceholderTextChange={setPlaceholderText}
						onVideoSizeChange={handleVideoSizeChange}
						canvasRef={canvasRef}
					/>
				</>
			}
			panelSlot={(panelWidth) => (
				<TitleSettingsPanel settings={currentFormatSettings} onChange={handleSettingsChange} width={panelWidth} />
			)}
		/>
	);
}
