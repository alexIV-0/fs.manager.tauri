import fs from 'fs';
import path from 'path';
import { settingsPath } from '../fileSistem/getOptionsFolder';
import {
	APP_SETTINGS_VERSION,
	AppSettings,
	DEFAULT_APP_SETTINGS,
} from './types';

const FILE_NAME = 'app-settings.json';

function getFilePath(): string {
	return path.join(settingsPath, FILE_NAME);
}

function ensureDir(): void {
	if (!fs.existsSync(settingsPath)) {
		fs.mkdirSync(settingsPath, { recursive: true });
	}
}

// Глубокий мердж дефолтов поверх прочитанного — защищает от неполного файла
// и от добавления новых полей в будущих версиях.
function mergeWithDefaults(raw: Partial<AppSettings> | null): AppSettings {
	const d = DEFAULT_APP_SETTINGS;
	if (!raw || typeof raw !== 'object') return { ...d };
	const rawPools =
		raw.resourcePools && typeof raw.resourcePools === 'object'
			? (Object.fromEntries(
					Object.entries(raw.resourcePools).filter(
						([, v]) => typeof v === 'number' && Number.isFinite(v),
					),
				) as Record<string, number>)
			: {};

	// Миграция старого формата localArchive → новый localArchives
	let localArchives = raw.storage?.localArchives ?? [];
	if (!Array.isArray(localArchives) && (raw.storage as any)?.localArchive) {
		const oldArchive = (raw.storage as any).localArchive;
		if (oldArchive.path || oldArchive.templateId) {
			const normalizedPath: string[] = Array.isArray(oldArchive.path)
				? oldArchive.path.filter((s: unknown): s is string => typeof s === 'string')
				: typeof oldArchive.path === 'string' && oldArchive.path
					? [oldArchive.path]
					: [];
			localArchives = [
				{
					enabled: oldArchive.enabled ?? false,
					path: normalizedPath,
					templateId: oldArchive.templateId ?? 'local-archive',
				},
			];
		}
	}
	// Валидация массива
	localArchives = Array.isArray(localArchives)
		? localArchives.filter((a) => a && typeof a === 'object')
		: [];

	const rawOnline = raw.storage?.onlineDb ?? {};

	// Миграция scanSchedule: старое поле backupScanMin → новое maxScanWaitMin.
	// Также чистим устаревшие watcher*-поля из processing.
	const rawScan = (raw.scanSchedule ?? {}) as any;
	const migratedScan: Partial<typeof d.scanSchedule> = {};
	if (typeof rawScan.maxScanWaitMin === 'number') migratedScan.maxScanWaitMin = rawScan.maxScanWaitMin;
	else if (typeof rawScan.backupScanMin === 'number') migratedScan.maxScanWaitMin = rawScan.backupScanMin;
	if (typeof rawScan.minScanWaitMin === 'number') migratedScan.minScanWaitMin = rawScan.minScanWaitMin;
	if (typeof rawScan.foldersDelayMs === 'number') migratedScan.foldersDelayMs = rawScan.foldersDelayMs;

	const rawProc = (raw.processing ?? {}) as any;
	const migratedProc: Partial<typeof d.processing> = {};
	if (typeof rawProc.maxParallel === 'number') migratedProc.maxParallel = rawProc.maxParallel;

	return {
		version: APP_SETTINGS_VERSION,
		processing: { ...d.processing, ...migratedProc },
		scanSchedule: { ...d.scanSchedule, ...migratedScan },
		resourcePools: rawPools,
		storage: {
			localArchives,
			onlineDb: {
				...d.storage.onlineDb,
				...rawOnline,
			},
		},
		cleanup: { ...d.cleanup, ...(raw.cleanup ?? {}) },
		logging: { ...d.logging, ...(raw.logging ?? {}) },
	};
}

function mergePools(
	base: Record<string, number>,
	patch: Partial<Record<string, number>> | undefined,
): Record<string, number> {
	const result: Record<string, number> = { ...base };
	if (!patch) return result;
	for (const [key, val] of Object.entries(patch)) {
		if (typeof val === 'number' && Number.isFinite(val)) result[key] = val;
	}
	return result;
}

let cache: AppSettings | null = null;

export function readAppSettings(): AppSettings {
	if (cache) return cache;

	const file = getFilePath();
	if (!fs.existsSync(file)) {
		cache = { ...DEFAULT_APP_SETTINGS };
		return cache;
	}

	try {
		const raw = fs.readFileSync(file, 'utf-8');
		const parsed = JSON.parse(raw) as Partial<AppSettings>;
		cache = mergeWithDefaults(parsed);
		return cache;
	} catch (e) {
		console.warn('[appSettings] failed to read, using defaults:', e);
		cache = { ...DEFAULT_APP_SETTINGS };
		return cache;
	}
}

// Атомарная запись: пишем в .tmp, потом переименовываем.
function writeAtomic(data: AppSettings): void {
	ensureDir();
	const file = getFilePath();
	const tmp = `${file}.tmp`;
	fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
	fs.renameSync(tmp, file);
}

// Полная перезапись (с сохранением валидности версии).
export function writeAppSettings(next: AppSettings): AppSettings {
	const merged = mergeWithDefaults(next);
	writeAtomic(merged);
	cache = merged;
	return merged;
}

// Частичный патч по секциям — удобно для UI.
// Глубина: один уровень внутри секции (processing.maxParallel, storage.onlineDb.url и т.д.)
export type AppSettingsPatch = {
	[K in keyof Omit<AppSettings, 'version'>]?: Partial<AppSettings[K]>;
};

export function patchAppSettings(patch: AppSettingsPatch): AppSettings {
	const current = readAppSettings();
	const patchStorage = patch.storage as any;

	// Если пытаемся обновить localArchives, используем новый формат
	let localArchives = current.storage.localArchives;
	if (patchStorage?.localArchives !== undefined) {
		localArchives = Array.isArray(patchStorage.localArchives) ? patchStorage.localArchives : current.storage.localArchives;
	}

	const next: AppSettings = {
		...current,
		processing: { ...current.processing, ...(patch.processing ?? {}) },
		scanSchedule: { ...current.scanSchedule, ...(patch.scanSchedule ?? {}) },
		resourcePools: mergePools(current.resourcePools, patch.resourcePools),
		storage: {
			localArchives,
			onlineDb: {
				...current.storage.onlineDb,
				...(patchStorage?.onlineDb ?? {}),
			},
		},
		cleanup: { ...current.cleanup, ...(patch.cleanup ?? {}) },
		logging: { ...current.logging, ...(patch.logging ?? {}) },
	};
	return writeAppSettings(next);
}

// Сбросить кэш — полезно в тестах и при внешних изменениях файла.
export function invalidateAppSettingsCache(): void {
	cache = null;
}
