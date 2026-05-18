// src/NODE_WIN/nodes/properties/VideoAdjustEdit/VideoAdjustModal.tsx

import { useState, useRef, useCallback } from 'react';
import { VideoAdjustSettings, defaultVideoAdjustSettings, oppositeFormat } from './types';
import ModalShell from '../ModalShell';
import VideoAdjustPanel from './VideoAdjustPanel';
import VideoAdjustPreview from './VideoAdjustPreview';

const SHELL_CONFIG = {
	defaultSize: { width: 1000, height: 640 },
	minWidth: 640,
	minHeight: 420,
	defaultPanelWidth: 280,
	minPanelWidth: 200,
	maxPanelWidth: 440,
};

interface VideoAdjustModalProps {
	value: string;
	onSave: (v: string) => void;
	onClose: () => void;
	nodeId: string;
}

export default function VideoAdjustModal({ value, onSave, onClose, nodeId }: VideoAdjustModalProps) {
	const [settings, setSettings] = useState<VideoAdjustSettings>(() => {
		if (value) {
			try {
				return JSON.parse(value) as VideoAdjustSettings;
			} catch {}
		}
		return defaultVideoAdjustSettings();
	});

	const fgKey = `videoAdjust_fgFilePath_${nodeId}`;
	const bgKey = `videoAdjust_bgFilePath_${nodeId}`;
	const [fgFilePath, setFgFilePath] = useState(() => localStorage.getItem(fgKey) ?? '');
	const [bgFilePath, setBgFilePath] = useState(() => localStorage.getItem(bgKey) ?? '');

	const fgVideoDimRef = useRef<{ w: number; h: number } | null>(null);

	const handleSave = useCallback(() => {
		onSave(JSON.stringify(settings));
		onClose();
	}, [settings, onSave, onClose]);

	const handleFgFile = useCallback(
		(p: string) => {
			setFgFilePath(p);
			localStorage.setItem(fgKey, p);
			const norm = p.replace(/\\/g, '/');
			const url = norm.startsWith('/') ? `file://${norm}` : `file:///${norm}`;
			const v = document.createElement('video');
			v.src = url;
			v.onloadedmetadata = () => {
				if (v.videoWidth > 0 && v.videoHeight > 0) {
					fgVideoDimRef.current = { w: v.videoWidth, h: v.videoHeight };
					setSettings((prev) => {
						if (!prev.autoFormat) return prev;
						return { ...prev, finalFormat: oppositeFormat(v.videoWidth, v.videoHeight) };
					});
				}
			};
		},
		[fgKey],
	);

	const handleSettingsChange = useCallback((s: VideoAdjustSettings) => {
		if (s.autoFormat && fgVideoDimRef.current) {
			const dim = fgVideoDimRef.current;
			const fmt = oppositeFormat(dim.w, dim.h);
			if (s.finalFormat[0] !== fmt[0] || s.finalFormat[1] !== fmt[1]) {
				setSettings({ ...s, finalFormat: fmt });
				return;
			}
		}
		setSettings(s);
	}, []);

	const handleBgFile = useCallback(
		(p: string) => {
			setBgFilePath(p);
			localStorage.setItem(bgKey, p);
		},
		[bgKey],
	);

	return (
		<ModalShell
			title='Video Adjust'
			onClose={onClose}
			onSave={handleSave}
			config={SHELL_CONFIG}
			canvasSlot={
				<VideoAdjustPreview
					fgFilePath={fgFilePath}
					bgFilePath={bgFilePath}
					settings={settings}
				/>
			}
			panelSlot={(panelWidth) => (
				<VideoAdjustPanel
					settings={settings}
					onChange={handleSettingsChange}
					width={panelWidth}
					fgFilePath={fgFilePath}
					bgFilePath={bgFilePath}
					onFgFile={handleFgFile}
					onBgFile={handleBgFile}
				/>
			)}
		/>
	);
}
