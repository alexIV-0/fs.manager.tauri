// plugin_store.ts
import { create } from 'zustand';
import { loadFromLocalStorage, saveToLocalStorage } from '@/Utils/loadSaveToLS';
import { PluginInfo, PluginUINode } from '@/types/global';

import {
	restorePluginFromInactiveInAllStores,
	movePluginToInactiveInAllStores,
	addPluginToPatternByColor,
	pluginEvents,
} from './pathPattern_store';

export interface PluginItem {
	// Основная информация (из PluginInfo)
	id: string;
	name: string;
	version: string;
	description: string;
	type: string[];
	path: string;
	hasUI?: boolean;
	uiType?: string | null;

	// Состояние плагина
	enabled: boolean;
	exists: boolean;
	uiData?: PluginUINode[];

	// Стоимость
	cost?: string;
	costUnit?: string;

	// Мета-информация
	lastSeen?: string;
}

// Интерфейс для хранения в localStorage
interface PluginsStorage {
	states: Record<
		string,
		{
			enabled: boolean;
			exists: boolean;
			type?: string[]; // Тип плагина для проверки nodeui
			name?: string; // Имя для красивых логов
		}
	>;
	order: string[];
}

const STORAGE_KEY = 'plugins-data';

// Загрузка данных из localStorage с миграцией
const loadPluginsData = (): PluginsStorage => {
	try {
		const data = loadFromLocalStorage(STORAGE_KEY);
		if (data && typeof data === 'object' && 'states' in data && 'order' in data) {
			// Миграция старых данных
			const states = data.states as Record<
				string,
				{
					enabled: boolean;
					exists?: boolean;
					type?: string[];
					name?: string;
				}
			>;

			Object.keys(states).forEach((key) => {
				// Миграция exists
				if (states[key].exists === undefined) {
					states[key].exists = true;
				}
				// type и name появятся при следующем updatePlugins
			});

			return data as PluginsStorage;
		}
		return { states: {}, order: [] };
	} catch {
		return { states: {}, order: [] };
	}
};

// Сохранение данных в localStorage
const savePluginsData = (data: PluginsStorage) => {
	saveToLocalStorage(STORAGE_KEY, data);
};

// Глобальные переменные состояния
let pluginsStorage = loadPluginsData();
let pluginOrder = pluginsStorage.order;

export interface PluginListStore {
	// Состояние
	plugins: PluginItem[];
	uiNodes: PluginUINode[];
	searchQuery: string;
	isLoading: boolean;
	error: string | null;

	// ========================
	// ОСНОВНЫЕ ОПЕРАЦИИ
	// ========================

	updatePlugins: (pluginsFromMain: PluginInfo[]) => void;
	toggleEnabled: (id: string, version: string) => void;
	removePlugin: (id: string, version: string) => void;
	addOrUpdatePlugin: (plugin: PluginInfo) => void;

	// ========================
	// ОПЕРАЦИИ С ПОРЯДКОМ
	// ========================

	movePluginGroup: (fromIndex: number, toIndex: number) => void;
	getPluginGroups: () => { id: string; plugins: PluginItem[] }[];

	// ========================
	// UI ОПЕРАЦИИ
	// ========================

	setUINodes: (nodes: PluginUINode[]) => void;
	loadUINodes: () => Promise<PluginUINode[]>;
	addUINode: (node: PluginUINode) => void;
	removeUINodesByPlugin: (pluginId: string, version: string) => void;

	// ========================
	// ПОИСК И ФИЛЬТРАЦИЯ
	// ========================

	setSearchQuery: (query: string) => void;
	getFilteredGroups: () => { id: string; plugins: PluginItem[] }[];

	// ========================
	// GETTERS
	// ========================

	getPlugin: (id: string, version?: string) => PluginItem | null;
	getEnabledPlugins: () => PluginItem[];
	getDisabledPlugins: () => PluginItem[];
	getNonExistentPlugins: () => PluginItem[];

	// ========================
	// СОСТОЯНИЕ ЗАГРУЗКИ
	// ========================

	setLoading: (loading: boolean) => void;
	setError: (error: string | null) => void;
	setPluginCost: (id: string, version: string, cost: string, costUnit: string) => Promise<void>;
}

