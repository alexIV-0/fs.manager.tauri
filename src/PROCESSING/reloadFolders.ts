import { commands, unwrap } from '@/Utils/specta';
import { loadFromLocalStorage, saveToLocalStorage } from '@/Utils/loadSaveToLS';
import { hydrateMainFolder, persistEnabled } from '@/Utils/folderState';
import { browseMirror } from '@/Utils/storageSeam';
import { archivedProjects_store } from '@/Store/MainWin/archivedProjects_store';

export async function reloadFolders(_obj: any) {
	// Папка клиента в облачном зеркале: список проектов знает каталог, а не диск —
	// нескачанный проект на диске просто отсутствует. Вне зеркала — ни одного
	// лишнего вызова, всё как раньше.
	const fromMirror = await browseMirror(_obj.path);
	const foldersArr: string[] = fromMirror
		? fromMirror.filter((e) => e.isDir).map((e) => e.name)
		: ((unwrap(await commands.getSomeFromFolder(_obj.path, [{ type: 'folders', ext: [] }])) as any)?.folders ?? []);

	// Архивные проекты: значок рисуется по этому набору. Список приходит тем же
	// листингом, что и сами проекты, поэтому отдельного запроса не нужно.
	// Обработка их пропускает независимо от интерфейса — там своя проверка
	// (`projectArchived` в findAllFilesForProcess), по каталогу, а не по стору.
	if (fromMirror) {
		archivedProjects_store
			.getState()
			.setForMainFolder(
				_obj.path,
				fromMirror.filter((e) => e.isDir && e.storage?.archived).map((e) => e.path),
			);

	}
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
		// `catalogWins` для облачной папки: у её проектов вкл/выкл живёт в БД, и файл
		// не должен перебивать каталог (см. ниже). Возвращённая карта — то, что лежит
		// в файлах: по ней видно расхождение, не читая их второй раз.
		const вФайлах = _obj.path
			? await hydrateMainFolder(_obj.id, _obj.path, finalArr, { catalogWins: Boolean(fromMirror) })
			: {};

		// ── Активность ОНЛАЙН-проекта: каталог важнее сайдкара ────────────────
		// Порядок здесь и был ошибкой. Раньше этот блок стоял ДО `hydrateMainFolder`,
		// а гидрация из `options/folderState.json` затирала его: файл «выигрывал», и
		// снятая на сайте галочка возвращалась обратно. Два источника истины на один
		// флаг — верный способ получить «не переключается».
		//
		// Для облачных проектов источник истины — каталог (`projects.is_paused`): его
		// пишет сайт, и он приезжает в каждом `/projects`. `folderState.json` остаётся
		// для локальных папок и как офлайн-кэш.
		if (fromMirror) {
			const offList: string[] = loadFromLocalStorage(_obj.id) || [];
			const off = new Set(offList);
			let changed = false;
			for (const row of fromMirror) {
				if (!row.isDir || !row.storage) continue;
				const paused = Boolean(row.storage.paused);
				if (paused && !off.has(row.name)) {
					off.add(row.name);
					changed = true;
				} else if (!paused && off.has(row.name)) {
					off.delete(row.name);
					changed = true;
				}
			}
			if (changed) {
				saveToLocalStorage(_obj.id, Array.from(off));
				// Галочки читают LS через свой хук — без события они не узнают.
				window.dispatchEvent(new CustomEvent('folders-off-list-changed', { detail: { key: _obj.id } }));
			}

			// ── Файл догоняет каталог ────────────────────────────────────────
			// Сайт переключает флаг в БД и `folderState.json` не трогает вовсе
			// (проверено: во всех файлах `updatedBy: app:*`, ни одного `site`).
			// Значит после правки с сайта файл остаётся со старым значением — и на
			// каждой гидрации спорит с каталогом, а другие машины и офлайн-режим
			// видят устаревшее «включён». Поэтому расхождение дописываем сразу.
			//
			// Цикла не будет: пишем только когда значения разошлись, а после записи
			// файл каталогу равен.
			for (const row of fromMirror) {
				if (!row.isDir || !row.storage) continue;
				const enabled = !row.storage.paused;
				const вФайле = вФайлах[row.name];
				// Файла нет и проект включён — писать нечего: «включён» это дефолт, а
				// плодить `options/folderState.json` у каждого проекта незачем (так было
				// задумано с самого начала). Файл появляется только когда есть что
				// сказать: выключён или значение разошлось.
				if (вФайле === undefined ? enabled : вФайле === enabled) continue;
				// Решение с сайта принял человек, поэтому причина «manual»: авто-логика
				// холодных проектов не должна считать это своим отключением.
				persistEnabled(_obj.id, row.name, enabled, 'manual');
			}
		}
	}

	return finalArr;
}
