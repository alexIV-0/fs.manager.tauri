import { loadFromLocalStorage, saveToLocalStorage } from '@/Utils/loadSaveToLS';
import { create } from 'zustand';

const STORAGE_KEY = 'localFolder';

interface LocalFoldersStore {
    localFolder: string;
    updateLocalFolder: (newFolder: string) => void;
}

export const localFolders_stor = create<LocalFoldersStore>()((set) => ({
    localFolder: loadFromLocalStorage(STORAGE_KEY) || '',

    updateLocalFolder: (newFolder) => {
        set({ localFolder: newFolder });
        saveToLocalStorage(STORAGE_KEY, newFolder);
    },
}));
