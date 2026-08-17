import { useHasAnyPlugin } from '@/Store/MainWin/plugin_store';

/** id системного плагина-адаптера очереди (`plugins-dev/remoteWorker`). */
export const WORKER_PLUGIN_ID = 'remoteWorker';

/**
 * Режим воркера доступен только когда установлен плагин-адаптер очереди.
 *
 * Тот же принцип, что у `updater` (нет плагина — нет кнопки обновления) и у
 * `usePostingAvailable`: ядро несёт цикл, scratch и исполнение, а разговор с очередью —
 * плагин. Нет плагина — разговаривать не с кем, и весь UI воркера прячем.
 *
 * Реактивно: включили/выключили/удалили плагин на лету — значение пересчитается само,
 * а работающий воркер гасится эффектом в AppMain.
 */
export const useWorkerAvailable = (): boolean => useHasAnyPlugin([WORKER_PLUGIN_ID]);
