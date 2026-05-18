import fs from 'fs';
import path from 'path';
import { settingsPath } from '../fileSistem/getOptionsFolder';

const FILE_NAME = 'pluginCosts.json';

export interface PluginCostEntry {
	cost: string;
	costUnit: string;
}

type CostMap = Record<string, PluginCostEntry>;

function getFilePath(): string {
	return path.join(settingsPath, FILE_NAME);
}

function ensureDir(): void {
	if (!fs.existsSync(settingsPath)) {
		fs.mkdirSync(settingsPath, { recursive: true });
	}
}

function readAll(): CostMap {
	const filePath = getFilePath();
	if (!fs.existsSync(filePath)) return {};
	try {
		return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as CostMap;
	} catch {
		return {};
	}
}

function writeAll(map: CostMap): void {
	ensureDir();
	fs.writeFileSync(getFilePath(), JSON.stringify(map, null, '\t') + '\n', 'utf-8');
}

/** Возвращает запись для плагина или undefined если её нет */
export function getPluginCost(key: string): PluginCostEntry | undefined {
	return readAll()[key];
}

/** Обновляет/создаёт запись и сохраняет файл */
export function setPluginCost(key: string, entry: PluginCostEntry): void {
	const map = readAll();
	map[key] = entry;
	writeAll(map);
}

/**
 * Если ключ уже есть — ничего не делает (сохраняем пользовательские настройки).
 * Если ключа нет — добавляет дефолт из plugin.json (первый импорт).
 * Возвращает итоговую запись (существующую или только что созданную).
 */
export function ensurePluginCostDefault(key: string, defaultEntry: PluginCostEntry): PluginCostEntry {
	const map = readAll();
	if (map[key]) return map[key];
	map[key] = defaultEntry;
	writeAll(map);
	return defaultEntry;
}
