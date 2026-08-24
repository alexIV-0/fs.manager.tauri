// Шов облачного хранилища для ЯДРА программы.
//
// Плагины получают шов через `_template/tauri.ts`, но `src/PROCESSING` зовёт
// `commands.*` напрямую — здесь его аналог.
//
// ── Три вида шва, путать нельзя ──────────────────────────────────────────────
//   • нужны БАЙТЫ            → `ensureLocal` (ждём скачивания);
//     то же, но сбой фатален → `ensureLocalStrict` (читателю важно отличить
//                              «файла нет вовсе» от «не скачалось»);
//   • нужны МЕТАДАННЫЕ       → `pathInfo` (из каталога, НЕ качаем);
//   • нужно ЗНАТЬ, ЕСТЬ ЛИ   → `pathExists` (из каталога, НЕ качаем).
//
// Если бы `stat`/`exists` гидратировали, первый же обход проекта скачал бы весь
// архив: `findFilesForSingleFolder` зовёт их на каждый найденный файл.
//
// ── Почему есть быстрый гейт ────────────────────────────────────────────────
// Сканирование локальной папки не должно платить ни одним лишним IPC-вызовом за
// облако, которого нет. Пока корень зеркала не задан, все функции возвращают
// ответ мгновенно и в Rust не ходят вообще.

import { commands, unwrap } from '@/Utils/specta';
import type { EnsureOutcome } from '@/bindings';

/** `undefined` — ещё не спрашивали. `''` — облака нет. */
let mirrorRoot: string | undefined;
let probing: Promise<void> | null = null;

/** Сбросить кэш — после смены настроек или подключения. */
export function resetStorageSeam(): void {
	mirrorRoot = undefined;
	probing = null;
}

async function ensureProbed(): Promise<void> {
	if (mirrorRoot !== undefined) return;
	if (!probing) {
		probing = (async () => {
			try {
				const r = await commands.storageStatus();
				mirrorRoot = r.status === 'ok' ? r.data.mirrorRoot : '';
			} catch {
				mirrorRoot = '';
			}
		})();
	}
	await probing;
}

/**
 * Быстрая проверка «может ли путь вообще относиться к зеркалу».
 *
 * Сравнение регистронезависимое: на macOS файловая система такова, и
 * `/Users/x/Mirror` с `/users/x/mirror` — один каталог. Строгое сравнение
 * отправило бы файл из зеркала по локальной ветке, и он остался бы нескачанным.
 *
 * Это только предфильтр — точное решение принимает Rust.
 */
function maybeMirror(p: string): boolean {
	if (!mirrorRoot) return false;
	return p.toLowerCase().startsWith(mirrorRoot.toLowerCase());
}

/**
 * Убедиться, что по пути лежит актуальный файл. Возвращает тот же путь.
 *
 * **Вне зеркала — no-op.** Поэтому вызов безопасно ставить перед любым
 * обращением к содержимому, не разбираясь «здесь надо или нет».
 */
export async function ensureLocal(p: string): Promise<string> {
	await ensureProbed();
	if (!maybeMirror(p)) return p;
	try {
		const r = await commands.storageEnsureLocal(p);
		return r.status === 'ok' ? r.data.path : p;
	} catch {
		// Хранилище отвалилось — работаем как раньше, а не падаем.
		return p;
	}
}

/** То же для списка. Полезно перед вызовом AE: он откроет пути сам, и наш код
 *  этих открытий уже не увидит — гидратировать надо ДО. */
export async function ensureLocalAll(paths: string[]): Promise<string[]> {
	await ensureProbed();
	if (!paths.some(maybeMirror)) return paths;
	return Promise.all(paths.map((p) => ensureLocal(p)));
}

/**
 * То же, что `ensureLocal`, но сбой НЕ прощает — бросает.
 *
 * Мягкость `ensureLocal` сделана для обработки: падать из-за облака посреди
 * витка нельзя. Но есть чтения, где «не скачалось» нельзя пережить как «файла нет»:
 * пустой `options.json` выглядит ровно как новый проект, а первое же сохранение
 * зальёт эту пустоту поверх облачного графа.
 *
 * Исход возвращается, чтобы вызывающий мог различить случаи: `notInMirror` —
 * файла нет ни в каталоге, ни под зеркалом (законный новый проект), `localOnly` —
 * лежит только на диске, остальные — байты на месте.
 */
export async function ensureLocalStrict(p: string): Promise<EnsureOutcome> {
	await ensureProbed();
	if (!maybeMirror(p)) return 'notInMirror';
	return unwrap(await commands.storageEnsureLocal(p)).outcome;
}

