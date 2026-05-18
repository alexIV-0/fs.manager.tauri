import { TextEditLanguage } from '@/NODE_WIN/definitions/types';

export const LANGUAGES: { value: TextEditLanguage; label: string }[] = [
	{ value: 'plaintext', label: 'Plain Text' },
	{ value: 'javascript', label: 'JavaScript' },
	{ value: 'typescript', label: 'TypeScript' },
	{ value: 'json', label: 'JSON' },
	{ value: 'python', label: 'Python' },
];

export const PRESETS = {
	S: { width: 420, height: 300 },
	M: { width: 640, height: 460 },
	L: { width: 900, height: 620 },
};

export const MIN_WIDTH = 320;
export const MIN_HEIGHT = 200;
