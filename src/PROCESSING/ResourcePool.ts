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
// Теперь набор семафоров принадлежит ОБЛАСТИ (`poolScopeOf`), а не вызову, и
// раннеры физически не могут задеть друг друга. `disposeRunPools` не бросает
// ожидающих — он их будит с отказом, поэтому «подвиснуть навсегда» больше нечему.
//
// ── Почему набор общий у обработки и воркера ────────────────────────────────
//
// Полос стало три, но НАБОРОВ два: локальный прогон и режим воркера делят один
// (`poolScopeOf`), потому что лимиты пулов — про железо машины, а не про раннер.
// `local: 1` означает «один After Effects за раз»; два набора семафоров означали бы
// два рендера сразу, то есть ровно то, что лимит и запрещает. Поэтому набор живёт,
// пока в области есть хоть одна активная полоса: `createRunPools` регистрирует
// полосу (а семафоры создаёт только для пустой области), `disposeRunPools` снимает
// её и гасит семафоры лишь за последней. Иначе конец волны локальной обработки
// выбрасывал бы семафоры из-под работающего воркера — та же болезнь, от которой
// уходили выше, только между другой парой раннеров.
//
// Цена: лимиты фиксируются тем, кто вошёл в область первым. Поменять их на лету
// нельзя было и раньше (`startProcessing` читает настройки на старте прогона), а
// после полной остановки всех полос область пересоздаётся со свежими значениями.

import {
	RESOURCE_POOL_DEFAULT_LIMITS,
	COLORTYPE_TO_POOL,
	FALLBACK_POOL,
} from '@/types/appSettings';
import { poolScopeOf } from './runLanes';

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

interface ScopePools {
	pools: Map<string, Semaphore>;
	/** pluginId → имя пула (из `manifest.resourcePool`). */
	pluginPool: Map<string, string>;
	/** Полосы, которые сейчас работают в этой области. Пусто → набор пора гасить. */
	lanes: Set<string>;
}

const scopes = new Map<string, ScopePools>();

/**
 * Регистрирует ПОЛОСУ в её области пулов и, если область пуста, создаёт семафоры.
 *
 * Повторный вызов для уже работающей полосы семафоры НЕ пересоздаёт: выбросить их
 * из-под идущих шагов значило бы оставить ожидающих без слота, а занятые слоты — без
 * учёта. Полоса, вошедшая в область второй, пользуется уже созданным набором и
 * лимитами того, кто вошёл первым (см. шапку файла).
 *
 * @param lane        полоса прогона (она же уходит в Rust как ключ токена прерывания)
 * @param userLimits  `resourcePools` из AppSettings (приоритет над дефолтами)
 * @param pluginPools `{id, pool}` из манифестов загруженных плагинов
 */
export function createRunPools(
	lane: string,
	userLimits: Record<string, number>,
	pluginPools: Array<{ id: string; pool: string }> = [],
): void {
	const scopeId = poolScopeOf(lane);
	let scope = scopes.get(scopeId);

	if (!scope) {
		const pools = new Map<string, Semaphore>();
		const merged: Record<string, number> = { ...RESOURCE_POOL_DEFAULT_LIMITS, ...userLimits };
		for (const [name, limit] of Object.entries(merged)) {
			pools.set(name, new Semaphore(Math.max(1, limit)));
		}
		scope = { pools, pluginPool: new Map(), lanes: new Set() };
		scopes.set(scopeId, scope);
	}

	// Карту pluginId→пул досыпаем всегда: полосы приходят в область в любом порядке,
	// а набор плагинов у них один и тот же — сливаем, а не перетираем.
	for (const p of pluginPools) {
		if (p?.id && p?.pool) scope.pluginPool.set(p.id, p.pool);
	}

	scope.lanes.add(lane);
}

/**
 * Снимает полосу с области. Семафоры гасим только за ПОСЛЕДНЕЙ: пока в области
 * работает кто-то ещё, его ожидающие должны дождаться слота, а не получить отказ.
 * Когда область пустеет — будим всех отказом, чтобы никто не висел вечно.
 */
export function disposeRunPools(lane: string): void {
	const scopeId = poolScopeOf(lane);
	const scope = scopes.get(scopeId);
	if (!scope) return;

	scope.lanes.delete(lane);
	if (scope.lanes.size > 0) return;

	for (const sem of scope.pools.values()) sem.dispose();
	scopes.delete(scopeId);
}

/** Определяет имя пула для шага: `manifest.resourcePool` (по pluginId) → дефолт по
 *  colorType → безопасный fallback. Никогда не возвращает несуществующий пул. */
export function resolvePool(lane: string, pluginId?: string, colorType?: string): string {
	const scope = scopes.get(poolScopeOf(lane));
	const explicit = pluginId ? scope?.pluginPool.get(pluginId) : undefined;
	const candidate = explicit ?? (colorType ? COLORTYPE_TO_POOL[colorType] : undefined) ?? FALLBACK_POOL;
	return scope?.pools.has(candidate) ? candidate : FALLBACK_POOL;
}

/**
 * Ждёт слот пула.
 *
 * Возвращает `false`, если работу начинать НЕЛЬЗЯ: область закрыта или пользователь
 * прервал ожидание. В этом случае `releasePool` звать не нужно — слот не занят.
 * Пул без набора (полоса не зарегистрирована) даёт `true` без ограничения: так ведёт
 * себя и старый код, и это правильно для вызовов вне раннеров.
 */
export async function acquirePool(lane: string, pool: string, signal?: AbortSignal): Promise<Acquired> {
	const sem = scopes.get(poolScopeOf(lane))?.pools.get(pool);
	if (!sem) return true;
	return sem.acquire(signal);
}

/** Освобождает слот и будит следующего в очереди. */
export function releasePool(lane: string, pool: string): void {
	scopes.get(poolScopeOf(lane))?.pools.get(pool)?.release();
}
