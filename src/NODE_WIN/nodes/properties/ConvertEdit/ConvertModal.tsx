// src/NODE_WIN/nodes/properties/ConvertEdit/ConvertModal.tsx

import { useState, useCallback } from 'react';
import { ConvertSettings, defaultConvertSettings } from './types';
import ModalShell from '../ModalShell';
import ConvertPanel from './ConvertPanel';
import ConvertPreview from './ConvertPreview';

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
	nodeId: string;
}

export default function ConvertModal({ value, onSave, onClose, nodeId }: ConvertModalProps) {
	const [settings, setSettings] = useState<ConvertSettings>(() => {
		if (value) {
			try {
				return JSON.parse(value) as ConvertSettings;
			} catch {}
		}
		return defaultConvertSettings();
	});

	const [sourceSize, setSourceSize] = useState<{ w: number; h: number } | null>(null);

	const fileKey = `convert_filePath_${nodeId}`;
	const [filePath, setFilePath] = useState(() => localStorage.getItem(fileKey) ?? '');

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

	return (
		<ModalShell
			title='Convert Settings'
			onClose={onClose}
			onSave={handleSave}
			config={SHELL_CONFIG}
			canvasSlot={
				<ConvertPreview
					filePath={filePath}
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
					filePath={filePath}
					onSelectFile={handleSelectFile}
					sourceW={sourceSize?.w}
					sourceH={sourceSize?.h}
				/>
			)}
		/>
	);
}
