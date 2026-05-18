// electron/processing/processItem.ts
import { tryToUnlinkFile, moveItem } from '../fileSistem/copyOrMoveItem';
import { getFormattedDateTime } from '../utilits/getFormattedDateTime';
import { getPluginManager } from '../pluginManagerRef';
import { acquireResource, releaseResource } from './ResourcePool';
import { runWithSender } from '../utilits/senderLogToMainWin';
import { verifyFileReady } from '../fileSistem/verifyFileReady';
import { isCloudFilePending } from '../fileSistem/isCloudFilePending';
import path from 'path';
import fs from 'fs';

// ─── Верификация готовности файла ────────────────────────────────────────────
// Для локальных файлов: 2 попытки × 30 сек.
// Для облачных (GD/iCloud): до 20 попыток × 30 сек (~10 минут).
// После первого failed verify проверяем isCloudFilePending — если файл активно
// скачивается, продолжаем ждать вместо быстрого отказа.
async function waitForFileReady(
	filePath: string,
	signal: AbortSignal,
	send: SendFn,
	itemId: string,
	typeOfFile?: Record<string, string[] | string>,
): Promise<boolean> {
	const RETRY_MS = 30_000;
	const MAX_ATTEMPTS = 2;
	const MAX_CLOUD_ATTEMPTS = 20;

	if (Array.isArray(filePath) || typeof filePath !== 'string') {
		send('log', {
			level: 'error',
			text: `[waitForFileReady] Invalid filePath type: ${Array.isArray(filePath) ? 'array' : typeof filePath}, value: ${JSON.stringify(filePath)}`,
			itemId,
		});
		return false;
	}

	for (let attempt = 1; ; attempt++) {
		if (signal.aborted) return false;

		const result = await verifyFileReady(filePath, typeOfFile);
		if (result.ok) return true;

		// После первой неудачи проверяем: не началось ли облачное скачивание?
		// (ffprobe-обращение могло его спровоцировать)
		const cloudPending = isCloudFilePending(filePath);
		const maxAttempts = cloudPending ? MAX_CLOUD_ATTEMPTS : MAX_ATTEMPTS;

		send('log', {
			level: 'warn',
			text: `[processItem] File not ready (attempt ${attempt}/${maxAttempts}${cloudPending ? ', cloud download in progress' : ''}): ${path.basename(filePath)} — ${result.reason ?? 'unknown'}`,
			itemId,
		});

		if (attempt >= maxAttempts) return false;

		await new Promise<void>((resolve) => {
			const timer = setTimeout(resolve, RETRY_MS);
			signal.addEventListener('abort', () => {
				clearTimeout(timer);
				resolve();
			}, { once: true });
		});
	}
}

// ─── Типы ────────────────────────────────────────────────────────────────────

type SendFn = (type: string, payload: any) => void;

interface ExecutionContext {
	results: Map<string, any[]>;
	description: any;
	signal: AbortSignal;
	itemId: string;
	send: SendFn;
}

// ─── Вспомогательная функция: переместить в папку errors ─────────────────────

async function moveToErrorsFolder(pathForDelete: string, projectPath: string, send: SendFn, itemId?: string): Promise<void> {
	try {
		const entries = fs.readdirSync(projectPath, { withFileTypes: true });
		let errorsFolder: string | null = null;

		for (const entry of entries) {
			if (entry.isDirectory() && entry.name.startsWith('errors')) {
				errorsFolder = path.join(projectPath, entry.name);
				break;
			}
		}

		if (!errorsFolder) {
			errorsFolder = path.join(projectPath, 'errors');
			fs.mkdirSync(errorsFolder, { recursive: true });
		}

		const destPath = path.join(errorsFolder, path.basename(pathForDelete));
		const moved = moveItem(pathForDelete, destPath, { overwrite: true });

		if (!moved) {
			send('log', {
				level: 'warn',
				text: `[processItem] Could not move failed item to errors: ${path.basename(pathForDelete)}`,
				itemId,
			});
			return;
		}

		const dateStr = getFormattedDateTime('$DD.$MM-$HH.$mm');
		const newFolderName = `errors (${dateStr})`;
		const newFolderPath = path.join(projectPath, newFolderName);

		if (!fs.existsSync(newFolderPath)) {
			fs.renameSync(errorsFolder, newFolderPath);
		}

		send('log', {
			level: 'warn',
			text: `[processItem] Error occurred — moved to "${newFolderName}": ${path.basename(pathForDelete)}`,
			itemId,
		});
		send('statusbar', {
			text: `⚠️ Error — moved to "${newFolderName}": ${path.basename(pathForDelete)}`,
		});
	} catch (e: any) {
		send('log', { level: 'warn', text: `[processItem] Error handling failed item: ${e.message}`, itemId });
	}
}

