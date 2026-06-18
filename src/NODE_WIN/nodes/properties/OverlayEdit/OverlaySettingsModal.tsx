// src/NODE_WIN/nodes/properties/OverlayEdit/OverlaySettingsModal.tsx

import { useState, useRef, useEffect, useCallback } from 'react';
import { commands, unwrap } from '@/Utils/specta';
import { Box, Tabs, Tab, Typography } from '@mui/material';
import { greyColor } from '@/Store/Color/grayColor';
import { OverlaySettings, OverlayFormatSettings, VideoFormat, defaultOverlaySettings } from './types';
import { DEFAULT_MODAL_SIZE, MIN_MODAL_WIDTH, MIN_MODAL_HEIGHT, DEFAULT_PANEL_WIDTH, MIN_PANEL_WIDTH, MAX_PANEL_WIDTH } from './constants';
import ModalShell from '../ModalShell';
import OverlayCanvas from './OverlayCanvas';
import OverlaySettingsPanel from './OverlaySettingsPanel';
import { usePathStore } from '@/Store/Node/usePathStore';
import { toAbsolutePath, toStoredPath } from '@/Utils/projectPath';

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
}

export default function OverlaySettingsModal({ value, onSave, onClose }: OverlaySettingsModalProps) {
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

	// Пути в settings.fg/bgFilePath хранятся в stored-форме (relative к проекту если внутри,
	// иначе absolute). UI получает absolute и только после подтверждения существования файла.
	const projectPath = usePathStore((s) => s.path);
	const [effectiveFgPath, setEffectiveFgPath] = useState('');
	const [effectiveBgPath, setEffectiveBgPath] = useState('');
	const [fgDataUrl, setFgDataUrl] = useState('');
	const [bgDataUrl, setBgDataUrl] = useState('');

	const canvasRef = useRef<HTMLCanvasElement>(null);

	useEffect(() => {
		const fgAbs = settings.fgFilePath ? toAbsolutePath(settings.fgFilePath, projectPath) : '';
		const bgAbs = settings.bgFilePath ? toAbsolutePath(settings.bgFilePath, projectPath) : '';
		if (fgAbs) {
			commands.checkFilePath(fgAbs, null).then((r) => {
				if (!unwrap(r)) return;
				setEffectiveFgPath(fgAbs);
				commands.readMediaPreview(fgAbs).then((rp) => setFgDataUrl(unwrap(rp))).catch(() => {});
			}).catch(() => {});
		}
		if (bgAbs) {
			commands.checkFilePath(bgAbs, null).then((r) => {
				if (!unwrap(r)) return;
				setEffectiveBgPath(bgAbs);
				commands.readMediaPreview(bgAbs).then((rp) => setBgDataUrl(unwrap(rp))).catch(() => {});
			}).catch(() => {});
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

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

	const handleFgFile = useCallback(async (p: string) => {
		setEffectiveFgPath(p);
		const stored = toStoredPath(p, projectPath);
		const dataUrl: string = await commands.readMediaPreview(p).then(unwrap).catch(() => '');
		if (!dataUrl) {
			setSettings((prev) => ({ ...prev, fgFilePath: stored }));
			return;
		}
		setFgDataUrl(dataUrl);
		const dims = await new Promise<{ w: number; h: number } | null>((resolve) => {
			const img = new Image();
			img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
			img.onerror = () => resolve(null);
			img.src = dataUrl;
		});
		setSettings((prev) => {
			const next: OverlaySettings = { ...prev, fgFilePath: stored };
			if (!dims || dims.w <= 0 || dims.h <= 0) return next;
			const formats: VideoFormat[] = ['landscape', 'portrait', 'square'];
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
				next[fmt] = { ...prev[fmt], scaleW: sw, scaleH: sh, posX, posY };
			}
			return next;
		});
	}, [projectPath]);

	const handleBgFile = useCallback((p: string) => {
		setEffectiveBgPath(p);
		setSettings((prev) => ({ ...prev, bgFilePath: toStoredPath(p, projectPath) }));
		commands.readMediaPreview(p).then((r) => setBgDataUrl(unwrap(r))).catch(() => {});
	}, [projectPath]);

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
					allFormats={settings}
					fgFilePath={effectiveFgPath}
					bgFilePath={effectiveBgPath}
				/>
			}
			panelSlot={(panelWidth) => (
				<OverlaySettingsPanel
					settings={currentFormatSettings}
					onChange={handleFormatSettingsChange}
					width={panelWidth}
					bgFilePath={effectiveBgPath}
					fgFilePath={effectiveFgPath}
					onBgFile={handleBgFile}
					onFgFile={handleFgFile}
					lockAspect={lockAspect}
					onLockAspectChange={setLockAspect}
				/>
			)}
		/>
	);
}
