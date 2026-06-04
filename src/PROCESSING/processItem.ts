// processItem — orchestrator одного item'а обработки. Порт из Electron'овского
// electron/main/processing/processItem.ts. Живёт в renderer'е, имеет:
//   - Полный debugger через DevTools
//   - Прямой доступ к Zustand-сторам (useProcessingStats_store, useStatusBar_Store и т.п.)
//   - Вызов плагинов через loadPlugin('plugin://...') — JS-функция, не IPC
//
// Эмиты log-window событий идут через invoke в Rust → forward в logWindow.

import { basename, dirname, join } from '@plugin-api/path';
import { loadPlugin } from '@/PluginAPI/loader';
import { acquirePool, releasePool } from './ResourcePool';
import { typeOfFile_store } from '@/Store/MainWin/pathPattern_store';
import { commands, unwrap } from '@/Utils/specta';

const api = () => (window as any).tauriAPI;

// ─── Типы ────────────────────────────────────────────────────────────────────

export type SendFn = (type: string, payload: any) => void;

export interface ExecutionContext {
	results: Map<string, any[]>;
	description: any;
	signal: AbortSignal;
	itemId: string;
	send: SendFn;
	accumulatedCost: number;
}

export interface PluginCtx {
	itemId: string;
	stepId?: string;
	signal: AbortSignal;
	pluginId: string;
	pluginVersion: string;
	pluginPath?: string;
	log: (level: 'info' | 'warn' | 'error' | 'debug', text: string, meta?: any) => void;
	send: SendFn;
	sendToMW: (type: string, payload: any) => void;
}

// ─── Утилиты ─────────────────────────────────────────────────────────────────

async function pathExists(p: string): Promise<boolean> {
	// `checkFilePath` отбрасывает папки (внутри стоит `!p.is_file() → return ""`), поэтому
	// для проверки «вообще существует ли путь» (файл или папка) используем `path_exists`.
	// Без этого фикса для папок postProcess получал pathForDeleteExists=false → SKIPPED.
	return Boolean(unwrap(await commands.pathExists(p)));
}

/**
 * Помечает папку, упавшую в обработке, дефисом в начале имени. mainSearch при
 * следующей итерации пропускает папки, начинающиеся с `-` (см. findFilesForSingleFolder),
 * поэтому такой "мягкий ban" удобнее, чем переносить целую папку в errors/.
 * Если папка уже начинается с `-` — ничего не делаем.
 */
async function markFolderAsError(
	folderPath: string,
	send: SendFn,
	itemId: string,
): Promise<void> {
	try {
		send('log', { level: 'warn', text: `[markFolderAsError] ENTER: ${folderPath}`, itemId });
		const name = basename(folderPath);
		if (name.startsWith('-')) {
			send('log', {
				level: 'warn',
				text: `[processItem] Folder already marked with "-": ${name}`,
				itemId,
			});
			return;
		}

		const newName = `-${name}`;
		const newPath = join(dirname(folderPath), newName);

		send('log', { level: 'warn', text: `[markFolderAsError] invoke renameFolder: ${folderPath} -> ${newPath}`, itemId });
		const renameResult = unwrap(await commands.renameFolder(folderPath, newPath));
		send('log', { level: 'warn', text: `[markFolderAsError] renameFolder result: ${JSON.stringify(renameResult)}`, itemId });

		send('log', {
			level: 'warn',
			text: `[processItem] Error — folder marked as skipped: "${name}" → "${newName}"`,
			itemId,
		});
		send('statusbar', { text: `⚠️ Error — marked folder: "${newName}"` });
	} catch (e: any) {
		send('log', {
			level: 'warn',
			text: `[processItem] markFolderAsError failed: ${e?.message ?? String(e)}`,
			itemId,
		});
	}
}

