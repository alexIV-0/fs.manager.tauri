// src/NODE_WIN/nodes/properties/ConvertEdit/ConvertModal.tsx

import { useState, useCallback, useEffect } from 'react';
import { commands, unwrap } from '@/Utils/specta';
import { ConvertSettings, defaultConvertSettings } from './types';
import ModalShell from '../ModalShell';
import ConvertPanel from './ConvertPanel';
import ConvertPreview from './ConvertPreview';
import { getConvertTheme } from './convertThemes';
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

// Компактная модалка для тем без канваса (encode-only): только панель настроек,
// с жёсткими min/max — НЕ растягиваем на всю ширину программы.
const ENCODE_ONLY_CONFIG = {
	defaultSize: { width: 460, height: 640 },
	minWidth: 360,
	minHeight: 420,
	maxWidth: 620,
	maxHeight: 1000,
	defaultPanelWidth: 460,
	minPanelWidth: 360,
	maxPanelWidth: 620,
};

interface ConvertModalProps {
	value: string;
	onSave: (v: string) => void;
	onClose: () => void;
	theme?: string;
}

export default function ConvertModal({ value, onSave, onClose, theme }: ConvertModalProps) {
	const activeTheme = getConvertTheme(theme);
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
			const exists = await commands.checkFilePath(abs, null).then(unwrap).catch(() => false);
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
			config={activeTheme.showCanvas ? SHELL_CONFIG : ENCODE_ONLY_CONFIG}
				showCanvas={activeTheme.showCanvas}
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
						theme={activeTheme}
					sourceW={sourceSize?.w}
					sourceH={sourceSize?.h}
				/>
			)}
		/>
	);
}
