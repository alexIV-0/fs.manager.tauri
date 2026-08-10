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
	/** Папка клиента в облачном зеркале. Такие записи не показываются в общем
	    списке главных папок — их место в секции «Онлайн», иначе клиент виден
	    дважды. Во всём остальном это обычная главная папка. */
	online?: boolean;
};

type UpdateParametersPayload = Partial<FolderInMainStore> & { id: string };

type UpdateProjectFoldersPayload = {
	mainId: string;
	foldersArr: string[];
};

export type MainFoldersStore = {
	mainFolderArr: FolderInMainStore[];
	/** Добавляет главную папку. Возвращает `false`, если путь уже есть в списке (дубликат не создаётся). */
	addFolderToMainArr: (path: string) => Promise<boolean>;
	/** Найти или завести папку облачного клиента. Возвращает её id.
	    Подпись брать неоткуда не нужно: имя папки в зеркале и есть имя клиента. */
	ensureOnlineFolder: (path: string) => string;
	removeFolderFromMainArr: (id: string) => void;
	moveFolderInMainArr: (dragIndex: number, hoverIndex: number) => void;
	updateParameters: (payload: UpdateParametersPayload) => void;
};

const STORAGE_KEY = 'mainFolders';

export const mainFolders_stor = create<MainFoldersStore>()((set, get) => ({
	mainFolderArr: loadFromLocalStorage(STORAGE_KEY) || [],

	addFolderToMainArr: async (path: string) => {
		// Одну и ту же папку нельзя держать в списке дважды. Сравниваем без хвостового слэша.
		const norm = (p: string) => p.replace(/\/+$/, '');
		if (get().mainFolderArr.some((f) => norm(f.path) === norm(path))) return false;

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
		return true;
	},

	ensureOnlineFolder: (path: string) => {
		const norm = (p: string) => p.replace(/\/+$/, '').toLowerCase();
		const found = get().mainFolderArr.find((f) => norm(f.path) === norm(path));
		if (found) return found.id;

		const entry: FolderInMainStore = {
			id: `online-${nanoid(5)}`,
			path,
			active: true,
			projectFolders: [],
			online: true,
		};
		const next = [...get().mainFolderArr, entry];
		set({ mainFolderArr: next });
		saveToLocalStorage(STORAGE_KEY, next);
		return entry.id;
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
