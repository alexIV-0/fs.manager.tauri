import { create } from 'zustand';
import { commands } from '@/Utils/specta';
import { resetStorageSeam } from '@/Utils/storageSeam';
import { useColumnView_Store } from '@/Store/MainWin/useColumnView_store';
import type {
	ConnectionConfig,
	FolderBadge,
	RemoteClient,
	RemoteProject,
	StorageDirEntry,
	StorageStatus,
} from '@/bindings';

/** Пустой статус — до первой попытки подключения. */
const OFFLINE: StorageStatus = {
	configured: false,
	connected: false,
	mock: false,
	baseUrl: '',
	mirrorRoot: '',
	caps: {
		apiVersion: 1,
		multipart: false,
		rename: false,
		copy: false,
		sharing: false,
		clients: false,
		originMtime: false,
		contentHash: false,
	},
	lastError: null,
	watching: false,
	pendingUploads: 0,
};

/** Где мы сейчас в онлайн-иерархии: клиент → проект → папка. */
export interface StorageNav {
	clientId: string | null;
	projectId: string | null;
	/** Логический путь внутри проекта. `''` — корень. */
	folderPath: string;
}

interface StorageStore {
	status: StorageStatus;
	/** `nav.clientId !== null` означает, что колонки 2–3 показывают облако, а не диск. */
	nav: StorageNav;
	setClient: (clientId: string | null) => void;
	setProject: (projectId: string | null) => void;
	setFolderPath: (folderPath: string) => void;
	config: ConnectionConfig | null;

	clients: RemoteClient[];
	projects: RemoteProject[];

	/** Кэш листингов: ключ `projectId\0folderPath`. */
	dirs: Record<string, StorageDirEntry[]>;
	/** Какие папки сейчас грузятся — чтобы не дёргать одно и то же дважды. */
	loading: Record<string, boolean>;

	busy: boolean;
	error: string | null;

	/** Восстановить подключение при запуске: тем же способом, что и в прошлый раз. */
	autoConnect: () => Promise<void>;
	connect: () => Promise<void>;
	connectMock: () => Promise<void>;
	/** Отключить хранилище — и живое, и демо. */
	disconnect: () => Promise<void>;
	refreshStatus: () => Promise<void>;
	refreshProjects: () => Promise<void>;
	/** Догнать проект и перечитать открытую папку. */
	catchUp: (projectId: string) => Promise<void>;
	listDir: (projectId: string, folderPath: string, force?: boolean) => Promise<StorageDirEntry[]>;
	folderBadge: (projectId: string, folderPath: string) => Promise<FolderBadge | null>;
	setPinned: (fileId: string, pinned: boolean) => Promise<void>;
	/** Скачать файл по требованию. Вне зеркала — no-op на стороне Rust. */
	ensureLocal: (path: string) => Promise<string>;
	/** Скачать по `fileId` — путь в зеркале клиент строит сам. */
	download: (fileId: string) => Promise<void>;
}

/**
 * Ключ кэша листингов. Разделитель — `\0`: в имени папки такого байта быть не
 * может, а пробел может, и `('p1 a', 'b')` совпал бы с `('p1', 'a b')`.
 *
 * Экспортируется намеренно: пока колонка строила ключ своим шаблоном, она
 * склеивала через пробел и не находила НИЧЕГО — содержимое проекта не
 * показывалось вообще. Один ключ = одна функция.
 */
export const dirKey = (projectId: string, folderPath: string) => `${projectId}\0${folderPath}`;

/** Result<T, string> из specta → T, ошибка кладётся в стор, а не роняет UI. */
function take<T>(r: { status: 'ok'; data: T } | { status: 'error'; error: string }): T {
	if (r.status === 'error') throw new Error(r.error);
	return r.data;
}

/**
 * Перечитать открытые панели после подключения.
 *
 * Колонки могли успеть прочитать зеркало с диска, пока хранилище ещё не было
 * поднято: тогда в списке нет облачных файлов и нет значков. Сам по себе этот
 * пересчёт не случится — от подключения колонки не зависят.
 */
async function reopenColumns(): Promise<void> {
	const { instances, openRoot } = useColumnView_Store.getState();
	for (const type of ['gd', 'local'] as const) {
		const root = instances[type].columns[0]?.path;
		if (root) await openRoot(type, root);
	}
}

/** Текст для человека. `String(e)` дал бы «Error: нет связи…» — префикс лишний. */
function msg(e: unknown): string {
	return e instanceof Error ? e.message : String(e);
}

