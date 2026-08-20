// Режим воркера: машина сама берёт задачи из очереди сайта.
//
// Цикл простой: спросить задачу → нет, подождать и спросить снова → есть, выполнить и
// отчитаться. Пустой ответ — норма, а не ошибка: очередь пуста большую часть времени.
// Материализация задачи и её исполнение — в `runTask.ts`, здесь только жизненный цикл
// режима и разговор с очередью.
//
// Ошибка ЗАПРОСА режим не гасит (сеть моргнула, сайт перезапустили) — показываем и
// спрашиваем дальше. А вот сбой ВЗЯТОЙ задачи обязан вернуть её в очередь: оставленная
// взятой, она пятнадцать минут ждёт протухания аренды, и всё это время её никто не
// подхватит.
//
// ПОЛОСА. У воркера она своя (`worker`), и это ровно то, что позволяет ему работать
// ОДНОВРЕМЕННО с локальным прогоном: полоса решает, чей стоп кого убивает. С общей
// полосой `processing` кнопка Stop локальной обработки прибивала бы ffmpeg взятой
// задачи, а аварийный стоп воркера — наоборот, чужой рендер.
//
// А вот СЕМАФОРЫ у воркера общие с локальным прогоном (`poolScopeOf` в `runLanes.ts`):
// лимиты пулов — про железо машины, и `local: 1` («один After Effects за раз») обязан
// остаться единицей на всю машину, а не стать двойкой оттого, что раннеров два. Шаг
// воркера просто ждёт свободный слот наравне с локальными. Поэтому запрета «пока идёт
// локальная обработка — не запускаться» здесь больше нет: очередь за слотами разводит
// нагрузку сама, а запрет отнимал у машины половину работы.
//
// Play в окне нод в эту схему не входит и не должен: он гоняет одну локальную папку в
// СВОЁМ realm'е, а семафоры — модульное состояние окна, поэтому `local: 1` между ним и
// воркером не держится. Это ручной запуск «здесь и сейчас» для локальной работы, и
// сводить его с очередью незачем — общий замок в Rust заводить не надо.
//
// Постинг — третья полоса со своим набором пулов, он параллелен обоим.
//
// ДВЕ ОСТАНОВКИ, и это не одна кнопка с оговоркой:
//   • мягкая  — новых задач не берём, текущую доводим, заливаем, отчитываемся, гаснем;
//   • аварийная — убиваем процессы сейчас и ВОЗВРАЩАЕМ задачу в очередь (`release`),
//     не дожидаясь протухания аренды. Без этого задача 15 минут числится взятой, и
//     подхватить её никто не может.

import { commands, unwrap } from '@/Utils/specta';
import { useWorker_store } from '@/Store/Processing/useWorker_store';
import { plugin_Store } from '@/Store/MainWin/plugin_store';
import { loadPlugin } from '@/PluginAPI/loader';
import { hostServices, invokeHost } from '@/PluginAPI/host';
import { joinPath } from '@/Utils/joinPath';
import { createRunPools, disposeRunPools } from '../ResourcePool';
import { RUN_WORKER } from '../runLanes';
import { getAppSettings } from '@/Store/Settings/appSettings_client';
import { abortNow, getSignal, startProcessContext } from '../utils/processingAbort';
import { WORKER_PLUGIN_ID } from './useWorkerAvailable';
import { runTask } from './runTask';

/**
 * Пауза между запросами, когда очередь пуста.
 *
 * В настройки не выносим намеренно: крутить эту ручку незачем, а лишний переключатель
 * пришлось бы объяснять. Задача после взятия идёт минуты и часы, поэтому лишние
 * секунды ожидания на её фоне не значат ничего — а вот частый холостой опрос сайта
 * стоит запросов на каждой машине парка.
 */
const POLL_SEC = 10;

/**
 * Отладочный флаг: брать задачи из локального файла вместо очереди сайта.
 *
 * Константой, а не настройкой: это инструмент разработчика, а не режим для
 * пользователя. Ручка в интерфейсе означала бы, что воркер можно случайно оставить
 * говорящим с файлом и потом искать, почему сайт не видит работы.
 */
const WORKER_MOCK = false;

function logWin(level: 'info' | 'warn' | 'error', text: string): void {
	console.log(`[remoteWorker:${level}] ${text}`);
	try {
		void commands.sendLog(level, text).catch(() => {});
	} catch {}
}

