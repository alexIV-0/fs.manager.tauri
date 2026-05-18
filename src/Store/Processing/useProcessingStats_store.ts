import { create } from 'zustand';

interface ProcessingStatsState {
	iterationCount: number;
	successCount: number;
	errorItemsCount: number;
	incIteration: () => void;
	incSuccess: () => void;
	incErrorItems: () => void;
	reset: () => void;
}

export const useProcessingStats_store = create<ProcessingStatsState>((set) => ({
	iterationCount: 0,
	successCount: 0,
	errorItemsCount: 0,
	incIteration: () => set((s) => ({ iterationCount: s.iterationCount + 1 })),
	incSuccess: () => set((s) => ({ successCount: s.successCount + 1 })),
	incErrorItems: () => set((s) => ({ errorItemsCount: s.errorItemsCount + 1 })),
	reset: () => set({ iterationCount: 0, successCount: 0, errorItemsCount: 0 }),
}));
