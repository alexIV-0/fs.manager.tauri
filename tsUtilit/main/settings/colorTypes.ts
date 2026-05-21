import fs from 'fs';
import path from 'path';
import { settingsPath } from '../fileSistem/getOptionsFolder';
import {
	COLOR_TYPES_VERSION,
	COLOR_TYPE_DEFAULT_LIMITS,
	ColorTypeEntry,
	ColorTypesFile,
	DEFAULT_COLOR_TYPES,
} from './types';
import { getPluginManager } from '../pluginManagerRef';

const FILE_NAME = 'colorTypes.json';

function getFilePath(): string {
	return path.join(settingsPath, FILE_NAME);
}

function ensureDir(): void {
	if (!fs.existsSync(settingsPath)) {
		fs.mkdirSync(settingsPath, { recursive: true });
	}
}

function writeAtomic(data: ColorTypesFile): void {
	ensureDir();
	const file = getFilePath();
	const tmp = `${file}.tmp`;
	fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
	fs.renameSync(tmp, file);
}

let cache: ColorTypesFile | null = null;

export function readColorTypes(): ColorTypesFile {
	if (cache) return cache;

	const file = getFilePath();
	if (!fs.existsSync(file)) {
		cache = { ...DEFAULT_COLOR_TYPES, types: [] };
		return cache;
	}
	try {
		const raw = fs.readFileSync(file, 'utf-8');
		const parsed = JSON.parse(raw) as Partial<ColorTypesFile>;
		cache = {
			version: COLOR_TYPES_VERSION,
			types: Array.isArray(parsed.types) ? parsed.types : [],
			lastScannedAt: parsed.lastScannedAt ?? null,
		};
		return cache;
	} catch (e) {
		console.warn('[colorTypes] failed to read, using defaults:', e);
		cache = { ...DEFAULT_COLOR_TYPES, types: [] };
		return cache;
	}
}

export function writeColorTypes(next: ColorTypesFile): ColorTypesFile {
	const clean: ColorTypesFile = {
		version: COLOR_TYPES_VERSION,
		types: next.types ?? [],
		lastScannedAt: next.lastScannedAt ?? null,
	};
	writeAtomic(clean);
	cache = clean;
	return clean;
}

export function invalidateColorTypesCache(): void {
	cache = null;
}

// Собирает уникальные colorType из всех загруженных плагинов.
async function collectUsedColorTypes(): Promise<Set<string>> {
	const used = new Set<string>();
	try {
		const pm = getPluginManager();
		const nodes = await pm.getAllUINodes();
		for (const node of nodes) {
			const ct = node?.data?.colorType;
			if (typeof ct === 'string' && ct.trim() !== '') {
				used.add(ct.trim());
			}
		}
	} catch (e) {
		console.warn('[colorTypes] rescan: pluginManager unavailable:', e);
	}
	return used;
}

// Пересканить плагины:
// — добавить новые colorType, которых ещё нет в сторе
// — отметить orphan: true тем, что больше не используются
// — ничего не удалять (юзер может вернуть плагин)
export async function rescanColorTypes(): Promise<ColorTypesFile> {
	const current = readColorTypes();
	const used = await collectUsedColorTypes();

	const existingByName = new Map(current.types.map((t) => [t.name, t]));
	const merged: ColorTypeEntry[] = [];

	// Обновляем существующие записи
	for (const entry of current.types) {
		merged.push({
			...entry,
			orphan: !used.has(entry.name),
		});
	}

	// Добавляем новые
	for (const name of used) {
		if (!existingByName.has(name)) {
			merged.push({
				name,
				defaultLimit: COLOR_TYPE_DEFAULT_LIMITS[name] ?? 1,
				orphan: false,
			});
		}
	}

	// Сортировка: сначала активные (по имени), потом orphan
	merged.sort((a, b) => {
		if (a.orphan !== b.orphan) return a.orphan ? 1 : -1;
		return a.name.localeCompare(b.name);
	});

	return writeColorTypes({
		version: COLOR_TYPES_VERSION,
		types: merged,
		lastScannedAt: new Date().toISOString(),
	});
}

// Добавить тип вручную (из PluginBuilder).
// Если уже есть — оставляем как есть, не перетираем.
export function addColorType(name: string, defaultLimit = 1): ColorTypesFile {
	const trimmed = name.trim();
	if (!trimmed) return readColorTypes();

	const current = readColorTypes();
	if (current.types.some((t) => t.name === trimmed)) return current;

	const next: ColorTypesFile = {
		...current,
		types: [
			...current.types,
			{ name: trimmed, defaultLimit, orphan: true }, // orphan=true пока плагин не появится
		],
	};
	return writeColorTypes(next);
}

// Удалить тип. Безопасно даже если плагины ещё используют его в ui.json —
// при следующем Refresh он вернётся в стор с orphan=false.
export function removeColorType(name: string): ColorTypesFile {
	const current = readColorTypes();
	const filtered = current.types.filter((t) => t.name !== name);
	if (filtered.length === current.types.length) return current;
	return writeColorTypes({ ...current, types: filtered });
}