/** Строка листинга в формате колонок — тот же тип, что отдаёт чтение диска. */
export interface MirrorItem {
	name: string;
	path: string;
	isDir: boolean;
	storage?: {
		fileId: string | null;
		state: import('@/bindings').FileState | null;
		aggregate: import('@/bindings').FolderAggregate | null;
		pinned: boolean;
		progress: number | null;
		error: string | null;
		sizeBytes: number | null;
		/** Только у строки проекта: проект убран в архив, обработка по нему не идёт. */
		archived: boolean;
		/** Только у строки проекта: приостановлен на сайте (`is_paused`) — галочка снята. */
		paused: boolean;
	};
}

/**
 * Содержимое папки зеркала. `null` — путь не наш, читай диск как обычно.
 *
 * Здесь есть файлы, которых на диске ещё нет: в этом весь смысл. Не скачанный
 * файл существует — просто пока не здесь.
 */
export async function browseMirror(p: string): Promise<MirrorItem[] | null> {
	await ensureProbed();
	if (!maybeMirror(p)) return null;
	try {
		const r = await commands.storageBrowse(p);
		if (r.status !== 'ok' || r.data === null) return null;
		return r.data.map((e) => ({
			name: e.name,
			path: e.path,
			isDir: e.isDir,
			storage: {
				fileId: e.fileId,
				state: e.state,
				aggregate: e.aggregate,
				pinned: e.pinned,
				progress: e.progress,
				error: e.error,
				sizeBytes: e.sizeBytes,
				archived: e.archived,
				paused: e.paused,
			},
		}));
	} catch {
		// Каталог недоступен — пусть колонка прочитает то, что есть на диске,
		// вместо пустого экрана.
		return null;
	}
}

/**
 * Создать папку зеркала на диске.
 *
 * Структуру целиком не материализуем — она видна из каталога. Папка нужна
 * физически ровно в двух случаях: её открывают в Finder и в неё кладут файл.
 * Вне зеркала — no-op, поэтому вызов безопасно ставить перед обоими.
 */
export async function ensureMirrorDir(p: string): Promise<void> {
	await ensureProbed();
	if (!maybeMirror(p)) return;
	try {
		await commands.storageEnsureDir(p);
	} catch {
		// Не создалась — дальше упадёт сама операция с понятной ошибкой,
		// дублировать её здесь незачем.
	}
}

/**
 * Сообщить, что пайплайн положил файлы — их надо залить.
 *
 * Это **основной триггер заливки**, а не оптимизация. Слежка за файловой системой
 * не может отличить дописанный файл от растущего (события «файл закрыт» на macOS
 * нет вообще), поэтому она ждёт затишья, а раннер знает точно: шаг завершён.
 *
 * Вне зеркала — no-op. Ошибку глотаем: не залившийся файл увидит вотчер или
 * полный обход, а падать из-за облака посреди обработки нельзя.
 */
export async function markUploads(paths: string[]): Promise<void> {
	await ensureProbed();
	const mine = paths.filter(maybeMirror);
	if (mine.length === 0) return;
	try {
		await commands.storageMarkDirty(mine, true);
	} catch {}
}

/**
 * Конец витка: залить всё накопившееся, не дожидаясь затишья.
 *
 * Нужно для файлов, о готовности которых сообщить некому, — например месячного
 * JSONL статистики: он дописывается на каждый элемент, и заливать его после
 * каждого значило бы гонять весь файл в облако тысячу раз за месяц.
 */
export async function flushUploads(): Promise<void> {
	await ensureProbed();
	if (!mirrorRoot) return;
	try {
		await commands.storageFlushUploads();
	} catch {}
}

/**
 * Догнать дельты каталога по пути проекта — один раз в начале витка.
 *
 * Дальше весь виток можно доверять локальному индексу. Альтернатива — спрашивать
 * бэкенд о каждом файле: при десяти тысячах элементов это десять тысяч запросов
 * вместо одного.
 *
 * Вне зеркала — no-op.
 */
export async function catchUpProject(projectPath: string): Promise<void> {
	await ensureProbed();
	if (!maybeMirror(projectPath)) return;
	try {
		await commands.storageCatchUpPath(projectPath);
	} catch {
		// Дельты не пришли — работаем по индексу, какой есть. Это отставание
		// каталога, а не причина останавливать обработку.
	}
}

