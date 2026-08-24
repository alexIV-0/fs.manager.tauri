// System plugin: адаптер очереди задач для режима воркера.
//
// Это НЕ нода: плагин грузится напрямую из ядра через `loadPlugin`, минуя
// `processItem`, — как `updater`. Поэтому сервисы принимаются параметром, а не
// третьим аргументом `ctx`, и экспорта `onLoad` здесь нет (его наличие запрещает
// loader.ts кэшировать модуль).
//
// ГРАНИЦА. Плагин знает про очередь и ничего не знает про обработку: как позвонить,
// что ответили, как это разобрать. Цикл, локальный scratch, `processItem`, продление
// аренды и кнопки остановки живут в ЯДРЕ. Причина не вкусовая: ES-модуль,
// загруженный динамическим импортом, выгрузить нельзя — держи цикл здесь, и после
// пересборки плагина старый инстанс продолжил бы ходить за задачами своим таймером,
// а остановить его было бы нечем, кроме перезапуска программы.
//
// Установка плагина = разблокировка режима воркера в интерфейсе (тот же принцип, что
// у `updater`: нет плагина — нет кнопки).
//
// ДВА ИСТОЧНИКА, один интерфейс:
//   • 'site' — живая очередь, `POST /api/storage/v1/queue` через Rust-команды;
//   • 'mock' — локальный JSON-файл с фикстурами.
// Мок остался для отладки без сети: в него можно вписать задачу руками и прогнать весь
// путь, не трогая живую очередь и не мешая другим машинам.

import type { PluginContext } from '../../src/PluginAPI/host';

// ─── Контракт ────────────────────────────────────────────────────────────────

/** Статус шага, как его ждёт `taskProgress`. */
export type StepStatus = 'running' | 'done' | 'error';

export type WorkerTask = {
	taskId: string;
	projectId: string;
	projectName?: string;
	/** До какого момента задача считается нашей. Дальше её заберёт другая машина. */
	leaseExpiresAt?: string | null;
	/**
	 * Объект обработки, собранный сайтом: `processingQueue`, шаги по id, `description`,
	 * `mainSearch.output` с идентичностью файла (или папки).
	 *
	 * Машинно-локального в нём нет и быть не может — пути к ffmpeg и After Effects у
	 * каждой машины свои. Их дописывает ядро (`PROCESSING/utils/machineLocals.ts`).
	 */
	payload: any;
};

export type QueueSource = 'site' | 'mock';

export type QueueConfig = {
	source: QueueSource;
	/** Файл с фикстурами. Нужен только для `source: 'mock'`. */
	mockPath?: string;
};

export type QueueServices = Pick<PluginContext, 'fs' | 'invoke'>;

export interface Queue {
	/** Задача или `null`. Пустая очередь — норма, а не ошибка. */
	claim(): Promise<WorkerTask | null>;
	progress(taskId: string, stepId: string, status: StepStatus, message?: string): Promise<void>;
	done(taskId: string, outFiles: string[], totalCost: number): Promise<void>;
	failed(taskId: string, error: string): Promise<void>;
	/** Аварийный стоп: вернуть задачу в очередь, не дожидаясь протухания аренды. */
	release(taskId: string): Promise<void>;
}

export function describe(): { id: string; version: string; sources: QueueSource[] } {
	return { id: 'remoteWorker', version: '1.0.0', sources: ['site', 'mock'] };
}

export function createQueue(cfg: QueueConfig, services: QueueServices): Queue {
	return cfg.source === 'mock' ? mockQueue(cfg, services) : siteQueue(cfg, services);
}

// ─── Живая очередь ───────────────────────────────────────────────────────────

// `POST /api/storage/v1/queue` — на ТОМ ЖЕ токене `mch_`, которым программа уже ходит
// за файлами. Второго токена в настройках не нужно: машина опознаётся своим
// `machineUuid`, и сайт по нему сам заводит ей строку.
//
// Ходим не напрямую, а через Rust-команды `storage_queue_*`. Не по вкусу: токен и адрес
// живут в `ConnectionConfig`, а наружу он отдаётся с вырезанным токеном
// (`redacted()`) — авторизоваться из renderer'а физически нечем. Заодно `machineUuid`
// подставляет Rust, и подменить его отсюда нельзя.
//
// `ctx.invoke` — узаконенный шов для команд своей площадки, тем же путём ходят
// `vk_*` и `youtube_*` в своих плагинах.
function siteQueue(_cfg: QueueConfig, { invoke }: QueueServices): Queue {
	return {
		async claim() {
			const task = await invoke('storage_queue_claim');
			if (!task) return null;
			// На сайте поле называется `id`; наружу отдаём `taskId`, чтобы у ядра была
			// одна форма задачи независимо от источника.
			return {
				taskId: task.id,
				projectId: task.projectId,
				projectName: task.projectName,
				leaseExpiresAt: task.leaseExpiresAt ?? null,
				payload: task.payload,
			};
		},
		async progress(taskId, stepId, status, message) {
			await invoke('storage_queue_progress', { taskId, stepId, status, message: message ?? null });
		},
		async done(taskId, outFiles, totalCost) {
			await invoke('storage_queue_done', { taskId, outFiles, totalCost });
		},
		async failed(taskId, error) {
			await invoke('storage_queue_failed', { taskId, error });
		},
		async release(taskId) {
			await invoke('storage_queue_release', { taskId });
		},
	};
}

