/*
	folderState — sync-слой «папка = единый источник правды» для вкл/выкл проекта.

	Состояние (вкл/выкл + дата активности) теперь дублируется в файл
	`{project}/options/folderState.json`. Файл = SSOT (его читает/пишет и будущий сайт),
	LocalStorage = синхронный кэш горячего цикла и подстраховка, когда Google Drive ещё
	не примонтирован. См. план: ideasAndTest/FOLDER_STATE_SSOT_PLAN.md.

	Дизайн-инварианты:
	- LS-формат НЕ меняем (off-список по ключу mainFolderId + карта активности
	  `${id}::activity`). Этот модуль лишь добавляет write-through в файл поверх уже
	  сделанной LS-записи и умеет гидрировать LS из файлов (подхват внешних правок).
	- Файл пишем ТОЛЬКО у «тронутых» проектов: при смене enabled (тогл/auto-off) — сразу,
	  при бампе активности — троттлингом ~1/сутки. Нетронутый проект файла не получает,
	  `options/` не плодится.
	- Слияние per-field: enabled — last-write-wins (файл выигрывает на гидрации),
	  lastActivityAt — max. updatedAt бампаем только на смене enabled (для чистого LWW),
	  бамп активности его не трогает.

	Зависимости однонаправленные: folderState → projectActivityLS (не наоборот), цикла нет.
*/

import { loadFromLocalStorage, saveToLocalStorage } from './loadSaveToLS';
import { commands, unwrap } from './specta';
import { joinPath } from './joinPath';
import { getActivityMap, getProjectActivity, setProjectActivity } from './projectActivityLS';
import { mainFolders_stor } from '@/Store/MainWin/mainFolders_store';
import { nanoid } from 'nanoid';

export const FOLDER_STATE_SCHEMA_VERSION = 1;

export type DisabledReason = 'manual' | 'auto' | null;

export interface FolderStateFile {
	schemaVersion: number;
	enabled: boolean;
	disabledReason: DisabledReason;
	disabledAt: string | null; // ISO UTC
	lastActivityAt: string | null; // ISO UTC
	updatedAt: string; // ISO UTC — база LWW по enabled
	updatedBy: string; // "app:<clientId>" | "site"
}

const OFF_LIST_EVENT = 'folders-off-list-changed';
const CLIENT_ID_KEY = 'folderState.clientId';

// Троттлинг файловой записи активности: помним день последней записи на проект.
// Только в памяти — при рестарте максимум одна лишняя запись, это ок.
const persistedDay = new Map<string, string>();

const nowIso = () => new Date().toISOString();
const dayOf = (iso: string) => iso.slice(0, 10);
const dayKey = (id: string, name: string) => `${id}::${name}`;

// Стабильный per-install идентификатор для updatedBy (для будущего конфликт-резолва/аудита).
function getClientId(): string {
	let id = loadFromLocalStorage(CLIENT_ID_KEY);
	if (typeof id !== 'string' || !id) {
		id = nanoid(8);
		saveToLocalStorage(CLIENT_ID_KEY, id);
	}
	return id;
}

function mainFolderPathById(id: string): string | null {
	return mainFolders_stor.getState().mainFolderArr.find((f) => f.id === id)?.path ?? null;
}

function stateFilePath(mainFolderPath: string, projectName: string): string {
	return joinPath(mainFolderPath, projectName, 'options', 'folderState.json');
}

// ── off-список (LS-кэш) ─────────────────────────────────────────────────────
const getOffList = (id: string): string[] => loadFromLocalStorage(id) || [];
const setOffList = (id: string, arr: string[]) => saveToLocalStorage(id, arr);
const notifyOffList = (id: string) =>
	window.dispatchEvent(new CustomEvent(OFF_LIST_EVENT, { detail: { key: id } }));

// Поздняя ISO из двух (строковое сравнение корректно для одинакового ISO-UTC формата).
function maxIso(a: string | null | undefined, b: string | null | undefined): string | null {
	if (!a) return b ?? null;
	if (!b) return a ?? null;
	return a >= b ? a : b;
}

// Read-modify-write одного файла: сохраняем поля, которых нет в LS (reason/disabledAt),
// и поля, писанные сайтом. Отсутствие файла = создаём с нуля.
async function writeStateFile(
	mainFolderPath: string,
	projectName: string,
	patch: Partial<FolderStateFile>,
): Promise<void> {
	// Guard: не воскрешать папку. write_file делает create_dir_all на родителе, поэтому
	// stale-запись после удаления/переименования проекта пересоздала бы папку с options/.
	// Пишем только если проектная папка реально существует на диске.
	const projectDir = joinPath(mainFolderPath, projectName);
	if (!unwrap(await commands.pathExists(projectDir))) return;

	const filePath = stateFilePath(mainFolderPath, projectName);
	let cur: Partial<FolderStateFile> = {};
	try {
		const raw = unwrap(await commands.readFileSync(filePath));
		const parsed = JSON.parse(raw);
		if (parsed && typeof parsed === 'object') cur = parsed;
	} catch {
		/* файла нет или он битый — создаём заново */
	}

	const next: FolderStateFile = {
		schemaVersion: FOLDER_STATE_SCHEMA_VERSION,
		enabled: patch.enabled ?? cur.enabled ?? true,
		disabledReason:
			patch.disabledReason !== undefined ? patch.disabledReason : cur.disabledReason ?? null,
		disabledAt: patch.disabledAt !== undefined ? patch.disabledAt : cur.disabledAt ?? null,
		// max-merge: бамп активности не может ОТКАТИТЬ дату (защита от отстающих часов).
		lastActivityAt:
			patch.lastActivityAt !== undefined
				? maxIso(cur.lastActivityAt, patch.lastActivityAt)
				: cur.lastActivityAt ?? null,
		// updatedAt/By бампаем только когда патч их прислал (= смена enabled). Иначе сохраняем.
		updatedAt: patch.updatedAt ?? cur.updatedAt ?? nowIso(),
		updatedBy: patch.updatedBy ?? cur.updatedBy ?? `app:${getClientId()}`,
	};

	unwrap(await commands.writeFileAtomic(filePath, JSON.stringify(next, null, 2)));
}

