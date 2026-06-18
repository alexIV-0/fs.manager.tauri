// Семафорный пул ресурсов — ограничивает параллельное выполнение шагов по КЛАССУ
// ресурса (local/online/ffmpeg/helpers), а не по цвету ноды. Работает глобально:
// если local.limit=1, второй тяжёлый шаг ждёт, пока первый не освободит слот.

import {
	RESOURCE_POOL_DEFAULT_LIMITS,
	COLORTYPE_TO_POOL,
	FALLBACK_POOL,
} from '@/types/appSettings';

class Semaphore {
	private slots: number;
	private queue: (() => void)[] = [];

	constructor(limit: number) {
		this.slots = Math.max(1, limit);
	}

	acquire(): Promise<void> {
		if (this.slots > 0) {
			this.slots--;
			return Promise.resolve();
		}
		return new Promise<void>((resolve) => this.queue.push(resolve));
	}

	release(): void {
		if (this.queue.length > 0) {
			this.queue.shift()!();
		} else {
			this.slots++;
		}
	}
}

const pools = new Map<string, Semaphore>();

// Карта pluginId → пул (из manifest.resourcePool). Заполняется на старте обработки
// из текущего списка плагинов → собранные флоу подхватывают актуальное назначение
// (резолв вживую по pluginId, а не из запечённых в ноду данных).
const pluginPool = new Map<string, string>();

/** Инициализирует пулы и карту плагинов перед стартом обработки.
 *  @param userLimits  resourcePools из AppSettings (приоритет над дефолтами), ключ = имя пула.
 *  @param pluginPools массив {id, pool} из манифестов загруженных плагинов (опционально). */
export function initResourcePools(
	userLimits: Record<string, number>,
	pluginPools: Array<{ id: string; pool: string }> = [],
): void {
	pools.clear();
	const merged: Record<string, number> = { ...RESOURCE_POOL_DEFAULT_LIMITS, ...userLimits };
	for (const [name, limit] of Object.entries(merged)) {
		pools.set(name, new Semaphore(Math.max(1, limit)));
	}

	pluginPool.clear();
	for (const p of pluginPools) {
		if (p?.id && p?.pool) pluginPool.set(p.id, p.pool);
	}
}

/** Определяет имя пула для шага: manifest.resourcePool (по pluginId) → дефолт по
 *  colorType → безопасный fallback. Никогда не возвращает несуществующий пул. */
export function resolvePool(pluginId?: string, colorType?: string): string {
	const explicit = pluginId ? pluginPool.get(pluginId) : undefined;
	const candidate = explicit ?? (colorType ? COLORTYPE_TO_POOL[colorType] : undefined) ?? FALLBACK_POOL;
	// Если по какой-то причине пул не инициализирован — падаем в FALLBACK_POOL (он есть всегда).
	return pools.has(candidate) ? candidate : FALLBACK_POOL;
}

/** Захватывает слот пула. Если слотов нет — ждёт. */
export async function acquirePool(pool: string): Promise<void> {
	const sem = pools.get(pool);
	if (sem) await sem.acquire();
}

/** Освобождает слот и будит следующего в очереди. */
export function releasePool(pool: string): void {
	pools.get(pool)?.release();
}
