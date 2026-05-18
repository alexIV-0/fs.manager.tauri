import { TextEditLanguage } from '@/NODE_WIN/definitions/types';

export type ResizeDirection = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

export interface PresetIndexItem {
	id: string;
	name: string;
	description: string;
	language: TextEditLanguage;
}

export interface ModalTheme {
	bgModal: string;
	bgHeader: string;
	borderColor: string;
	defColor: string;
}

export interface SavePresetModalProps extends ModalTheme {
	initialText: string;
	initialLanguage: TextEditLanguage;
	editItem?: PresetIndexItem | null;
	onClose: () => void;
	onSaved: () => void;
}

export interface LoadPresetModalProps extends ModalTheme {
	currentLanguage: TextEditLanguage;
	onClose: () => void;
	onLoad: (text: string) => void;
}

export interface TextEditModalProps extends ModalTheme {
	label: string;
	value: string;
	language: TextEditLanguage;
	isFullscreen: boolean;
	modalSize: { width: number; height: number };
	anchorPos: { x: number; y: number } | null;
	editorRef: React.RefObject<HTMLDivElement | null>;
	onClose: () => void;
	onSave: () => void;
	onLanguageChange: (lang: TextEditLanguage) => void;
	onToggleFullscreen: () => void;
	onApplyPreset: (preset: 'S' | 'M' | 'L') => void;
	onResizeMouseDown: (e: React.MouseEvent, dir: ResizeDirection) => void;
	onSavePreset: () => void;
	onLoadPreset: () => void;
}