// ─── Публичная точка входа ────────────────────────────────────────────────────

export async function processItem({ item, signal, send }: { item: any; signal: AbortSignal; send: SendFn }) {
	// itemId должен совпадать с тем, что renderer отправил в log-window:item-queued
	// (см. findFilesForSingleFolder.ts). Порядок fallback идентичен.
	const desc = item.description ?? {};
	const itemId: string =
		desc.dbItemId ??
		(desc.pathForDelete && desc.findTime ? `${desc.pathForDelete}:${desc.findTime}` : undefined) ??
		desc.pathForDelete ??
		desc.id ??
		String(Date.now());

	const curItem: string = desc.curItem ?? path.basename(desc.pathForDelete ?? itemId);
	const itemName: string = desc.findTime ? `[${desc.findTime}] ${curItem}` : curItem;
	const mainFolderName: string = item.description?.mainFolderName ?? '';
	const projectName: string = item.description?.projectName ?? '';

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
		};
	});

	const dbItemId: string | undefined = item.description?.dbItemId;

	send('item:start', { itemId, itemName, mainFolderName, projectName, steps, dbItemId });

	// ─── Верификация готовности исходного файла/папки ────────────────────────
	// Файл — ffprobe для media-типов, generic-чтение для остальных.
	// Папка — рекурсивно параллельно проверяем все файлы, чьё расширение есть в typeOfFile.
	let srcPath: string | undefined = item.description?.pathForDelete;
	if (Array.isArray(srcPath)) srcPath = srcPath[0];

	if (srcPath && fs.existsSync(srcPath)) {
		const typeOfFile = item.description?.typeOfFile as Record<string, string[] | string> | undefined;
		const ready = await waitForFileReady(srcPath, signal, send, itemId, typeOfFile);
		if (!ready) {
			send('log', {
				level: 'error',
				text: `[processItem] File not ready after retries, skipping: ${path.basename(srcPath)}`,
				itemId,
			});
			send('item:end', { itemId, status: 'error', totalCost: 0 });
			return;
		}
	}

	const ctx: ExecutionContext = {
		results: new Map(),
		description: item.description,
		signal,
		itemId,
		send,
	};

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

	// ─── Пост-обработка оригинального файла/папки ────────────────────────────
	const pathForDelete: string | undefined = item.description?.pathForDelete;
	const projectPath: string | undefined = item.description?.projectPathGD;

	if (pathForDelete && fs.existsSync(pathForDelete)) {
		const deleteAfter = item[mainSearchKey]?.deleteAfter ?? false;
		if (allStepsSucceeded && !ctx.signal.aborted) {
			if (deleteAfter) {
				const result = tryToUnlinkFile(pathForDelete);
				if (result === 'success') {
					send('log', { level: 'info', text: `[processItem] Deleted original: ${path.basename(pathForDelete)}`, itemId });
				} else {
					send('log', { level: 'warn', text: `[processItem] Failed to delete original: ${path.basename(pathForDelete)}`, itemId });
				}
			}
		} else if (!allStepsSucceeded && !ctx.signal.aborted && projectPath && deleteAfter) {
			await moveToErrorsFolder(pathForDelete, projectPath, send, itemId);
		}
	}

	const finalStatus = ctx.signal.aborted ? 'aborted' : allStepsSucceeded ? 'done' : 'error';
	send('item:end', { itemId, status: finalStatus });
	send('process:complete', null);

	return finalStatus;
}

