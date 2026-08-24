import { create } from 'zustand';

interface StatusBarState {
	statusBar: string;
	setStatusBarState: (text: string) => void;
}

export const useStatusBar_Store = create<StatusBarState>((set) => ({
	statusBar: 'слежение остановлено',

	setStatusBarState: (text) =>
		set(() => ({
			statusBar: text,
		})),
}));
