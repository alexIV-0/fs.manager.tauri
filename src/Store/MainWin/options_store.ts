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
	const DEFAULTS: OptionsObj = {
		mainFolderWidth: 200,
		projectFolderWidth: 200,
		folderWidth: 200,
		gdFolderHeight: 200,
	};
	// Разворачиваем поверх дефолтов, а не вместо них: у тех, кто запускал программу
	// раньше, в localStorage лежит объект без новых ключей, и без слияния новая
	// опция пришла бы как `undefined`.
	const initialOptions: OptionsObj = { ...DEFAULTS, ...(savedOptions ?? {}) };

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
