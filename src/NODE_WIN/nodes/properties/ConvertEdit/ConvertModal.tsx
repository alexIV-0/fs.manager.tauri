// src/NODE_WIN/nodes/properties/ConvertEdit/ConvertModal.tsx

import { useState, useCallback, useEffect } from 'react';
import { ConvertSettings, defaultConvertSettings } from './types';
import ModalShell from '../ModalShell';
import ConvertPanel from './ConvertPanel';
import ConvertPreview from './ConvertPreview';
import { usePathStore } from '@/Store/Node/usePathStore';
import { toAbsolutePath, toStoredPath } from '@/Utils/projectPath';

const SHELL_CONFIG = {
	defaultSize: { width: 1060, height: 680 },
	minWidth: 700,
	minHeight: 460,
	defaultPanelWidth: 300,
	minPanelWidth: 240,
	maxPanelWidth: 480,
};

interface ConvertModalProps {
	value: string;
	onSave: (v: string) => void;
	onClose: () => void;
}

export default function ConvertModal({ value, onSave, onClose }: ConvertModalProps) {
	const [settings, setSettings] = useState<ConvertSettings>(() => {
		if (value) {
			try {
				return JSON.parse(value) as ConvertSettings;
			} catch {}
		}
		return defaultConvertSettings();
	});

	const [sourceSize, setSourceSize] = useState<{ w: number; h: number } | null>(null);

	// settings.filePath хранится в stored-форме (relative к проекту если внутри, иначе absolute).
	// UI работает с absolute, и только если файл реально существует.
	const projectPath = usePathStore((s) => s.path);
	const [effectiveFilePath, setEffectiveFilePath] = useState('');

	useEffect(() => {
		const saved = settings.filePath;
		if (!saved) return;
		const abs = toAbsolutePath(saved, projectPath);
		(async () => {
			const exists = await (window as any).electronAPI.invoke('checkFilePath', abs).catch(() => false);
			if (exists) setEffectiveFilePath(abs);
		})();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const handleSave = useCallback(() => {
		onSave(JSON.stringify(settings));
		onClose();
	}, [settings, onSave, onClose]);

	const handleSelectFile = useCallback((p: string) => {
		setEffectiveFilePath(p);
		setSettings((prev) => ({ ...prev, filePath: toStoredPath(p, projectPath) }));
	}, [projectPath]);

	return (
		<ModalShell
			title='Convert Settings'
			onClose={onClose}
			onSave={handleSave}
			config={SHELL_CONFIG}
			canvasSlot={
				<ConvertPreview
					filePath={effectiveFilePath}
					settings={settings}
					onSettingsChange={setSettings}
					onOrigSizeDetected={(w, h) => setSourceSize({ w, h })}
				/>
			}
			panelSlot={(panelWidth) => (
				<ConvertPanel
					settings={settings}
					onChange={setSettings}
					width={panelWidth}
					filePath={effectiveFilePath}
					onSelectFile={handleSelectFile}
					sourceW={sourceSize?.w}
					sourceH={sourceSize?.h}
				/>
			)}
		/>
	);
}
