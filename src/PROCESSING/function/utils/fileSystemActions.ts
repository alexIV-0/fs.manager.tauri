import { localFolders_stor } from '@/Store/MainWin/localFolders_store';
import { useColumnView_Store } from '@/Store/MainWin/useColumnView_store';
import { clipboardFs_store } from '@/Store/MainWin/clipboardFs_store';
import { joinPath } from '@/Utils/joinPath';

// ── Определяем тип инстанса по пути ────────────────────────────────────────
function getInstanceType(path: string): 'gd' | 'local' {
	const lFolder = localFolders_stor.getState().localFolder;
	return path.startsWith(lFolder) ? 'local' : 'gd';
}

// ── Удаление с обрезкой дочерних колонок ───────────────────────────────────
export async function deleteItem(path: string): Promise<void> {
	try {
		await window.electronAPI.invoke('deleteItem', path);
	} catch (err) {
		console.error('deleteItem failed:', err);
		return;
	}

	const instanceType = getInstanceType(path);
	await useColumnView_Store.getState().removeItemAndTrimColumns(instanceType, path);
}

// ── Копировать путь в буфер ─────────────────────────────────────────────────
export async function copyPath(path: string): Promise<void> {
	try {
		await window.electronAPI.invoke('copyToClipboard', path);
	} catch (err) {
		console.error('copyPath failed:', err);
	}
}

// ── Показать в Finder / Explorer ────────────────────────────────────────────
export async function showInFinder(path: string): Promise<void> {
	try {
		await window.electronAPI.invoke('showInFolder', path);
	} catch (err) {
		console.error('showInFinder failed:', err);
	}
}

// ── Открыть файл дефолтным приложением ─────────────────────────────────────
export async function openFile(path: string): Promise<void> {
	try {
		await window.electronAPI.invoke('openFileWithDefaultApp', path);
	} catch (err) {
		console.error('openFile failed:', err);
	}
}

// ── Переименовать папку с обновлением колонок ───────────────────────────────
export async function renameFolder(
	oldPath: string,
	newPath: string,
	onSuccess?: (oldName: string, newName: string) => void,
): Promise<void> {
	try {
		await window.electronAPI.invoke('renameFolder', oldPath, newPath);

		const parentPath = (await window.electronAPI.invoke('pathDirname', oldPath)) as string;
		const oldName = (await window.electronAPI.invoke('pathBasename', oldPath)) as string;
		const newName = (await window.electronAPI.invoke('pathBasename', newPath)) as string;

		const instanceType = getInstanceType(oldPath);
		useColumnView_Store.getState().refreshAffectedColumns(instanceType, [parentPath]);

		onSuccess?.(oldName, newName);
	} catch (err) {
		console.error('renameFolder failed:', err);
	}
}

// ── Переименовать файл с обновлением колонок ────────────────────────────────
export async function renameFile(
	oldPath: string,
	newPath: string,
	onSuccess?: (oldName: string, newName: string) => void,
): Promise<void> {
	try {
		const success = await window.electronAPI.invoke('renameFile', oldPath, newPath);
		if (!success) return;

		const parentPath = (await window.electronAPI.invoke('pathDirname', oldPath)) as string;
		const oldName = (await window.electronAPI.invoke('pathBasename', oldPath)) as string;
		const newName = (await window.electronAPI.invoke('pathBasename', newPath)) as string;

		const instanceType = getInstanceType(oldPath);
		useColumnView_Store.getState().refreshAffectedColumns(instanceType, [parentPath]);

		onSuccess?.(oldName, newName);
	} catch (err) {
		console.error('renameFile failed:', err);
	}
}

// ── Создать новую папку ─────────────────────────────────────────────────────
export async function createFolder(parentPath: string, folderName = 'Новая папка'): Promise<void> {
	try {
		const newFolderPath = joinPath(parentPath, folderName);
		await window.electronAPI.invoke('createFolder', newFolderPath);

		const instanceType = getInstanceType(parentPath);
		useColumnView_Store.getState().refreshAffectedColumns(instanceType, [parentPath]);
	} catch (err) {
		console.error('createFolder failed:', err);
	}
}

// ── Создать текстовый файл ──────────────────────────────────────────────────
export async function createTextFile(parentPath: string, fileName = 'Новый файл.txt'): Promise<void> {
	try {
		const newFilePath = joinPath(parentPath, fileName);
		await window.electronAPI.invoke('createTextFile', newFilePath);

		const instanceType = getInstanceType(parentPath);
		useColumnView_Store.getState().refreshAffectedColumns(instanceType, [parentPath]);
	} catch (err) {
		console.error('createTextFile failed:', err);
	}
}

// ── Копировать элемент в буфер (внутренний) ─────────────────────────────────
export function copyToClipboardFs(paths: string[]): void {
	clipboardFs_store.getState().copy(paths);
}

// ── Вырезать элемент в буфер (внутренний) ───────────────────────────────────
export function cutToClipboardFs(paths: string[]): void {
	clipboardFs_store.getState().cut(paths);
}

// ── Вставить из буфера в папку ───────────────────────────────────────────────
export async function pasteFromClipboardFs(destFolderPath: string): Promise<void> {
	const { type, paths, clear } = clipboardFs_store.getState();
	if (!type || paths.length === 0) return;

	const instanceType = getInstanceType(destFolderPath);

	for (const srcPath of paths) {
		const name = (await window.electronAPI.invoke('pathBasename', srcPath)) as string;
		const destPath = joinPath(destFolderPath, name);

		try {
			if (type === 'copy') {
				await window.electronAPI.invoke('copyItem', srcPath, destPath, { overwrite: false });
			} else {
				await window.electronAPI.invoke('moveItem', srcPath, destPath, { overwrite: false });
				// После перемещения убираем из исходной колонки
				const srcInstanceType = getInstanceType(srcPath);
				await useColumnView_Store.getState().removeItemAndTrimColumns(srcInstanceType, srcPath);
			}
		} catch (err) {
			console.error('pasteFromClipboardFs failed for', srcPath, err);
		}
	}

	if (type === 'cut') clear();

	useColumnView_Store.getState().refreshAffectedColumns(instanceType, [destFolderPath]);
}
