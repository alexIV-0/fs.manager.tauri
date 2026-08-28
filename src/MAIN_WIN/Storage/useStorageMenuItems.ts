// Пункты контекстного меню, специфичные для облака: файл, папка, проект.
//
// Добавляются к обычному меню, а не заменяют его: облачный файл — тот же файл,
// у него так же есть «Открыть», «Переименовать», «Удалить». Отличие только в
// действиях, которых у локального файла быть не может — скачать, отправить,
// держать оффлайн; у папки те же действия, но по всему поддереву.
//
// Сами действия здесь НЕ живут: массовые — в `bulkActions.ts` (их зовёт ещё и клик
// по значку папки), пофайловые — в командах. Здесь только пункты меню.

import { CloudDownload, CloudUpload, HardDriveDownload, Pin, PinOff, RotateCw, Trash2 } from 'lucide-react';

import type { ContextMenuItem } from '../FileExplorerColumn/ContextMenu/FileFolderContextMenu';
import type { FileItem } from '@/Store/helpers/readDirContent';
import { commands } from '@/Utils/specta';
import { refreshFolder } from '@/Utils/storageSeam';
import {
	downloadFolder,
	downloadSelection,
	refreshFolderRows,
	setPinnedSelection,
	uploadFolder,
	uploadSelection,
} from './bulkActions';
import { естьВОблаке, естьНаДиске, идётПередача, pullFromCloud, pushToCloud } from './fileActions';

type Storage = FileItem['storage'];

/**
 * Пункты облачной ПАПКИ (и папки проекта): массовые действия плюс «Обновить».
 *
 * ── Зачем массовые ──────────────────────────────────────────────────────────
 * Без них папку скачивали пофайлово: зайти, выделить, «Скачать», и так по каждой
 * вложенной папке. Папка — естественная единица работы («забери мне этот проект»),
 * и рекурсия здесь не удобство, а сам смысл действия.
 *
 * Два пункта скачивания, а не один с вопросом: выбор «оставить оффлайн» нельзя
 * задать в `confirm` (там всего две кнопки), а он важен — без пина скачанное
 * вытесняется по таймеру через несколько часов.
 *
 * «Обновить» спрашивает состояние только этой папки: дельты её проекта плюс сверка
 * локальных путей. Незачем трогать чужие проекты — охват синхронизации и так
 * строится по тому, с чем работают.
 *
 * Файлам этот набор не нужен: у файла свои три пункта (`storageMenuItems`), а
 * состояние папки — это состояние её содержимого.
 */
export function storageFolderMenuItems(path: string, isMirror: boolean): ContextMenuItem[] {
	if (!isMirror) return [];
	return [
		{
			id: 'storage-download-folder',
			label: 'Скачать папку из облака…',
			icon: CloudDownload,
			dividerBefore: true,
			onClick: () => void downloadFolder(path),
		},
		{
			id: 'storage-download-folder-pin',
			label: 'Скачать и оставить оффлайн…',
			icon: HardDriveDownload,
			onClick: () => void downloadFolder(path, true),
		},
		{
			id: 'storage-upload-folder',
			label: 'Отправить папку в облако…',
			icon: CloudUpload,
			onClick: () => void uploadFolder(path),
		},
		{
			id: 'storage-refresh-folder',
			label: 'Обновить',
			icon: RotateCw,
			onClick: () => {
				void refreshFolder(path).then(() => refreshFolderRows(path));
			},
		},
	];
}

/**
 * Пункт «Удалить проект полностью» — только для проекта зеркала (2-я колонка).
 *
 * Отдельно от `storageFolderMenuItems`: те пункты общие для любой папки зеркала, а этот
 * относится только к уровню проекта. Обычное «Удалить» на проекте не работает и работать
 * не может — папка проекта не запись в каталоге файлов, `delete` её не принимает.
 *
 * Название без слова «безвозвратно», хотя удаление необратимо: подробности и числа —
 * в подтверждении, которое показывает обработчик. Пункт меню не место для дисклеймера.
 */
export function storageProjectMenuItems(isMirror: boolean, onPurge: () => void): ContextMenuItem[] {
	if (!isMirror) return [];
	return [
		{
			id: 'storage-purge-project',
			label: 'Удалить проект полностью…',
			icon: Trash2,
			dividerBefore: true,
			onClick: onPurge,
		},
	];
}