/**
 * Архивный ли это проект. `false` — не архивный ИЛИ путь вообще не проект зеркала.
 *
 * Архивность решает бэкенд (`is_archived`, не `group_name`), и обработку по таким
 * проектам запускать нельзя — так прямо написано в контракте storage-API. Вне
 * зеркала — no-op без единого IPC-вызова.
 */
export async function projectArchived(projectPath: string): Promise<boolean> {
	await ensureProbed();
	if (!maybeMirror(projectPath)) return false;
	try {
		const r = await commands.storageProjectInfo(projectPath);
		return r.status === 'ok' ? Boolean(r.data?.archived) : false;
	} catch {
		// Каталог недоступен — не превращаем это в «пропустить проект»: молча
		// потерянный виток обработки хуже, чем обработка архивного проекта.
		return false;
	}
}

/**
 * Создать папку В КАТАЛОГЕ и на диске. `false` — путь не в зеркале, создавай сам.
 *
 * Отличается от `ensureMirrorDir`: та материализует на диске папку, которая в
 * каталоге уже есть. Здесь папка в каталоге ЗАВОДИТСЯ — иначе у неё нет `file_id`,
 * а значит ни переименования, ни удаления через API, ни значка синхронизации.
 */
export async function mkdirInCloud(path: string): Promise<boolean> {
	await ensureProbed();
	if (!maybeMirror(path)) return false;
	const r = await commands.storageMkdir(path);
	if (r.status !== 'ok') throw new Error(String(r.error));
	return r.data !== null;
}

/**
 * Создать папку — ЕДИНСТВЕННЫЙ правильный способ сделать это в коде программы.
 *
 * В зеркале папка заводится в каталоге (`/mkdir`), вне зеркала — просто на диске.
 * Звать `testAndCreateFolder` напрямую нельзя: папка, созданная только на диске,
 * для облака не существует — нет `file_id`, значит ни переименования, ни удаления
 * через API, ни значка синхронизации, и на сайте её не видно. Ровно так пропадала
 * папка `IN`: её создавал `ensureProjectFolders` мимо каталога.
 *
 * Отказ облака НЕ отменяет создание на диске: работать без сети программа обязана,
 * а папка с файлами внутри зарегистрируется сама — `folder_path` приезжает в
 * каталог вместе с первым залитым файлом. Молчать об отказе при этом нельзя:
 * пустая папка так и останется невидимой для сайта, и знать об этом надо из логов.
 */
export async function ensureDir(path: string): Promise<void> {
	try {
		if (await mkdirInCloud(path)) return;
	} catch (err) {
		console.error('[storage] папка не заведена в каталоге, создаю только на диске:', path, err);
	}
	unwrap(await commands.testAndCreateFolder(path));
}

/**
 * Удалить — **двухступенчато**. `null` — путь не в зеркале, удаляй как обычно.
 *
 * Первое нажатие убирает локальную копию (файл остаётся в облаке со значком «только
 * онлайн»), второе — удаляет в облаке. Случайное нажатие стоит повторного
 * скачивания, а не мастера, который считали часами.
 *
 * `needsConfirm` — вторая ступень требует подтверждения: у бэкенда нет корзины
 * (просьба 6), значит удаление в облаке необратимо. Подтвердил — зови с
 * `allowOnline = true`.
 */
export async function deleteInCloud(path: string, allowOnline = false): Promise<import('@/bindings').DeleteStage | null> {
	await ensureProbed();
	if (!maybeMirror(path)) return null;
	const r = await commands.storageDelete(path, allowOnline);
	if (r.status !== 'ok') throw new Error(String(r.error));
	return r.data;
}

/**
 * Выжечь проект: содержимое в облаке + локальная папка. `null` — путь не в зеркале.
 *
 * **Полного удаления здесь не бывает, и это не недоделка.** Запись самого проекта
 * программа удалить не может: под machine token у бэкенда нет такого эндпоинта
 * (просьба 3.7), а папка проекта — не запись в каталоге файлов, чтобы уйти через
 * `delete`. Плюс `options` бэкенд защищает 403. Поэтому отчёт возвращается целиком:
 * интерфейс обязан показать, что осталось, а не сказать «проект удалён».
 *
 * Подтверждение — на вызывающем: команда не спрашивает, а делает.
 */
export async function purgeProject(path: string): Promise<import('@/bindings').PurgeReport | null> {
	await ensureProbed();
	if (!maybeMirror(path)) return null;
	const r = await commands.storagePurgeProject(path);
	if (r.status !== 'ok') throw new Error(String(r.error));
	return r.data;
}

