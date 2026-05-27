// src/NODE_WIN/nodes/properties/VideoAdjustEdit/VideoAdjustModal.tsx

import { useState, useRef, useCallback, useEffect } from 'react';
import { VideoAdjustSettings, defaultVideoAdjustSettings, oppositeFormat } from './types';
import ModalShell from '../ModalShell';
import VideoAdjustPanel from './VideoAdjustPanel';
import VideoAdjustPreview from './VideoAdjustPreview';
import { usePathStore } from '@/Store/Node/usePathStore';
import { toAbsolutePath, toStoredPath } from '@/Utils/projectPath';
import { toFileUrl } from '@/Utils/mediaUtils';

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
}

export default function VideoAdjustModal({ value, onSave, onClose }: VideoAdjustModalProps) {
	const [settings, setSettings] = useState<VideoAdjustSettings>(() => {
		if (value) {
			try {
				return JSON.parse(value) as VideoAdjustSettings;
			} catch {}
		}
		return defaultVideoAdjustSettings();
	});

	// settings.fg/bgFilePath хранится в stored-форме (relative к проекту если внутри,
	// иначе absolute). UI работает с absolute и только если файл существует.
	const projectPath = usePathStore((s) => s.path);
	const [effectiveFgPath, setEffectiveFgPath] = useState('');
	const [effectiveBgPath, setEffectiveBgPath] = useState('');

	const fgVideoDimRef = useRef<{ w: number; h: number } | null>(null);

	useEffect(() => {
		const api = (window as any).electronAPI;
		const fgAbs = settings.fgFilePath ? toAbsolutePath(settings.fgFilePath, projectPath) : '';
		const bgAbs = settings.bgFilePath ? toAbsolutePath(settings.bgFilePath, projectPath) : '';
		if (fgAbs) api.invoke('checkFilePath', fgAbs).then((ok: any) => { if (ok) setEffectiveFgPath(fgAbs); }).catch(() => {});
		if (bgAbs) api.invoke('checkFilePath', bgAbs).then((ok: any) => { if (ok) setEffectiveBgPath(bgAbs); }).catch(() => {});
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const handleSave = useCallback(() => {
		onSave(JSON.stringify(settings));
		onClose();
	}, [settings, onSave, onClose]);

	const handleFgFile = useCallback((p: string) => {
		setEffectiveFgPath(p);
		setSettings((prev) => ({ ...prev, fgFilePath: toStoredPath(p, projectPath) }));
		// В Tauri WebView не грузит file://-URL — нужен asset-протокол через convertFileSrc.
		const v = document.createElement('video');
		v.src = toFileUrl(p);
		v.onloadedmetadata = () => {
			if (v.videoWidth > 0 && v.videoHeight > 0) {
				fgVideoDimRef.current = { w: v.videoWidth, h: v.videoHeight };
				setSettings((prev) => {
					if (!prev.autoFormat) return prev;
					return { ...prev, finalFormat: oppositeFormat(v.videoWidth, v.videoHeight) };
				});
			}
		};
	}, [projectPath]);

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

	const handleBgFile = useCallback((p: string) => {
		setEffectiveBgPath(p);
		setSettings((prev) => ({ ...prev, bgFilePath: toStoredPath(p, projectPath) }));
	}, [projectPath]);

	return (
		<ModalShell
			title='Video Adjust'
			onClose={onClose}
			onSave={handleSave}
			config={SHELL_CONFIG}
			canvasSlot={
				<VideoAdjustPreview
					fgFilePath={effectiveFgPath}
					bgFilePath={effectiveBgPath}
					settings={settings}
				/>
			}
			panelSlot={(panelWidth) => (
				<VideoAdjustPanel
					settings={settings}
					onChange={handleSettingsChange}
					width={panelWidth}
					fgFilePath={effectiveFgPath}
					bgFilePath={effectiveBgPath}
					onFgFile={handleFgFile}
					onBgFile={handleBgFile}
				/>
			)}
		/>
	);
}
