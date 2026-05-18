import { create } from 'zustand';

interface ClipboardFsState {
	type: 'copy' | 'cut' | null;
	paths: string[];
	copy: (paths: string[]) => void;
	cut: (paths: string[]) => void;
	clear: () => void;
}

export const clipboardFs_store = create<ClipboardFsState>((set) => ({
	type: null,
	paths: [],
	copy: (paths) => set({ type: 'copy', paths }),
	cut: (paths) => set({ type: 'cut', paths }),
	clear: () => set({ type: null, paths: [] }),
}));
