// processItem — orchestrator одного item'а обработки. Порт из Electron'овского
// electron/main/processing/processItem.ts. Живёт в renderer'е, имеет:
//   - Полный debugger через DevTools
//   - Прямой доступ к Zustand-сторам (useProcessingStats_store, useStatusBar_Store и т.п.)
//   - Вызов плагинов через loadPlugin('plugin://...') — JS-функция, не IPC
//
// Эмиты log-window событий идут через invoke в Rust → forward в logWindow.

import { basename, join } from '@plugin-api/path';
import { loadPlugin } from '@/PluginAPI/loader';

const api = () => (window as any).electronAPI;

// ─── Типы ────────────────────────────────────────────────────────────────────

export type SendFn = (type: string, payload: any) => void;

export interface ExecutionContext {
	results: Map<string, any[]>;
	description: any;
	signal: AbortSignal;
	itemId: string;
	send: SendFn;
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
	sendToMW: (msg: any) => void;
}

// ─── Утилиты ─────────────────────────────────────────────────────────────────

async function pathExists(p: string): Promise<boolean> {
	const checked = await api().invoke('checkFilePath', p);
	return Boolean(checked);
}

async function moveToErrorsFolder(
	pathForDelete: string,
	projectPath: string,
	send: SendFn,
	itemId: string,
): Promise<void> {
	try {
		// Ищем папку errors* в проекте
		const items = (await api().invoke('getSomeFromFolder', projectPath, [
			{ type: 'folders', ext: [] },
		])) as any[];
		let errorsFolder = items.find((it) => it.name?.startsWith('errors'))?.path as string | undefined;

		if (!errorsFolder) {
			errorsFolder = join(projectPath, 'errors');
			await api().invoke('testAndCreateFolder', errorsFolder);
		}

		const destPath = join(errorsFolder, basename(pathForDelete));
		await api().invoke('moveItem', pathForDelete, destPath, { overwrite: true });

		const now = new Date();
		const dateStr = `${String(now.getDate()).padStart(2, '0')}.${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}.${String(now.getMinutes()).padStart(2, '0')}`;
		const newFolderName = `errors (${dateStr})`;
		const newFolderPath = join(projectPath, newFolderName);

		if (!(await pathExists(newFolderPath))) {
			await api().invoke('renameFolder', errorsFolder, newFolderPath);
		}

		send('log', {
			level: 'warn',
			text: `[processItem] Error — moved to "${newFolderName}": ${basename(pathForDelete)}`,
			itemId,
		});
		send('statusbar', {
			text: `⚠️ Error — moved to "${newFolderName}": ${basename(pathForDelete)}`,
		});
	} catch (e: any) {
		send('log', { level: 'warn', text: `[processItem] moveToErrors failed: ${e.message}`, itemId });
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
			api()
				.invoke('log-window:item-queued', {
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
			api()
				.invoke('log-window:emit-item-end', {
					itemId: payload.itemId,
					status: payload.status,
					endTime: new Date().toISOString(),
					totalCost: payload.totalCost,
				})
				.catch(() => {});
		} else if (type === 'node:start') {
			api()
				.invoke('log-window:emit-node-update', {
					itemId: payload.itemId,
					nodeId: payload.nodeId,
					status: 'running',
					startTime: new Date().toISOString(),
				})
				.catch(() => {});
		} else if (type === 'node:done') {
			api()
				.invoke('log-window:emit-node-update', {
					itemId: payload.itemId,
					nodeId: payload.nodeId,
					status: 'done',
					endTime: new Date().toISOString(),
					finalCost: payload.finalCost,
				})
				.catch(() => {});
		} else if (type === 'node:error') {
			api()
				.invoke('log-window:emit-node-update', {
					itemId: payload.itemId,
					nodeId: payload.nodeId,
					status: 'error',
					endTime: new Date().toISOString(),
				})
				.catch(() => {});
		} else if (type === 'log' || type === 'error') {
			api()
				.invoke('log-window:emit-item-log', {
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
			api().invoke('setStatusBar', payload.text ?? '').catch(() => {});
		}
	};

	send('item:start', { itemId, itemName, mainFolderName, projectName, steps });

	const ctx: ExecutionContext = {
		results: new Map(),
		description: desc,
		signal,
		itemId,
		send,
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

	if (pathForDelete && (await pathExists(pathForDelete))) {
		const deleteAfter = mainSearchObj?.deleteAfter ?? false;
		if (allStepsSucceeded && !ctx.signal.aborted && deleteAfter) {
			try {
				await api().invoke('deleteItem', pathForDelete);
				send('log', { level: 'info', text: `[processItem] Deleted original: ${basename(pathForDelete)}`, itemId });
			} catch {
				send('log', { level: 'warn', text: `[processItem] Failed to delete original: ${basename(pathForDelete)}`, itemId });
			}
		} else if (!allStepsSucceeded && !ctx.signal.aborted && projectPath && deleteAfter) {
			await moveToErrorsFolder(pathForDelete, projectPath, send, itemId);
		}
	}

	const finalStatus = ctx.signal.aborted ? 'aborted' : allStepsSucceeded ? 'done' : 'error';
	send('item:end', { itemId, status: finalStatus });
	return finalStatus;
}

// ─── Выполнение шага ─────────────────────────────────────────────────────────

async function executeStep(stepId: string, stepObj: any, ctx: ExecutionContext, item: any): Promise<boolean> {
	const nodeType = stepObj.nodeType ?? 'default';
	if (nodeType === 'loop') return executeLoop(stepId, stepObj, ctx, item);
	return executeDefault(stepId, stepObj, ctx);
}

// ─── Обычная нода (один плагин) ──────────────────────────────────────────────

async function executeDefault(stepId: string, stepObj: any, ctx: ExecutionContext): Promise<boolean> {
	const { send } = ctx;
	const resolvedImport = resolveImport(stepObj.import, ctx);
	const execObj = { ...stepObj, import: resolvedImport };

	if (!execObj.pluginId || !execObj.pluginVersion) {
		send('error', { step: stepId, message: `Missing pluginId/pluginVersion in "${stepId}"`, itemId: ctx.itemId });
		return false;
	}

	send('node:start', { nodeId: stepId, itemId: ctx.itemId });
	send('log', { level: 'info', text: `→ ${stepId} (${execObj.pluginId}@${execObj.pluginVersion})`, itemId: ctx.itemId, stepId });

	try {
		const pluginModule = await loadPlugin(execObj.pluginId, execObj.pluginVersion);
		const pluginFn = resolveCallable(pluginModule);
		if (!pluginFn) {
			throw new Error(`Plugin ${execObj.pluginId}@${execObj.pluginVersion} has no callable export`);
		}

		const pluginCtx: PluginCtx = {
			itemId: ctx.itemId,
			stepId,
			signal: ctx.signal,
			pluginId: execObj.pluginId,
			pluginVersion: execObj.pluginVersion,
			log: (level, text, meta) => send('log', { level, text, meta, itemId: ctx.itemId, stepId }),
			send,
			sendToMW: (msg: any) => send('log', { ...msg, itemId: ctx.itemId, stepId }),
		};

		const result = await pluginFn(execObj, ctx.description, pluginCtx);
		const output = Array.isArray(result) ? result : [result];
		ctx.results.set(stepId, output);
		stepObj.output = output;

		send('node:done', { nodeId: stepId, output, itemId: ctx.itemId });
		return true;
	} catch (e: any) {
		send('node:error', { nodeId: stepId, message: e?.message ?? String(e), itemId: ctx.itemId });
		send('error', { step: stepId, message: e?.message ?? String(e), itemId: ctx.itemId, stepId });
		console.error(`[processItem] Error in step "${stepId}":`, e);
		return false;
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

	for (let i = 0; i < inputArray.length; i++) {
		if (ctx.signal.aborted) {
			send('aborted', null);
			return false;
		}

		const currentItem = inputArray[i];
		send('log', { level: 'info', text: `  [${i + 1}/${inputArray.length}] ${currentItem}`, itemId: ctx.itemId, stepId });

		const innerCtx: ExecutionContext = {
			results: new Map(ctx.results),
			description: ctx.description,
			signal: ctx.signal,
			itemId: ctx.itemId,
			send,
		};
		innerCtx.results.set(`${stepId}__inputInLoop`, [currentItem]);

		const subgraph: any[] = stepObj.subgraph ?? [];
		let iterationOk = true;

		for (const subStep of subgraph) {
			if (innerCtx.signal.aborted) return false;
			const patched = patchSubStepImport(subStep, stepId);
			const ok = await executeStep(subStep.id, patched, innerCtx, item);
			if (!ok) {
				iterationOk = false;
				break;
			}
		}

		if (!iterationOk) {
			send('log', { level: 'warn', text: `  [${i + 1}/${inputArray.length}] failed`, itemId: ctx.itemId, stepId });
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