async function moveToErrorsFolder(
	pathForDelete: string,
	projectPath: string,
	send: SendFn,
	itemId: string,
): Promise<void> {
	try {
		send('log', {
			level: 'warn',
			text: `[moveToErrorsFolder] ENTER: pathForDelete=${pathForDelete} projectPath=${projectPath}`,
			itemId,
		});
		// Делегируем в Rust (`move_to_errors`) — он сам ищет/создаёт папку errors*,
		// переносит файл и переименовывает папку с датой. JS-реализация существовала
		// исторически (порт из Electron), но дублировала логику и ломалась на
		// несоответствии формы ответа `getSomeFromFolder`.
		const res = unwrap(await commands.moveToErrors(pathForDelete, projectPath));
		send('log', { level: 'warn', text: `[moveToErrorsFolder] moveToErrors result: ${JSON.stringify(res)}`, itemId });

		if (!res?.success) {
			send('log', {
				level: 'warn',
				text: `[processItem] moveToErrors failed: ${res?.error ?? 'unknown error'}`,
				itemId,
			});
			return;
		}

		send('log', {
			level: 'warn',
			text: `[processItem] Error — moved to errors: ${basename(pathForDelete)}`,
			itemId,
		});
		send('statusbar', {
			text: `⚠️ Error — moved to errors: ${basename(pathForDelete)}`,
		});
	} catch (e: any) {
		send('log', { level: 'warn', text: `[processItem] moveToErrors failed: ${e?.message ?? String(e)}`, itemId });
	}
}

// ─── Главный orchestrator ────────────────────────────────────────────────────

