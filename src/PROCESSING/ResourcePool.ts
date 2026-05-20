// Семафорный пул ресурсов — ограничивает параллельное выполнение шагов по colorType.
// Работает глобально: если afterEffect.limit=1, второй объект ждёт пока первый не освободит слот.

import { COLOR_TYPE_DEFAULT_LIMITS } from '@/types/appSettings';

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

/** Инициализирует пулы перед стартом обработки. Вызывается из startProcessing.
 *  userLimits — resourcePools из AppSettings (приоритет над дефолтами). */
export function initResourcePools(userLimits: Record<string, number>): void {
	pools.clear();
	const merged: Record<string, number> = { ...COLOR_TYPE_DEFAULT_LIMITS, ...userLimits };
	for (const [name, limit] of Object.entries(merged)) {
		pools.set(name, new Semaphore(Math.max(1, limit)));
	}
}

/** Захватывает слот пула для colorType. Если слотов нет — ждёт. */
export async function acquirePool(colorType: string): Promise<void> {
	const pool = pools.get(colorType);
	if (pool) await pool.acquire();
}

/** Освобождает слот и будит следующего в очереди. */
export function releasePool(colorType: string): void {
	pools.get(colorType)?.release();
}
