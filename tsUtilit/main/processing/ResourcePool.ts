import { Semaphore } from './Semaphore';
import { readAppSettings } from '../settings/appSettings';
import { readColorTypes } from '../settings/colorTypes';
import { COLOR_TYPE_DEFAULT_LIMITS, FALLBACK_POOL_LIMIT } from '../settings/types';

// Пул строится лениво при первом acquire и больше не перестраивается
// до рестарта приложения (hot-reload отложен — см. docs/BACKLOG.md).
let pool: Record<string, Semaphore> | null = null;
let fallback: Semaphore | null = null;

function buildPool(): Record<string, Semaphore> {
	const settings = readAppSettings();
	const colorTypes = readColorTypes();
	const userLimits = settings.resourcePools ?? {};

	const result: Record<string, Semaphore> = {};

	// 1) Все типы из colorTypes.json (сканер уже их собрал)
	for (const entry of colorTypes.types) {
		const limit =
			userLimits[entry.name] ??
			entry.defaultLimit ??
			COLOR_TYPE_DEFAULT_LIMITS[entry.name] ??
			1;
		result[entry.name] = new Semaphore(Math.max(1, limit));
	}

	// 2) Типы, которые юзер вручную прописал в settings, но их нет в colorTypes
	for (const [name, limit] of Object.entries(userLimits)) {
		if (!result[name]) {
			result[name] = new Semaphore(Math.max(1, limit));
		}
	}

	// 3) «Известные» встроенные типы на случай, если сканер ещё не запускался
	for (const [name, defLimit] of Object.entries(COLOR_TYPE_DEFAULT_LIMITS)) {
		if (!result[name]) {
			result[name] = new Semaphore(userLimits[name] ?? defLimit);
		}
	}

	return result;
}

function ensureBuilt(): void {
	if (pool) return;
	try {
		pool = buildPool();
	} catch (e) {
		console.warn('[ResourcePool] build failed, using defaults:', e);
		pool = {
			afterEffect: new Semaphore(1),
			moho: new Semaphore(1),
			ffmpeg: new Semaphore(2),
			ai: new Semaphore(1),
			helpers: new Semaphore(10),
		};
	}
	fallback = new Semaphore(FALLBACK_POOL_LIMIT);
}

export function acquireResource(colorType: string): Promise<void> {
	ensureBuilt();
	return (pool![colorType] ?? fallback!).acquire();
}

export function releaseResource(colorType: string): void {
	ensureBuilt();
	(pool![colorType] ?? fallback!).release();
}