export const plugin_Store = create<PluginListStore>((set, get) => ({
	plugins: [],
	uiNodes: [],
	searchQuery: '',
	isLoading: false,
	error: null,

	// ========================
	// ОБНОВЛЕНИЕ ПЛАГИНОВ ИЗ MAIN
	// ========================

	updatePlugins: (pluginsFromMain) => {
		set((state) => {
			const existingPluginsMap = new Map(state.plugins.map((p) => [`${p.id}@${p.version}`, p]));

			const newPlugins: PluginItem[] = [];
			const processedKeys = new Set<string>();

			// 1. Обрабатываем плагины с диска
			pluginsFromMain.forEach((pluginInfo) => {
				const key = `${pluginInfo.id}@${pluginInfo.version}`;
				const existingPlugin = existingPluginsMap.get(key);
				const savedState = pluginsStorage.states[key];

				const enabled = savedState?.enabled ?? true;
				const exists = true;

				const pluginItem: PluginItem = {
					id: pluginInfo.id,
					name: pluginInfo.name,
					version: pluginInfo.version,
					description: pluginInfo.description || '',
					type: pluginInfo.type,
					path: pluginInfo.path,
					hasUI: pluginInfo.hasUI,
					enabled,
					exists,
					lastSeen: new Date().toISOString(),
					uiData: existingPlugin?.uiData,
					uiType: pluginInfo.uiType,
					cost: pluginInfo.cost ?? '0',
					costUnit: pluginInfo.costUnit ?? 'run',
				};

				newPlugins.push(pluginItem);
				processedKeys.add(key);

				// ✅ Сохраняем состояние с type и name
				pluginsStorage.states[key] = {
					enabled,
					exists,
					type: pluginInfo.type,
					name: pluginInfo.name,
				};

				// СОБЫТИЕ: плагин появился на диске
				if (savedState && savedState.exists === false) {
					const isNodeUI = pluginInfo.type.includes('nodeui');

					if (isNodeUI) {
						const pluginName = `${pluginInfo.name} (${pluginInfo.version})`;
						// console.log(`[Plugin Store] 🟢 Plugin restored on disk: ${pluginName}`);

						// Если плагин был enabled, восстанавливаем его
						if (savedState.enabled) {
							restorePluginFromInactiveInAllStores(pluginName);
						}
					}
				}
			});

			// 2. Добавляем плагины из localStorage, которых НЕТ на диске
			Object.keys(pluginsStorage.states).forEach((key) => {
				if (processedKeys.has(key)) {
					return;
				}

				const [id, version] = key.split('@');
				const savedState = pluginsStorage.states[key];

				if (!savedState) {
					return;
				}

				// Ищем в state (может быть undefined при первой загрузке)
				const existingPlugin = state.plugins.find((p) => p.id === id && p.version === version);

				// console.log(`[Plugin Store] ⚠️ Plugin missing on disk: ${key}`);

				const pluginItem: PluginItem = existingPlugin
					? {
							...existingPlugin,
							exists: false,
							enabled: savedState.enabled,
						}
					: {
							// Используем данные из savedState если есть
							id,
							name: savedState.name || id,
							version,
							description: 'Плагин отсутствует на диске',
							type: savedState.type || ['unknown'],
							path: '',
							hasUI: false,
							enabled: savedState.enabled,
							exists: false,
							lastSeen: undefined,
							uiData: undefined,
							uiType: null,
						};

				newPlugins.push(pluginItem);

				// Обновляем exists в localStorage
				pluginsStorage.states[key] = {
					enabled: savedState.enabled,
					exists: false,
					type: savedState.type,
					name: savedState.name,
				};

				// ПРОВЕРКА: нужно ли переносить в inactive
				const wasExistingBefore = savedState.exists !== false; // undefined или true
				const isNodeUIPlugin = savedState.type?.includes('nodeui') ?? false; // ✅ Из savedState!

				if (wasExistingBefore && isNodeUIPlugin) {
					const pluginName = savedState.name ? `${savedState.name} (${version})` : `${id} (${version})`;

					// console.log(`[Plugin Store] 🔴 Plugin went missing, moving to inactive: ${pluginName}`);

					// Переносим в inactive
					movePluginToInactiveInAllStores(pluginName);
				}
			});

			// 3. Обновляем порядок групп
			const pluginIds = [...new Set(newPlugins.map((p) => p.id))];

			pluginIds.forEach((id) => {
				if (!pluginOrder.includes(id)) {
					pluginOrder.push(id);
				}
			});

			pluginsStorage.order = pluginOrder;
			savePluginsData(pluginsStorage);

			const sortedPlugins = sortPluginsByGroups(newPlugins);

			// console.log(`[Plugin Store] ✅ Plugins updated:`, {
			// 	total: sortedPlugins.length,
			// 	onDisk: pluginsFromMain.length,
			// 	missing: sortedPlugins.filter((p) => !p.exists).length,
			// 	enabled: sortedPlugins.filter((p) => p.enabled).length,
			// });

			return { plugins: sortedPlugins };
		});
	},

	// ========================
	// ПЕРЕКЛЮЧЕНИЕ ENABLED
	// ========================

	// toggleEnabled
	toggleEnabled: (id, version) => {
		set((state) => {
			const key = `${id}@${version}`;

			const plugin = state.plugins.find((p) => p.id === id && p.version === version);
			const pluginName = plugin ? `${plugin.name} (${plugin.version})` : null;

			const newPlugins = state.plugins.map((p) => {
				if (p.id === id && p.version === version) {
					const newEnabled = !p.enabled;

					// ✅ Сохраняем enabled, exists, type, name
					pluginsStorage.states[key] = {
						enabled: newEnabled,
						exists: p.exists,
						type: p.type,
						name: p.name,
					};

					// Синхронизация с pathPattern только если плагин существует на диске
					if (pluginName && p.type.includes('nodeui') && p.exists) {
						if (newEnabled) {
							restorePluginFromInactiveInAllStores(pluginName);
						} else {
							movePluginToInactiveInAllStores(pluginName);
						}
					}

					return { ...p, enabled: newEnabled };
				}
				return p;
			});

			savePluginsData(pluginsStorage);
			return { plugins: newPlugins };
		});
	},

	// ========================
	// ДОБАВЛЕНИЕ/ОБНОВЛЕНИЕ
	// ========================

	addOrUpdatePlugin: (pluginInfo) => {
		set((state) => {
			const key = `${pluginInfo.id}@${pluginInfo.version}`;
			const existingIndex = state.plugins.findIndex((p) => p.id === pluginInfo.id && p.version === pluginInfo.version);

			const savedState = pluginsStorage.states[key];
			const enabled = savedState?.enabled ?? true;
			const exists = true;

			const isNewPlugin = existingIndex === -1;

			const pluginItem: PluginItem = {
				id: pluginInfo.id,
				name: pluginInfo.name,
				version: pluginInfo.version,
				description: pluginInfo.description || '',
				type: pluginInfo.type,
				path: pluginInfo.path,
				hasUI: pluginInfo.hasUI,
				enabled,
				exists,
				lastSeen: new Date().toISOString(),
				uiData: existingIndex >= 0 ? state.plugins[existingIndex].uiData : undefined,
				uiType: pluginInfo.uiType,
				cost: pluginInfo.cost ?? '0',
				costUnit: pluginInfo.costUnit ?? 'run',
			};

			let newPlugins;
			if (existingIndex >= 0) {
				newPlugins = [...state.plugins];
				newPlugins[existingIndex] = pluginItem;
			} else {
				newPlugins = [...state.plugins, pluginItem];

				if (!pluginOrder.includes(pluginInfo.id)) {
					pluginOrder.push(pluginInfo.id);
					pluginsStorage.order = pluginOrder;
				}
			}

			// ✅ Сохраняем состояние с type и name
			pluginsStorage.states[key] = {
				enabled,
				exists,
				type: pluginInfo.type,
				name: pluginInfo.name,
			};
			savePluginsData(pluginsStorage);

			// АВТОМАТИЧЕСКОЕ ДОБАВЛЕНИЕ В PATTERN STORE
			if (isNewPlugin && pluginInfo.type.includes('nodeui') && enabled) {
				const manifest = pluginInfo.manifest;
				if (manifest) {
					const ui = manifest.ui;
					if (ui && typeof ui === 'object') {
						const colorType = ui.data?.colorType;
						if (colorType) {
							const pluginName = `${pluginInfo.name} (${pluginInfo.version})`;
							addPluginToPatternByColor(colorType, pluginName);
						}
					}
				}
			}

			return { plugins: sortPluginsByGroups(newPlugins) };
		});
	},

	// ========================
	// УДАЛЕНИЕ ПЛАГИНА
	// ========================

	removePlugin: (id, version) => {
		set((state) => {
			const key = `${id}@${version}`;
			// console.log(`[Plugin Store] Удаление плагина: ${key}`);

			const plugin = state.plugins.find((p) => p.id === id && p.version === version);

			if (!plugin) {
				// console.warn(`[Plugin Store] Плагин не найден: ${key}`);
				return state;
			}

			// Всегда удаляем плагин полностью при явном действии пользователя
			const newPlugins = state.plugins.filter((p) => !(p.id === id && p.version === version));
			delete pluginsStorage.states[key];

			// Проверяем, остались ли другие версии
			const hasOtherVersions = newPlugins.some((p) => p.id === id);

			if (!hasOtherVersions) {
				pluginOrder = pluginOrder.filter((pluginId) => pluginId !== id);
				pluginsStorage.order = pluginOrder;
			}

			savePluginsData(pluginsStorage);

			const newUINodes = state.uiNodes.filter((node) => !(node.pluginId === id && node.pluginVersion === version));

			return {
				plugins: sortPluginsByGroups(newPlugins),
				uiNodes: newUINodes,
			};
		});
	},

	// ========================
	// ПЕРЕМЕЩЕНИЕ ГРУППЫ
	// ========================

	movePluginGroup: (fromIndex, toIndex) => {
		set((state) => {
			const groups = get().getFilteredGroups();

			if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= groups.length || toIndex >= groups.length) {
				return state;
			}

			const newOrder = [...pluginOrder];
			const [movedGroupId] = newOrder.splice(fromIndex, 1);
			newOrder.splice(toIndex, 0, movedGroupId);

			pluginOrder = newOrder;
			pluginsStorage.order = pluginOrder;
			savePluginsData(pluginsStorage);

			return { plugins: sortPluginsByGroups(state.plugins) };
		});
	},

	// ========================
	// ПОЛУЧЕНИЕ ГРУПП
	// ========================

	getPluginGroups: () => {
		const { plugins } = get();
		return groupPluginsById(sortPluginsByGroups(plugins));
	},

	getFilteredGroups: () => {
		const { plugins, searchQuery } = get();

		if (!searchQuery.trim()) {
			return groupPluginsById(sortPluginsByGroups(plugins));
		}

		const lowerQuery = searchQuery.toLowerCase();

		const filteredPlugins = plugins.filter(
			(p) =>
				p.name.toLowerCase().includes(lowerQuery) ||
				p.description?.toLowerCase().includes(lowerQuery) ||
				p.version.toLowerCase().includes(lowerQuery) ||
				p.id.toLowerCase().includes(lowerQuery) ||
				p.type.some((t) => t.toLowerCase().includes(lowerQuery)),
		);

		const groups = groupPluginsById(filteredPlugins);

		return groups.sort((a, b) => {
			const indexA = pluginOrder.indexOf(a.id);
			const indexB = pluginOrder.indexOf(b.id);
			if (indexA === -1) return 1;
			if (indexB === -1) return -1;
			return indexA - indexB;
		});
	},

	// ========================
	// GETTERS
	// ========================

	getPlugin: (id, version) => {
		const { plugins } = get();

		if (version) {
			return plugins.find((p) => p.id === id && p.version === version) || null;
		}

		const versions = plugins
			.filter((p) => p.id === id && p.enabled && p.exists)
			.sort((a, b) => b.version.localeCompare(a.version));

		return versions[0] || null;
	},

	getEnabledPlugins: () => {
		const { plugins } = get();
		return sortPluginsByGroups(plugins.filter((p) => p.enabled && p.exists));
	},

	getDisabledPlugins: () => {
		const { plugins } = get();
		return sortPluginsByGroups(plugins.filter((p) => !p.enabled && p.exists));
	},

	getNonExistentPlugins: () => {
		const { plugins } = get();
		return sortPluginsByGroups(plugins.filter((p) => !p.exists));
	},

	// ========================
	// UI МЕТОДЫ
	// ========================

	setUINodes: (nodes) => {
		set({ uiNodes: nodes });
	},

	loadUINodes: async () => {
		const { setLoading, setError, setUINodes } = get();

		setLoading(true);
		setError(null);

		try {
			// console.log('[PluginStore] Loading UI nodes...');
			const uiNodes = await window.tauriAPI.invoke<PluginUINode[]>('plugins:get-all-ui-nodes');
			// console.log(`[PluginStore] Loaded ${uiNodes.length} UI nodes`, uiNodes);
			setUINodes(uiNodes);
			return uiNodes;
		} catch (err) {
			// console.error('Ошибка загрузки UI нод:', err);
			setError('Failed to load UI nodes');
			throw err;
		} finally {
			setLoading(false);
		}
	},

	addUINode: (node) => {
		set((state) => ({
			uiNodes: [...state.uiNodes, node],
		}));
	},

	removeUINodesByPlugin: (pluginId, version) => {
		set((state) => ({
			uiNodes: state.uiNodes.filter((node) => !(node.pluginId === pluginId && node.pluginVersion === version)),
		}));
	},

	setSearchQuery: (query) => {
		set({ searchQuery: query });
	},

	setLoading: (loading) => {
		set({ isLoading: loading });
	},

	setError: (error) => {
		set({ error });
	},

	setPluginCost: async (id, version, cost, costUnit) => {
		// Оптимистично обновляем стор СРАЗУ — `<select>` в настройках controlled и берёт
		// значение из plugin.costUnit, поэтому без мгновенного апдейта он бы не сдвинулся
		// до ответа бэкенда. При ошибке записи откатываем.
		let prev: { cost?: string; costUnit?: string } | undefined;
		set((state) => ({
			plugins: state.plugins.map((p) => {
				if (p.id === id && p.version === version) {
					prev = { cost: p.cost, costUnit: p.costUnit };
					return { ...p, cost, costUnit };
				}
				return p;
			}),
		}));

		try {
			await window.tauriAPI.invoke('plugins:set-cost', id, version, cost, costUnit);
		} catch (err) {
			// Откат к предыдущему значению, если бэкенд отказал.
			if (prev) {
				set((state) => ({
					plugins: state.plugins.map((p) =>
						p.id === id && p.version === version ? { ...p, cost: prev!.cost, costUnit: prev!.costUnit } : p,
					),
				}));
			}
			throw err;
		}
	},
}));

