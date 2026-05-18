// src/NODE_WIN/nodes/properties/KeyingEdit/KeyingModal.tsx

import { useState, useRef, useCallback } from 'react';
import { Typography } from '@mui/material';
import { KeyingSettings, defaultKeyingSettings } from './types';
import ModalShell from '../ModalShell';
import KeyingPanel from './KeyingPanel';
import KeyingPreview, { type PixelInfo } from './KeyingPreview';

const SHELL_CONFIG = {
	defaultSize: { width: 1060, height: 680 },
	minWidth: 700,
	minHeight: 460,
	defaultPanelWidth: 280,
	minPanelWidth: 220,
	maxPanelWidth: 440,
};

interface KeyingModalProps {
	value: string;
	onSave: (v: string) => void;
	onClose: () => void;
	nodeId: string;
}

export default function KeyingModal({ value, onSave, onClose, nodeId }: KeyingModalProps) {
	const [settings, setSettings] = useState<KeyingSettings>(() => {
		if (value) {
			try {
				return JSON.parse(value) as KeyingSettings;
			} catch {}
		}
		return defaultKeyingSettings();
	});

	const fileKey = `keying_filePath_${nodeId}`;
	const [filePath, setFilePath] = useState(() => localStorage.getItem(fileKey) ?? '');

	const [eyedropperActive, setEyedropperActive] = useState(false);
	const [eyedropperTarget, setEyedropperTarget] = useState<'chromakey' | 'colorkey' | 'despill'>('chromakey');
	const [hoveredPixel, setHoveredPixel] = useState<PixelInfo | null>(null);

	const eyedropperTargetRef = useRef(eyedropperTarget);
	eyedropperTargetRef.current = eyedropperTarget;

	const handleSave = useCallback(() => {
		onSave(JSON.stringify(settings));
		onClose();
	}, [settings, onSave, onClose]);

	const handleSelectFile = useCallback(
		(p: string) => {
			setFilePath(p);
			localStorage.setItem(fileKey, p);
		},
		[fileKey],
	);

	const handleEyedropperStart = useCallback((target: 'chromakey' | 'colorkey' | 'despill') => {
		setEyedropperTarget(target);
		setEyedropperActive(true);
	}, []);

	const handleEyedropperPick = useCallback((color: string) => {
		if (!color) return;
		setEyedropperActive(false);
		const target = eyedropperTargetRef.current;
		setSettings((prev) => {
			if (target === 'chromakey') return { ...prev, chromakey: { ...prev.chromakey, color } };
			if (target === 'colorkey') return { ...prev, colorkey: { ...prev.colorkey, color } };
			return { ...prev, despill: { ...prev.despill, color } };
		});
	}, []);

	return (
		<ModalShell
			title='Keying Settings'
			onClose={onClose}
			onSave={handleSave}
			config={SHELL_CONFIG}
			headerExtra={
				eyedropperActive ? (
					<Typography sx={{ fontSize: 11, color: '#ff9800', mr: 1 }}>
						Click on preview to pick color...
					</Typography>
				) : undefined
			}
			canvasSlot={
				<KeyingPreview
					filePath={filePath}
					settings={settings}
					eyedropperActive={eyedropperActive}
					onEyedropperPick={handleEyedropperPick}
					onPixelHover={setHoveredPixel}
				/>
			}
			panelSlot={(panelWidth) => (
				<KeyingPanel
					settings={settings}
					onChange={setSettings}
					width={panelWidth}
					filePath={filePath}
					onSelectFile={handleSelectFile}
					onEyedropperStart={handleEyedropperStart}
					hoveredPixel={hoveredPixel}
				/>
			)}
		/>
	);
}
