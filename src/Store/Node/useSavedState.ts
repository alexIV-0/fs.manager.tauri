import { create } from 'zustand';
import { SavedState } from '@/NODE_WIN/definitions/types';

type State = {
	savedState: SavedState | null;
	setSavedState: (savedState: SavedState | null) => void;
};

export const useSavedState = create<State>((set) => ({
	savedState: null,
	setSavedState: (savedState: SavedState | null) => {
		console.log('[useSavedState] 📦 setSavedState called, value:', savedState ? 'SavedState object' : 'null');
		if (savedState) {
			console.log('[useSavedState] 📊 SavedState keys:', Object.keys(savedState));
		}
		set({ savedState });
		console.log('[useSavedState] ✅ SavedState updated in store');
	},
}));
