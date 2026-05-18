// src/NODE_WIN/nodes/properties/TitleEdit/presetUtils.ts

import { getPresetsDir } from '@/NODE_WIN/utils/getPresetDir';
import { TitlePresetItem, TitleSettings } from './types';
import { joinPath } from '@/Utils/joinPath';

const api = window.electronAPI;

// ── Пути ─────────────────────────────────────────────────────────────────────

async function getIndexPath(): Promise<string> {
	const dir = await getPresetsDir('titlePresets');
	return joinPath(dir, 'index.json');
}

async function getPresetDataPath(id: string): Promise<string> {
	const dir = await getPresetsDir('titlePresets');
	return joinPath(dir, `${id}.json`);
}

// ── Index (список пресетов) ───────────────────────────────────────────────────

export async function loadPresetIndex(): Promise<TitlePresetItem[]> {
	const indexPath = await getIndexPath();
	const exists = await api.invoke<string>('checkFilePath', indexPath);
	if (!exists) return [];

	try {
		const raw = await api.invoke<string>('readFileSync', indexPath);
		return JSON.parse(raw) as TitlePresetItem[];
	} catch {
		return [];
	}
}

export async function savePresetIndex(items: TitlePresetItem[]): Promise<void> {
	const indexPath = await getIndexPath();
	await api.invoke('writeFile', indexPath, JSON.stringify(items, null, 2));
}

// ── Данные пресета ────────────────────────────────────────────────────────────

export async function loadPresetData(id: string): Promise<TitleSettings | null> {
	const dataPath = await getPresetDataPath(id);
	const exists = await api.invoke<string>('checkFilePath', dataPath);
	if (!exists) return null;

	try {
		const raw = await api.invoke<string>('readFileSync', dataPath);
		return JSON.parse(raw) as TitleSettings;
	} catch {
		return null;
	}
}

export async function savePresetData(id: string, settings: TitleSettings): Promise<void> {
	const dataPath = await getPresetDataPath(id);
	await api.invoke('writeFile', dataPath, JSON.stringify(settings, null, 2));
}

// ── Удаление ──────────────────────────────────────────────────────────────────

export async function deletePreset(id: string): Promise<void> {
	const dataPath = await getPresetDataPath(id);
	await api.invoke('deleteItem', dataPath);
}

// ── Сохранение нового пресета ─────────────────────────────────────────────────

export async function saveNewPreset(
	name: string,
	description: string,
	settings: TitleSettings,
	previewBase64: string,
): Promise<TitlePresetItem> {
	const id = generateId();

	const newItem: TitlePresetItem = {
		id,
		name,
		description,
		preview: previewBase64,
	};

	// Сохраняем данные настроек
	await savePresetData(id, settings);

	// Обновляем индекс
	const index = await loadPresetIndex();
	await savePresetIndex([...index, newItem]);

	return newItem;
}

// ── Обновление существующего пресета ─────────────────────────────────────────

export async function updatePreset(
	id: string,
	name: string,
	description: string,
	settings: TitleSettings,
	previewBase64: string,
): Promise<void> {
	// Обновляем данные
	await savePresetData(id, settings);

	// Обновляем запись в индексе
	const index = await loadPresetIndex();
	const updated = index.map((item) => (item.id === id ? { ...item, name, description, preview: previewBase64 } : item));
	await savePresetIndex(updated);
}

// ── Генерация превью из canvas ────────────────────────────────────────────────

export function generatePreviewFromCanvas(canvas: HTMLCanvasElement, maxWidth = 200, maxHeight = 120): string {
	// Создаём маленький canvas для превью
	const previewCanvas = document.createElement('canvas');
	previewCanvas.width = maxWidth;
	previewCanvas.height = maxHeight;

	const ctx = previewCanvas.getContext('2d');
	if (!ctx) return '';

	// Рисуем оригинальный canvas масштабированным
	ctx.drawImage(canvas, 0, 0, maxWidth, maxHeight);

	return previewCanvas.toDataURL('image/png');
}

// ── Утилиты ───────────────────────────────────────────────────────────────────

function generateId(): string {
	return `title_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}
