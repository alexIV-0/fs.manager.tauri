import { useColumnView_Store } from '@/Store/MainWin/useColumnView_store';
import { getInstanceType } from './fileSystemActions';

export async function deleteItemWithTrimColumns(path: string) {
	try {
		await window.electronAPI.invoke('deleteItem', path);
	} catch (err) {
		console.error('deleteItem failed:', err);
		return;
	}

	const instanceType = getInstanceType(path);

	await useColumnView_Store.getState().removeItemAndTrimColumns(instanceType, path);
}
