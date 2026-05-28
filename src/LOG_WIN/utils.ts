import type { ProcessingItemGroup, StepInfo } from './types';

// Сколько завершённых item'ов держим во вкладке «Текущие» (RAM). Должно совпадать с
// HOT_BUFFER_FINISHED_LIMIT на Rust-стороне. Старые завершённые остаются в «Архиве» (на диске).
export const LIVE_FINISHED_LIMIT = 40;

export const LEVEL_COLOR: Record<string, string> = {
	info: '#58a6ff',
	warn: '#d29922',
	error: '#f85149',
	debug: '#8b949e',
};

export const STEP_COLOR: Record<StepInfo['status'], string> = {
	queued: '#555',
	running: LEVEL_COLOR.warn,
	done: '#3fb950',
	error: LEVEL_COLOR.error,
};

export function fmtCost(n: number): string {
	if (!Number.isFinite(n)) return '';
	if (n <= 0) return '$0';
	return n < 1 ? `$${n.toFixed(3)}` : `$${n.toFixed(2)}`;
}

export function fmtBytes(n: number): string {
	if (n < 1024) return `${n} B`;
	if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
	return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function fmtTime(iso: string) {
	return new Date(iso).toLocaleTimeString('ru-RU', { hour12: false });
}

export function elapsed(startIso: string, endIso?: string): string {
	const ms = (endIso ? new Date(endIso) : new Date()).getTime() - new Date(startIso).getTime();
	const s = Math.floor(ms / 1000);
	const m = Math.floor(s / 60);
	const h = Math.floor(m / 60);
	if (h > 0) return `${h}:${String(m % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
	return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export function progress(steps: StepInfo[]): number {
	if (steps.length === 0) return 0;
	return Math.round((steps.filter((s) => s.status === 'done' || s.status === 'error').length / steps.length) * 100);
}

// Суммирует реальное время выполнения шагов (pool wait не учитывается,
// т.к. node:start отправляется только ПОСЛЕ acquirePool).
export function sumStepMs(steps: StepInfo[]): number {
	const now = Date.now();
	let total = 0;
	for (const step of steps) {
		if (!step.startTime) continue;
		const start = new Date(step.startTime).getTime();
		const end = step.endTime ? new Date(step.endTime).getTime() : now;
		if (end > start) total += end - start;
	}
	return total;
}

export function msToElapsed(ms: number): string {
	const s = Math.floor(ms / 1000);
	const m = Math.floor(s / 60);
	const h = Math.floor(m / 60);
	if (h > 0) return `${h}:${String(m % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
	return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

// В архиве group.errorCount/warnCount=0 (Rust пишет в файл то, что было на item-start, и не
// инкрементит счётчики на log-событиях). Восстанавливаем по тому, что точно сохраняется:
// status шагов + сами error/warn-записи в step.logs/itemLogs.
export function effectiveCounts(group: ProcessingItemGroup): { errors: number; warns: number } {
	let errs = 0;
	let warns = 0;
	for (const s of group.steps) {
		if (s.status === 'error') errs++;
		for (const l of s.logs) {
			if (l.level === 'error') errs++;
			else if (l.level === 'warn') warns++;
		}
	}
	for (const l of group.itemLogs ?? []) {
		if (l.level === 'error') errs++;
		else if (l.level === 'warn') warns++;
	}
	return {
		errors: Math.max(group.errorCount ?? 0, errs),
		warns: Math.max(group.warnCount ?? 0, warns),
	};
}

export function groupByHierarchy(list: ProcessingItemGroup[]): Map<string, Map<string, ProcessingItemGroup[]>> {
	const result = new Map<string, Map<string, ProcessingItemGroup[]>>();
	for (const g of list) {
		const mf = g.mainFolderName || '—';
		const proj = g.projectName || '—';
		if (!result.has(mf)) result.set(mf, new Map());
		const projects = result.get(mf)!;
		if (!projects.has(proj)) projects.set(proj, []);
		projects.get(proj)!.push(g);
	}
	return result;
}

export const LEVELS = [
	{ key: 'info', label: 'Info', color: LEVEL_COLOR.info },
	{ key: 'warn', label: 'Warn', color: LEVEL_COLOR.warn },
	{ key: 'error', label: 'Error', color: LEVEL_COLOR.error },
	{ key: 'debug', label: 'Debug', color: LEVEL_COLOR.debug },
] as const;
