import { create } from 'zustand';

export type ProjectSearchState = {
	isOpen: boolean;
	searchQuery: string;
	selectedPlugins: string[]; // плагины по которым фильтруем
	setIsOpen: (open: boolean) => void;
	setSearchQuery: (query: string) => void;
	togglePlugin: (pluginId: string) => void;
	clearFilters: () => void;
};

export const useProjectSearch_store = create<ProjectSearchState>((set) => ({
	isOpen: false,
	searchQuery: '',
	selectedPlugins: [],

	setIsOpen: (open: boolean) => set({ isOpen: open }),

	setSearchQuery: (query: string) => set({ searchQuery: query }),

	togglePlugin: (pluginId: string) =>
		set((state) => {
			const newSelected = state.selectedPlugins.includes(pluginId)
				? state.selectedPlugins.filter((p) => p !== pluginId)
				: [...state.selectedPlugins, pluginId];
			return { selectedPlugins: newSelected };
		}),

	clearFilters: () => set({ searchQuery: '', selectedPlugins: [] }),
}));
