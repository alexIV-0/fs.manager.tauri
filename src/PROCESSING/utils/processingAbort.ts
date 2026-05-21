// processingAbort.ts
let controller: AbortController | null = null;

export function startProcessContext() {
	controller = new AbortController();
}

export function abortNow() {
	controller?.abort();
}

export function getSignal(): AbortSignal {
	if (!controller) {
		throw new Error('Process context not initialized');
	}
	return controller.signal;
}