// ─── Мок ─────────────────────────────────────────────────────────────────────

type MockRow = {
	taskId: string;
	projectId: string;
	projectName?: string;
	status: 'queued' | 'claimed' | 'running' | 'done' | 'failed';
	payload: any;
	claimedBy?: string;
	leaseExpiresAt?: string | null;
	steps?: { stepId: string; status: StepStatus; message?: string; at: string }[];
	outFiles?: string[];
	totalCost?: number;
	error?: string;
};

type MockFile = { tasks: MockRow[] };

const LEASE_MINUTES = 15;

// Чтение-правка-запись, без атомарности. На живой очереди так нельзя — там ровно для
// этого `SKIP LOCKED` в БД, — но у мока писатель ровно один: эта программа на этой
// машине. Здесь важно не «кто первый», а чтобы жизненный цикл задачи был виден
// глазами в файле.
function mockQueue(cfg: QueueConfig, { fs }: QueueServices): Queue {
	const path = cfg.mockPath ?? '';

	async function readFile(): Promise<MockFile> {
		if (!path) throw new Error('[remoteWorker] mockPath не задан');
		if (!(await fs.exists(path))) {
			// Заводим пустую очередь: пусть файл существует и его видно, куда класть
			// задачи, — иначе непонятно, мок сломался или просто пуст.
			const empty: MockFile = { tasks: [] };
			await fs.write(path, JSON.stringify(empty, null, 2));
			return empty;
		}
		try {
			const parsed = JSON.parse(await fs.read(path));
			return { tasks: Array.isArray(parsed?.tasks) ? parsed.tasks : [] };
		} catch (e) {
			throw new Error(`[remoteWorker] мок-очередь не читается (${path}): ${e}`);
		}
	}

	async function update(taskId: string, patch: (row: MockRow) => void): Promise<void> {
		const file = await readFile();
		const row = file.tasks.find((t) => t.taskId === taskId);
		if (!row) throw new Error(`[remoteWorker] задачи ${taskId} нет в мок-очереди`);
		patch(row);
		await fs.write(path, JSON.stringify(file, null, 2));
	}

	return {
		async claim() {
			const file = await readFile();
			const row = file.tasks.find((t) => t.status === 'queued');
			if (!row) return null;

			row.status = 'claimed';
			row.claimedBy = 'local-mock';
			row.leaseExpiresAt = new Date(Date.now() + LEASE_MINUTES * 60_000).toISOString();
			await fs.write(path, JSON.stringify(file, null, 2));

			return {
				taskId: row.taskId,
				projectId: row.projectId,
				projectName: row.projectName,
				leaseExpiresAt: row.leaseExpiresAt,
				payload: row.payload,
			};
		},

		async progress(taskId, stepId, status, message) {
			await update(taskId, (row) => {
				// Первый шаг переводит задачу в running — как на сайте.
				if (row.status === 'claimed') row.status = 'running';
				row.steps = [...(row.steps ?? []), { stepId, status, message, at: new Date().toISOString() }];
				row.leaseExpiresAt = new Date(Date.now() + LEASE_MINUTES * 60_000).toISOString();
			});
		},

		async done(taskId, outFiles, totalCost) {
			await update(taskId, (row) => {
				row.status = 'done';
				row.outFiles = outFiles;
				row.totalCost = totalCost;
				row.leaseExpiresAt = null;
			});
		},

		async failed(taskId, error) {
			await update(taskId, (row) => {
				row.status = 'failed';
				row.error = error;
				row.leaseExpiresAt = null;
			});
		},

		async release(taskId) {
			await update(taskId, (row) => {
				// Именно 'queued', а не 'failed': аварийный стоп — не провал задачи, её
				// должна подхватить следующая машина (или эта же после перезапуска).
				row.status = 'queued';
				row.claimedBy = undefined;
				row.leaseExpiresAt = null;
			});
		},
	};
}
