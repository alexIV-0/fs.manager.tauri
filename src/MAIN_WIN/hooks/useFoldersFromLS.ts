import { useState, useEffect, useCallback } from 'react';
import { loadFromLocalStorage, saveToLocalStorage } from '@/Utils/loadSaveToLS';

function useFoldersFromLS(storageKey: string) {
	// Триггер для пересчёта (чтобы вызвать useEffect)
	const [, forceUpdate] = useState(0);

	// Получаем актуальный массив из LS
	const getFolders = useCallback((): string[] => loadFromLocalStorage(storageKey) || [], [storageKey]);

	const notify = () => {
		window.dispatchEvent(new CustomEvent('folders-off-list-changed', { detail: { key: storageKey } }));
		forceUpdate((v) => v + 1);
	};

	const addFolder = (name: string) => {
		const current = loadFromLocalStorage(storageKey) || [];
		saveToLocalStorage(storageKey, [...current, name]);
		notify();
	};

	const removeFolder = (name: string) => {
		const current = loadFromLocalStorage(storageKey) || [];
		saveToLocalStorage(storageKey, current.filter((f: string) => f !== name));
		notify();
	};

	const updateFolders = (newFolders: string[]) => {
		saveToLocalStorage(storageKey, newFolders);
		notify();
	};

	return {
		folders: getFolders(), // всегда актуальный
		addFolder,
		removeFolder,
		updateFolders,
	};
}

export default useFoldersFromLS;
