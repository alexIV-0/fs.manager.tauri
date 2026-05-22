import { nanoid } from 'nanoid';
import { PresetIndexItem } from './types';
import { getPresetsDir } from '@/NODE_WIN/utils/getPresetDir';
import { joinPath } from '@/Utils/joinPath';
import { tauriAPI } from '@/Utils/tauri-api';

const api = tauriAPI;

async function getIndexPath(): Promise<string> {
	const dir = await getPresetsDir('textPresets');
	return joinPath(dir, 'index.json');
}

export async function loadIndex(): Promise<PresetIndexItem[]> {
	const indexPath = await getIndexPath();
	const exists = await api.invoke<string>('checkFilePath', indexPath);
	if (!exists) return [];
	try {
		const raw = await api.invoke<string>('readFileSync', indexPath);
		return JSON.parse(raw) as PresetIndexItem[];
	} catch {
		return [];
	}
}

export async function saveIndex(items: PresetIndexItem[]): Promise<void> {
	const indexPath = await getIndexPath();
	await api.invoke('writeFile', indexPath, JSON.stringify(items, null, 2));
}

export async function loadPresetText(id: string): Promise<string> {
	const dir = await getPresetsDir('textPresets');
	const filePath = joinPath(dir, `${id}.txt`);
	const exists = await api.invoke<string>('checkFilePath', filePath);
	if (!exists) return '';
	return api.invoke<string>('readFileSync', filePath);
}

export async function savePresetText(id: string, text: string): Promise<void> {
	const dir = await getPresetsDir('textPresets');
	const filePath = joinPath(dir, `${id}.txt`);
	await api.invoke('writeFile', filePath, text);
}

export async function deletePresetFiles(id: string): Promise<void> {
	const dir = await getPresetsDir('textPresets');
	const filePath = joinPath(dir, `${id}.txt`);
	await api.invoke('deleteItem', filePath);
}

export function generateId(): string {
	return nanoid(8);
}
