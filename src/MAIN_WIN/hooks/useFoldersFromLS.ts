import { useState, useEffect, useCallback } from 'react';
import { loadFromLocalStorage, saveToLocalStorage } from '@/Utils/loadSaveToLS';

function useFoldersFromLS(storageKey: string) {
	// Триггер для пересчёта (чтобы вызвать useEffect)
	const [, forceUpdate] = useState(0);

	// Получаем актуальный массив из LS
	const getFolders = useCallback((): string[] => loadFromLocalStorage(storageKey) || [], [storageKey]);

	const addFolder = (name: string) => {
		const current = loadFromLocalStorage(storageKey) || [];
		saveToLocalStorage(storageKey, [...current, name]);
		forceUpdate((v) => v + 1); // чтобы React перерендерил компонент
	};

	const removeFolder = (name: string) => {
		const current = loadFromLocalStorage(storageKey) || [];
		saveToLocalStorage(
			storageKey,
			current.filter((f: string) => f !== name)
		);
		forceUpdate((v) => v + 1);
	};

	const updateFolders = (newFolders: string[]) => {
		saveToLocalStorage(storageKey, newFolders);
		forceUpdate((v) => v + 1);
	};

	return {
		folders: getFolders(), // всегда актуальный
		addFolder,
		removeFolder,
		updateFolders,
	};
}

export default useFoldersFromLS;
