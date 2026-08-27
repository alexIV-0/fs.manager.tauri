// ── settingsSync_store ───────────────────────────────────────────────────────
// Синхронизация общих словарей (типы файлов / нод / данных, маски путей) с
// сайтом. План — `ideasAndTest/SETTINGS_SYNC_PLAN.md`.
//
// Что тут есть, а что нет:
//   • правила слияния и нормализации — в чистом `src/Utils/settingsSync.ts`;
//   • транспорт — Rust (`storage_settings_get/put`): адрес и токен живут там и в
//     renderer не отдаются;
//   • здесь только порядок действий и состояние для интерфейса.
//
// ── Три состояния связи, а не два (план §2)
// «не подключен» ≠ «нет сети». Первое — НАСТРОЙКА (хранилище не заведено), и
// тогда программа не делает ни одного запроса и ведёт себя как раньше. Второе —
// временная недоступность: правки копятся локально, и при возврате связи мы
// СНАЧАЛА отдаём своё, потом принимаем чужое. Если эти состояния не различать и
// на любом восстановлении тянуть с сервера, правки, сделанные пока лежала сеть,
// затрутся молча.
//
// ── Почему «локальных правок N» считается, а не хранится флагом
// Дирти — это расхождение локального стора с БАЗОЙ (снимком последнего успешного
// обмена). Считать его на чтении дешевле и надёжнее, чем поднимать флаг в каждом
// сеттере: сеттеров десяток, и забытый флаг выглядел бы как «правок нет».

import { create } from 'zustand';
import { commands, unwrap } from '@/Utils/specta';
import {
	SYNC_DOMAINS,
	diffCount,
	fromServerEntry,
	mergeDocument,
	toRemoteDomain,
	toStoreElements,
	type RemoteDomains,
	type RemoteEntry,
	type SettingsDoc,
	type SyncDomain,
} from '@/Utils/settingsSync';
import { pathPattern_store, typeOfNodes_store, typeOfdata_store, typeOfFile_store, type PatternElement } from './pathPattern_store';

/** Домен → стор. Единственное место, где эта связь записана. */
const DOMAIN_STORES: Record<SyncDomain, { getState: () => { patternStore: PatternElement[]; applyRemote: (els: PatternElement[]) => void } }> = {
	fileType: typeOfFile_store,
	nodeType: typeOfNodes_store,
	dataType: typeOfdata_store,
	pathPattern: pathPattern_store,
};

/** Сколько раз пытаться при конфликте ревизий, прежде чем сдаться до следующего раза. */
const CONFLICT_RETRIES = 2;

interface SettingsSyncState {
	/** Хранилище настроено (адрес + токен). Пока нет — синхронизации не существует. */
	configured: boolean;
	/** Ревизия сервера после последнего успешного обмена. */
	revision: number | null;
	/** Сколько записей расходится с базой. */
	dirty: number;
	busy: boolean;
	/** Последняя ошибка обмена. Сетевую от «не настроено» отличаем состоянием выше. */
	lastError: string | null;
	lastSyncAt: number | null;

	setConfigured: (v: boolean) => void;
	refreshDirty: () => Promise<void>;
	/** Полный цикл: прочитать сервер → слить → применить → отдать своё. */
	sync: () => Promise<void>;
}

const readLocal = (): RemoteDomains => {
	const out: RemoteDomains = {};
	for (const domain of SYNC_DOMAINS) {
		out[domain] = toRemoteDomain(domain, DOMAIN_STORES[domain].getState().patternStore);
	}
	return out;
};

const normalizeServerDoc = (raw: any): SettingsDoc => {
	const domains: RemoteDomains = {};
	for (const domain of SYNC_DOMAINS) {
		const list = raw?.domains?.[domain];
		if (Array.isArray(list)) domains[domain] = list.map((e: any) => fromServerEntry(domain, e));
	}
	return { revision: Number(raw?.revision ?? 0), domains };
};

const readBase = async (): Promise<SettingsDoc | null> => {
	try {
		const raw = unwrap(await commands.settingsSyncBaseGet());
		if (!raw || typeof raw !== 'object') return null;
		return normalizeServerDoc(raw);
	} catch (e) {
		console.warn('[settingsSync] база не прочиталась:', e);
		return null;
	}
};

const writeBase = async (doc: SettingsDoc): Promise<void> => {
	try {
		await commands.settingsSyncBaseSet(doc as any);
	} catch (e) {
		console.warn('[settingsSync] база не записалась:', e);
	}
};

export const settingsSync_store = create<SettingsSyncState>()((set, get) => ({
	configured: false,
	revision: null,
	dirty: 0,
	busy: false,
	lastError: null,
	lastSyncAt: null,

	setConfigured: (v) => set({ configured: v }),

	refreshDirty: async () => {
		const base = await readBase();
		const local = readLocal();
		let dirty = 0;
		for (const domain of SYNC_DOMAINS) {
			dirty += diffCount(base?.domains?.[domain] ?? null, local[domain] ?? []);
		}
		set({ dirty, revision: base ? base.revision : get().revision });
	},

	sync: async () => {
		if (get().busy) return;
		set({ busy: true, lastError: null });

		try {
			const base = await readBase();
			let remote = normalizeServerDoc(unwrap(await commands.storageSettingsGet(null)));

			for (let attempt = 0; attempt <= CONFLICT_RETRIES; attempt += 1) {
				const local = readLocal();
				const { domains, notes, changedVsRemote } = mergeDocument(base, local, remote);
				for (const note of notes) console.info('[settingsSync]', note);

				// Применяем слияние локально ДО записи наверх: если сеть отвалится на
				// PUT, у человека уже будет согласованное состояние, а не половина.
				for (const domain of SYNC_DOMAINS) {
					const merged = domains[domain];
					if (!merged) continue;
					const store = DOMAIN_STORES[domain].getState();
					store.applyRemote(toStoreElements(domain, merged, store.patternStore));
				}

				if (!changedVsRemote) {
					// Локально ничего нового — сервер и есть истина, он же становится базой.
					await writeBase(remote);
					set({ revision: remote.revision, dirty: 0, lastSyncAt: Date.now() });
					return;
				}

				const result = unwrap(await commands.storageSettingsPut(remote.revision, domains as any));
				const document = normalizeServerDoc(result.document);

				if (!result.conflict) {
					await writeBase(document);
					set({ revision: document.revision, dirty: 0, lastSyncAt: Date.now() });
					return;
				}

				// 409: между чтением и записью кто-то записал. Сливаем ещё раз, но уже
				// с его свежим документом; база остаётся прежней — она про ПРОШЛЫЙ
				// успешный обмен, а не про попытку.
				console.info('[settingsSync] ревизия уехала, сливаем ещё раз:', remote.revision, '→', document.revision);
				remote = document;
			}

			set({ lastError: 'Не удалось записать словари: ревизия меняется быстрее, чем мы сливаем' });
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			set({ lastError: message });
			console.warn('[settingsSync] обмен не удался:', message);
			// Расхождение с базой пересчитываем: правки остались локальными.
			await get().refreshDirty();
		} finally {
			set({ busy: false });
		}
	},
}));

/** Домены, которые НЕ синхронизируются, — для явной пометки в интерфейсе. */
export const LOCAL_ONLY_DOMAINS: { key: string; why: string }[] = [
	{ key: 'programPathPattern', why: 'пути к ffmpeg / After Effects — у каждой машины свои' },
	{ key: 'dopMaterialFolderPath', why: 'локальные папки доп-материалов' },
];

export type { RemoteEntry };
