// Пункты контекстного меню, специфичные для облачного файла.
//
// Добавляются к обычному меню, а не заменяют его: облачный файл — тот же файл,
// у него так же есть «Открыть», «Переименовать», «Удалить». Отличие ровно в
// трёх действиях, которых у локального файла быть не может.

import { CloudDownload, CloudUpload, Pin, PinOff, RotateCw } from 'lucide-react';

import type { ContextMenuItem } from '../FileExplorerColumn/ContextMenu/FileFolderContextMenu';
import type { FileItem } from '@/Store/helpers/readDirContent';
import { useColumnView_Store } from '@/Store/MainWin/useColumnView_store';
import { invalidateDirCache } from '@/Store/helpers/readDirContent';
import { commands } from '@/Utils/specta';
import { refreshFolder } from '@/Utils/storageSeam';
import { dirname } from '@/Utils/path';

type Storage = FileItem['storage'];

/**
 * Пункт «Обновить» для облачной ПАПКИ (и папки проекта).
 *
 * Спрашивает состояние только этой папки: дельты её проекта плюс сверка локальных
 * путей. Незачем трогать чужие проекты — охват синхронизации и так строится по тому,
 * с чем работают.
 *
 * Файлам это не нужно: у файла есть «Скачать»/«Обновить копию», а состояние папки —
 * это состояние её содержимого.
 */
export function storageFolderMenuItems(path: string, isMirror: boolean): ContextMenuItem[] {
	if (!isMirror) return [];
	return [
		{
			id: 'storage-refresh-folder',
			label: 'Обновить',
			icon: RotateCw,
			dividerBefore: true,
			onClick: () => {
				void refreshFolder(path).then(() => {
					invalidateDirCache(path);
					const parent = dirname(path);
					invalidateDirCache(parent);
					const store = useColumnView_Store.getState();
					store.refreshAffectedColumns('gd', [path, parent]);
					store.refreshAffectedColumns('local', [path, parent]);
				});
			},
		},
	];
}

/** Пункты для строки файла. Пустой массив — файл не из зеркала. */
export function storageMenuItems(path: string, storage: Storage): ContextMenuItem[] {
	if (!storage?.state) return [];

	// После любого действия перечитываем папку: значок обязан измениться сразу,
	// иначе человек не понимает, сработало ли.
	const refresh = () => {
		const parent = dirname(path);
		invalidateDirCache(parent);
		const store = useColumnView_Store.getState();
		store.refreshAffectedColumns('gd', [parent]);
		store.refreshAffectedColumns('local', [parent]);
	};

	const items: ContextMenuItem[] = [];

	// Пока передача идёт, ручные действия бессмысленны: «скачать» во время
	// скачивания возвращало ошибку, а выглядело как «кнопка не работает».
	const busy = storage.state === 'downloading' || storage.state === 'uploading';

	// Ошибку показываем словами. Раньше результат команды не смотрели вовсе
	// (`.then(refresh)`), а specta ошибку не бросает — возвращает `{status:'error'}`.
	// Поэтому отказ выглядел как «нажал, и ничего не произошло».
	const run = (
		action: Promise<{ status: 'ok' } | { status: 'error'; error: string }>,
		failed: string,
	) => {
		void action.then((r) => {
			if (r.status === 'error') window.alert(`${failed}\n\n${r.error}`);
			refresh();
		});
	};

	// Пункт показываем, только если в облаке ЕСТЬ что брать. Раньше условие было
	// «состояние не fresh», и у файла, который лежит только на диске, в меню висело
	// «скачать» — предложение скачать то, чего в облаке нет. `conflict` тоже сюда не
	// входит: расхождение разбирается двумя стрелками у значка, а не молчаливым
	// перетиранием локальной правки.
	//
	// `error` — единственный случай, где пункт даём в обе стороны: какая половина
	// отвалилась, по состоянию не видно, и выбор честнее догадки.
	const вОблаке = storage.state === 'cloud' || storage.state === 'stale' || storage.state === 'error';
	const наДиске =
		storage.state === 'localOnly' || storage.state === 'localModified' || storage.state === 'error';

	if (!busy && вОблаке) {
		items.push({
			id: 'storage-download',
			label: storage.state === 'stale' ? 'Обновить копию из облака' : 'Скачать из облака',
			icon: CloudDownload,
			dividerBefore: true,
			onClick: () => run(commands.storageEnsureLocal(path), 'Не удалось скачать файл'),
		});
	}

	// Залить вручную, не дожидаясь фонового прохода.
	if (!busy && наДиске) {
		items.push({
			id: 'storage-upload',
			label: 'Отправить в облако',
			icon: CloudUpload,
			dividerBefore: items.length === 0,
			onClick: () => run(commands.storageUpload(path), 'Не удалось отправить файл в облако'),
		});
	}

	// Закрепление держит файл от вытеснения по времени.
	if (storage.fileId) {
		items.push({
			id: 'storage-pin',
			label: storage.pinned ? 'Не держать оффлайн' : 'Оставить оффлайн',
			icon: storage.pinned ? PinOff : Pin,
			dividerBefore: items.length === 0,
			onClick: () => {
				void commands.storageSetPinned(storage.fileId!, !storage.pinned).then(refresh);
			},
		});
	}

	return items;
}