export async function processItem(item: any, signal: AbortSignal): Promise<string> {
	const desc = item.description ?? {};
	const itemId: string =
		desc.dbItemId ??
		(desc.pathForDelete && desc.findTime ? `${desc.pathForDelete}:${desc.findTime}` : undefined) ??
		desc.pathForDelete ??
		desc.id ??
		String(Date.now());

	const curItem: string = desc.curItem ?? basename(desc.pathForDelete ?? itemId);
	const itemName: string = desc.findTime ? `[${desc.findTime}] ${curItem}` : curItem;
	const mainFolderName: string = desc.mainFolderName ?? '';
	const projectName: string = desc.projectName ?? '';

	const steps = (item.processingQueue as string[]).slice(1).map((key) => {
		const s = item[key];
		return {
			stepId: key,
			label: s?.nodeLabel || s?.pluginId || key,
			pluginId: s?.pluginId as string | undefined,
			pluginVersion: s?.pluginVersion as string | undefined,
			nodeType: (s?.nodeType ?? 'default') as string,
			cost: (s?.cost ?? '0') as string,
			costUnit: (s?.costUnit ?? 'run') as string,
			isTerminal: Boolean(s?.isTerminal),
			status: 'queued' as const,
			startTime: undefined as string | undefined,
			endTime: undefined as string | undefined,
			logs: [] as any[],
			errorCount: 0,
		};
	});

	// Помощник send → форвардит события в logWindow через invoke + в processing-event
	const send: SendFn = (type, payload) => {
		// Локальная шина (для startProcessing'овского handleProcessingEvent)
		try {
			window.dispatchEvent(new CustomEvent('processing:event', { detail: { type, payload } }));
		} catch {}

		// Forward в logWindow через Rust emit-команды
		if (type === 'item:start') {
			commands
				.logWindowEmitItemQueued({
					itemId: payload.itemId,
					itemName: payload.itemName,
					mainFolderName: payload.mainFolderName ?? '',
					projectName: payload.projectName ?? '',
					steps: payload.steps ?? [],
					status: 'running',
					startTime: new Date().toISOString(),
					itemLogs: [],
					errorCount: 0,
					warnCount: 0,
				})
				.catch(() => {});
		} else if (type === 'item:end') {
			commands
				.logWindowEmitItemEnd({
					itemId: payload.itemId,
					status: payload.status,
					endTime: new Date().toISOString(),
					totalCost: payload.totalCost,
					duration: payload.duration,
				})
				.catch(() => {});
		} else if (type === 'node:start') {
			commands
				.logWindowEmitNodeUpdate({
					itemId: payload.itemId,
					nodeId: payload.nodeId,
					status: 'running',
					startTime: new Date().toISOString(),
				})
				.catch(() => {});
			// Broadcast в node_win (через Rust → app.emit "processing-event").
			// Для саб-шагов loop'а nodeId суффиксирован ('#k'), а граф знает только оригинальный
			// id — поэтому в node-graph шлём graphNodeId (без суффикса), если он передан.
			commands.sendNodeStart(payload.graphNodeId ?? payload.nodeId).catch(() => {});
		} else if (type === 'node:done') {
			commands
				.logWindowEmitNodeUpdate({
					itemId: payload.itemId,
					nodeId: payload.nodeId,
					status: 'done',
					endTime: new Date().toISOString(),
					finalCost: payload.finalCost,
				})
				.catch(() => {});
			commands.sendNodeDone(payload.graphNodeId ?? payload.nodeId, payload.output ?? null).catch(() => {});
		} else if (type === 'node:error') {
			commands
				.logWindowEmitNodeUpdate({
					itemId: payload.itemId,
					nodeId: payload.nodeId,
					status: 'error',
					endTime: new Date().toISOString(),
				})
				.catch(() => {});
			commands.sendNodeError(payload.graphNodeId ?? payload.nodeId, payload.message ?? '').catch(() => {});
		} else if (type === 'process:complete') {
			commands.sendProcessComplete().catch(() => {});
		} else if (type === 'log' || type === 'error') {
			commands
				.logWindowEmitItemLog({
					id: Math.random().toString(36).slice(2, 9),
					timestamp: new Date().toISOString(),
					level: type === 'error' ? 'error' : payload.level ?? 'info',
					message: payload.text ?? payload.message ?? '',
					meta: payload.meta,
					source: 'renderer',
					itemId: payload.itemId ?? itemId,
					stepId: payload.stepId,
				})
				.catch(() => {});
		} else if (type === 'statusbar') {
			api().invoke('set_status_bar', { text: payload.text ?? '' }).catch(() => {});
		}
	};

	send('item:start', { itemId, itemName, mainFolderName, projectName, steps });

	const ctx: ExecutionContext = {
		results: new Map(),
		description: desc,
		signal,
		itemId,
		send,
		accumulatedCost: 0,
	};

	// Главный поиск (первый элемент queue) уже имеет output из findItemAndCreateProps
	const mainSearchKey = item.processingQueue[0];
	const mainSearchObj = item[mainSearchKey];
	if (mainSearchObj?.output) {
		ctx.results.set(mainSearchKey, mainSearchObj.output);
	}

	let allStepsSucceeded = true;

	for (let j = 1; j < item.processingQueue.length; j++) {
		if (ctx.signal.aborted) {
			send('aborted', null);
			allStepsSucceeded = false;
			break;
		}
		const queueKey = item.processingQueue[j];
		const stepObj = item[queueKey];
		if (!stepObj) continue;

		const ok = await executeStep(queueKey, stepObj, ctx, item);
		if (!ok) {
			allStepsSucceeded = false;
			break;
		}
	}

	// Post-обработка оригинала
	const pathForDelete: string | undefined = desc.pathForDelete;
	const projectPath: string | undefined = desc.projectPathGD;
	const deleteAfter = mainSearchObj?.deleteAfter ?? false;
	const pathForDeleteExists = pathForDelete ? await pathExists(pathForDelete) : false;
	const isFolder = Boolean(desc.isFolder);

	// [DIAG v2] Полная картина значений на момент принятия решения.
	send('log', {
		level: 'warn',
		text:
			`[processItem.postProcess v2] allStepsSucceeded=${allStepsSucceeded} ` +
			`aborted=${ctx.signal.aborted} ` +
			`deleteAfter=${deleteAfter} ` +
			`isFolder=${isFolder} ` +
			`pathForDeleteExists=${pathForDeleteExists} ` +
			`projectPath=${projectPath ?? '<empty>'} ` +
			`pathForDelete=${pathForDelete ?? '<empty>'}`,
		itemId,
	});

	if (pathForDelete && pathForDeleteExists) {
		if (allStepsSucceeded && !ctx.signal.aborted && deleteAfter) {
			send('log', { level: 'warn', text: `[processItem.postProcess] → DELETE branch`, itemId });
			try {
				unwrap(await commands.deleteItem(pathForDelete));
				send('log', { level: 'info', text: `[processItem] Deleted original: ${basename(pathForDelete)}`, itemId });
			} catch {
				send('log', { level: 'warn', text: `[processItem] Failed to delete original: ${basename(pathForDelete)}`, itemId });
			}
		} else if (!allStepsSucceeded && !ctx.signal.aborted && deleteAfter) {
			// Папку не двигаем в errors/ — просто префиксуем имя `-`, чтобы mainSearch
			// её пропустил на следующей итерации. Для файла — обычный перенос в errors/.
			if (isFolder) {
				send('log', { level: 'warn', text: `[processItem.postProcess] → MARK-FOLDER branch`, itemId });
				await markFolderAsError(pathForDelete, send, itemId);
			} else if (projectPath) {
				send('log', { level: 'warn', text: `[processItem.postProcess] → MOVE-TO-ERRORS branch`, itemId });
				await moveToErrorsFolder(pathForDelete, projectPath, send, itemId);
			} else {
				send('log', {
					level: 'warn',
					text: `[processItem.postProcess] → NO-OP: file error but projectPath is empty`,
					itemId,
				});
			}
		} else {
			send('log', {
				level: 'warn',
				text:
					`[processItem.postProcess] → NO-OP: no branch matched ` +
					`(allStepsSucceeded=${allStepsSucceeded}, aborted=${ctx.signal.aborted}, deleteAfter=${deleteAfter})`,
				itemId,
			});
		}
	} else {
		send('log', {
			level: 'warn',
			text:
				`[processItem.postProcess] → SKIPPED outer if: ` +
				`pathForDelete=${pathForDelete ?? '<empty>'} exists=${pathForDeleteExists}`,
			itemId,
		});
	}

	const finalStatus = ctx.signal.aborted ? 'aborted' : allStepsSucceeded ? 'done' : 'error';
	// Передаём totalCost когда хоть один шаг имел costUnit='run' или 'fromSite'.
	const hasCostTracking = steps.some((s) => ['run', 'fromSite'].includes(s.costUnit ?? 'run'));
	const totalCost = hasCostTracking ? ctx.accumulatedCost : undefined;

	// Суммируем длительности всех выходных медиафайлов из терминальных шагов.
	const mediaDurationSecs = await collectMediaDuration(ctx, steps);
	const duration = secsToDurationStr(mediaDurationSecs);

	send('item:end', { itemId, status: finalStatus, totalCost, duration });
	return finalStatus;
}

