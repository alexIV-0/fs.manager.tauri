// logWindow.ts
import { BrowserWindow, dialog, ipcMain } from 'electron';
import fs from 'fs';
import path from 'path';
import { createAppWindow } from './createAppWindows';
import { getDbExporter } from './dbExporter';

export interface LogWindowOptions {
	width?: number;
	height?: number;
	iconPath?: string;
	storeKey?: string;
}

export interface LogEntry {
	id: string;
	timestamp: string;
	level: 'info' | 'warn' | 'error' | 'debug';
	message: string;
	meta?: any;
	source: 'main' | 'renderer';
	itemId?: string;
	stepId?: string;
}

export type CostUnit = 'HH' | 'MM' | 'ss' | 'run' | 'fromSite';

export interface StepInfo {
	stepId: string;
	label: string;
	pluginId?: string;
	pluginVersion?: string;
	nodeType: string;
	status: 'queued' | 'running' | 'done' | 'error';
	startTime?: string;
	endTime?: string;
	logs: LogEntry[];
	errorCount: number;
	cost?: string;
	costUnit?: CostUnit;
	finalCost?: number;
	isTerminal?: boolean;
}

export interface ProcessingItemGroup {
	itemId: string;
	itemName: string;
	mainFolderName: string;
	projectName: string;
	status: 'queued' | 'running' | 'done' | 'error' | 'aborted';
	startTime: string;
	endTime?: string;
	steps: StepInfo[];
	errorCount: number;
	warnCount: number;
	itemLogs: LogEntry[];
	totalCost?: number;
	dbItemId?: string;
}

function computeFinalCost(cost: string | undefined, unit: CostUnit | undefined, startIso?: string, endIso?: string): number {
	const base = Number(cost);
	if (!Number.isFinite(base) || !unit) return 0;
	// 'fromSite' cost is set externally by the plugin after downloading results
	if (unit === 'fromSite') return 0;
	if (unit === 'run') return base;
	if (!startIso || !endIso) return 0;
	const durSec = (new Date(endIso).getTime() - new Date(startIso).getTime()) / 1000;
	if (durSec <= 0) return 0;
	if (unit === 'ss') return base * durSec;
	if (unit === 'MM') return base * (durSec / 60);
	if (unit === 'HH') return base * (durSec / 3600);
	return 0;
}

export interface LogWindowStats {
	totalItems: number;
	runningItems: number;
	errorItems: number;
	totalLogs: number;
	errors: number;
	warnings: number;
}

export class LogWindowManager {
	private window: BrowserWindow | null = null;
	private items: Map<string, ProcessingItemGroup> = new Map();
	private orphanLogs: LogEntry[] = [];

	constructor(private options: LogWindowOptions = {}) {
		this.options = {
			width: 1400,
			height: 800,
			storeKey: 'logWindowState',
			...options,
		};
		this.setupIPC();
	}

	private setupIPC() {
		ipcMain.on('renderer-log', (_, payload) => {
			this.addItemLog(payload.level, payload.message, payload.meta, 'renderer');
		});

		ipcMain.handle('log-window:get-history', () => ({
			items: Array.from(this.items.values()),
			orphanLogs: this.orphanLogs,
			stats: this.getStats(),
		}));

		ipcMain.handle('log-window:clear', () => {
			this.clearHistory();
			return true;
		});

		ipcMain.handle('log-window:export', async (event, format: 'txt' | 'json') => {
			const win = BrowserWindow.fromWebContents(event.sender) ?? this.window;
			return this.exportLogs(format, win);
		});

		ipcMain.handle('log-window:item-queued', (_, payload: {
			itemId: string;
			itemName: string;
			mainFolderName?: string;
			projectName?: string;
			steps?: Omit<StepInfo, 'status' | 'logs' | 'errorCount'>[];
			dbItemId?: string;
		}) => {
			this.itemQueued(
				payload.itemId,
				payload.itemName,
				payload.mainFolderName ?? '',
				payload.projectName ?? '',
				payload.steps ?? [],
				payload.dbItemId,
			);
		});

		ipcMain.handle('log-window:abort-queued', () => {
			this.abortAllQueued();
		});
	}

	// ── Window lifecycle ──────────────────────────────────────────────────────

