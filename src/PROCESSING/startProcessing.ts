import { isScanningStore } from '@/Store/MainWin/isScaning_store';
import { useWorkProject_Store } from '@/Store/Processing/useWorkProject_Store';
import { useStatusBar_Store } from '@/Store/Processing/useStatusBar_Store';
import { getSignal } from './function/utils/processingAbort';
import { getAppSettings } from '@/Store/Settings/appSettings_client';
import { useProcessingStats_store } from '@/Store/Processing/useProcessingStats_store';
import { processItem } from './processItem';

let isSubscribed = false;

export async function startProcessing() {
	const signal = getSignal();
	let totalProcessedFile = 0;

	// Снимок настроек на старте цикла — лимиты применяются при старте processing.
	const { maxParallel } = getAppSettings().processing;
	const MAX_PARALLEL = Math.max(1, maxParallel);

	// Processing events are now routed to logWindow in main process.
	// Only handle aborted/error here for status bar feedback.
	const handleProcessingEvent = (event: { type: string; payload: any }) => {
		if (event.type === 'aborted') {
			console.warn('[Processing] Aborted');
		}
	};

	if (!isSubscribed) {
		window.electronAPI.onProcessingEvent(handleProcessingEvent);
		isSubscribed = true;
	}

	isScanningStore.getState().setIsScanningProcess(true);

	const running = new Set<Promise<void>>();

	const processOne = async (item: any) => {
		try {
			// Прямой вызов в renderer'е — никаких IPC. processItem импортирует плагины
			// через plugin:// протокол, вызывает их как JS-функции, прокидывает ctx.
			const status: string = await processItem(item, signal);
			totalProcessedFile++;
			const { incSuccess, incErrorItems } = useProcessingStats_store.getState();
			if (status === 'done') incSuccess();
			else if (status === 'error') incErrorItems();
		} catch (e: any) {
			console.error('PROCESS FAILED:', e?.message ?? e);
		}
	};

	while (isScanningStore.getState().isScanning) {
		if (signal.aborted) break;

		// Мягкая остановка: ждём текущие items, ставим isScanning=false и выходим.
		if (!isScanningStore.getState().isScanningProcess) {
			if (running.size > 0) await Promise.allSettled(running);
			isScanningStore.getState().setIsScanning(false);
			break;
		}

		while (running.size < MAX_PARALLEL && isScanningStore.getState().isScanningProcess) {
			const item = useWorkProject_Store.getState().takeNextItem();
			if (!item) break;

			let promise: Promise<void>;
			promise = processOne(item).finally(() => running.delete(promise));
			running.add(promise);
		}

		// Очередь пуста и нечего обрабатывать — выходим. Управление возвращается
		// в runProcessing, который сам решит, ждать или сканировать дальше.
		if (running.size === 0) break;

		await Promise.race(running);
	}

	if (running.size > 0) {
		await Promise.allSettled(running);
	}

	// Queued-записи в окне логов, которые так и не стартовали (стоп/abort), переводим в aborted.
	window.electronAPI.invoke('log-window:abort-queued').catch(() => {});

	useStatusBar_Store.getState().setStatusBarState('waiting starting');

	window.electronAPI.removeProcessingEvent(handleProcessingEvent);
	isSubscribed = false;
}