export const storage_store = create<StorageStore>()((set, get) => ({
	status: OFFLINE,
	nav: { clientId: null, projectId: null, folderPath: '' },
	config: null,
	clients: [],
	projects: [],
	dirs: {},
	loading: {},
	busy: false,
	error: null,

	setClient: (clientId) =>
		// Смена клиента сбрасывает проект и путь: иначе на экране останется
		// содержимое чужого проекта под новым заголовком.
		set({ nav: { clientId, projectId: null, folderPath: '' } }),

	setProject: (projectId) =>
		set((s) => ({ nav: { ...s.nav, projectId, folderPath: '' } })),

	setFolderPath: (folderPath) => set((s) => ({ nav: { ...s.nav, folderPath } })),

	autoConnect: async () => {
		// Демо живёт в памяти процесса, живое подключение — в настройках. И то и
		// другое после перезапуска надо поднять заново, иначе облачная папка молча
		// становится обычной локальной: ни значков, ни синхронизации.
		try {
			const cfg = take(await commands.storageGetConfig());
			if (cfg.demo) {
				await get().connectMock();
			} else if (cfg.baseUrl.trim() && cfg.token.trim()) {
				await get().connect();
			}
		} catch (e) {
			// Нет сети или бэкенд лежит — работаем локально, как и раньше.
			set({ error: msg(e) });
		}
	},

	connect: async () => {
		set({ busy: true, error: null });
		try {
			const status = take(await commands.storageConnect());
			// Ядро кэширует «есть ли зеркало» ради скорости сканирования — после
			// подключения кэш обязан протухнуть, иначе шов останется выключенным.
			resetStorageSeam();
			set({ status });
			if (status.connected) {
				await get().refreshProjects();
				await reopenColumns();
			}
		} catch (e) {
			set({ error: msg(e) });
		} finally {
			set({ busy: false });
		}
	},

	connectMock: async () => {
		set({ busy: true, error: null });
		try {
			const status = take(await commands.storageConnectMock());
			resetStorageSeam();
			set({ status });
			await get().refreshProjects();
			await reopenColumns();
		} catch (e) {
			set({ error: msg(e) });
		} finally {
			set({ busy: false });
		}
	},

	disconnect: async () => {
		set({ busy: true, error: null });
		try {
			const status = take(await commands.storageDisconnect());
			resetStorageSeam();
			// Клиентов и проектов больше нет: список из отключённого хранилища —
			// то же вранье, что и содержимое папки от прошлой сессии.
			set({ status, clients: [], projects: [], dirs: {}, nav: { clientId: null, projectId: null, folderPath: '' } });
			await reopenColumns();
		} catch (e) {
			set({ error: msg(e) });
		} finally {
			set({ busy: false });
		}
	},

	refreshStatus: async () => {
		try {
			set({ status: take(await commands.storageStatus()) });
		} catch (e) {
			set({ error: msg(e) });
		}
	},

	refreshProjects: async () => {
		try {
			const resp = take(await commands.storageRefreshProjects());
			set({ clients: resp.clients, projects: resp.projects, error: null });
		} catch (e) {
			// Сеть могла отвалиться — показываем то, что уже есть в локальном индексе.
			set({ error: msg(e) });
			try {
				set({
					clients: take(await commands.storageClients()),
					projects: take(await commands.storageProjects(null)),
				});
			} catch {
				/* индекс пуст — показывать нечего */
			}
		}
	},

	catchUp: async (projectId) => {
		set({ busy: true });
		try {
			take(await commands.storageCatchUp(projectId));
			// Сбрасываем кэш листингов этого проекта: дельта могла поменять что угодно.
			const dirs = { ...get().dirs };
			for (const k of Object.keys(dirs)) {
				if (k.startsWith(`${projectId}\0`)) delete dirs[k];
			}
			set({ dirs, error: null });
		} catch (e) {
			set({ error: msg(e) });
		} finally {
			set({ busy: false });
		}
	},

	listDir: async (projectId, folderPath, force = false) => {
		const key = dirKey(projectId, folderPath);
		const cached = get().dirs[key];
		if (cached && !force) return cached;
		if (get().loading[key]) return cached ?? [];

		set((s) => ({ loading: { ...s.loading, [key]: true } }));
		try {
			const entries = take(await commands.storageListDir(projectId, folderPath));
			set((s) => ({ dirs: { ...s.dirs, [key]: entries } }));
			return entries;
		} catch (e) {
			set({ error: msg(e) });
			return [];
		} finally {
			set((s) => {
				const loading = { ...s.loading };
				delete loading[key];
				return { loading };
			});
		}
	},

	folderBadge: async (projectId, folderPath) => {
		try {
			return take(await commands.storageFolderBadge(projectId, folderPath));
		} catch {
			return null;
		}
	},

	setPinned: async (fileId, pinned) => {
		try {
			take(await commands.storageSetPinned(fileId, pinned));
			// Значок меняется локально — перечитывать всю папку незачем.
			set((s) => {
				const dirs = { ...s.dirs };
				for (const [k, list] of Object.entries(dirs)) {
					const i = list.findIndex((e) => e.fileId === fileId);
					if (i >= 0) {
						const copy = [...list];
						copy[i] = { ...copy[i], pinned };
						dirs[k] = copy;
					}
				}
				return { dirs };
			});
		} catch (e) {
			set({ error: msg(e) });
		}
	},

	ensureLocal: async (path) => {
		const r = take(await commands.storageEnsureLocal(path));
		return r.path;
	},

	download: async (fileId) => {
		const { nav } = get();
		try {
			// Пока идёт передача, перечитываем папку раз в 400 мс: значок должен
			// показывать проценты, а не замирать до конца скачивания.
			const tick = setInterval(() => {
				if (nav.projectId) void get().listDir(nav.projectId, nav.folderPath, true);
			}, 400);
			try {
				take(await commands.storageDownload(fileId));
			} finally {
				clearInterval(tick);
			}
			if (nav.projectId) await get().listDir(nav.projectId, nav.folderPath, true);
		} catch (e) {
			set({ error: msg(e) });
			if (nav.projectId) await get().listDir(nav.projectId, nav.folderPath, true);
		}
	},
}));

/** Проекты одного клиента (или все, если клиент не выбран). */
export function projectsOfClient(projects: RemoteProject[], clientId: string | null) {
	if (!clientId) return projects;
	return projects.filter((p) => p.clientId === clientId);
}
