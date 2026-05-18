// sender.ts
// Per-item sender via AsyncLocalStorage — каждая параллельная задача имеет свой send.
// Плагины, вызывающие sendToMW из своего async-контекста, автоматически получают
// sender своей задачи (itemId передаётся из processItem через AsyncLocalStorage).

import { AsyncLocalStorage } from 'async_hooks';

export interface Sender {
	(type: string, payload: any): void;
}

interface SenderContext {
	send: Sender;
	itemId?: string;
	stepId?: string;
}

const als = new AsyncLocalStorage<SenderContext>();

// Fallback для случаев, когда AsyncLocalStorage недоступен (старый код)
let globalSender: Sender | null = null;

export function setSender(sender: Sender) {
	globalSender = sender;
}

export function getSender(): Sender | null {
	const ctx = als.getStore();
	return ctx?.send ?? globalSender;
}

/**
 * Запускает fn внутри async-контекста с заданным sender.
 * Все вызовы sendToMW внутри fn (включая плагины) получат этот sender.
 */
export function runWithSender<T>(ctx: SenderContext, fn: () => Promise<T>): Promise<T> {
	return als.run(ctx, fn);
}

/**
 * Безопасный sender для вызова из плагинов и старого кода.
 * Автоматически подхватывает itemId/stepId из async-контекста, если они там есть.
 */
export function sendToMW(type: string, payload: any) {
	const ctx = als.getStore();
	const sender = ctx?.send ?? globalSender;
	if (!sender) return;

	// Если это лог и itemId не задан явно — подставляем из контекста
	if ((type === 'log' || type === 'error') && ctx && payload && typeof payload === 'object') {
		if (!payload.itemId && ctx.itemId) payload = { ...payload, itemId: ctx.itemId };
		if (!payload.stepId && ctx.stepId) payload = { ...payload, stepId: ctx.stepId };
	}

	// Для node:siteCost подставляем itemId и nodeId из контекста
	if (type === 'node:siteCost' && ctx && payload && typeof payload === 'object') {
		if (!payload.itemId && ctx.itemId) payload = { ...payload, itemId: ctx.itemId };
		if (!payload.nodeId && ctx.stepId) payload = { ...payload, nodeId: ctx.stepId };
	}

	sender(type, payload);
}

export const safeSend: Sender = sendToMW;
