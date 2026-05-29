/*
	тут будем искать только необходимые файлы и собирать массив для обработки
	никакой обработки тут не будет.
	только создаем массив файлов для обработки.
	один ITEM в папке IN = одному (или нескольким) файлам в папке OUT
	если это папка - то все файлы, которые в ней должны быть использованы для создания финального ролика
*/

import { isScanningStore } from '@/Store/MainWin/isScaning_store';
import { localFolders_stor } from '@/Store/MainWin/localFolders_store';
import { mainFolders_stor } from '@/Store/MainWin/mainFolders_store';
import { useErrors_Store } from '@/Store/Processing/useErrors_Store';
import { useStatusBar_Store } from '@/Store/Processing/useStatusBar_Store';
import { useWorkProject_Store } from '@/Store/Processing/useWorkProject_Store';
import { loadFromLocalStorage, saveToLocalStorage } from '@/Utils/loadSaveToLS';
import { joinPath } from '@/Utils/joinPath';
import { reloadFolders } from './reloadFolders';
import { timeToWait } from './runProcessing';
import { waitingSome } from './waitingSome';
import { getSignal } from './utils/processingAbort';
import { findFilesForSingleFolder } from './findFilesForSingleFolder';
import { useProcessingStats_store } from '@/Store/Processing/useProcessingStats_store';
import { getAppSettings } from '@/Store/Settings/appSettings_client';
import { formatNameByPattern } from '@/Utils/formatNameByPattern';

export async function findAllFilesForProcess(clearQueue = true) {
	useProcessingStats_store.getState().incIteration();
	const { setMainFolderIndex, setCurentFolderIndex } = isScanningStore.getState();
	const { errors, clearErrorsState } = useErrors_Store.getState();
	const { setStatusBarState } = useStatusBar_Store.getState();
	const signal = getSignal();

	const dateTime = formatNameByPattern({
		string: '$YYYY.$DD.$MM-$HH.$mm',
	});
	const year = dateTime.slice(0, 4);
	const findDateName = dateTime.slice(5);
	console.groupCollapsed(`File search (${findDateName}):`);

	if (clearQueue) {
		useWorkProject_Store.getState().clearWorkProjectState();
		clearErrorsState();
	}

	// цикл по вкл. главным папкам
	for (let i = 0; i < mainFolders_stor.getState().mainFolderArr.length; i++) {
		if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

		const curMainFolder = mainFolders_stor.getState().mainFolderArr[i];
		if (!curMainFolder.active) continue;

		const mainFolderName = await window.electronAPI.invoke('pathBasename', curMainFolder.path);

		// обновляем все папки, вдруг новые добавили — ПЕРЕД сканированием файлов
		const finalArr = await reloadFolders(curMainFolder);
		mainFolders_stor.getState().updateParameters({
			id: curMainFolder.id,
			projectFolders: finalArr,
		});

		setMainFolderIndex(i);
		let getOffArr: string[] = loadFromLocalStorage(curMainFolder.id) || [];

		// ── чистим off-список от имён удалённых/переименованных папок ────
		// finalArr — актуальный список с диска; всё что в LS, но отсутствует там — мусор.
		const finalSet = new Set(finalArr);
		const cleaned = getOffArr.filter((n) => finalSet.has(n));
		if (cleaned.length !== getOffArr.length) {
			const removed = getOffArr.filter((n) => !finalSet.has(n));
			console.log(`[offList cleanup] ${mainFolderName} — removed stale: ${removed.join(', ')}`);
			getOffArr = cleaned;
			saveToLocalStorage(curMainFolder.id, getOffArr);
		}

		// ── авто-отключение проектов по mtime папки OUT ──────────────────
		// Если включено в настройках и OUT не модифицировалась N дней —
		// добавляем проект в off-список (тот же массив в LS, что и ручной чекбокс).
		// Если все подпапки отключены — главная папка остаётся активной (желтеет в UI).
		const autoDisableDays = getAppSettings().cleanup.autoDisableDays;
		if (autoDisableDays && autoDisableDays > 0) {
			const cutoffMs = Date.now() - autoDisableDays * 24 * 60 * 60 * 1000;
			const offSet = new Set<string>(getOffArr);
			for (const projectName of finalArr) {
				if (offSet.has(projectName)) continue;
				const outPath = joinPath(curMainFolder.path, projectName, 'OUT');
				const info: any = await window.electronAPI.invoke('getFileInfo', outPath);
				// getFileInfo (Rust FileInfo) сериализуется в snake_case: is_dir / modified (ms).
				const isDir = info?.is_dir ?? info?.isDirectory ?? false;
				const modifiedMs: number | undefined = info?.modified ?? info?.modifiedMs;
				if (!isDir) continue;
				if (typeof modifiedMs === 'number' && modifiedMs < cutoffMs) {
					offSet.add(projectName);
					console.log(`[autoDisable] ${mainFolderName}/${projectName} — OUT idle > ${autoDisableDays}d`);
				}
			}
			if (offSet.size !== getOffArr.length) {
				getOffArr = Array.from(offSet);
				saveToLocalStorage(curMainFolder.id, getOffArr);
			}
			// Все подпапки отключены — не выключаем главную папку, просто пропускаем цикл файлов.
			// Главная папка продолжает сканировать на появление новых подпапок.
			// Считаем только те off-имена, что реально есть в finalArr — старые/удалённые
			// записи в LS не должны учитываться, иначе главная папка скипается с активными подпапками.
			const activeOffCount = finalArr.reduce((n, p) => (offSet.has(p) ? n + 1 : n), 0);
			if (finalArr.length > 0 && activeOffCount >= finalArr.length) {
				console.log(`[autoDisable] ${mainFolderName} — all projects off, folder stays active`);
				continue;
			}
		}

		// цикл по всем вкл. папкам проектов в основной папке
		for (let fIndex = 0; fIndex < finalArr.length; fIndex++) {
			if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

			const projectName = finalArr[fIndex];
			if (getOffArr.includes(projectName)) continue;

			setCurentFolderIndex(fIndex);
			setStatusBarState(`[${mainFolderName}] - ${projectName}`);

			console.groupCollapsed(`[${mainFolderName}] - ${projectName}`);

			const projectPathOnGD = joinPath(curMainFolder.path, projectName);

			const beforeCount = useWorkProject_Store.getState().workProject.length;
			await findFilesForSingleFolder(projectPathOnGD as string, curMainFolder.path as string, year, findDateName);
			const addedCount = useWorkProject_Store.getState().workProject.length - beforeCount;
			if (addedCount > 0) {
				console.log(`%c→ found ${addedCount} item(s)`, 'color: #d4a017');
			}

			console.groupEnd();
			await waitingSome(timeToWait.folders);
		}

		console.log('-----------------');
	}
	console.groupEnd();

	if (errors.length != 0) {
		errors.forEach((error: any) => console.error(`Error in ${error.project}: ${error.message}`));
	}
	if (clearQueue) clearErrorsState();
}
