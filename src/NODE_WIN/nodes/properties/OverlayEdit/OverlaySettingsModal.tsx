// src/NODE_WIN/nodes/properties/OverlayEdit/OverlaySettingsModal.tsx

import { useState, useRef, useEffect, useCallback } from 'react';
import { Box, Tabs, Tab, Typography } from '@mui/material';
import { greyColor } from '@/Store/Color/grayColor';
import { OverlaySettings, OverlayFormatSettings, VideoFormat, defaultOverlaySettings } from './types';
import { DEFAULT_MODAL_SIZE, MIN_MODAL_WIDTH, MIN_MODAL_HEIGHT, DEFAULT_PANEL_WIDTH, MIN_PANEL_WIDTH, MAX_PANEL_WIDTH } from './constants';
import ModalShell from '../ModalShell';
import OverlayCanvas from './OverlayCanvas';
import OverlaySettingsPanel from './OverlaySettingsPanel';

const FORMAT_TABS: { value: VideoFormat; label: string }[] = [
	{ value: 'landscape', label: 'Landscape' },
	{ value: 'portrait', label: 'Portrait' },
	{ value: 'square', label: 'Square' },
];

const SHELL_CONFIG = {
	defaultSize: DEFAULT_MODAL_SIZE,
	minWidth: MIN_MODAL_WIDTH,
	minHeight: MIN_MODAL_HEIGHT,
	defaultPanelWidth: DEFAULT_PANEL_WIDTH,
	minPanelWidth: MIN_PANEL_WIDTH,
	maxPanelWidth: MAX_PANEL_WIDTH,
};

interface OverlaySettingsModalProps {
	value: string;
	onSave: (value: string) => void;
	onClose: () => void;
	nodeId: string;
}

export default function OverlaySettingsModal({ value, onSave, onClose, nodeId }: OverlaySettingsModalProps) {
	const [settings, setSettings] = useState<OverlaySettings>(() => {
		if (value) {
			try {
				return JSON.parse(value) as OverlaySettings;
			} catch {}
		}
		return defaultOverlaySettings();
	});

	const [activeFormat, setActiveFormat] = useState<VideoFormat>('landscape');
	const [lockAspect, setLockAspect] = useState(true);

	const fgKey = `overlayEdit_fgFilePath_${nodeId}`;
	const bgKey = `overlayEdit_bgFilePath_${nodeId}`;
	const [fgFilePath, setFgFilePath] = useState(() => localStorage.getItem(fgKey) ?? '');
	const [bgFilePath, setBgFilePath] = useState(() => localStorage.getItem(bgKey) ?? '');
	const [fgDataUrl, setFgDataUrl] = useState('');
	const [bgDataUrl, setBgDataUrl] = useState('');

	const canvasRef = useRef<HTMLCanvasElement>(null);

	useEffect(() => {
		const api = (window as any).electronAPI;
		if (fgFilePath) api.invoke('read-media-preview', fgFilePath).then(setFgDataUrl).catch(() => {});
		if (bgFilePath) api.invoke('read-media-preview', bgFilePath).then(setBgDataUrl).catch(() => {});
	}, []); // eslint-disable-line react-hooks/exhaustive-deps

	const currentFormatSettings = settings[activeFormat];

	const handleFormatChange = useCallback((format: VideoFormat) => setActiveFormat(format), []);

	const handleFormatSettingsChange = useCallback(
		(newFmt: OverlayFormatSettings) => setSettings((prev) => ({ ...prev, [activeFormat]: newFmt })),
		[activeFormat],
	);

	const handleSave = useCallback(() => {
		onSave(JSON.stringify(settings));
		onClose();
	}, [settings, onSave, onClose]);

	const handleFgFile = useCallback(
		async (p: string) => {
			setFgFilePath(p);
			localStorage.setItem(fgKey, p);
			const dataUrl: string = await (window as any).electronAPI.invoke('read-media-preview', p).catch(() => '');
			if (!dataUrl) return;
			setFgDataUrl(dataUrl);
			const dims = await new Promise<{ w: number; h: number } | null>((resolve) => {
				const img = new Image();
				img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
				img.onerror = () => resolve(null);
				img.src = dataUrl;
			});
			if (!dims || dims.w <= 0 || dims.h <= 0) return;
			setSettings((prev) => {
				const formats: VideoFormat[] = ['landscape', 'portrait', 'square'];
				const updated = { ...prev };
				for (const fmt of formats) {
					const { bgWidth, bgHeight } = prev[fmt];
					const ratio = dims.w / dims.h;
					let sw = dims.w, sh = dims.h;
					if (sw > bgWidth || sh > bgHeight) {
						if (bgWidth / bgHeight < ratio) {
							sw = bgWidth; sh = Math.round(bgWidth / ratio);
						} else {
							sh = bgHeight; sw = Math.round(bgHeight * ratio);
						}
					}
					const posX = parseFloat(((bgWidth - sw) / 2).toFixed(2));
					const posY = parseFloat(((bgHeight - sh) / 2).toFixed(2));
					updated[fmt] = { ...prev[fmt], scaleW: sw, scaleH: sh, posX, posY };
				}
				return updated;
			});
		},
		[fgKey],
	);

	const handleBgFile = useCallback(
		(p: string) => {
			setBgFilePath(p);
			localStorage.setItem(bgKey, p);
			(window as any).electronAPI.invoke('read-media-preview', p).then(setBgDataUrl).catch(() => {});
		},
		[bgKey],
	);

	const defColor = greyColor(80);
	const labelColor = greyColor(55);

	return (
		<ModalShell
			title='Overlay & Offset'
			onClose={onClose}
			onSave={handleSave}
			config={SHELL_CONFIG}
			headerCenter={
				<Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
					<Typography fontSize={13} fontWeight={500} color={defColor} sx={{ whiteSpace: 'nowrap' }}>
						Overlay &amp; Offset
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
				<OverlayCanvas
					settings={currentFormatSettings}
					onSettingsChange={handleFormatSettingsChange}
					bgImageSrc={bgDataUrl || undefined}
					fgImageSrc={fgDataUrl || undefined}
					canvasRef={canvasRef}
					lockAspect={lockAspect}
				/>
			}
			panelSlot={(panelWidth) => (
				<OverlaySettingsPanel
					settings={currentFormatSettings}
					onChange={handleFormatSettingsChange}
					width={panelWidth}
					bgFilePath={bgFilePath}
					fgFilePath={fgFilePath}
					onBgFile={handleBgFile}
					onFgFile={handleFgFile}
					lockAspect={lockAspect}
					onLockAspectChange={setLockAspect}
				/>
			)}
		/>
	);
}
