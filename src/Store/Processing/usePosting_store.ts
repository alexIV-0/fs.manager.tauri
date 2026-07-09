import { create } from 'zustand';

// Состояние отдельного процесса автопостинга (независим от обработки).
// Свой Start/Stop в главном окне, свой планировщик (src/PROCESSING/autoPost/scheduler).
export interface PostingStatus {
	routesCount: number; // сколько папок под наблюдением (postSources.json)
	queuedCount: number; // всего файлов к постингу (не запощенных)
	nextScanAt: number | null; // unix sec следующего прохода планировщика (обратный отсчёт «следующий поиск через…»)
	nextDueAt: number | null; // unix sec ближайшего поста (null — нечего/неизвестно)
	lastPermalink: string | null; // последняя успешная ссылка
	lastError: string | null; // последняя ошибка (текст)
	lastAt: number | null; // unix sec последнего события (для UI)
}

type PostingStore = {
	isPosting: boolean;
	status: PostingStatus;
	setIsPosting: (value: boolean) => void;
	setStatus: (patch: Partial<PostingStatus>) => void;
	resetStatus: () => void;
};

const EMPTY: PostingStatus = {
	routesCount: 0,
	queuedCount: 0,
	nextScanAt: null,
	nextDueAt: null,
	lastPermalink: null,
	lastError: null,
	lastAt: null,
};

export const usePosting_store = create<PostingStore>((set) => ({
	isPosting: false,
	status: { ...EMPTY },
	setIsPosting: (value: boolean) => set({ isPosting: value }),
	setStatus: (patch) => set((s) => ({ status: { ...s.status, ...patch } })),
	resetStatus: () => set({ status: { ...EMPTY } }),
}));
