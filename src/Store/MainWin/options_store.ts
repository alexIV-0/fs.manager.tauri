import { loadFromLocalStorage, saveToLocalStorage } from '@/Utils/loadSaveToLS';
import { create } from 'zustand';

type OptionsObj = {
	mainFolderWidth: number;
	projectFolderWidth: number;
	folderWidth: number;
	gdFolderHeight: number;
};

type OptionsStore = {
	optionsObj: OptionsObj;
	updateOptions: (name: string, value: any) => void;
};

const STORAGE_KEY = 'options_store';

export const options_store = create<OptionsStore>()((set, get) => {
	// При создании стора загружаем данные из localStorage
	const savedOptions = loadFromLocalStorage(STORAGE_KEY);
	const initialOptions = savedOptions || {
		mainFolderWidth: 200,
		projectFolderWidth: 200,
		folderWidth: 200,
		gdFolderHeight: 200,
	};

	return {
		optionsObj: initialOptions,
		updateOptions: (name: string, value: any) => {
			const newOptionsObj = { ...get().optionsObj, [name]: value };
			set({ optionsObj: newOptionsObj });
			// Сохраняем в localStorage при каждом обновлении
			saveToLocalStorage(STORAGE_KEY, newOptionsObj);
		},
	};
});