// ─── Выполнение одного шага ───────────────────────────────────────────────────

async function executeStep(stepId: string, stepObj: any, ctx: ExecutionContext, item: any): Promise<boolean> {
	const nodeType = stepObj.nodeType ?? 'default';
	if (nodeType === 'loop') return executeLoop(stepId, stepObj, ctx, item);
	return executeDefault(stepId, stepObj, ctx);
}

// ─── Обычная нода ─────────────────────────────────────────────────────────────

async function executeDefault(stepId: string, stepObj: any, ctx: ExecutionContext): Promise<boolean> {
	const { send } = ctx;
	const resolvedImport = resolveImport(stepObj.import, ctx);
	const execObj = { ...stepObj, import: resolvedImport };

	if (!execObj.pluginId || !execObj.pluginVersion) {
		send('error', { step: stepId, message: `Missing pluginId or pluginVersion in "${stepId}"`, itemId: ctx.itemId });
		return false;
	}

	const colorType: string | undefined = stepObj.colorType;
	if (colorType) await acquireResource(colorType);

	send('node:start', { nodeId: stepId, itemId: ctx.itemId });
	send('log', { level: 'info', text: `→ ${stepId} (${execObj.pluginId}@${execObj.pluginVersion})`, itemId: ctx.itemId, stepId });

	try {
		// Оборачиваем вызов плагина в AsyncLocalStorage-контекст:
		// все sendToMW из плагина автоматически получат itemId + stepId
		const result = await runWithSender(
			{ send, itemId: ctx.itemId, stepId },
			() => getPluginManager().callDefault(execObj.pluginId, execObj.pluginVersion, execObj, ctx.description),
		);

		const output = Array.isArray(result) ? result : [result];
		ctx.results.set(stepId, output);
		stepObj.output = output;

		send('node:done', { nodeId: stepId, output, itemId: ctx.itemId });
		send('done', { step: stepId, output });
		return true;
	} catch (e: any) {
		send('node:error', { nodeId: stepId, message: e.message, itemId: ctx.itemId });
		send('error', { step: stepId, message: e.message, itemId: ctx.itemId });
		console.error(`[processItem] Error in step "${stepId}":`, e);
		return false;
	} finally {
		if (colorType) releaseResource(colorType);
	}
}

// ─── Loop нода ───────────────────────────────────────────────────────────────

async function executeLoop(stepId: string, stepObj: any, ctx: ExecutionContext, item: any): Promise<boolean> {
	const { send } = ctx;
	const loopInputSourceId = stepObj.import?.loopInput;
	if (!loopInputSourceId) {
		send('error', { step: stepId, message: `Loop "${stepId}" has no loopInput connected`, itemId: ctx.itemId });
		return false;
	}

	const inputArray = ctx.results.get(loopInputSourceId) ?? [];
	if (!Array.isArray(inputArray) || inputArray.length === 0) {
		send('log', { level: 'info', text: `Loop "${stepId}": input is empty, skipping`, itemId: ctx.itemId, stepId });
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

			const patchedSubStep = patchSubStepImport(subStep, stepId);
			const ok = await executeStep(subStep.id, patchedSubStep, innerCtx, item);

			if (!ok) {
				iterationOk = false;
				break;
			}
		}

		if (!iterationOk) {
			send('log', { level: 'warn', text: `  [${i + 1}/${inputArray.length}] iteration failed, skipping`, itemId: ctx.itemId, stepId });
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
	send('done', { step: stepId, output: accumulator });
	return true;
}

// ─── Вспомогательные функции ──────────────────────────────────────────────────

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

	const patchedImport: Record<string, string> = { ...subStep.import };
	for (const [key, value] of Object.entries(patchedImport)) {
		if (value === loopNodeId) {
			patchedImport[key] = `${loopNodeId}__inputInLoop`;
		}
	}

	return { ...subStep, import: patchedImport };
}
