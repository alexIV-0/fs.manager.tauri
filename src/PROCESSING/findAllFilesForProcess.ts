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
import { getProjectActivity, setProjectActivity, pruneActivity } from '@/Utils/projectActivityLS';
import { recordActivity, persistEnabled } from '@/Utils/folderState';
import { basename } from '@/Utils/path';
import { joinPath } from '@/Utils/joinPath';
import { catchUpProject, isInMirror, projectArchived, setProjectPaused } from '@/Utils/storageSeam';
import { archivedProjects_store } from '@/Store/MainWin/archivedProjects_store';
import { reloadFolders } from './reloadFolders';
import { timeToWait } from './runProcessing';
import { waitingSome } from './waitingSome';
import { getSignal } from './utils/processingAbort';
import { findFilesForSingleFolder } from './findFilesForSingleFolder';
import { clearTgRoutes, addTgRouteFromProject } from './tgCollect';
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
		clearTgRoutes(); // пересобираем routing map ТГ-сбора каждый полный скан
	}

	// цикл по вкл. главным папкам
	for (let i = 0; i < mainFolders_stor.getState().mainFolderArr.length; i++) {
		if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

		const curMainFolder = mainFolders_stor.getState().mainFolderArr[i];
		if (!curMainFolder.active) continue;

		const mainFolderName = basename(curMainFolder.path);

		// Области видимости двух запусков НЕ пересекаются:
		//   • локальный прогон (эта функция) — только локально подключённые папки;
		//   • режим воркера — только задачи с сайта, локальные папки его не касаются.
		//
		// Иначе облачный проект обрабатывали бы обе стороны сразу: эта машина по своему
		// расписанию и любая другая, взявшая ту же задачу из очереди. Результат — двойной
		// рендер и гонка за один и тот же OUT, причём заметная только по факту.
		//
		// Первая колонка при этом остаётся общей: локальные и облачные папки видны рядом,
		// синхронизатор работает как работал. Разделены запуски, а не интерфейс.
		if (await isInMirror(curMainFolder.path)) {
			console.log(`[scan] ${mainFolderName} — облачная папка, локальный прогон её не трогает (задачи берёт воркер)`);
			continue;
		}

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
		// та же чистка для карты активности
		pruneActivity(curMainFolder.id, finalArr);

		// ── авто-отключение «холодных» проектов ──────────────────────────
		// Если проект не использовался N дней — добавляем в off-список (тот же
		// массив в LS, что и ручной чекбокс). Дату активности ведём сами в LS,
		// а НЕ по mtime папки OUT: gsync-демон Google откатывает время каталога
		// на серверное, и свежие файлы внутри OUT его не омолаживают.
		// Дату двигает обработка (addedCount > 0) и ручное включение.
		// Если все подпапки отключены — главная папка остаётся активной (желтеет в UI).
		const autoDisableDays = getAppSettings().cleanup.autoDisableDays;
		if (autoDisableDays && autoDisableDays > 0) {
			const cutoffMs = Date.now() - autoDisableDays * 24 * 60 * 60 * 1000;
			const offSet = new Set<string>(getOffArr);
			for (const projectName of finalArr) {
				if (offSet.has(projectName)) continue;
				// Архивный проект авто-отключению не подлежит. Архив — блок ПЕРВОГО
				// уровня: он и так снимает проект с обработки, а вкл/выкл при нём не
				// значит ничего. Без этой проверки таймер «холодных» гасил бы архивные
				// (они по определению холодные) и писал бы в облако бессмысленную
				// смену флага — которую человек потом увидел бы при разархивации.
				if (archivedProjects_store.getState().paths[
					`${curMainFolder.path}/${projectName}`.replace(/[\\/]+$/, '').toLowerCase()
				]) continue;
				// Первая встреча проекта — засеваем «сейчас», чтобы при апгрейде
				// (или у новой папки) ничего не отключилось задним числом.
				let lastActivityMs = getProjectActivity(curMainFolder.id, projectName);
				if (lastActivityMs === undefined) {
					lastActivityMs = Date.now();
					setProjectActivity(curMainFolder.id, projectName, lastActivityMs);
				}
				if (lastActivityMs < cutoffMs) {
					offSet.add(projectName);
					// Фиксируем авто-отключение и в файле, и в каталоге: иначе сайт (и
					// другая машина) продолжают считать проект включённым, а следующий
					// `/projects` вернёт наш локальный флаг обратно.
					persistEnabled(curMainFolder.id, projectName, false, 'auto');
					if (curMainFolder.online) {
						void setProjectPaused(joinPath(curMainFolder.path, projectName), true).catch((e) =>
							console.error('[autoDisable] каталог отказал:', projectName, e),
						);
					}
						console.log(`[autoDisable] ${mainFolderName}/${projectName} — idle > ${autoDisableDays}d`);
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

			// Облачный проект: один запрос дельт на проект ЗДЕСЬ — и дальше весь
			// проход доверяем локальному индексу. Иначе пришлось бы спрашивать
			// бэкенд про каждый найденный файл: при десяти тысячах элементов это
			// разница между одним запросом и десятью тысячами.
			// Вне зеркала — no-op без единого IPC-вызова.
			await catchUpProject(projectPathOnGD as string);

			// Архивный проект обработке не подлежит — так требует контракт
			// storage-API. Проверяем ПОСЛЕ дельт: флаг мог измениться на сайте, и
			// решение должно приниматься по свежему каталогу, а не по прошлому проходу.
			if (await projectArchived(projectPathOnGD as string)) {
				console.log(`%c→ архивный проект, пропуск`, 'color: #888');
				console.groupEnd();
				await waitingSome(timeToWait.folders);
				continue;
			}

			// ТГ-сбор: безусловно (независимо от содержимого IN) собираем маршрут из
			// options/tgSearch.json — дешёвый stat, до IN-гейта в findFilesForSingleFolder.
			await addTgRouteFromProject(projectPathOnGD as string);

			const beforeCount = useWorkProject_Store.getState().workProject.length;
			await findFilesForSingleFolder(projectPathOnGD as string, curMainFolder.path as string, year, findDateName);
			const addedCount = useWorkProject_Store.getState().workProject.length - beforeCount;
			if (addedCount > 0) {
				console.log(`%c→ found ${addedCount} item(s)`, 'color: #d4a017');
				// Проект реально используется — двигаем дату активности на «сейчас».
				// Пока в него что-то падает, auto-disable его не тронет. Бесплатно:
				// перебора файлов нет, это побочка уже сделанного поиска.
				// recordActivity = LS всегда + файл options/folderState.json троттлингом ~1/сутки.
				recordActivity(curMainFolder.id, projectName, Date.now());
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
