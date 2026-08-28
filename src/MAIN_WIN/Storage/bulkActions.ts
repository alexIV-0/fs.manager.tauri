// Массовые действия по папке зеркала — одна реализация на все точки входа.
//
// Точек три, и все обязаны вести себя одинаково: пункт контекстного меню, клик по
// значку папки и (в будущем) кнопка в модалке «Информация». Развести их по трём
// файлам значило бы получить три разных диалога подтверждения — и три разных
// представления человека о том, что сейчас произойдёт.
//
// ── Почему всегда спрашиваем ────────────────────────────────────────────────
// Клик по облачку — это рекурсивная гидрация: она может стоить пятьдесят
// гигабайт и час канала. Цифры для вопроса бесплатны (лежат в индексе), поэтому
// молчаливого запуска здесь не бывает: `window.confirm` с числами — тот же приём,
// что у удаления проекта, и по той же причине.
//
// ── Почему в конце ничего не говорим ────────────────────────────────────────
// Итог виден сразу и без слов: значки в строках уходят в «скачивается», кнопка
// синхронизации в верхней панели показывает очередь и проценты. Модальное «готово»
// после каждого нажатия только мешало бы. Молчим ТОЛЬКО про успех — про отказ,
// про «нечего делать» и про упёршуюся в предохранитель очередь говорим словами.

import type { FileItem } from '@/Store/helpers/readDirContent';
import { invalidateDirCache } from '@/Store/helpers/readDirContent';
import { useColumnView_Store } from '@/Store/MainWin/useColumnView_store';
import { basename, dirname } from '@/Utils/path';
import { commands } from '@/Utils/specta';
import { downloadSubtree, subtreePlan, uploadSubtree } from '@/Utils/storageSeam';
import { естьВОблаке, естьНаДиске, идётПередача, pullFromCloud, pushToCloud } from './fileActions';
import { humanSize, plural } from './syncText';

/** «47 файлов» — счёт по-русски: текст вопроса читают перед согласием на 50 ГБ. */
const файлов = (n: number) => plural(n, ['файл', 'файла', 'файлов']);

/**
 * Перечитать строку папки и её родителя.
 *
 * Значок обязан измениться сразу после действия, иначе человек не понимает,
 * сработало ли. Событие `storage-changed` из Rust придёт и само, но только когда
 * поедет первый байт, — а между нажатием и первым байтом проходит секунда-две.
 */
export function refreshFolderRows(path: string): void {
	const parent = dirname(path);
	invalidateDirCache(path);
	invalidateDirCache(parent);
	const store = useColumnView_Store.getState();
	store.refreshAffectedColumns('gd', [path, parent]);
	store.refreshAffectedColumns('local', [path, parent]);
}

/** Строка про то, что массовая операция не тронет. Пусто — трогать нечего. */
function неразобранное(count: number): string {
	if (count === 0) return '';
	return (
		`\n${файлов(count)} ${count === 1 ? 'требует' : 'требуют'} разбора (конфликт или ошибка) — ` +
		`их массовая операция не трогает, они решаются по одному стрелками в строке.`
	);
}

/**
 * Скачать папку целиком: докачать всё, чего здесь нет.
 *
 * `pin` — заодно «оставить оффлайн». Без него скачанное живёт по правилам кэша и
 * через несколько часов вытесняется по таймеру: человек, скачавший папку ради
 * работы в дороге, обнаружил бы пустоту. Поэтому про кэш сказано прямо в вопросе.
 */
export async function downloadFolder(path: string, pin = false): Promise<void> {
	const name = basename(path) || path;
	try {
		const plan = await subtreePlan(path);
		if (!plan) {
			window.alert(`«${name}» — не папка облачного зеркала, скачивать нечего.`);
			return;
		}
		if (!plan.known) {
			window.alert(
				`Каталог проекта ещё не загружен — сколько здесь файлов, неизвестно.\n` +
					`Нажмите «Обновить» на папке и повторите.`,
			);
			return;
		}
		if (plan.missingFiles === 0) {
			window.alert(
				`В «${name}» скачивать нечего: ${файлов(plan.files)} — уже на диске.` +
					неразобранное(plan.unresolved),
			);
			return;
		}

		const строки = [
			`Скачать «${name}»${pin ? ' и оставить оффлайн' : ''}?`,
			'',
			`${файлов(plan.missingFiles)}, ${humanSize(plan.missingBytes)} — вместе со вложенными папками.`,
			plan.localFiles > 0 ? `${файлов(plan.localFiles)} уже на диске, их не трогаем.` : '',
			неразобранное(plan.unresolved),
			'',
			pin
				? 'Оставленное оффлайн вытеснение по таймеру не тронет — папка останется на диске.'
				: 'Копии живут по правилам кэша и через несколько часов вытесняются. Чтобы папка осталась на диске, есть пункт «Скачать и оставить оффлайн».',
		];
		if (!window.confirm(строки.filter(Boolean).join('\n'))) return;

		const r = await downloadSubtree(path, pin);
		if (r?.capped) {
			window.alert(
				`Поставлено в очередь ${файлов(r.queued)} — это предел одной операции.\n` +
					`Остальное доберётся повторным «Скачать папку», когда очередь опустеет.`,
			);
		}
	} catch (err) {
		window.alert(`Не удалось скачать «${name}»:\n\n${String(err)}`);
	} finally {
		refreshFolderRows(path);
	}
}

