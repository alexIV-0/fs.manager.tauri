import { commands, unwrap } from '@/Utils/specta';
import { loadFromLocalStorage, saveToLocalStorage } from '@/Utils/loadSaveToLS';

export async function reloadFolders(_obj: any) {
	const res = unwrap(await commands.getSomeFromFolder(_obj.path, [{ type: 'folders', ext: [] }])) as any;
	const foldersArr: string[] = res?.folders ?? [];
	const oldProjects = _obj.projectFolders || [];
	// 4. Оставляем только те, что есть в новом массиве
	const kept = oldProjects.filter((name: string) => foldersArr.includes(name));

	// 5. Добавляем новые, которых не было
	const existingSet = new Set(kept);
	const newOnes = foldersArr.filter((name) => !existingSet.has(name));

	const finalArr = [...kept, ...newOnes];

	// 6. Чистим LS выключенных папок (ключ = id главной папки): убираем имена,
	//    которых больше нет на диске, чтобы off-список не накапливал мусор.
	if (_obj.id) {
		const offList: string[] = loadFromLocalStorage(_obj.id) || [];
		const prunedOff = offList.filter((name) => foldersArr.includes(name));
		if (prunedOff.length !== offList.length) {
			saveToLocalStorage(_obj.id, prunedOff);
			// Перерисовываем FolderItem (жёлтая подсветка idle зависит от off-списка).
			window.dispatchEvent(new CustomEvent('folders-off-list-changed', { detail: { key: _obj.id } }));
		}
	}

	return finalArr;
}
