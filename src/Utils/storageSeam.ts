// Шов облачного хранилища для ЯДРА программы.
//
// Плагины получают шов через `_template/tauri.ts`, но `src/PROCESSING` зовёт
// `commands.*` напрямую — здесь его аналог.
//
// ── Три вида шва, путать нельзя ──────────────────────────────────────────────
//   • нужны БАЙТЫ            → `ensureLocal` (ждём скачивания);
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

import { commands } from '@/Utils/specta';

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
