// Пофайловые облачные действия — одна реализация на меню, значок и стрелки.
//
// ── Почему это отдельный файл ───────────────────────────────────────────────
// Три точки входа делают одно и то же: пункт меню, клик по значку и стрелка в
// строке. Пока действие жило внутри меню, у значка и стрелок его просто не было —
// человек видел состояние и не мог ничего с ним сделать. Растащить одно действие
// по трём компонентам значило бы получить три разных поведения (одно с алертом об
// ошибке, другое без; одно перечитывает папку, другое нет).
//
// ── Направление зависит от состояния, а не от кнопки ───────────────────────
// «Скачать» у обычного расхождения — обычная гидрация, а у конфликта — отдельная
// операция: `ensure_local` файл в конфликте не трогает вовсе (и правильно: иначе
// он молча затирал бы локальную работу). Поэтому решение «каким путём везти»
// принимается здесь, по состоянию, а вызывающему остаётся только направление.

import type { FileState } from '@/bindings';
import { commands } from '@/Utils/specta';
import { resolveConflict } from '@/Utils/storageSeam';
import { refreshFolderRows } from './bulkActions';

/** В облаке есть что взять. */
export function естьВОблаке(state: FileState): boolean {
	return state === 'cloud' || state === 'stale' || state === 'conflict' || state === 'error';
}

/** На диске есть что отправить. */
export function естьНаДиске(state: FileState): boolean {
	return (
		state === 'localOnly' ||
		state === 'localModified' ||
		state === 'conflict' ||
		state === 'error'
	);
}

/** Передача уже идёт — ручные действия только мешают. */
export function идётПередача(state: FileState): boolean {
	return state === 'downloading' || state === 'uploading';
}

/**
 * Расхождение, где обе стороны осмысленны, — здесь и нужны две стрелки.
 *
 * `cloud` и `localOnly` сюда не входят: у них ровно одно направление, и оно уже
 * висит на самом значке (клик по нему). Две стрелки там были бы шумом в строке,
 * а таких файлов в облачной папке большинство.
 */
export function нуженВыбор(state: FileState): boolean {
	return state === 'conflict' || state === 'stale' || state === 'localModified' || state === 'error';
}

/** Ошибку показываем словами: specta её не бросает, а возвращает в результате. */
async function run(
	action: Promise<{ status: 'ok' } | { status: 'error'; error: string }>,
	failed: string,
): Promise<void> {
	const r = await action;
	if (r.status === 'error') window.alert(`${failed}\n\n${r.error}`);
}

/**
 * Взять версию из облака.
 *
 * У конфликта путь свой: локальная копия выбрасывается и файл качается заново.
 * Обычная гидрация файл в конфликте не тронет — значит «скачать» на нём выглядело
 * бы как неработающая кнопка.
 */
export async function pullFromCloud(path: string, state: FileState): Promise<void> {
	try {
		if (state === 'conflict') await resolveConflict(path, true);
		else await run(commands.storageEnsureLocal(path), 'Не удалось скачать файл');
	} catch (err) {
		window.alert(`Не удалось взять версию из облака:\n\n${String(err)}`);
	} finally {
		refreshFolderRows(path);
	}
}

/**
 * Отправить свою версию в облако.
 *
 * `stale` и `conflict` идут через разрешение расхождения: там сначала снимается
 * метка (иначе заливка молча ничего не сделает — она не трогает конфликтные файлы),
 * а облачная версия перезаписывается осознанно.
 */
export async function pushToCloud(path: string, state: FileState): Promise<void> {
	try {
		if (state === 'conflict' || state === 'stale') await resolveConflict(path, false);
		else await run(commands.storageUpload(path), 'Не удалось отправить файл в облако');
	} catch (err) {
		window.alert(`Не удалось отправить файл в облако:\n\n${String(err)}`);
	} finally {
		refreshFolderRows(path);
	}
}