// ========================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ========================

const groupPluginsById = (plugins: PluginItem[]): { id: string; plugins: PluginItem[] }[] => {
	const groups = new Map<string, PluginItem[]>();

	plugins.forEach((plugin) => {
		if (!groups.has(plugin.id)) {
			groups.set(plugin.id, []);
		}
		groups.get(plugin.id)!.push(plugin);
	});

	groups.forEach((groupPlugins) => {
		groupPlugins.sort((a, b) => b.version.localeCompare(a.version));
	});

	return Array.from(groups.entries()).map(([id, plugins]) => ({ id, plugins }));
};

const sortPluginsByGroups = (plugins: PluginItem[]): PluginItem[] => {
	const groups = groupPluginsById(plugins);

	const sortedGroups = groups.sort((a, b) => {
		const indexA = pluginOrder.indexOf(a.id);
		const indexB = pluginOrder.indexOf(b.id);

		if (indexA === -1 && indexB === -1) return 0;
		if (indexA === -1) return 1;
		if (indexB === -1) return -1;
		return indexA - indexB;
	});

	return sortedGroups.flatMap((group) => group.plugins);
};

// ========================
// ИНИЦИАЛИЗАЦИЯ
// ========================

export const initializePlugins = async () => {
	const { updatePlugins, loadUINodes, setLoading, setError } = plugin_Store.getState();

	setLoading(true);
	setError(null);

	try {
		const allPlugins = await window.tauriAPI.invoke<PluginInfo[]>('plugins:get-all-plugins');
		updatePlugins(allPlugins);

		await loadUINodes();
	} catch (err) {
		// console.error('Error initializing plugins:', err);
		setError('Failed to initialize plugins');
	} finally {
		setLoading(false);
	}
};
