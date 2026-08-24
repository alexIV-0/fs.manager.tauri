import { isScanningStore } from '@/Store/MainWin/isScaning_store';
import { useWorkProject_Store } from '@/Store/Processing/useWorkProject_Store';
import { commands } from '@/Utils/specta';
import { useStatusBar_Store } from '@/Store/Processing/useStatusBar_Store';
import { useWorker_store } from '@/Store/Processing/useWorker_store';
import { getSignal } from './utils/processingAbort';
import { getAppSettings } from '@/Store/Settings/appSettings_client';
import { useProcessingStats_store } from '@/Store/Processing/useProcessingStats_store';
import { processItem } from './processItem';
import { createRunPools, disposeRunPools } from './ResourcePool';
import { RUN_PROCESSING } from './runLanes';
import { prefetchNextItems } from './utils/prefetchSources';

export async function startProcessing() {
	const signal = getSignal();
	let totalProcessedFile = 0;

	// Снимок настроек на старте цикла — лимиты применяются при старте processing.
	const settings = getAppSettings();
	const { maxParallel } = settings.processing;
	const MAX_PARALLEL = Math.max(1, maxParallel);

	// Регистрируемся в области ресурсных пулов своей полосы (`processing`). Слоты =
	// лимит из settings.resourcePools (с fallback на RESOURCE_POOL_DEFAULT_LIMITS).
	// Карта pluginId→пул берётся из манифестов текущих плагинов → собранные флоу
	// подхватывают актуальное назначение (резолв вживую по pluginId).
	//
	// Не процессный синглтон и не набор на вызов: постинг — независимый раннер со своей
	// кнопкой, и его старт посреди обработки раньше выбрасывал семафоры вместе с
	// очередью ожидающих, после чего обработка висла навсегда. У него теперь свой набор,
	// а вот с режимом воркера набор ОБЩИЙ: он про железо машины, а не про раннера (см.
	// `runLanes.ts`). Если воркер уже работает — входим в готовую область, его лимиты и
	// его семафоры.
	let pluginPools: Array<{ id: string; pool: string }> = [];
	try {
		const all = (await window.plugins.getAllPlugins()) ?? [];
		pluginPools = all
			.map((p: any) => ({ id: p?.id, pool: p?.manifest?.resourcePool }))
			.filter((x): x is { id: string; pool: string } => Boolean(x.id && x.pool));
	} catch (e) {
		console.warn('[startProcessing] cannot read plugin resourcePools:', e);
	}
	createRunPools(RUN_PROCESSING, settings.resourcePools ?? {}, pluginPools);

	// Processing events are now routed to logWindow in main process.
	// Only handle aborted/error here for status bar feedback.
	const handleProcessingEvent = (event: { type: string; payload: any }) => {
		if (event.type === 'aborted') {
			console.warn('[Processing] Aborted');
		}
	};

	// Подписка на весь прогон. Модульный флаг `isSubscribed` здесь был бесполезен:
	// в конце функции он сбрасывался, поэтому на входе всегда был false. Хуже того,
	// исключение между подпиской и отпиской оставляло слушателя навсегда, а флаг —
	// поднятым, и следующий прогон уже не подписывался. Снятие теперь в finally.
	window.tauriAPI.onProcessingEvent(handleProcessingEvent);

	isScanningStore.getState().setIsScanningProcess(true);

	const running = new Set<Promise<void>>();

	const processOne = async (item: any) => {
		try {
			// Прямой вызов в renderer'е — никаких IPC. processItem импортирует плагины
			// через plugin:// протокол, вызывает их как JS-функции, прокидывает ctx.
			const { status } = await processItem(item, signal, RUN_PROCESSING);
			totalProcessedFile++;
			const { incSuccess, incErrorItems } = useProcessingStats_store.getState();
			if (status === 'done') incSuccess();
			else if (status === 'error') incErrorItems();
		} catch (e: any) {
			console.error('PROCESS FAILED:', e?.message ?? e);
		}
	};

	try {
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

				// Пока этот элемент обрабатывается, тихо тянем исходники следующих.
				// Список очереди построен заранее — значит уже известно, что
				// понадобится, и ждать скачивания на каждом элементе незачем.
				void prefetchNextItems();
			}

			// Очередь пуста и нечего обрабатывать — выходим. Управление возвращается
			// в runProcessing, который сам решит, ждать или сканировать дальше.
			if (running.size === 0) break;

			await Promise.race(running);
		}

		if (running.size > 0) {
			await Promise.allSettled(running);
		}

		// Queued-записи в окне логов, которые так и не стартовали (стоп/abort), переводим в
		// aborted. Элементы воркера этим не задеть: он регистрирует свой сразу в статусе
		// `running` (`processItem`, item:start), а `queued` бывает только у найденного
		// сканом и не начатого.
		commands.logWindowEmitAbortQueued().catch(() => {});

		// «Всё, обработка кончилась» — заявление про ВСЮ машину, а не про эту волну:
		// статус-бар один на программу, а `process:complete` гасит подсветку активной ноды
		// в графе. Пока по своей полосе работает воркер, ни то ни другое не правда — он
		// в этот момент может рендерить, и сброс выглядел бы как «обработка встала».
		// Свой статус воркер допишет сам, шагами.
		if (!useWorker_store.getState().isWorking) {
			// Сбрасываем statusBar в idle. Локальный set обновляет стор в этом окне (nodeWin),
			// а IPC `setStatusBar` транслирует событие в main window — там стор отдельный.
			useStatusBar_Store.getState().setStatusBarState('waiting starting');
			void commands.setStatusBar('waiting starting').catch(() => {});

			// Финальный broadcast: node_win получит 'process:complete' и сбросит подсветку
			// активной ноды через 2 секунды (см. ProcessingEventListener).
			commands.sendProcessComplete().catch(() => {});
		}
	} finally {
		// Снятие подписки и выход из области пулов — обязательно, даже если из цикла
		// вылетело исключение. Иначе слушатель остаётся навсегда, а ожидающие слот
		// (жёсткий стоп посреди ожидания) висят вечно. Семафоры при этом гаснут только
		// если в области больше никого нет: работающий воркер их удержит.
		window.tauriAPI.removeProcessingEvent(handleProcessingEvent);
		disposeRunPools(RUN_PROCESSING);
	}
}