/** Пункты для строки файла. Пустой массив — файл не из зеркала. */
export function storageMenuItems(path: string, storage: Storage): ContextMenuItem[] {
	if (!storage?.state) return [];

	const state = storage.state;
	const items: ContextMenuItem[] = [];

	// Направления — те же предикаты, что у значка и у стрелок (`fileActions`).
	// Раньше условия жили прямо здесь, и меню могло предлагать то, чего стрелки не
	// умеют (и наоборот). Пока передача идёт, ручные действия бессмысленны:
	// «скачать» во время скачивания возвращало ошибку, а выглядело как «кнопка не
	// работает».
	if (!идётПередача(state) && естьВОблаке(state)) {
		items.push({
			id: 'storage-download',
			label:
				state === 'stale'
					? 'Обновить копию из облака'
					: state === 'conflict'
						? 'Взять версию из облака'
						: 'Скачать из облака',
			icon: CloudDownload,
			dividerBefore: true,
			onClick: () => void pullFromCloud(path, state),
		});
	}

	// Залить вручную, не дожидаясь фонового прохода.
	if (!идётПередача(state) && естьНаДиске(state)) {
		items.push({
			id: 'storage-upload',
			label: state === 'conflict' || state === 'stale' ? 'Залить мою версию' : 'Отправить в облако',
			icon: CloudUpload,
			dividerBefore: items.length === 0,
			onClick: () => void pushToCloud(path, state),
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
				// Значок обязан измениться сразу, иначе непонятно, сработало ли.
				void commands
					.storageSetPinned(storage.fileId!, !storage.pinned)
					.then(() => refreshFolderRows(path));
			},
		});
	}

	return items;
}

/**
 * Облачные пункты для ВЫДЕЛЕНИЯ — одна точка входа для строки файла и строки папки.
 *
 * Одна строка — прежние наборы, слово в слово: у файла свои три пункта, у папки
 * свои четыре. Несколько строк — общий набор с охватом в подписи и одним вопросом
 * на всё выделение (`downloadSelection`/`uploadSelection`).
 *
 * Смешанное выделение (файлы и папки вместе) — обычный случай, а не край: в папке
 * проекта лежит и то и другое. Поэтому набор здесь один на оба вида строк, а
 * разбирается с ними план внутри действия.
 */
export function storageSelectionItems(targets: FileItem[]): ContextMenuItem[] {
	if (targets.length === 0) return [];
	if (targets.length === 1) {
		const one = targets[0];
		return one.isDir
			? storageFolderMenuItems(one.path, Boolean(one.storage))
			: storageMenuItems(one.path, one.storage);
	}

	// Строки не из зеркала в выделении просто не участвуют: локальный файл рядом с
	// облачным — норма, и из-за него весь набор пропадать не должен.
	const зеркальные = targets.filter((t) => Boolean(t.storage));
	if (зеркальные.length === 0) return [];

	const можноСкачать = зеркальные.some((t) =>
		t.isDir
			? t.storage?.aggregate === 'allCloud' || t.storage?.aggregate === 'mixed'
			: t.storage?.state != null && !идётПередача(t.storage.state) && естьВОблаке(t.storage.state),
	);
	const можноОтправить = зеркальные.some((t) =>
		t.isDir
			? t.storage?.aggregate === 'needsUpload'
			: t.storage?.state != null && !идётПередача(t.storage.state) && естьНаДиске(t.storage.state),
	);

	// Пин живёт на записи каталога — он есть только у файлов.
	const пинуемые = зеркальные.filter((t) => !t.isDir && t.storage?.fileId);
	const всеЗакреплены = пинуемые.length > 0 && пинуемые.every((t) => t.storage?.pinned);

	const items: ContextMenuItem[] = [];

	if (можноСкачать) {
		items.push({
			id: 'storage-download-selection',
			label: `Скачать из облака (${зеркальные.length})…`,
			icon: CloudDownload,
			dividerBefore: true,
			onClick: () => void downloadSelection(зеркальные),
		});
		items.push({
			id: 'storage-download-selection-pin',
			label: 'Скачать и оставить оффлайн…',
			icon: HardDriveDownload,
			onClick: () => void downloadSelection(зеркальные, true),
		});
	}

	if (можноОтправить) {
		items.push({
			id: 'storage-upload-selection',
			label: `Отправить в облако (${зеркальные.length})…`,
			icon: CloudUpload,
			dividerBefore: items.length === 0,
			onClick: () => void uploadSelection(зеркальные),
		});
	}

	if (пинуемые.length > 0) {
		items.push({
			id: 'storage-pin-selection',
			label: всеЗакреплены ? `Не держать оффлайн (${пинуемые.length})` : `Оставить оффлайн (${пинуемые.length})`,
			icon: всеЗакреплены ? PinOff : Pin,
			dividerBefore: items.length === 0,
			onClick: () => void setPinnedSelection(пинуемые, !всеЗакреплены),
		});
	}

	return items;
}
