// setActiveFolders_store.ts
import { create } from 'zustand';

type ActiveFoldersStore = {
    activeMainFolder: string | null;
    activeProjectFolder: string | null;
    scrollToMainFolder: string | null;
    scrollToProjectFolder: string | null;
    setMainFolderId: (id: string | null) => void;
    setActiveProjectFolder: (id: string | null) => void;
    setScrollToMainFolder: (id: string | null) => void;
    setScrollToProjectFolder: (id: string | null) => void;
};

export const setActiveFolders_store = create<ActiveFoldersStore>((set) => ({
    activeMainFolder: null,
    activeProjectFolder: null,
    scrollToMainFolder: null,
    scrollToProjectFolder: null,
    setMainFolderId: (id) => set({ activeMainFolder: id }),
    setActiveProjectFolder: (id) => set({ activeProjectFolder: id }),
    setScrollToMainFolder: (id) => set({ scrollToMainFolder: id }),
    setScrollToProjectFolder: (id) => set({ scrollToProjectFolder: id }),
}));
