import { create } from 'zustand';

type State = {
	path: string;
	addPath: (path: string) => void;
};

export const usePathStore = create<State>((set) => ({
	path: '',
	addPath: (path) => {
		console.log('[usePathStore] 📍 addPath called with:', path);
		set({ path });
		console.log('[usePathStore] ✅ Path updated in store');
	},
}));
