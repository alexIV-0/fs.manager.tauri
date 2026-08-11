// Семафорный пул ресурсов — ограничивает параллельное выполнение шагов по КЛАССУ
// ресурса (local/online/ffmpeg/helpers), а не по цвету ноды.
//
// ── Почему пулы принадлежат ПРОГОНУ, а не процессу ──────────────────────────
//
// Раньше здесь были два процессных синглтона (`pools`, `pluginPool`), а
// `initResourcePools` начинался с `pools.clear()`. Инициализацию зовут ДВА
// независимых раннера: обработка (`startProcessing`) и постинг
// (`startPostScheduler`) — у постинга своя кнопка Start/Stop и свои часы, так что
// он может стартовать посреди обработки. И тогда `clear()` выбрасывал семафоры
// ВМЕСТЕ С ОЧЕРЕДЬЮ ожидающих `resolve`: их промисы не резолвились уже никогда
// (`releasePool` обращался к новому семафору), шаг не возвращался, а
// `Promise.allSettled(running)` в `startProcessing` вис вечно — Stop не помогал,
// лечилось перезапуском приложения. Тот же `clear()` тихо раздувал лимиты:
// слот освобождался у нового семафора.
//
// Теперь у каждого прогона свой набор семафоров под своим `runId`, и раннеры
// физически не могут задеть друг друга. `disposeRunPools` не бросает ожидающих —
// он их будит с отказом, поэтому «подвиснуть навсегда» больше нечему.

import {
	RESOURCE_POOL_DEFAULT_LIMITS,
	COLORTYPE_TO_POOL,
	FALLBACK_POOL,
} from '@/types/appSettings';

/** Итог ожидания слота. `false` = слот не получен, работу начинать нельзя. */
type Acquired = boolean;

class Semaphore {
	private slots: number;
	/** Ожидающие. Каждому отдаём `true` (слот занят) или `false` (отказ). */
	private queue: ((ok: Acquired) => void)[] = [];
	private disposed = false;

	constructor(limit: number) {
		this.slots = Math.max(1, limit);
	}

	acquire(signal?: AbortSignal): Promise<Acquired> {
		if (this.disposed) return Promise.resolve(false);
		if (signal?.aborted) return Promise.resolve(false);
		if (this.slots > 0) {
			this.slots--;
			return Promise.resolve(true);
		}

		return new Promise<Acquired>((resolve) => {
			let settled = false;
			const finish = (ok: Acquired) => {
				if (settled) return;
				settled = true;
				signal?.removeEventListener('abort', onAbort);
				resolve(ok);
			};

			// Прерывание во время ожидания слота. Без этого шаг, дождавшийся слота
			// после полной остановки, всё равно запускал плагин.
			const onAbort = () => {
				const i = this.queue.indexOf(waiter);
				if (i >= 0) this.queue.splice(i, 1);
				finish(false);
			};

			const waiter = (ok: Acquired) => finish(ok);
			this.queue.push(waiter);
			signal?.addEventListener('abort', onAbort, { once: true });
		});
	}

	release(): void {
		if (this.disposed) return;
		const next = this.queue.shift();
		if (next) next(true);
		else this.slots++;
	}

	/** Будит всех ожидающих отказом. Слот после этого не выдаётся никому. */
	dispose(): void {
		this.disposed = true;
		const waiting = this.queue.splice(0);
		for (const w of waiting) w(false);
	}
}

interface RunPools {
	pools: Map<string, Semaphore>;
	/** pluginId → имя пула (из `manifest.resourcePool`). */
	pluginPool: Map<string, string>;
}

const runs = new Map<string, RunPools>();

/**
 * Создаёт набор пулов для ОДНОГО прогона. Повторный вызов с тем же `runId`
 * пересоздаёт набор — но сначала корректно будит ожидающих прежнего.
 *
 * @param runId       идентификатор прогона (он же уходит в Rust как ключ токена прерывания)
 * @param userLimits  `resourcePools` из AppSettings (приоритет над дефолтами)
 * @param pluginPools `{id, pool}` из манифестов загруженных плагинов
 */
export function createRunPools(
	runId: string,
	userLimits: Record<string, number>,
	pluginPools: Array<{ id: string; pool: string }> = [],
): void {
	disposeRunPools(runId);

	const pools = new Map<string, Semaphore>();
	const merged: Record<string, number> = { ...RESOURCE_POOL_DEFAULT_LIMITS, ...userLimits };
	for (const [name, limit] of Object.entries(merged)) {
		pools.set(name, new Semaphore(Math.max(1, limit)));
	}

	const pluginPool = new Map<string, string>();
	for (const p of pluginPools) {
		if (p?.id && p?.pool) pluginPool.set(p.id, p.pool);
	}

	runs.set(runId, { pools, pluginPool });
}

/** Закрывает набор прогона: ожидающие получают отказ, а не висят вечно. */
export function disposeRunPools(runId: string): void {
	const run = runs.get(runId);
	if (!run) return;
	for (const sem of run.pools.values()) sem.dispose();
	runs.delete(runId);
}

/** Определяет имя пула для шага: `manifest.resourcePool` (по pluginId) → дефолт по
 *  colorType → безопасный fallback. Никогда не возвращает несуществующий пул. */
export function resolvePool(runId: string, pluginId?: string, colorType?: string): string {
	const run = runs.get(runId);
	const explicit = pluginId ? run?.pluginPool.get(pluginId) : undefined;
	const candidate = explicit ?? (colorType ? COLORTYPE_TO_POOL[colorType] : undefined) ?? FALLBACK_POOL;
	return run?.pools.has(candidate) ? candidate : FALLBACK_POOL;
}

/**
 * Ждёт слот пула.
 *
 * Возвращает `false`, если работу начинать НЕЛЬЗЯ: прогон закрыт или пользователь
 * прервал ожидание. В этом случае `releasePool` звать не нужно — слот не занят.
 * Пул без набора (прогон не создан) даёт `true` без ограничения: так ведёт себя
 * и старый код, и это правильно для вызовов вне раннеров.
 */
export async function acquirePool(runId: string, pool: string, signal?: AbortSignal): Promise<Acquired> {
	const sem = runs.get(runId)?.pools.get(pool);
	if (!sem) return true;
	return sem.acquire(signal);
}

/** Освобождает слот и будит следующего в очереди. */
export function releasePool(runId: string, pool: string): void {
	runs.get(runId)?.pools.get(pool)?.release();
}