/** Отправить папку целиком: залить всё, чего нет в облаке. */
export async function uploadFolder(path: string): Promise<void> {
	const name = basename(path) || path;
	try {
		const plan = await subtreePlan(path);
		if (!plan) {
			window.alert(`«${name}» — не папка облачного зеркала, отправлять нечего.`);
			return;
		}
		if (plan.uploadFiles === 0) {
			window.alert(
				`Из «${name}» отправлять нечего — всё содержимое уже в облаке.` +
					неразобранное(plan.unresolved),
			);
			return;
		}

		const строки = [
			`Отправить «${name}» в облако?`,
			'',
			`${файлов(plan.uploadFiles)}, ${humanSize(plan.uploadBytes)} — те, которых в облаке нет или которые правили здесь.`,
			неразобранное(plan.unresolved),
		];
		if (!window.confirm(строки.filter(Boolean).join('\n'))) return;

		await uploadSubtree(path);
	} catch (err) {
		window.alert(`Не удалось отправить «${name}»:\n\n${String(err)}`);
	} finally {
		refreshFolderRows(path);
	}
}

// ─── Действия по ВЫДЕЛЕНИЮ ───────────────────────────────────────────────────
//
// Те же две операции, но охват задаётся выделением, а не одной строкой. Отдельно
// от `downloadFolder`/`uploadFolder` по одной причине: вопрос человеку должен быть
// ОДИН, с общими числами. Прогнать выделение из пяти папок через `downloadFolder`
// значило бы показать пять `confirm` подряд — после третьего их перестают читать.
//
// Строки приходят целиком (`FileItem`), а не путями: у файла состояние
// синхронизации уже прочитано колонкой, и спрашивать его снова в Rust незачем.

/** Что предстоит выделению: суммы по папкам плюс сами файлы. */
interface SelectionPlan {
	folders: FileItem[];
	/** Файлы, которым есть что везти в выбранную сторону. */
	files: FileItem[];
	count: number;
	bytes: number;
	unresolved: number;
	/** Папки, каталог которых ещё не загружен: их числа неизвестны. */
	unknown: number;
}

const пустойПлан = (): SelectionPlan => ({ folders: [], files: [], count: 0, bytes: 0, unresolved: 0, unknown: 0 });

async function planSelection(items: FileItem[], direction: 'down' | 'up'): Promise<SelectionPlan> {
	const plan = пустойПлан();

	for (const item of items) {
		if (item.isDir) {
			const sub = await subtreePlan(item.path);
			if (!sub) continue; // не папка зеркала — трогать нечего
			if (!sub.known) {
				plan.unknown += 1;
				continue;
			}
			plan.folders.push(item);
			plan.count += direction === 'down' ? sub.missingFiles : sub.uploadFiles;
			plan.bytes += direction === 'down' ? sub.missingBytes : sub.uploadBytes;
			plan.unresolved += sub.unresolved;
			continue;
		}

		const state = item.storage?.state;
		if (!state) continue; // строка не из зеркала
		// Пока передача идёт, ручное действие только мешает — ровно как у значка.
		if (идётПередача(state)) continue;
		// Конфликт и ошибку массовая операция не трогает (см. шапку `bulk.rs`).
		if (state === 'conflict' || state === 'error') {
			plan.unresolved += 1;
			continue;
		}
		const годится = direction === 'down' ? естьВОблаке(state) : естьНаДиске(state);
		if (!годится) continue;
		plan.files.push(item);
		plan.count += 1;
		plan.bytes += item.storage?.sizeBytes ?? 0;
	}

	return plan;
}