	create() {
		if (this.window && !this.window.isDestroyed()) {
			this.window.focus();
			return this.window;
		}

		const isDev = !!process.env.VITE_DEV_SERVER_URL;
		const logWindowUrl = isDev
			? `${process.env.VITE_DEV_SERVER_URL}/logWindow.html`
			: `file://${path.join(process.env.APP_ROOT!, 'dist', 'logWindow.html')}`;

		this.window = createAppWindow({
			storeKey: this.options.storeKey!,
			title: 'Логи обработки',
			icon: this.options.iconPath ?? '',
			defaultSize: { width: this.options.width!, height: this.options.height! },
			devTools: false,
			loadUrl: logWindowUrl,
		});

		this.window.once('ready-to-show', () => {
			this.window!.show();
			this.window!.focus();
			setTimeout(() => this.sendHistory(), 300);
		});

		this.window.on('closed', () => { this.window = null; });

		return this.window;
	}

	open() {
		if (this.window && !this.window.isDestroyed()) {
			this.window.show();
			this.window.focus();
			return true;
		}
		this.create();
		return true;
	}

	toggle() {
		if (this.window && !this.window.isDestroyed()) {
			this.window.isVisible() ? this.window.hide() : (this.window.show(), this.window.focus());
		} else {
			this.open();
		}
		return true;
	}

	// ── Item lifecycle ────────────────────────────────────────────────────────

	itemQueued(itemId: string, itemName: string, mainFolderName: string, projectName: string, steps: Omit<StepInfo, 'status' | 'logs' | 'errorCount'>[], dbItemId?: string) {
		const existing = this.items.get(itemId);
		// Не затираем активные/queued записи; терминальные (done/error/aborted) — перезаписываем свежим стартом.
		if (existing && (existing.status === 'queued' || existing.status === 'running')) return;

		const group: ProcessingItemGroup = {
			itemId,
			itemName,
			mainFolderName,
			projectName,
			status: 'queued',
			startTime: new Date().toISOString(),
			steps: steps.map((s) => ({
				...s,
				status: 'queued',
				logs: [],
				errorCount: 0,
			})),
			errorCount: 0,
			warnCount: 0,
			itemLogs: [],
			dbItemId,
		};
		this.items.set(itemId, group);
		this.send('log-window:item-start', group);
	}

	itemStart(itemId: string, itemName: string, mainFolderName: string, projectName: string, steps: Omit<StepInfo, 'status' | 'logs' | 'errorCount'>[], dbItemId?: string) {
		const existing = this.items.get(itemId);
		if (existing && existing.status === 'queued') {
			existing.status = 'running';
			// startTime сохраняем — он отражает момент постановки в очередь.
			if (dbItemId && !existing.dbItemId) existing.dbItemId = dbItemId;
			this.send('log-window:item-start', existing);
			if (existing.dbItemId) getDbExporter().itemStart(existing.dbItemId);
			return;
		}

		const group: ProcessingItemGroup = {
			itemId,
			itemName,
			mainFolderName,
			projectName,
			status: 'running',
			startTime: new Date().toISOString(),
			steps: steps.map((s) => ({
				...s,
				status: 'queued',
				logs: [],
				errorCount: 0,
			})),
			errorCount: 0,
			warnCount: 0,
			itemLogs: [],
			dbItemId,
		};
		this.items.set(itemId, group);
		this.send('log-window:item-start', group);

		if (dbItemId) getDbExporter().itemStart(dbItemId);
	}

	abortAllQueued() {
		const endTime = new Date().toISOString();
		for (const [itemId, group] of this.items) {
			if (group.status !== 'queued') continue;
			group.status = 'aborted';
			group.endTime = endTime;
			this.send('log-window:item-end', { itemId, status: 'aborted', endTime });
		}
	}

