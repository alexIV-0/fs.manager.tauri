import { loadFromLocalStorage, saveToLocalStorage } from '@/Utils/loadSaveToLS';
import { nanoid } from 'nanoid';
import { create } from 'zustand';
import { basename } from '@/Utils/path';

export type ProjectFolder = {
	id: string;
	name: string;
	active: boolean;
};

export type FolderInMainStore = {
	id: string;
	path: string;
	active: boolean;
	projectFolders: string[];
};

type UpdateParametersPayload = Partial<FolderInMainStore> & { id: string };

type UpdateProjectFoldersPayload = {
	mainId: string;
	foldersArr: string[];
};

export type MainFoldersStore = {
	mainFolderArr: FolderInMainStore[];
	addFolderToMainArr: (path: string) => Promise<void>;
	removeFolderFromMainArr: (id: string) => void;
	moveFolderInMainArr: (dragIndex: number, hoverIndex: number) => void;
	updateParameters: (payload: UpdateParametersPayload) => void;
};

const STORAGE_KEY = 'mainFolders';

export const mainFolders_stor = create<MainFoldersStore>()((set, get) => ({
	mainFolderArr: loadFromLocalStorage(STORAGE_KEY) || [],

	addFolderToMainArr: async (path: string) => {
		const nameF = basename(path);
		const newFolder = [
			...get().mainFolderArr,
			{
				id: `${nameF}-${nanoid(5)}`,
				path,
				active: true,
				projectFolders: [], // добавляем по умолчанию пустой массив
			},
		];
		set({ mainFolderArr: newFolder });
		saveToLocalStorage(STORAGE_KEY, newFolder);
	},

	removeFolderFromMainArr: (id: string) => {
		const newFolder = get().mainFolderArr.filter((folder) => folder.id !== id);
		set({ mainFolderArr: newFolder });
		saveToLocalStorage(STORAGE_KEY, newFolder);
	},

	moveFolderInMainArr: (dragIndex: number, hoverIndex: number) => {
		const folders = [...get().mainFolderArr];
		const [removed] = folders.splice(dragIndex, 1);
		folders.splice(hoverIndex, 0, removed);
		set({ mainFolderArr: folders });
		saveToLocalStorage(STORAGE_KEY, folders);
	},

	updateParameters: ({ id, ...rest }: UpdateParametersPayload) => {
		const updatedFolders = get().mainFolderArr.map((folder) => (folder.id === id ? { ...folder, ...rest } : folder));
		set({ mainFolderArr: updatedFolders });
		saveToLocalStorage(STORAGE_KEY, updatedFolders);
	},

	// новый метод
	updateProjectFolders: ({ mainId, foldersArr }: UpdateProjectFoldersPayload) => {
		const updatedFolders = get().mainFolderArr.map((folder) => {
			if (folder.id !== mainId) return folder;

			return {
				...folder,
				projectFolders: foldersArr,
			};
		});
		set({ mainFolderArr: updatedFolders });
		saveToLocalStorage(STORAGE_KEY, updatedFolders);
	},
}));
