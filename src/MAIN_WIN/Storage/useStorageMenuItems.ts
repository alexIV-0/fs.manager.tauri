// Пункты контекстного меню, специфичные для облачного файла.
//
// Добавляются к обычному меню, а не заменяют его: облачный файл — тот же файл,
// у него так же есть «Открыть», «Переименовать», «Удалить». Отличие ровно в
// трёх действиях, которых у локального файла быть не может.

import { CloudDownload, CloudUpload, Pin, PinOff } from 'lucide-react';

import type { ContextMenuItem } from '../FileExplorerColumn/ContextMenu/FileFolderContextMenu';
import type { FileItem } from '@/Store/helpers/readDirContent';
import { useColumnView_Store } from '@/Store/MainWin/useColumnView_store';
import { invalidateDirCache } from '@/Store/helpers/readDirContent';
import { commands } from '@/Utils/specta';
import { dirname } from '@/Utils/path';

type Storage = FileItem['storage'];

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

	// Скачивать нечего, если копия уже актуальна.
	if (storage.state !== 'fresh') {
		items.push({
			id: 'storage-download',
			label: 'Скачать',
			icon: CloudDownload,
			dividerBefore: true,
			onClick: () => {
				void commands.storageEnsureLocal(path).then(refresh);
			},
		});
	}

	// Залить вручную, не дожидаясь фонового прохода.
	if (storage.state === 'localOnly' || storage.state === 'localModified') {
		items.push({
			id: 'storage-upload',
			label: 'Залить сейчас',
			icon: CloudUpload,
			dividerBefore: items.length === 0,
			onClick: () => {
				void commands.storageUpload(path).then(refresh);
			},
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
