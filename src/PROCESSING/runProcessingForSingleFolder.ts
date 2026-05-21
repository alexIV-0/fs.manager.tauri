/*
	Запуск обработки только для одной конкретной папки.
	Используется из окна нод (TopPanel → кнопка Play).

	Шаги:
	1. Читаем options.json из папки (уже сохранён до вызова)
	2. Ищем файлы в папке IN
	3. Собираем очередь процессов
	4. Запускаем startProcessing только для этой папки
*/

import { isScanningStore } from '@/Store/MainWin/isScaning_store';
import { useWorkProject_Store } from '@/Store/Processing/useWorkProject_Store';
import { findFilesForSingleFolder } from './findFilesForSingleFolder';
import { startProcessing } from './startProcessing';
import { startProcessContext } from './utils/processingAbort';

export async function runProcessingForSingleFolder(folderPath: string) {
	const { clearWorkProjectState } = useWorkProject_Store.getState();
	const { setIsScanningProcess } = isScanningStore.getState();

	startProcessContext();
	clearWorkProjectState();

	const dateTime: any = await window.electronAPI.invoke('formatNameByPattern', {
		string: '$YYYY.$DD.$MM-$HH.$mm',
	});
	const year = dateTime.slice(0, 4);
	const findDateName = dateTime.slice(5);

	const mainFolderPath: string = await window.electronAPI.invoke('pathDirname', folderPath);

	console.groupCollapsed(`[Single run] ${findDateName}`);

	await findFilesForSingleFolder(folderPath, mainFolderPath, year, findDateName);

	const found = useWorkProject_Store.getState().workProject.length;
	console.log(`Found ${found} item(s) for processing`);
	console.groupEnd();

	if (found > 0) {
		const { setIsScanning } = isScanningStore.getState();
		setIsScanning(true);
		setIsScanningProcess(true);
		try {
			await startProcessing();
		} finally {
			setIsScanningProcess(false);
			setIsScanning(false);
		}
	}

	clearWorkProjectState();
}