/** «каталог ещё не загружен» — числа по таким папкам неизвестны, молчать нельзя. */
function незагруженные(count: number): string {
	if (count === 0) return '';
	return (
		`\nУ ${count === 1 ? 'одной папки' : `${count} папок`} каталог ещё не загружен — их содержимое в счёт не вошло. ` +
		`Нажмите на папке «Обновить» и повторите.`
	);
}

/**
 * Скачать всё выделенное: папки — поддеревьями, файлы — поимённо.
 *
 * Ждать здесь нечего и незачем: как и у «Скачать папку», байты везут фоновые
 * задачи, а прогресс виден значками строк и кнопкой синхронизации. Пауза с
 * ожиданием есть только там, где без байтов нельзя продолжать, — перед
 * копированием (`hydrateForCopy`).
 */
export async function downloadSelection(items: FileItem[], pin = false): Promise<void> {
	try {
		const plan = await planSelection(items, 'down');
		if (plan.count === 0) {
			window.alert(
				`Скачивать нечего: всё выделенное уже на диске.` +
					неразобранное(plan.unresolved) +
					незагруженные(plan.unknown),
			);
			return;
		}

		const строки = [
			`Скачать выделенное${pin ? ' и оставить оффлайн' : ''}?`,
			'',
			`${файлов(plan.count)}, ${humanSize(plan.bytes)} — вместе со вложенными папками.`,
			неразобранное(plan.unresolved),
			незагруженные(plan.unknown),
			'',
			pin
				? 'Оставленное оффлайн вытеснение по таймеру не тронет.'
				: 'Копии живут по правилам кэша и через несколько часов вытесняются. Чтобы оставить их на диске, есть пункт «Скачать и оставить оффлайн».',
		];
		if (!window.confirm(строки.filter(Boolean).join('\n'))) return;

		for (const folder of plan.folders) await downloadSubtree(folder.path, pin);
		for (const file of plan.files) {
			await pullFromCloud(file.path, file.storage!.state!);
			// Пин ставим ПОСЛЕ скачивания: до него защищать от вытеснения нечего.
			if (pin && file.storage?.fileId) await commands.storageSetPinned(file.storage.fileId, true);
		}
	} catch (err) {
		window.alert(`Не удалось скачать выделенное:\n\n${String(err)}`);
	} finally {
		for (const item of items) refreshFolderRows(item.path);
	}
}

/** Отправить всё выделенное в облако: папки — поддеревьями, файлы — поимённо. */
export async function uploadSelection(items: FileItem[]): Promise<void> {
	try {
		const plan = await planSelection(items, 'up');
		if (plan.count === 0) {
			window.alert(
				`Отправлять нечего: всё выделенное уже в облаке.` +
					неразобранное(plan.unresolved) +
					незагруженные(plan.unknown),
			);
			return;
		}

		const строки = [
			'Отправить выделенное в облако?',
			'',
			`${файлов(plan.count)}, ${humanSize(plan.bytes)} — те, которых в облаке нет или которые правили здесь.`,
			неразобранное(plan.unresolved),
			незагруженные(plan.unknown),
		];
		if (!window.confirm(строки.filter(Boolean).join('\n'))) return;

		for (const folder of plan.folders) await uploadSubtree(folder.path);
		for (const file of plan.files) await pushToCloud(file.path, file.storage!.state!);
	} catch (err) {
		window.alert(`Не удалось отправить выделенное:\n\n${String(err)}`);
	} finally {
		for (const item of items) refreshFolderRows(item.path);
	}
}

/**
 * «Оставить оффлайн» / «Не держать оффлайн» для всего выделения.
 *
 * Только файлы: пин живёт на записи каталога, у логической папки его нет. Папку
 * оставляют оффлайн через «Скачать и оставить оффлайн» — там пин ставится каждому
 * файлу поддерева.
 */
export async function setPinnedSelection(items: FileItem[], pinned: boolean): Promise<void> {
	const ids = items.map((i) => i.storage?.fileId).filter((id): id is string => Boolean(id));
	if (ids.length === 0) return;
	try {
		for (const id of ids) await commands.storageSetPinned(id, pinned);
	} catch (err) {
		window.alert(`Не удалось изменить «оставить оффлайн»:\n\n${String(err)}`);
	} finally {
		for (const item of items) refreshFolderRows(item.path);
	}
}
