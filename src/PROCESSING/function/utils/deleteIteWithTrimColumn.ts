import { localFolders_stor } from '@/Store/MainWin/localFolders_store';
import { useColumnView_Store } from '@/Store/MainWin/useColumnView_store';

export async function deleteItemWithTrimColumns(path: string) {
	try {
		await window.electronAPI.invoke('deleteItem', path);
	} catch (err) {
		console.error('deleteItem failed:', err);
		return;
	}

	const lFolder = localFolders_stor.getState().localFolder;
	const instanceType = path.startsWith(lFolder) ? 'local' : 'gd';

	await useColumnView_Store.getState().removeItemAndTrimColumns(instanceType, path);
}