// ── Публичный API ───────────────────────────────────────────────────────────

/**
 * Записать вкл/выкл проекта в файл (LS off-список уже обновил вызывающий).
 * Fire-and-forget: UI не ждёт диск. Бампает updatedAt (LWW по enabled).
 */
export function persistEnabled(
	mainFolderId: string,
	projectName: string,
	enabled: boolean,
	reason: DisabledReason,
): void {
	const mfPath = mainFolderPathById(mainFolderId);
	if (!mfPath) return;
	writeStateFile(mfPath, projectName, {
		enabled,
		disabledReason: enabled ? null : reason,
		disabledAt: enabled ? null : nowIso(),
		updatedAt: nowIso(),
		updatedBy: `app:${getClientId()}`,
	}).catch((e) => console.warn('[folderState] persistEnabled:', projectName, e));
}

/**
 * Бамп реальной активности (обработка нашла файлы). Пишет LS всегда,
 * файл — троттлингом ~1/сутки. НЕ бампает updatedAt (чтобы не мешать LWW по enabled).
 * Используется только на «горячем» бампе; засев/бэкдейт активности идут через
 * setProjectActivity (LS-only, без файла — не плодим состояние у нетронутых).
 */
export function recordActivity(mainFolderId: string, projectName: string, ts: number): void {
	setProjectActivity(mainFolderId, projectName, ts);
	const mfPath = mainFolderPathById(mainFolderId);
	if (!mfPath) return;
	const iso = new Date(ts).toISOString();
	const key = dayKey(mainFolderId, projectName);
	if (persistedDay.get(key) === dayOf(iso)) return; // уже писали сегодня
	persistedDay.set(key, dayOf(iso));
	writeStateFile(mfPath, projectName, { lastActivityAt: iso }).catch((e) =>
		console.warn('[folderState] recordActivity:', projectName, e),
	);
}

/**
 * Гидрация: читает `options/folderState.json` по всем проектам главной папки одним IPC,
 * мёржит в LS-кэш (enabled — файл выигрывает; lastActivityAt — max) и делает ленивую
 * миграцию (у проекта в legacy off-списке, но без файла, создаёт файл enabled:false).
 * Зовётся из reloadFolders на КАЖДОМ проходе/reload → подхватывает внешние правки.
 */
export async function hydrateMainFolder(
	mainFolderId: string,
	mainFolderPath: string,
	projectNames: string[],
	opts: { catalogWins?: boolean } = {},
): Promise<Record<string, boolean>> {
	let states: Record<string, FolderStateFile> = {};
	try {
		states = unwrap(await commands.readFolderStates(mainFolderPath)) as unknown as Record<
			string,
			FolderStateFile
		>;
	} catch (e) {
		// Диск недоступен (GD ещё не примонтирован и т.п.) — оставляем LS-кэш как есть.
		console.warn('[folderState] hydrate read failed:', mainFolderPath, e);
		return {};
	}

	// Что лежит в файлах — отдаём наружу. Вызывающий сравнивает с каталогом и
	// дописывает разошедшиеся файлы; иначе пришлось бы читать их второй раз.
	const вФайлах: Record<string, boolean> = {};

	const off = new Set(getOffList(mainFolderId));
	let offChanged = false;
	const clientId = getClientId();

	for (const name of projectNames) {
		const st = states[name];
		if (st && typeof st.enabled === 'boolean') {
			вФайлах[name] = st.enabled;
			// У ОБЛАЧНОГО проекта вкл/выкл живёт в каталоге (`projects.is_paused`) — его
			// пишет сайт, и он приезжает в каждом `/projects`. Файл для таких проектов
			// кэш, а не источник: дать ему «победить» здесь значило бы вернуть снятую на
			// сайте галочку обратно. Активность (`lastActivityAt`) мёржим по-прежнему —
			// её в каталоге нет вовсе.
			if (opts.catalogWins) {
				// enabled не трогаем; ниже — только активность.
			} else if (st.enabled && off.has(name)) {
				off.delete(name);
				offChanged = true;
			} else if (!st.enabled && !off.has(name)) {
				off.add(name);
				offChanged = true;
			}
			// Активность: max-merge в LS.
			if (st.lastActivityAt) {
				const ms = Date.parse(st.lastActivityAt);
				if (!Number.isNaN(ms)) {
					const cur = getProjectActivity(mainFolderId, name);
					if (cur === undefined || ms > cur) setProjectActivity(mainFolderId, name, ms);
				}
				persistedDay.set(dayKey(mainFolderId, name), dayOf(st.lastActivityAt));
			}
		} else if (off.has(name)) {
			// Файла нет, но проект выключен в legacy LS → одноразовая миграция.
			// manual vs auto из legacy не различить → sticky-manual (поведение идентично).
			writeStateFile(mainFolderPath, name, {
				enabled: false,
				disabledReason: 'manual',
				disabledAt: nowIso(),
				updatedAt: nowIso(),
				updatedBy: `app:${clientId}`,
			}).catch((e) => console.warn('[folderState] migrate:', name, e));
		}
		// Включённый проект без файла — ничего не пишем (таймер пере-засеется «сейчас»).
	}

	if (offChanged) {
		setOffList(mainFolderId, Array.from(off));
		notifyOffList(mainFolderId);
	}

	return вФайлах;
}