/**
 * Сколько файлов и байт в проекте по каталогу — чтобы спросить с числами, а не вслепую.
 *
 * `null` — путь не в зеркале ИЛИ полного обхода проекта ещё не делали. Второе не то же
 * самое, что «пусто»: показать «0 файлов» там, где мы просто не спрашивали, — худший
 * вид вранья, поэтому неизвестность возвращаем неизвестностью.
 */
export async function projectCloudStats(path: string): Promise<{ files: number; bytes: number } | null> {
	await ensureProbed();
	if (!maybeMirror(path)) return null;
	try {
		const info = await commands.storageProjectInfo(path);
		const projectId = info.status === 'ok' ? info.data?.projectId : null;
		if (!projectId) return null;
		const st = await commands.storageSubtreeStats(projectId, '');
		if (st.status !== 'ok' || !st.data.known) return null;
		return { files: st.data.files, bytes: st.data.bytes };
	} catch {
		return null;
	}
}

/**
 * Обновить состояние ОДНОЙ папки: дельты её проекта + сверка путей.
 *
 * Пункт меню «Обновить» у облачной папки. Спрашивает только её проект — незачем
 * трогать чужие: охват синхронизации и так строится по тому, с чем работают.
 *
 * `false` — путь не в зеркале.
 */
export async function refreshFolder(path: string): Promise<boolean> {
	await ensureProbed();
	if (!maybeMirror(path)) return false;
	try {
		await commands.storageCatchUpPath(path);
		await commands.storageSyncNow();
	} catch {
		// Сеть отвалилась — показываем, что есть в индексе.
	}
	return true;
}

/**
 * Догнать каталог прямо сейчас (кнопка «Обновить» у владельца).
 *
 * Интерфейс от этого не перерисовывается — он и так рисуется из локальной БД.
 * Задача вызова: подтянуть саму БД и подвинуть локальные копии за изменившимися
 * путями. Вне зеркала — no-op.
 */
export async function syncNow(): Promise<void> {
	await ensureProbed();
	if (!mirrorRoot) return;
	try {
		await commands.storageSyncNow();
	} catch {
		// Сеть отвалилась — показываем, что есть в индексе. Кнопка не обязана падать.
	}
}

/**
 * Освободить диск от локальных копий владельца. Онлайн не трогается.
 *
 * `null` — путь не в зеркале. Незалитое остаётся на диске: в нём работа, которой в
 * облаке ещё нет, и отчёт это возвращает, чтобы интерфейс не соврал «удалено всё».
 */
export async function dropOwnerLocal(
	path: string,
): Promise<import('@/bindings').DropOwnerReport | null> {
	await ensureProbed();
	if (!maybeMirror(path)) return null;
	const r = await commands.storageDropOwnerLocal(path);
	if (r.status !== 'ok') throw new Error(String(r.error));
	return r.data;
}

/**
 * Разрешить конфликт: `takeCloud = true` — взять облачную версию, иначе залить свою.
 *
 * Бросает — вызывающий показывает ошибку: молча «ничего не произошло» в разрешении
 * конфликта хуже всего, человек останется с тем же ⚠ и без объяснений.
 */
export async function resolveConflict(path: string, takeCloud: boolean): Promise<void> {
	await ensureProbed();
	if (!maybeMirror(path)) return;
	const r = await commands.storageResolveConflict(path, takeCloud);
	if (r.status !== 'ok') throw new Error(String(r.error));
}

/**
 * Удалить ПОЛНОСТЬЮ — и копию, и запись в каталоге. `false` — путь не в зеркале.
 *
 * Для раннера, а не для человека: «удалить исходник после обработки» — явная
 * инструкция пайплайна, и двухступенчатость тут вредна. Убрать только локальную копию
 * значило бы оставить файл в каталоге, а следующий скан подобрал бы его снова и
 * обработал заново — бесконечный круг.
 *
 * Человеку двухступенчатое удаление остаётся: там оно защищает от случайного нажатия.
 */
export async function deleteEverywhere(path: string): Promise<boolean> {
	await ensureProbed();
	if (!maybeMirror(path)) return false;
	// Первый вызов снимает локальную копию, если она есть; второй — запись в каталоге.
	// Разрешение на облако передаём сразу: спрашивать в раннере некого.
	const first = await deleteInCloud(path, true);
	if (first === 'localCopy') await deleteInCloud(path, true);
	return true;
}