	itemEnd(itemId: string, status: 'done' | 'error' | 'aborted') {
		const group = this.items.get(itemId);
		if (!group) return;
		group.status = status;
		group.endTime = new Date().toISOString();
		// close any step still 'running' → mark as error/done to match item status
		for (const step of group.steps) {
			if (step.status === 'running') {
				step.status = status === 'done' ? 'done' : 'error';
				step.endTime = group.endTime;
				step.finalCost = computeFinalCost(step.cost, step.costUnit, step.startTime, step.endTime);
			}
		}
		group.totalCost = group.steps.reduce((sum, s) => sum + (s.finalCost ?? 0), 0);
		this.send('log-window:item-end', { itemId, status, endTime: group.endTime, totalCost: group.totalCost });

		if (group.dbItemId) getDbExporter().itemEnd(group.dbItemId, status, group.totalCost);
	}

	nodeStart(itemId: string, nodeId: string) {
		const group = this.items.get(itemId);
		if (!group) return;
		const step = group.steps.find((s) => s.stepId === nodeId);
		if (step) {
			step.status = 'running';
			step.startTime = new Date().toISOString();
		}
		this.send('log-window:node-update', { itemId, nodeId, status: 'running', startTime: step?.startTime });

		if (group.dbItemId) getDbExporter().nodeStart(group.dbItemId, nodeId);
	}

	nodeSiteCost(itemId: string, nodeId: string, cost: number) {
		const group = this.items.get(itemId);
		if (!group) return;
		const step = group.steps.find((s) => s.stepId === nodeId);
		if (!step || step.costUnit !== 'fromSite') return;
		step.finalCost = cost;
		group.totalCost = group.steps.reduce((sum, s) => sum + (s.finalCost ?? 0), 0);
		this.send('log-window:node-update', { itemId, nodeId, finalCost: cost });
	}

	nodeDone(itemId: string, nodeId: string, output?: unknown) {
		const group = this.items.get(itemId);
		if (!group) return;
		const step = group.steps.find((s) => s.stepId === nodeId);
		if (step) {
			step.status = 'done';
			step.endTime = new Date().toISOString();
			if (step.costUnit !== 'fromSite') {
				step.finalCost = computeFinalCost(step.cost, step.costUnit, step.startTime, step.endTime);
			}
		}
		this.send('log-window:node-update', {
			itemId,
			nodeId,
			status: 'done',
			endTime: step?.endTime,
			finalCost: step?.finalCost,
		});

		if (group.dbItemId && step) {
			getDbExporter().nodeDone(group.dbItemId, nodeId, step.finalCost, output, step.isTerminal ?? false).catch(() => {});
		}
	}

	nodeError(itemId: string, nodeId: string, message: string) {
		const group = this.items.get(itemId);
		if (!group) return;
		const step = group.steps.find((s) => s.stepId === nodeId);
		if (step) {
			step.status = 'error';
			step.endTime = new Date().toISOString();
			step.errorCount++;
			step.finalCost = computeFinalCost(step.cost, step.costUnit, step.startTime, step.endTime);
		}
		group.errorCount++;
		this.send('log-window:node-update', {
			itemId,
			nodeId,
			status: 'error',
			endTime: step?.endTime,
			message,
			finalCost: step?.finalCost,
		});

		if (group.dbItemId) getDbExporter().nodeError(group.dbItemId, nodeId, step?.finalCost);
	}

	addItemLog(
		level: string,
		message: string,
		meta?: any,
		source: 'main' | 'renderer' = 'main',
		itemId?: string,
		stepId?: string,
	) {
		const entry: LogEntry = {
			id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
			timestamp: new Date().toISOString(),
			level: (level as LogEntry['level']) ?? 'info',
			message,
			meta,
			source,
			itemId,
			stepId,
		};

		const windowOpen = !!(this.window && !this.window.isDestroyed());

		if (itemId) {
			const group = this.items.get(itemId);
			if (group) {
				if (level === 'error') group.errorCount++;
				if (level === 'warn') group.warnCount++;
				const step = stepId ? group.steps.find((s) => s.stepId === stepId) : undefined;
				if (step) {
					if (level === 'error') step.errorCount++;
					// Сохраняем в step.logs ТОЛЬКО если окно закрыто — иначе дублирование
					// (окно получит лог через live IPC и добавит в свой step.logs).
					if (!windowOpen) step.logs.push(entry);
				} else if (!windowOpen) {
					// item-уровень, окно закрыто — сохраняем для history
					(group as any).itemLogs ??= [];
					(group as any).itemLogs.push(entry);
				}
			}
		} else {
			this.orphanLogs.push(entry);
			if (this.orphanLogs.length > 1000) this.orphanLogs = this.orphanLogs.slice(-500);
		}

		this.send('log-window:item-log', entry);
	}

