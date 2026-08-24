import { useState, useEffect, useCallback } from 'react';
import { loadFromLocalStorage, saveToLocalStorage } from '@/Utils/loadSaveToLS';
import { persistEnabled } from '@/Utils/folderState';

function useFoldersFromLS(storageKey: string) {
	// Триггер для пересчёта (чтобы вызвать useEffect)
	const [, forceUpdate] = useState(0);

	// Получаем актуальный массив из LS
	const getFolders = useCallback((): string[] => loadFromLocalStorage(storageKey) || [], [storageKey]);

	const notify = () => {
		window.dispatchEvent(new CustomEvent('folders-off-list-changed', { detail: { key: storageKey } }));
		forceUpdate((v) => v + 1);
	};

	// addFolder = ВЫКЛючить проект (имя в off-список), removeFolder = ВКЛючить.
	// LS обновляем синхронно (мгновенный UI), файл options/folderState.json пишем
	// write-through (fire-and-forget) — это ручной тогл, причина 'manual'.
	const addFolder = (name: string) => {
		const current = loadFromLocalStorage(storageKey) || [];
		saveToLocalStorage(storageKey, [...current, name]);
		notify();
		persistEnabled(storageKey, name, false, 'manual');
	};

	const removeFolder = (name: string) => {
		const current = loadFromLocalStorage(storageKey) || [];
		saveToLocalStorage(storageKey, current.filter((f: string) => f !== name));
		notify();
		persistEnabled(storageKey, name, true, null);
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
