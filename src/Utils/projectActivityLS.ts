import { loadFromLocalStorage, saveToLocalStorage } from './loadSaveToLS';

/*
	Активность проектов для авто-отключения «холодных» папок.

	Почему не mtime папки OUT: каталоги синхронизируются gsync-демоном Google,
	который при сверке с облаком переписывает время папки на серверное. Серверное
	время каталога не меняется при добавлении файла внутрь, поэтому свежие файлы в
	OUT не «омолаживают» папку, а ручная правка mtime откатывается синком. Из-за
	этого папка, которой пользуются, через сутки выглядела «холодной».

	Ground-truth «когда проект последний раз реально использовался» ведёт само
	приложение: дату двигает обработка (есть что обрабатывать) и ручное включение.
	Перебора файлов нет — это побочка уже сделанной работы.

	Ключ — `${mainFolderId}::activity`, значение — Record<projectName, msEpoch>.
*/

type ActivityMap = Record<string, number>;

const activityKey = (mainFolderId: string) => `${mainFolderId}::activity`;

export function getActivityMap(mainFolderId: string): ActivityMap {
	return loadFromLocalStorage(activityKey(mainFolderId)) || {};
}

export function getProjectActivity(mainFolderId: string, project: string): number | undefined {
	const v = getActivityMap(mainFolderId)[project];
	return typeof v === 'number' ? v : undefined;
}

export function setProjectActivity(mainFolderId: string, project: string, ts: number) {
	const map = getActivityMap(mainFolderId);
	map[project] = ts;
	saveToLocalStorage(activityKey(mainFolderId), map);
}

// Чистим записи об удалённых/переименованных проектах (зеркалит чистку off-списка).
export function pruneActivity(mainFolderId: string, validNames: string[]) {
	const map = getActivityMap(mainFolderId);
	const valid = new Set(validNames);
	let changed = false;
	for (const name of Object.keys(map)) {
		if (!valid.has(name)) {
			delete map[name];
			changed = true;
		}
	}
	if (changed) saveToLocalStorage(activityKey(mainFolderId), map);
}