	// ── Legacy shim ───────────────────────────────────────────────────────────

	addLog(level: string, message: string, meta?: any, source: 'main' | 'renderer' = 'main') {
		this.addItemLog(level, message, meta, source);
	}

	// ── History & stats ───────────────────────────────────────────────────────

	private sendHistory() {
		if (this.window && !this.window.isDestroyed()) {
			this.window.webContents.send('log-window:history', {
				items: Array.from(this.items.values()),
				orphanLogs: this.orphanLogs,
				stats: this.getStats(),
			});
		}
	}

	private send(channel: string, payload: any) {
		if (this.window && !this.window.isDestroyed()) {
			this.window.webContents.send(channel, payload);
		}
	}

	clearHistory() {
		this.items.clear();
		this.orphanLogs = [];
		this.send('log-window:cleared', null);
		return true;
	}

	getStats(): LogWindowStats {
		const arr = Array.from(this.items.values());
		let totalLogs = this.orphanLogs.length;
		let errors = 0;
		let warnings = 0;
		for (const g of arr) {
			totalLogs += g.steps.reduce((s, step) => s + step.logs.length, 0);
			errors += g.errorCount;
			warnings += g.warnCount;
		}
		return {
			totalItems: arr.length,
			runningItems: arr.filter((g) => g.status === 'running').length,
			errorItems: arr.filter((g) => g.errorCount > 0).length,
			totalLogs,
			errors,
			warnings,
		};
	}

	// ── Export ────────────────────────────────────────────────────────────────

	async exportLogs(format: 'txt' | 'json' = 'txt', win?: BrowserWindow | null) {
		const targetWin = win ?? this.window;
		if (!targetWin) return null;

		try {
			const { filePath } = await dialog.showSaveDialog(targetWin, {
				title: 'Экспорт логов',
				defaultPath: `logs-${new Date().toISOString().slice(0, 10)}.${format}`,
				filters: [
					{ name: 'Text Files', extensions: ['txt'] },
					{ name: 'JSON Files', extensions: ['json'] },
				],
			});
			if (!filePath) return null;

			const allItems = Array.from(this.items.values());
			let content: string;

			if (format === 'json') {
				content = JSON.stringify({ items: allItems, orphanLogs: this.orphanLogs }, null, 2);
			} else {
				const lines: string[] = [];
				for (const group of allItems) {
					lines.push(`\n=== ${group.itemName} [${group.status.toUpperCase()}] ===`);
					lines.push(`    Started: ${new Date(group.startTime).toLocaleString()}`);
					if (group.endTime) lines.push(`    Ended:   ${new Date(group.endTime).toLocaleString()}`);
					for (const step of group.steps) {
						const stepId = step.pluginId ? ` (${step.pluginId})` : '';
						lines.push(`  -- ${step.label}${stepId} [${step.status}] --`);
						for (const e of step.logs) {
							const time = new Date(e.timestamp).toLocaleTimeString('ru-RU', { hour12: false });
							lines.push(`    ${time} ${e.level.toUpperCase().padEnd(5)} ${e.message}`);
						}
					}
				}
				content = lines.join('\n');
			}

			fs.writeFileSync(filePath, content, 'utf-8');
			return filePath;
		} catch {
			return null;
		}
	}

	isOpen(): boolean { return this.window !== null && !this.window.isDestroyed(); }
	isVisible(): boolean { return this.isOpen() && this.window!.isVisible(); }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

let logWindowInstance: LogWindowManager | null = null;

export function getLogWindowManager(options?: LogWindowOptions): LogWindowManager {
	if (!logWindowInstance) logWindowInstance = new LogWindowManager(options);
	return logWindowInstance;
}

export function openLogWindow(): boolean { return getLogWindowManager().open(); }
export function toggleLogWindow(): void { getLogWindowManager().toggle(); }

export function getLogWindowStatus() {
	const m = getLogWindowManager();
	return { isOpen: m.isOpen(), isVisible: m.isVisible(), stats: m.getStats() };
}
