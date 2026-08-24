import { create } from 'zustand';

// Состояние режима воркера — машина берёт задачи из очереди сайта.
//
// Отдельный стор, а не поле в isScanningStore: это третий независимый процесс рядом с
// обработкой и постингом, со своей кнопкой и своими часами. Но в отличие от постинга
// он с локальной обработкой НЕ уживается — см. `blockedByLocalRun` в UI.
//
// `stopRequested` — мягкая остановка: новые задачи не берём, текущую доводим до конца.
// Отдельно от `isWorking`, потому что это два разных вопроса: «работаем ли сейчас» и
// «просили ли остановиться». Совместив их, нельзя показать «дорабатываю последнюю».

/**
 * Чем занят воркер прямо сейчас. Нужно интерфейсу, чтобы «работает» не выглядело как
 * «висит»: между задачами он большую часть времени просто ждёт, и это надо показывать
 * как нормальную работу, а не как тишину.
 */
export type WorkerPhase = 'idle' | 'asking' | 'working';

export interface WorkerStatus {
	phase: WorkerPhase;
	/** Когда пойдём спрашивать в следующий раз (unix sec) — для обратного отсчёта. */
	nextPollAt: number | null;
	/** Сколько раз спросили за этот прогон. Видно, что опрос реально идёт. */
	pollCount: number;
	/** Задача, которая выполняется прямо сейчас. */
	currentTaskId: string | null;
	currentProject: string | null;
	/** До какого момента задача числится за нами (unix sec). */
	leaseUntil: number | null;
	/** Сколько задач завершено за этот прогон — видно, что воркер живой. */
	doneCount: number;
	failedCount: number;
	lastError: string | null;
	lastAt: number | null;
}

type WorkerStore = {
	isWorking: boolean;
	stopRequested: boolean;
	status: WorkerStatus;
	setIsWorking: (value: boolean) => void;
	setStopRequested: (value: boolean) => void;
	setStatus: (patch: Partial<WorkerStatus>) => void;
	resetStatus: () => void;
};

const EMPTY: WorkerStatus = {
	phase: 'idle',
	nextPollAt: null,
	pollCount: 0,
	currentTaskId: null,
	currentProject: null,
	leaseUntil: null,
	doneCount: 0,
	failedCount: 0,
	lastError: null,
	lastAt: null,
};

export const useWorker_store = create<WorkerStore>((set) => ({
	isWorking: false,
	stopRequested: false,
	status: { ...EMPTY },
	setIsWorking: (value) => set({ isWorking: value }),
	setStopRequested: (value) => set({ stopRequested: value }),
	setStatus: (patch) => set((s) => ({ status: { ...s.status, ...patch } })),
	resetStatus: () => set({ status: { ...EMPTY } }),
}));