// ─── Выполнение шага ─────────────────────────────────────────────────────────

// logStepId — id, под которым уходят node:* и log-события в log-window (для саб-шагов
// loop'а здесь стоит суффиксированный id `${id}#${iter}`, чтобы события маршрутизировались
// в нужный саб-шаг конкретной итерации). ctx.results всегда индексируется по оригинальному
// stepId, чтобы downstream-импорты находили выход.
async function executeStep(stepId: string, stepObj: any, ctx: ExecutionContext, item: any, logStepId?: string): Promise<boolean> {
	const nodeType = stepObj.nodeType ?? 'default';
	if (nodeType === 'loop') return executeLoop(stepId, stepObj, ctx, item);
	return executeDefault(stepId, stepObj, ctx, logStepId ?? stepId);
}

// ─── Обычная нода (один плагин) ──────────────────────────────────────────────

async function executeDefault(stepId: string, stepObj: any, ctx: ExecutionContext, logStepId: string): Promise<boolean> {
	const { send } = ctx;
	const resolvedImport = resolveImport(stepObj.import, ctx);
	const execObj = { ...stepObj, import: resolvedImport };

	if (!execObj.pluginId || !execObj.pluginVersion) {
		send('error', { step: logStepId, message: `Missing pluginId/pluginVersion in "${stepId}"`, itemId: ctx.itemId, stepId: logStepId });
		return false;
	}

	// Захватываем слот ресурсного пула по colorType (afterEffect → лимит 1, helpers → 10 и т.д.).
	// Если лимит исчерпан — ждём освобождения слота другим item'ом.
	const colorType: string | undefined = execObj.colorType;
	if (colorType) await acquirePool(colorType);

	send('node:start', { nodeId: logStepId, graphNodeId: stepId, itemId: ctx.itemId });
	send('log', { level: 'info', text: `→ ${stepId} (${execObj.pluginId}@${execObj.pluginVersion})`, itemId: ctx.itemId, stepId: logStepId });

	try {
		// execToken = уникальный токен на каждый вызов плагина. loader.ts использует
		// его для cache-bust динамического import'а — это гарантирует свежий
		// module-instance для каждого исполнения, без чего sendToMW из параллельных
		// вызовов одного плагина гонялись бы за общим module-local `_bound`.
		const execToken = `${ctx.itemId}-${stepId}-${Date.now().toString(36)}`;
		const pluginModule = await loadPlugin(execObj.pluginId, execObj.pluginVersion, execToken);
		const pluginFn = resolveCallable(pluginModule);
		if (!pluginFn) {
			throw new Error(`Plugin ${execObj.pluginId}@${execObj.pluginVersion} has no callable export`);
		}

		// Захватывает стоимость от плагинов с costUnit='fromSite'
		let capturedSiteCost: number | undefined;

		// sendToMW из плагинов имеет сигнатуру (type, payload) — маршрутизируем по type.
		const sendToMW = (type: string, payload: any) => {
			if (type === 'log') {
				const p = typeof payload === 'string' ? { text: payload } : (payload ?? {});
				send('log', { level: p.level ?? 'info', text: p.text ?? '', meta: p.meta, itemId: ctx.itemId, stepId: logStepId });
			} else if (type === 'error') {
				const p = typeof payload === 'string' ? { message: payload } : (payload ?? {});
				send('log', { level: 'error', text: p.message ?? p.text ?? String(payload), meta: p.meta, itemId: ctx.itemId, stepId: logStepId });
			} else if (type === 'statusbar') {
				const text = typeof payload === 'string' ? payload : (payload?.text ?? '');
				send('statusbar', { text });
			} else if (type === 'node:siteCost') {
				const raw = payload?.cost;
				const cost = typeof raw === 'number' ? raw : parseFloat(String(raw ?? '0')) || 0;
				capturedSiteCost = cost;
				send('log', { level: 'info', text: `[siteCost] raw=${raw} parsed=${cost}`, itemId: ctx.itemId, stepId: logStepId });
			} else {
				send(type, { ...(typeof payload === 'object' && payload !== null ? payload : { value: payload }), itemId: ctx.itemId, stepId: logStepId });
			}
		};

		const pluginCtx: PluginCtx = {
			itemId: ctx.itemId,
			stepId,
			signal: ctx.signal,
			pluginId: execObj.pluginId,
			pluginVersion: execObj.pluginVersion,
			log: (level, text, meta) => send('log', { level, text, meta, itemId: ctx.itemId, stepId: logStepId }),
			send,
			sendToMW,
		};

		// pluginSender.ts / tauri.ts (inlined в каждый плагин-бандл) хранят
		// module-local `_bound`, в который мы биндим per-execution sendToMW через
		// onLoad. loader.ts даёт свежий module-instance на каждый execToken, так
		// что параллельные вызовы одного плагина не делят `_bound`.
		if (typeof pluginModule.onLoad === 'function') {
			pluginModule.onLoad({ sendToMW });
		}

		const result = await pluginFn(execObj, ctx.description, pluginCtx);
		const output = Array.isArray(result) ? result : [result];
		ctx.results.set(stepId, output);
		stepObj.output = output;

		let finalCost: number | undefined;
		const costNum = parseFloat(execObj.cost ?? stepObj.cost ?? '0') || 0;
		const costUnit = execObj.costUnit ?? stepObj.costUnit ?? 'run';
		if (capturedSiteCost !== undefined) {
			finalCost = capturedSiteCost;
			ctx.accumulatedCost += capturedSiteCost;
		} else if (costUnit === 'run') {
			finalCost = costNum;
			ctx.accumulatedCost += costNum;
		}

		send('log', { level: 'info', text: `[costDebug] costUnit=${costUnit} capturedSiteCost=${capturedSiteCost} finalCost=${finalCost}`, itemId: ctx.itemId, stepId: logStepId });
		send('node:done', { nodeId: logStepId, graphNodeId: stepId, output, itemId: ctx.itemId, finalCost });
		return true;
	} catch (e: any) {
		send('node:error', { nodeId: logStepId, graphNodeId: stepId, message: e?.message ?? String(e), itemId: ctx.itemId });
		send('error', { step: logStepId, message: e?.message ?? String(e), itemId: ctx.itemId, stepId: logStepId });
		console.error(`[processItem] Error in step "${stepId}":`, e);
		return false;
	} finally {
		// Всегда освобождаем слот — даже при ошибке
		if (colorType) releasePool(colorType);
	}
}

