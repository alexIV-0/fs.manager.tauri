import { nanoid } from 'nanoid';
import { PresetIndexItem } from './types';
import { getPresetsDir } from '@/NODE_WIN/utils/getPresetDir';
import { joinPath } from '@/Utils/joinPath';
import { commands, unwrap } from '@/Utils/specta';

async function getIndexPath(): Promise<string> {
	const dir = await getPresetsDir('textPresets');
	return joinPath(dir, 'index.json');
}

export async function loadIndex(): Promise<PresetIndexItem[]> {
	const indexPath = await getIndexPath();
	const exists = unwrap(await commands.checkFilePath(indexPath, null));
	if (!exists) return [];
	try {
		const raw = unwrap(await commands.readFileSync(indexPath));
		return JSON.parse(raw) as PresetIndexItem[];
	} catch {
		return [];
	}
}

export async function saveIndex(items: PresetIndexItem[]): Promise<void> {
	const indexPath = await getIndexPath();
	unwrap(await commands.writeFile(indexPath, JSON.stringify(items, null, 2)));
}

export async function loadPresetText(id: string): Promise<string> {
	const dir = await getPresetsDir('textPresets');
	const filePath = joinPath(dir, `${id}.txt`);
	const exists = unwrap(await commands.checkFilePath(filePath, null));
	if (!exists) return '';
	return unwrap(await commands.readFileSync(filePath));
}

export async function savePresetText(id: string, text: string): Promise<void> {
	const dir = await getPresetsDir('textPresets');
	const filePath = joinPath(dir, `${id}.txt`);
	unwrap(await commands.writeFile(filePath, text));
}

export async function deletePresetFiles(id: string): Promise<void> {
	const dir = await getPresetsDir('textPresets');
	const filePath = joinPath(dir, `${id}.txt`);
	unwrap(await commands.deleteItem(filePath));
}

export function generateId(): string {
	return nanoid(8);
}