// Регистрация в области ресурсных пулов + гашение флага прерывания СВОЕЙ полосы. Без
// сброса флага воркер, запущенный после собственной аварийной остановки, унаследовал бы
// прошлый стоп — и каждый его `exec` умирал бы мгновенно. Набор семафоров при этом
// общий с локальным прогоном: если тот уже работает, воркер входит в готовую область и
// ничего не пересоздаёт (см. `ResourcePool.ts`).
async function initPools(): Promise<void> {
	let pluginPools: Array<{ id: string; pool: string }> = [];
	try {
		const all = (await (window as any).plugins?.getAllPlugins()) ?? [];
		pluginPools = all
			.map((p: any) => ({ id: p?.id, pool: p?.manifest?.resourcePool }))
			.filter((x: any) => Boolean(x.id && x.pool));
	} catch (e) {
		console.warn('[remoteWorker] cannot read plugin resourcePools:', e);
	}
	createRunPools(RUN_WORKER, getAppSettings().resourcePools ?? {}, pluginPools);
	await commands.resetProcessingSignal(RUN_WORKER).catch(() => {});
}

export function isWorkerRunning(): boolean {
	return useWorker_store.getState().isWorking;
}

// ─── Очередь ─────────────────────────────────────────────────────────────────

/**
 * Собрать адаптер очереди из плагина.
 *
 * Версию берём из стора установленных плагинов, а не константой в коде: обновится
 * плагин — раннер иначе продолжил бы грузить старую сборку по старому пути, и правка
 * «не применилась» без видимой причины.
 *
 * Источник — живая очередь сайта. Мок (`WORKER_MOCK = true`) оставлен для отладки без
 * сети: в файл `<app data>/worker/queue.json` можно вписать задачу руками и прогнать
 * весь путь, не трогая общую очередь и не мешая другим машинам.
 */
async function makeQueue(): Promise<any> {
	const installed = plugin_Store.getState().plugins.find((p) => p.id === WORKER_PLUGIN_ID && p.enabled && p.exists);
	if (!installed) throw new Error(`плагин ${WORKER_PLUGIN_ID} не установлен`);

	const mod = await loadPlugin(WORKER_PLUGIN_ID, installed.version);
	const dataDir = unwrap(await commands.getUserDataPath());

	// `invoke` — тот же шов, что у плагинов своей площадки: HTTP делает Rust, потому что
	// токен хранилища в renderer не отдаётся.
	return mod.createQueue(
		{ source: WORKER_MOCK ? 'mock' : 'site', mockPath: joinPath(dataDir, 'worker', 'queue.json') },
		{ fs: hostServices.fs, invoke: (cmd: string, args?: Record<string, unknown>) => invokeHost(cmd, args) },
	);
}

/** Пауза, которая слышит остановку: иначе Stop ждал бы полного интервала. */
async function sleepAbortable(sec: number, signal: AbortSignal): Promise<void> {
	const until = Date.now() + sec * 1000;
	while (Date.now() < until) {
		if (signal.aborted || useWorker_store.getState().stopRequested) return;
		await new Promise((r) => setTimeout(r, 250));
	}
}

// ─── Цикл ────────────────────────────────────────────────────────────────────

/** Очередь текущего прогона — нужна аварийной остановке, чтобы вернуть задачу. */
let activeQueue: any = null;

async function pollLoop(queue: any, signal: AbortSignal): Promise<void> {
	const store = () => useWorker_store.getState();

	while (!signal.aborted && !store().stopRequested) {
		store().setStatus({ phase: 'asking', nextPollAt: null, pollCount: store().status.pollCount + 1 });

		let task: any = null;
		try {
			task = await queue.claim();
		} catch (e: any) {
			// Ошибка запроса — не повод гасить режим: сеть моргнула, сайт перезапустили.
			// Показываем и продолжаем спрашивать, иначе воркер тихо умирал бы от любого сбоя.
			store().setStatus({ lastError: String(e?.message ?? e), lastAt: Math.floor(Date.now() / 1000) });
			logWin('warn', `[worker] запрос не прошёл: ${e?.message ?? e}`);
		}

		if (!task) {
			// Пустая очередь — норма, а не ошибка.
			store().setStatus({ phase: 'idle', nextPollAt: Math.floor(Date.now() / 1000) + POLL_SEC });
			await sleepAbortable(POLL_SEC, signal);
			continue;
		}

		store().setStatus({
			phase: 'working',
			currentTaskId: task.taskId,
			currentProject: task.projectName ?? task.projectId ?? null,
			leaseUntil: task.leaseExpiresAt ? Math.floor(new Date(task.leaseExpiresAt).getTime() / 1000) : null,
			nextPollAt: null,
		});
		logWin('info', `[worker] взята задача ${task.taskId} (${task.projectName ?? task.projectId})`);

		try {
			const outcome = await runTask(task, queue, signal, logWin);

			// Аварийный стоп — не провал задачи. Он сам вернул её в очередь (`release`),
			// и отчитаться сейчас `failed` значило бы перебить возврат: задача осталась бы
			// проваленной, хотя её просто прервал человек.
			if (signal.aborted) break;

			if (outcome.status === 'done') {
				await queue.done(task.taskId, outcome.outFiles, outcome.totalCost);
				store().setStatus({ doneCount: store().status.doneCount + 1, lastError: null, lastAt: Math.floor(Date.now() / 1000) });
				logWin('info', `[worker] задача ${task.taskId} готова: файлов ${outcome.outFiles.length}, цена ${outcome.totalCost}`);
			} else {
				await queue.failed(task.taskId, outcome.error ?? 'обработка не удалась');
				store().setStatus({
					failedCount: store().status.failedCount + 1,
					lastError: outcome.error ?? 'обработка не удалась',
					lastAt: Math.floor(Date.now() / 1000),
				});
				logWin('error', `[worker] задача ${task.taskId} провалена: ${outcome.error ?? ''}`);
			}
		} catch (e: any) {
			// Прерывание — тоже не провал, возврат уже сделан аварийным стопом.
			if (signal.aborted) break;

			// Сорвалось до отчёта — задачу нельзя оставлять взятой. Возвращаем в очередь:
			// сбой мог быть локальным (нет места, упал ffmpeg), и другая машина справится.
			const msg = String(e?.message ?? e);
			logWin('error', `[worker] задача ${task.taskId} сорвалась: ${msg}`);
			await queue.release(task.taskId).catch((re: any) => logWin('error', `[worker] и вернуть не удалось: ${re?.message ?? re}`));
			store().setStatus({ failedCount: store().status.failedCount + 1, lastError: msg, lastAt: Math.floor(Date.now() / 1000) });
		} finally {
			store().setStatus({ currentTaskId: null, currentProject: null, leaseUntil: null });
		}
	}
}

