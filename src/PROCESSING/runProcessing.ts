/*
	Главный цикл обработки (sequential live-queue):
	1. Полный скан всех вкл. папок → заполняет очередь
	2. Параллельная обработка items из очереди (startProcessing)
	3. Ждём интервал: max(minScanWait, maxScanWait − elapsed)
	4. Повторяем скан, пока пользователь не нажмёт Stop
*/

import { isScanningStore } from '@/Store/MainWin/isScaning_store';
import { useWorkProject_Store } from '@/Store/Processing/useWorkProject_Store';
import { findAllFilesForProcess } from './findAllFilesForProcess';
import { finalyWating } from './function/utils/finalyWating';
import { startProcessing } from './startProcessing';
import { startProcessContext } from './function/utils/processingAbort';
import { getAppSettings } from '@/Store/Settings/appSettings_client';
import { localFolders_stor } from '@/Store/MainWin/localFolders_store';

// Значения подтягиваются из AppSettings при старте runProcessing.
// Экспорт ради обратной совместимости с местами, которые читают timeToWait.folders.
export let timeToWait = {
	maxWait: 900_000, // максимум между сканами
	minWait: 180_000, // минимум между сканами (floor когда скан был долгим)
	folders: 200, // задержка между папками внутри скана
};

function triggerCleanup(): void {
	const localFolder = localFolders_stor.getState().localFolder;
	if (!localFolder) return;
	window.electronAPI.invoke('cleanup:auto-delete', localFolder).catch(() => {});
}

export async function runProcessing() {
	const { clearWorkProjectState } = useWorkProject_Store.getState();
	const { setMainFolderIndex } = isScanningStore.getState();
	clearWorkProjectState();
	startProcessContext();

	// Применяем свежие значения из настроек перед стартом цикла.
	const { minScanWaitMin, maxScanWaitMin, foldersDelayMs } = getAppSettings().scanSchedule;
	timeToWait = {
		maxWait: Math.max(0, maxScanWaitMin) * 60 * 1000,
		minWait: Math.max(0, minScanWaitMin) * 60 * 1000,
		folders: Math.max(0, foldersDelayMs),
	};

	try {
		// ── Первый полный скан ───────────────────────────────────────────
		await findAllFilesForProcess(true);

		const processArr = useWorkProject_Store.getState().workProject;
		if (processArr.length !== 0) {
			console.groupCollapsed(`%c===find files for process: ${processArr.length}`, 'color: yellow');
			console.log(processArr);
			console.groupEnd();
		}

		// Cleanup старых папок после первого скана
		triggerCleanup();

		// ── Главный цикл: process → wait → scan → process → ... ──────────
		// Цикл выходит ТОЛЬКО когда пользователь нажимает Stop (полный или мягкий).
		// startProcessing внутри сам выходит, когда очередь пустая — это значит,
		// что текущая «волна» обработана, можно ждать паузу до следующего скана.
		while (isScanningStore.getState().isScanning) {
			const cycleStart = Date.now();

			// Обрабатываем всё что есть в очереди.
			// Возвращается, когда очередь пуста + ничего не запущено,
			// либо при мягкой остановке (она внутри startProcessing ставит isScanning=false).
			await startProcessing();

			if (!isScanningStore.getState().isScanning) break;

			// Пауза до следующего скана:
			// если cycleStart→now было быстрым — ждём maxWait целиком,
			// если волна обрабатывалась дольше maxWait — ждём минимум minWait (не моментально).
			const elapsed = Date.now() - cycleStart;
			const waitTime = Math.max(timeToWait.minWait, timeToWait.maxWait - elapsed);

			// Ждём; полный Stop кинет AbortError из finalyWating.
			await finalyWating(waitTime);

			if (!isScanningStore.getState().isScanning) break;

			// Мягкая остановка (пользователь нажал «Stop after current block» во время ожидания):
			// isScanningProcess стал false пока мы ждали — завершаем цикл.
			if (!isScanningStore.getState().isScanningProcess) {
				isScanningStore.getState().setIsScanning(false);
				break;
			}

			// К этому моменту очередь гарантированно пуста (startProcessing всё обработал),
			// поэтому сбрасываем registeredPaths чтобы повторно найти файлы в папках.
			await findAllFilesForProcess(true);
			triggerCleanup();
		}
	} catch (e: any) {
		if (e.name === 'AbortError') {
			console.log('⛔ HARD STOP');
			clearWorkProjectState();
		} else {
			throw e;
		}
	} finally {
		setMainFolderIndex(-1);
		clearWorkProjectState();
	}
}
