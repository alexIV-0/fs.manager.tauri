import { isScanningStore } from '@/Store/MainWin/isScaning_store';
import { mainFolders_stor } from '@/Store/MainWin/mainFolders_store';
import { typeOfFile_store } from '@/Store/MainWin/pathPattern_store';
import { joinPath } from '@/Utils/joinPath';

type Prefetched = { files: string[]; folders: string[] };

export async function collectFilesFromFolderFunc(_node: any, prefetched?: Prefetched) {
	const curMainFolder = mainFolders_stor.getState().mainFolderArr[isScanningStore.getState().mainFolderIndex];
	const curFolderPath = joinPath(
		curMainFolder.path,
		curMainFolder.projectFolders[isScanningStore.getState().curentFolderIndex],
		'IN',
	);

	const searchTypeName: string = Array.isArray(_node.searchType) ? _node.searchType[0] : _node.searchType;
	const fileTypes = typeOfFile_store.getState().patternStore.find((element) => element.name === searchTypeName) || {
		path: [],
	};
	const exts: string[] = (fileTypes.path as string[]).map((e) => String(e).toLowerCase());

	let items: string[] = [];

	if (_node.recursiveSearch) {
		// Рекурсия — отдельный IPC, prefetched (top-level) недостаточен
		const searchObj = [{ type: searchTypeName, ext: fileTypes.path }];
		const itemArrName: any = await window.electronAPI.invoke('recursiveFindFiles', curFolderPath, searchObj);
		items = itemArrName[searchTypeName] ?? [];
	} else if (prefetched) {
		// Используем уже отсканированный top-level список — фильтруем в памяти
		if (searchTypeName === 'folders') {
			items = prefetched.folders;
		} else {
			items = prefetched.files.filter((name) => {
				if (exts.length === 0) return true;
				const dot = name.lastIndexOf('.');
				const ext = dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
				return exts.includes(ext);
			});
		}
	} else {
		// Fallback: prefetched нет (например, вызов из NODE_WIN single-folder run)
		const searchObj = [{ type: searchTypeName, ext: fileTypes.path }];
		const itemArrName: any = await window.electronAPI.invoke('getSomeFromFolder', curFolderPath, searchObj);
		items = itemArrName[searchTypeName] ?? [];
	}

	if (items.length === 0) return;

	const mergedPaths = mergePath(items, curFolderPath);

	// Защита: убедиться что все элементы это строки
	const validPaths = mergedPaths.map((p: any) => {
		if (Array.isArray(p)) {
			console.warn('[collectFilesFromFolderFunc] Item is an array, extracting first element:', p);
			return p[0];
		}
		return p;
	});

	_node.output = validPaths;
	return _node;
}

function mergePath(itemArrName: string[], curFolderPath: string): string[] {
	return itemArrName.map((name) => joinPath(curFolderPath, name));
}