export async function startWorker(): Promise<void> {
	const store = useWorker_store.getState();
	if (store.isWorking) return;

	store.resetStatus();
	store.setStopRequested(false);
	store.setIsWorking(true);
	await initPools();
	logWin('info', '[worker] режим воркера включён');

	let queue: any;
	try {
		queue = await makeQueue();
	} catch (e: any) {
		// Не собрали очередь — режим не начался. Гасим сразу, иначе кнопка горит
		// «работает», а не работает ничего.
		logWin('error', `[worker] очередь не поднялась: ${e?.message ?? e}`);
		store.setStatus({ lastError: String(e?.message ?? e), lastAt: Math.floor(Date.now() / 1000) });
		finishWorker();
		return;
	}

	activeQueue = queue;
	// Контекст прерывания СВОЕЙ полосы: тот же механизм, что у локального прогона, но
	// отдельный сигнал. Свой AbortController мимо этого модуля был бы вторым сигналом —
	// `abortNow(RUN_WORKER)` его не видит, и аварийный стоп рвал бы цикл, не трогая
	// обработку.
	startProcessContext(RUN_WORKER);
	try {
		await pollLoop(queue, getSignal(RUN_WORKER));
	} catch (e: any) {
		logWin('error', `[worker] цикл упал: ${e?.message ?? e}`);
		useWorker_store.getState().setStatus({ lastError: String(e?.message ?? e), lastAt: Math.floor(Date.now() / 1000) });
	} finally {
		finishWorker();
	}
}

/** Мягкая остановка: текущую задачу доводим до конца, новых не берём. */
export function stopWorkerSoft(): void {
	const store = useWorker_store.getState();
	if (!store.isWorking) return;

	// Флага достаточно: цикл проверяет его и перед следующим запросом, и внутри паузы,
	// поэтому ждать полного интервала опроса не придётся. Гасит себя он сам, дойдя до
	// конца текущей задачи, — здесь ничего не рвём.
	store.setStopRequested(true);
	logWin('info', '[worker] остановка после текущей задачи');
}

/** Аварийная остановка: убить процессы сейчас, задачу вернуть в очередь. */
export function stopWorkerNow(): void {
	const store = useWorker_store.getState();
	if (!store.isWorking) return;

	abortNow(RUN_WORKER);
	void commands.abortProcessing(RUN_WORKER).catch(() => {});
	logWin('warn', '[worker] аварийная остановка');

	// Задачу возвращаем в очередь СРАЗУ, не дожидаясь протухания аренды: иначе её
	// пятнадцать минут никто не подхватит. Отдельно от `finishWorker`, потому что режим
	// гасим в любом случае, а вернуть можно только то, что успели взять.
	const taskId = store.status.currentTaskId;
	if (taskId && activeQueue) {
		void activeQueue
			.release(taskId)
			.then(() => logWin('info', `[worker] задача ${taskId} возвращена в очередь`))
			.catch((e: any) => logWin('error', `[worker] не удалось вернуть задачу ${taskId}: ${e?.message ?? e}`));
	}

	finishWorker();
}

function finishWorker(): void {
	const store = useWorker_store.getState();
	store.setIsWorking(false);
	store.setStopRequested(false);
	store.setStatus({
		phase: 'idle',
		nextPollAt: null,
		currentTaskId: null,
		currentProject: null,
		leaseUntil: null,
		lastAt: Math.floor(Date.now() / 1000),
	});
	activeQueue = null;
	disposeRunPools(RUN_WORKER);
}
