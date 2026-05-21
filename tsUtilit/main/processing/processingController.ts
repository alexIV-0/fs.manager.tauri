// Множество активных контроллеров — нужно для параллельной обработки нескольких items
const controllers = new Set<AbortController>();

export function createAbortController(): AbortController {
	const controller = new AbortController();
	controllers.add(controller);
	// Автоматически убираем из Set когда сигнал сработал
	controller.signal.addEventListener('abort', () => controllers.delete(controller));
	return controller;
}

export function abortProcessing() {
	controllers.forEach((c) => c.abort());
	controllers.clear();
}

export function getAbortSignal(): AbortSignal | null {
	// Возвращает сигнал последнего контроллера (для обратной совместимости)
	const arr = [...controllers];
	return arr.length > 0 ? arr[arr.length - 1].signal : null;
}
