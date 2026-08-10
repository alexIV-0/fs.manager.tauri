import { commands, unwrap } from '@/Utils/specta';
import { loadFromLocalStorage, saveToLocalStorage } from '@/Utils/loadSaveToLS';
import { hydrateMainFolder } from '@/Utils/folderState';
import { browseMirror } from '@/Utils/storageSeam';

export async function reloadFolders(_obj: any) {
	// Папка клиента в облачном зеркале: список проектов знает каталог, а не диск —
	// нескачанный проект на диске просто отсутствует. Вне зеркала — ни одного
	// лишнего вызова, всё как раньше.
	const fromMirror = await browseMirror(_obj.path);
	const foldersArr: string[] = fromMirror
		? fromMirror.filter((e) => e.isDir).map((e) => e.name)
		: ((unwrap(await commands.getSomeFromFolder(_obj.path, [{ type: 'folders', ext: [] }])) as any)?.folders ?? []);
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

		// 7. Гидрация из папки (SSOT): читаем options/folderState.json по всем проектам,
		//    подхватываем внешние правки (сайт/др. машина: enabled — файл выигрывает,
		//    lastActivityAt — max) и делаем ленивую миграцию legacy off-списка в файлы.
		//    На КАЖДОМ reload/проходе — чтобы состояние сходилось с папкой.
		if (_obj.path) await hydrateMainFolder(_obj.id, _obj.path, finalArr);
	}

	return finalArr;
}