// ─── Loop нода (subgraph) ────────────────────────────────────────────────────

async function executeLoop(stepId: string, stepObj: any, ctx: ExecutionContext, item: any): Promise<boolean> {
	const { send } = ctx;
	const loopInputSourceId = stepObj.import?.loopInput;
	if (!loopInputSourceId) {
		send('error', { step: stepId, message: `Loop "${stepId}" has no loopInput connected`, itemId: ctx.itemId });
		return false;
	}

	const inputArray = ctx.results.get(loopInputSourceId) ?? [];
	if (!Array.isArray(inputArray) || inputArray.length === 0) {
		send('log', { level: 'info', text: `Loop "${stepId}": empty input, skipping`, itemId: ctx.itemId, stepId });
		ctx.results.set(stepId, []);
		stepObj.output = [];
		return true;
	}

	send('node:start', { nodeId: stepId, itemId: ctx.itemId });
	send('log', { level: 'info', text: `→ Loop "${stepId}": ${inputArray.length} item(s)`, itemId: ctx.itemId, stepId });

	const accumulator: any[] = [];
	// Любое падение итерации поднимаем наверх как падение всего шага, чтобы
	// processItem пометил item как error и (при deleteAfter) перенёс оригинал
	// в errors. Раньше loop всегда возвращал true и ошибка проглатывалась.
	let anyIterationFailed = false;

	const N = inputArray.length;
	for (let i = 0; i < N; i++) {
		if (ctx.signal.aborted) {
			send('aborted', null);
			return false;
		}

		const currentItem = inputArray[i];
		const iter = i + 1;
		send('log', { level: 'info', text: `  [${iter}/${N}] ${currentItem}`, itemId: ctx.itemId, stepId });

		// description копируем спрэдом, а не ссылкой: иначе loopIndex протекёт в родительский
		// ctx и при возврате во внешний цикл там окажется значение внутреннего (для nested loops).
		const innerCtx: ExecutionContext = {
			results: new Map(ctx.results),
			description: { ...ctx.description, loopIndex: iter },
			signal: ctx.signal,
			itemId: ctx.itemId,
			send,
			accumulatedCost: 0,
		};
		innerCtx.results.set(`${stepId}__inputInLoop`, [currentItem]);

		const subgraph: any[] = stepObj.subgraph ?? [];

		// Регистрируем саб-шаги текущей итерации в log-window: батч из всех плагинов
		// subgraph с суффиксированными stepId. UI добавит их под Loop как nested StepRow.
		const batchSubSteps = subgraph.map((s: any) => ({
			stepId: `${s.id}#${iter}`,
			label: N > 1 ? `[${iter}/${N}] ${s.nodeLabel || s.pluginId || s.id}` : (s.nodeLabel || s.pluginId || s.id),
			pluginId: s.pluginId,
			pluginVersion: s.pluginVersion,
			nodeType: s.nodeType ?? 'default',
			cost: String(s.cost ?? '0'),
			costUnit: s.costUnit ?? 'run',
			status: 'queued' as const,
			logs: [] as any[],
			errorCount: 0,
		}));
		if (batchSubSteps.length > 0) {
			// AWAIT обязателен: батч должен быть зарегистрирован в Rust state ДО того,
			// как из executeStep полетят node:start/log события с суффиксированным stepId,
			// иначе find_step_mut не найдёт саб-шаг и логи свалятся в itemLogs.
			try {
				await commands.logWindowEmitSubstepBatch({
					itemId: ctx.itemId,
					parentStepId: stepId,
					subSteps: batchSubSteps,
				});
			} catch (err) {
				// Если команда не зарегистрирована в Rust (старый бинарь) — увидим тут.
				console.error('[executeLoop] emit-substep-batch failed:', err);
			}
		}

		let iterationOk = true;

		for (const subStep of subgraph) {
			if (innerCtx.signal.aborted) return false;
			const patched = patchSubStepImport(subStep, stepId);
			// stepId для results — оригинальный subStep.id (важно для downstream-импортов внутри
			// этой итерации). logStepId — суффиксированный, чтобы события маршрутизировались
			// в правильный саб-шаг конкретной итерации в log-window.
			const ok = await executeStep(subStep.id, patched, innerCtx, item, `${subStep.id}#${iter}`);
			if (!ok) {
				iterationOk = false;
				break;
			}
		}

		ctx.accumulatedCost += innerCtx.accumulatedCost;

		if (!iterationOk) {
			anyIterationFailed = true;
			send('log', { level: 'warn', text: `  [${i + 1}/${N}] failed`, itemId: ctx.itemId, stepId });
			continue;
		}

		const loopOutputSourceId = stepObj.loopOutputSource;
		if (loopOutputSourceId) {
			const iterResult = innerCtx.results.get(loopOutputSourceId);
			if (iterResult !== undefined) {
				accumulator.push(...(Array.isArray(iterResult) ? iterResult : [iterResult]));
			}
		}
	}

	ctx.results.set(stepId, accumulator);
	stepObj.output = accumulator;

	if (anyIterationFailed) {
		send('node:error', { nodeId: stepId, message: `Loop "${stepId}": one or more iterations failed`, itemId: ctx.itemId });
		send('error', { step: stepId, message: `Loop "${stepId}": one or more iterations failed`, itemId: ctx.itemId, stepId });
		return false;
	}

	send('node:done', { nodeId: stepId, output: accumulator, itemId: ctx.itemId });
	return true;
}

