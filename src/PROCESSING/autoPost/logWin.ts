// Эмит постинга в окно log_win как поитемного события (item-start/log/node-update/item-end),
// по образцу processItem.ts. Окно log_win показывает только этот канал (log-window:*),
// а НЕ processing-event/send_log — поэтому постинг логируем именно так.

import { commands } from '@/Utils/specta';

const STEP_DEFS: { stepId: string; label: string; isTerminal: boolean }[] = [
	{ stepId: 'save', label: 'video.save', isTerminal: false },
	{ stepId: 'upload', label: 'upload', isTerminal: false },
	{ stepId: 'post', label: 'wall.post', isTerminal: true },
];

function nowIso(): string {
	return new Date().toISOString();
}

/** Создаёт item постинга в log_win (status=running) с тремя шагами в queued. */
export function startPostItem(itemId: string, itemName: string, mainFolderName: string, projectName: string): void {
	const steps = STEP_DEFS.map((s) => ({
		stepId: s.stepId,
		label: s.label,
		nodeType: 'default',
		cost: '0',
		costUnit: 'run',
		isTerminal: s.isTerminal,
		status: 'queued',
		logs: [],
		errorCount: 0,
	}));
	commands
		.logWindowEmitItemQueued({
			itemId,
			itemName,
			mainFolderName,
			projectName,
			steps,
			status: 'running',
			startTime: nowIso(),
			itemLogs: [],
			errorCount: 0,
			warnCount: 0,
		})
		.catch(() => {});
}

/** Лог-строка под item'ом (если stepId задан — под конкретным шагом). */
export function postItemLog(itemId: string, level: 'info' | 'warn' | 'error', message: string, stepId?: string): void {
	commands
		.logWindowEmitItemLog({
			id: Math.random().toString(36).slice(2, 9),
			timestamp: nowIso(),
			level,
			message,
			source: 'renderer',
			itemId,
			stepId: stepId ?? null,
		})
		.catch(() => {});
}

/** Обновление статуса шага (квадратик running/done/error). */
export function postStepUpdate(itemId: string, stepId: string, status: 'running' | 'done' | 'error'): void {
	const patch: Record<string, any> = { itemId, nodeId: stepId, status };
	if (status === 'running') patch.startTime = nowIso();
	else patch.endTime = nowIso();
	commands.logWindowEmitNodeUpdate(patch).catch(() => {});
}

/** Завершение item'а постинга. */
export function endPostItem(itemId: string, status: 'done' | 'error'): void {
	commands.logWindowEmitItemEnd({ itemId, status, endTime: nowIso() }).catch(() => {});
}
