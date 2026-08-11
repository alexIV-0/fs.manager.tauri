// Планировщик автопостинга — ОТДЕЛЬНЫЙ процесс, независимый от обработки.
// Своя кнопка Start/Stop в главном окне, свой AbortController, свои часы.
//
// Каждый тик (~TICK_MS): сам перечисляет активные проекты (reloadFolders, минуя IN-скан
// обработки) → собирает маршруты из postSources.json → runAutoPost постит те папки, у кого
// истёк интервал (гейт внутри postOneForRoute по _post-логу). Так поминутные интервалы
// honored, не упираясь в 15-мин скан-цикл обработки.

import { mainFolders_stor } from '@/Store/MainWin/mainFolders_store';
import { loadFromLocalStorage } from '@/Utils/loadSaveToLS';
import { joinPath } from '@/Utils/joinPath';
import { usePosting_store } from '@/Store/Processing/usePosting_store';
import { getAppSettings } from '@/Store/Settings/appSettings_client';
import { reloadFolders } from '../reloadFolders';
import { createRunPools, disposeRunPools } from '../ResourcePool';
import { RUN_POSTING } from '../runLanes';
import { commands } from '@/Utils/specta';
import { clearPostRoutes, addPostRouteFromProject, runAutoPost } from './index';

// Ресурсные пулы ЭТОГО прогона (полоса `posting`) — свой набор, не общий с обработкой.
// processItem захватывает слоты по pluginId/colorType; без набора пулы не ограничивают.
//
// Заодно гасим флаг прерывания своей полосы. Без этого постинг, запущенный после
// остановленной обработки, наследовал выставленный флаг — и каждый его `exec`
// умирал мгновенно, потому что гасил флаг только старт обработки.
async function initPools(): Promise<void> {
	let pluginPools: Array<{ id: string; pool: string }> = [];
	try {
		const all = (await (window as any).plugins?.getAllPlugins()) ?? [];
		pluginPools = all
			.map((p: any) => ({ id: p?.id, pool: p?.manifest?.resourcePool }))
			.filter((x: any) => Boolean(x.id && x.pool));
	} catch (e) {
		console.warn('[postScheduler] cannot read plugin resourcePools:', e);
	}
	createRunPools(RUN_POSTING, getAppSettings().resourcePools ?? {}, pluginPools);
	await commands.resetProcessingSignal(RUN_POSTING).catch(() => {});
}

// Интервал обхода папок постингом — из настроек (posting.scanWaitMin), дефолт 30 c.
// Читается каждый виток, чтобы изменение применялось вживую. Пол — 5 c (защита).
function tickMs(): number {
	const min = getAppSettings().posting?.scanWaitMin ?? 0.5;
	return Math.max(5, min * 60) * 1000;
}

let controller: AbortController | null = null;

function sleep(ms: number, signal: AbortSignal): Promise<void> {
	return new Promise((resolve) => {
		if (signal.aborted) return resolve();
		const t = setTimeout(() => {
			signal.removeEventListener('abort', onAbort);
			resolve();
		}, ms);
		const onAbort = () => {
			clearTimeout(t);
			resolve();
		};
		signal.addEventListener('abort', onAbort, { once: true });
	});
}

/// Собственное перечисление проектов под постинг (не зависит от скан-цикла обработки).
/// Для каждой активной главной папки листает проекты (reloadFolders), пропускает off-список,
/// и пробует добавить маршрут из options/postSources.json.
async function collectPostRoutes(signal: AbortSignal): Promise<void> {
	clearPostRoutes();
	const folders = mainFolders_stor.getState().mainFolderArr;
	for (const mf of folders) {
		if (signal.aborted) return;
		if (!mf.active) continue;
		let projects: string[] = [];
		try {
			projects = await reloadFolders(mf);
		} catch {
			projects = mf.projectFolders || [];
		}
		const off: string[] = loadFromLocalStorage(mf.id) || [];
		for (const project of projects) {
			if (signal.aborted) return;
			if (off.includes(project)) continue;
			await addPostRouteFromProject(joinPath(mf.path, project));
		}
	}
}

/// Запуск отдельного процесса постинга. Идемпотентно (повторный вызов игнорируется).
export function startPostScheduler(): void {
	if (controller) return;
	controller = new AbortController();
	const signal = controller.signal;
	usePosting_store.getState().setIsPosting(true);

	(async () => {
		try {
			await initPools();
			while (!signal.aborted) {
				try {
					await collectPostRoutes(signal);
					await runAutoPost(signal);
				} catch (e) {
					console.warn('[postScheduler] tick failed:', e);
				}
				const ms = tickMs();
				// Момент следующего прохода → статусбар показывает «следующий поиск через…».
				usePosting_store.getState().setStatus({ nextScanAt: Math.floor(Date.now() / 1000) + Math.round(ms / 1000) });
				await sleep(ms, signal);
			}
		} finally {
			usePosting_store.getState().setIsPosting(false);
		}
	})();
}

/// Остановка процесса постинга.
export function stopPostScheduler(): void {
	controller?.abort();
	controller = null;
	// Прерывание СВОЕЙ полосы: убивает exec'и постинга и не касается обработки.
	void commands.abortProcessing(RUN_POSTING).catch(() => {});
	const st = usePosting_store.getState();
	st.setIsPosting(false);
	st.resetStatus();
}