// ─── Хелперы ──────────────────────────────────────────────────────────────────

/**
 * Резолвит вызываемую функцию из загруженного плагина. Аналогично Electron'овскому
 * `PluginManager.callDefault`: пробуем три стратегии.
 *   1) `module.default` — если это функция
 *   2) `module` — если сам модуль функция (редко в ESM, но возможно)
 *   3) Первая попавшаяся функция, кроме служебных `onLoad`/`onUnload`
 *      — большинство наших плагинов экспортируют именованную функцию (createPathFunc,
 *        copyFileFunc, fileInfoFunc и т.п.) — этот вариант для них.
 */
function resolveCallable(mod: any): ((...args: any[]) => any) | null {
	if (!mod) return null;

	if (typeof mod.default === 'function') return mod.default;
	if (typeof mod === 'function') return mod;

	const reserved = new Set(['onLoad', 'onUnload', 'default']);
	for (const key of Object.keys(mod)) {
		if (reserved.has(key)) continue;
		if (typeof mod[key] === 'function') return mod[key];
	}
	return null;
}

function resolveImport(importObj: Record<string, string> | undefined, ctx: ExecutionContext): Record<string, any[]> {
	if (!importObj) return {};
	const resolved: Record<string, any[]> = {};
	for (const [key, sourceId] of Object.entries(importObj)) {
		if (typeof sourceId === 'string') {
			resolved[key] = ctx.results.get(sourceId) ?? [];
		} else {
			resolved[key] = sourceId as any;
		}
	}
	return resolved;
}