/**
 * Лежит ли путь в зеркале. Нужно интерфейсу, чтобы одинаковое меню вело себя
 * по-разному: у онлайн-проекта переименование делается на сайте, а не на диске.
 *
 * Дешёво: после первого `storageStatus` ответ считается локально.
 */
export async function isInMirror(p: string): Promise<boolean> {
	await ensureProbed();
	return maybeMirror(p);
}

/**
 * Переименовать в облаке И на диске. `false` — путь не в зеркале, переименовывай сам.
 *
 * Переименовать только на диске нельзя: логическое имя живёт в каталоге бэкенда, и
 * после локального переименования путь перестаёт разбираться — колонка молча читает
 * диск, значки синхронизации исчезают, а в облаке файл остаётся под прежним именем.
 *
 * Бросает с понятным текстом на уровнях выше проекта (владелец, сам проект): их
 * имена меняются на сайте.
 */
export async function renameInCloud(path: string, newName: string): Promise<boolean> {
	await ensureProbed();
	if (!maybeMirror(path)) return false;
	const r = await commands.storageRename(path, newName);
	if (r.status !== 'ok') throw new Error(String(r.error));
	return r.data !== null;
}

/**
 * Перенести внутри облака: тот же `/rename`, только меняется папка. `false` — путь
 * не наш (или приёмник вне зеркала), переноси как обычно.
 *
 * Байты при этом не двигаются вообще: логический путь живёт в каталоге, а `s3Key` от
 * папки не зависит. Перенос папки с сотнями гигабайт стоит один SQL-запрос.
 *
 * Перенос **между проектами** бэкенд не умеет — вернётся ошибка с объяснением.
 */
export async function moveInCloud(path: string, destDir: string): Promise<boolean> {
	await ensureProbed();
	if (!maybeMirror(path) || !maybeMirror(destDir)) return false;
	const r = await commands.storageMove(path, destDir);
	if (r.status !== 'ok') throw new Error(String(r.error));
	return r.data !== null;
}

/**
 * Переименовать ПРОЕКТ: имя в каталоге, папка зеркала следом. `false` — не наш путь.
 *
 * Пункт меню обычный, а не серый: для человека проект — такая же папка, и «сходи на
 * сайт» ломает работу. Эндпоинта под machine token у бэкенда пока нет — тогда прилетит
 * его ошибка, а на диске ничего не изменится (порядок «сначала каталог»).
 */
export async function renameProjectInCloud(path: string, newName: string): Promise<boolean> {
	await ensureProbed();
	if (!maybeMirror(path)) return false;
	const r = await commands.storageRenameProject(path, newName);
	if (r.status !== 'ok') throw new Error(String(r.error));
	return r.data !== null;
}

/**
 * Включить/выключить проект в каталоге. `false` — путь не проект зеркала.
 *
 * Направление «программа → сайт». Обратное идёт само: `is_paused` приезжает в каждом
 * `/projects` и снимает галочку (это работает уже сегодня).
 *
 * Эндпоинта под machine token у бэкенда пока нет — прилетит его ошибка. Новых полей
 * в БД при этом не нужно: колонка `is_paused` есть и её пишет сайт.
 */
export async function setProjectPaused(path: string, paused: boolean): Promise<boolean> {
	await ensureProbed();
	if (!maybeMirror(path)) return false;
	const r = await commands.storageSetProjectPaused(path, paused);
	if (r.status !== 'ok') throw new Error(String(r.error));
	return r.data !== null;
}

export interface SeamPathInfo {
	inMirror: boolean;
	exists: boolean;
	local: boolean;
	isFolder: boolean;
	size: number | null;
	mtime: number | null;
	fileId: string | null;
}

/** Сведения о пути БЕЗ скачивания. `null` — путь не наш, спрашивай диск. */
export async function pathInfo(p: string): Promise<SeamPathInfo | null> {
	await ensureProbed();
	if (!maybeMirror(p)) return null;
	try {
		const r = await commands.storagePathInfo(p);
		return r.status === 'ok' && r.data.inMirror ? r.data : null;
	} catch {
		return null;
	}
}

/**
 * Существует ли путь — с учётом облака.
 *
 * Для облачного файла возвращает `true`, даже если он не скачан: он существует,
 * просто пока не здесь. Иначе проверки вида «нет файла — пропускаем» молча
 * выбрасывали бы из обработки всё облачное.
 */
export async function pathExists(p: string): Promise<boolean> {
	const info = await pathInfo(p);
	if (info) return info.exists;
	const r = await commands.pathExists(p);
	return r.status === 'ok' ? Boolean(r.data) : false;
}
