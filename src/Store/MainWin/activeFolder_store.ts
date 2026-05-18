// setActiveFolders_store.ts
import { create } from 'zustand';

type ActiveFoldersStore = {
    activeMainFolder: string | null; // 👈 лучше null по умолчанию
    activeProjectFolder: string | null; // 👈 если нужно — тоже string | null
    setMainFolderId: (id: string | null) => void;
    setActiveProjectFolder: (id: string | null) => void;
};

export const setActiveFolders_store = create<ActiveFoldersStore>((set) => ({
    activeMainFolder: null, // изначально ничего не выделено
    activeProjectFolder: null,
    setMainFolderId: (id) => set({ activeMainFolder: id }),
    setActiveProjectFolder: (id) => set({ activeProjectFolder: id }),
}));