function patchSubStepImport(subStep: any, loopNodeId: string): any {
	if (!subStep.import) return subStep;
	const patched: Record<string, string> = { ...subStep.import };
	for (const [key, value] of Object.entries(patched)) {
		if (value === loopNodeId) patched[key] = `${loopNodeId}__inputInLoop`;
	}
	return { ...subStep, import: patched };
}

// ─── Media duration helpers ───────────────────────────────────────────────────

function secsToDurationStr(secs: number): string {
	const s = Math.floor(secs);
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	const sec = s % 60;
	return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

async function collectMediaDuration(ctx: ExecutionContext, steps: { stepId: string; isTerminal: boolean }[]): Promise<number> {
	const types = typeOfFile_store.getState().patternStore;
	const mediaExts = new Set<string>(
		types
			.filter((t) => t.name === 'video' || t.name === 'audio')
			.flatMap((t) => t.path)
			.map((ext) => ext.toLowerCase()),
	);

	let totalSecs = 0;
	for (const step of steps) {
		if (!step.isTerminal) continue;
		const output = ctx.results.get(step.stepId);
		const outputs = Array.isArray(output) ? output : (output != null ? [output] : []);
		for (const item of outputs) {
			const filePath: unknown =
				typeof item === 'string' ? item
				: (item as any)?.path ?? (item as any)?.filePath ?? (item as any)?.outputPath ?? null;
			if (typeof filePath !== 'string' || !filePath) continue;
			const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
			if (!mediaExts.has(ext)) continue;
			try {
				const infoJson: string = await api().invoke('ffprobe_get_info', filePath);
				const streams: any[] = JSON.parse(infoJson).streams ?? [];
				const stream = streams.find((s: any) => s.codec_type === 'video')
				            ?? streams.find((s: any) => s.codec_type === 'audio');
				if (stream?.duration) totalSecs += parseFloat(stream.duration) || 0;
			} catch {}
		}
	}
	return totalSecs;
}
