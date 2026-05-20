import { loadFromLocalStorage, saveToLocalStorage } from '@/Utils/loadSaveToLS';
import { nanoid } from 'nanoid';
import { create } from 'zustand';
import { PatternDomain, patternDomainRegistry } from './pathPatternDomainRegistry';

// ========================
// EVENT EMITTER
// ========================
type EventCallback = (pluginName: string) => void;

class PluginEventEmitter {
	private listeners: { [key: string]: EventCallback[] } = {};

	on(event: string, callback: EventCallback) {
		if (!this.listeners[event]) {
			this.listeners[event] = [];
		}
		this.listeners[event].push(callback);
	}

	emit(event: string, pluginName: string) {
		if (this.listeners[event]) {
			this.listeners[event].forEach((callback) => callback(pluginName));
		}
	}

	off(event: string, callback: EventCallback) {
		if (this.listeners[event]) {
			this.listeners[event] = this.listeners[event].filter((cb) => cb !== callback);
		}
	}
}

export const pluginEvents = new PluginEventEmitter();

// ========================
// TYPES
// ========================
export type PatternElement = {
	id: string;
	name: string;
	path: string[];
	color?: string | null;
	inactivePath?: string[];
	/** Дефолтный элемент — пользователь не может его удалить или переименовать.
	 * Path и цвет редактировать можно. Помечается автоматически: см. createPathPatternStore
	 * (мёрджит локальные записи с defaults по `name`). */
	isDefault?: boolean;
};

export type PatternStore = {
	patternStore: PatternElement[];

	// Основные методы
	addPatternElement: (name: string, path: string[], color?: string | undefined) => void;
	updatePatternElementName: (id: string, name: string) => void;
	updatePatternElementPath: (id: string, path: string[]) => void;
	updatePatternElementColor: (id: string, color: string) => void;
	movePatternElement: (dragIndex: number, hoverIndex: number) => void;
	removePatternElement: (id: string) => void;
	restoreDefault: () => void;

	// Методы синхронизации с плагинами
	movePluginToInactive: (pluginName: string) => void;
	restorePluginFromInactive: (pluginName: string) => void;

	// Отписка от событий
	unsubscribe?: () => void;
};

// ========================
// STORE CREATOR
// ========================
export const createPathPatternStore = (storageKey: string, defaultTypes: PatternElement[] = [], domain?: PatternDomain) => {
	const store = create<PatternStore>()((set, get) => {
		// Загрузка из localStorage
		let initialState: PatternElement[] = [];
		try {
			initialState = loadFromLocalStorage(storageKey);
		} catch (e) {
			console.warn(`Failed to load ${storageKey} from localStorage:`, e);
		}

		const defaultNamesSet = new Set(defaultTypes.map((d) => d.name));

		// Инициализация с defaultTypes
		if (!initialState || initialState.length === 0) {
			initialState = defaultTypes.map((item) => ({
				...item,
				inactivePath: item.inactivePath || [],
				isDefault: true,
			}));
			try {
				saveToLocalStorage(storageKey, initialState);
			} catch (e) {
				console.warn(`Failed to save ${storageKey} to localStorage:`, e);
			}
		} else {
			// Merge defaults поверх localStorage:
			// 1) Поднять флаг isDefault на записях, которые есть в defaultTypes (по name).
			//    Нужно для миграции: раньше флага не было, и сейчас бы он не появился.
			// 2) Добавить недостающие из defaults в конец — для эволюции дефолтов
			//    (новые типы вроде 'ai' появляются у уже существующих пользователей).
			let mutated = false;
			initialState = initialState.map((it) => {
				if (defaultNamesSet.has(it.name) && !it.isDefault) {
					mutated = true;
					return { ...it, isDefault: true };
				}
				return it;
			});

			const existingNames = new Set(initialState.map((it) => it.name));
			const missing = defaultTypes.filter((d) => !existingNames.has(d.name));
			if (missing.length > 0) {
				initialState = [
					...initialState,
					...missing.map((item) => ({
						...item,
						inactivePath: item.inactivePath || [],
						isDefault: true,
					})),
				];
				mutated = true;
			}

			if (mutated) {
				try {
					saveToLocalStorage(storageKey, initialState);
				} catch {}
			}
		}

		// Создаем объект стора
		const storeObject = {
			patternStore: initialState,

			addPatternElement: (name: string, path: string[], color?: string | undefined) => {
				const newElement: PatternElement = {
					id: nanoid(5),
					name,
					path,
					color: color === undefined ? null : color,
					inactivePath: [],
				};
				set((state) => {
					const updatedElements = [...state.patternStore, newElement];
					saveToLocalStorage(storageKey, updatedElements);
					return { patternStore: updatedElements };
				});

				if (domain) {
					patternDomainRegistry[domain]?.onAdd?.(get());
				}
			},

			updatePatternElementName: (id: string, name: string) => {
				set((state) => {
					const updatedElements = state.patternStore.map((element) => {
						if (element.id !== id) return element;
						// Дефолтные элементы нельзя переименовывать — иначе их связь
						// с дефолтами/colorTypes/programmPath ломается.
						if (element.isDefault) return element;
						return { ...element, name };
					});
					saveToLocalStorage(storageKey, updatedElements);
					return { patternStore: updatedElements };
				});
			},

			updatePatternElementPath: (id: string, path: string[]) => {
				let updatedElement: PatternElement | undefined;

				set((state) => {
					const updatedElements = state.patternStore.map((element) => {
						if (element.id === id) {
							updatedElement = { ...element, path };
							return updatedElement;
						}
						return element;
					});
					saveToLocalStorage(storageKey, updatedElements);
					return { patternStore: updatedElements };
				});

				if (domain && updatedElement) {
					patternDomainRegistry[domain]?.onChange?.(updatedElement.path, get());
				}
			},

			updatePatternElementColor: (id: string, color: string) => {
				set((state) => {
					const updatedElements = state.patternStore.map((element) => (element.id === id ? { ...element, color } : element));
					saveToLocalStorage(storageKey, updatedElements);
					return { patternStore: updatedElements };
				});
			},

			removePatternElement: (id: string) => {
				set((state) => {
					const target = state.patternStore.find((el) => el.id === id);
					// Дефолтные элементы нельзя удалять.
					if (target?.isDefault) return state;
					const updatedElements = state.patternStore.filter((element) => id !== element.id);
					saveToLocalStorage(storageKey, updatedElements);
					return { patternStore: updatedElements };
				});
				if (domain) {
					patternDomainRegistry[domain]?.onRemove?.(get());
				}
			},

			movePatternElement: (dragIndex: number, hoverIndex: number) => {
				set((state) => {
					const elements = [...state.patternStore];
					const [removed] = elements.splice(dragIndex, 1);
					elements.splice(hoverIndex, 0, removed);
					saveToLocalStorage(storageKey, elements);
					return { patternStore: elements };
				});
			},

			restoreDefault: () => {
				// При сбросе на дефолты возвращаем флаг isDefault — без него защита
				// удаления/переименования не работала после сброса.
				const defaultWithInactive = defaultTypes.map((item) => ({
					...item,
					inactivePath: item.inactivePath || [],
					isDefault: true,
				}));
				set({ patternStore: defaultWithInactive });
				saveToLocalStorage(storageKey, defaultWithInactive);
			},

			// Плагин выключили - переносим во все паттерны, где он используется
			movePluginToInactive: (pluginName: string) => {
				console.log(`[PatternStore:${storageKey}] Moving to inactive: ${pluginName}`);
				set((state) => {
					const updatedElements = state.patternStore.map((element) => {
						if (element.path.includes(pluginName)) {
							return {
								...element,
								path: element.path.filter((name) => name !== pluginName),
								inactivePath: [...(element.inactivePath || []), pluginName],
							};
						}
						return element;
					});

					saveToLocalStorage(storageKey, updatedElements);
					return { patternStore: updatedElements };
				});
			},

			restorePluginFromInactive: (pluginName: string) => {
				console.log(`[PatternStore:${storageKey}] Restoring from inactive: ${pluginName}`);
				set((state) => {
					const updatedElements = state.patternStore.map((element) => {
						if (element.inactivePath?.includes(pluginName)) {
							return {
								...element,
								path: [...element.path, pluginName],
								inactivePath: element.inactivePath.filter((name) => name !== pluginName),
							};
						}
						return element;
					});

					saveToLocalStorage(storageKey, updatedElements);
					return { patternStore: updatedElements };
				});
			},
		};

		return storeObject;
	});

	// ПОДПИСКА НА СОБЫТИЯ - ПОСЛЕ создания стора
	if (domain === 'nodeType') {
		console.log(`[PatternStore:${storageKey}] 🔵 Setting up event listeners (AFTER store creation)`);

		// ВАЖНО: получаем актуальное состояние КАЖДЫЙ раз при событии!
		const onPluginEnabled = (pluginName: string) => {
			const currentState = store.getState(); // <-- ПОЛУЧАЕМ СВЕЖЕЕ СОСТОЯНИЕ
			console.log(`[PatternStore:${storageKey}] ✅ EVENT PLUGIN_ENABLED: ${pluginName}`);
			currentState.restorePluginFromInactive(pluginName);
		};

		const onPluginDisabled = (pluginName: string) => {
			const currentState = store.getState(); // <-- ПОЛУЧАЕМ СВЕЖЕЕ СОСТОЯНИЕ
			console.log(`[PatternStore:${storageKey}] ✅ EVENT PLUGIN_DISABLED: ${pluginName}`);
			currentState.movePluginToInactive(pluginName);
		};

		pluginEvents.on('PLUGIN_ENABLED', onPluginEnabled);
		pluginEvents.on('PLUGIN_DISABLED', onPluginDisabled);

		console.log(`[PatternStore:${storageKey}] ✅ Event listeners attached`);
	}
	return store;
};

// ========================
// DEFAULT TYPES WITH INACTIVEPATH
// ========================
const defaultFileTypes: PatternElement[] = [
	{
		color: '#0a84feff',
		id: 'video',
		name: 'video',
		path: ['avi', 'mov', 'mp4', 'mpeg', 'mpg', 'm2v', 'm4v', 'ts', 'mxf'],
		inactivePath: [],
	},
	{ color: '#ffae0cff', id: 'audio', name: 'audio', path: ['mp3', 'wav'], inactivePath: [] },
	{
		color: '#00e308ff',
		id: 'image',
		name: 'image',
		path: ['jpg', 'jpeg', 'png', 'tiff', 'tga', 'pdf', 'gif', 'pgf'],
		inactivePath: [],
	},
	{ color: '#90bae5ff', id: 'text', name: 'text', path: ['txt', 'json'], inactivePath: [] },
	{ color: '#9be590ff', id: 'title', name: 'title', path: ['lrc', 'srt'], inactivePath: [] },
	{ color: 'rgb(99, 214, 81)', id: 'xlsx', name: 'xlsx', path: ['tsv', 'csv'], inactivePath: [] },
	{ color: '#9857ffff', id: 'aep', name: 'aep', path: ['aep'], inactivePath: [] },
	{ color: '#b20affff', id: 'moho', name: 'moho', path: ['moho'], inactivePath: [] },
	{ color: 'rgb(0, 50, 200)', id: 'scripts', name: 'scripts', path: ['js', 'jsx', 'lua'], inactivePath: [] },
];

const defaultTypeData: PatternElement[] = [
	{ color: '#e00000ff', id: 'folders', name: 'folders', path: [], inactivePath: [] },
	{ color: '#838bffff', id: 'files', name: 'files', path: [], inactivePath: [] },
	{ color: '#005903ff', id: 'path', name: 'path', path: [], inactivePath: [] },
	{ color: '#5a0000ff', id: 'timecode', name: 'timecode', path: [], inactivePath: [] },
	{ color: '#16668aff', id: 'string', name: 'string', path: [], inactivePath: [] },
];

const defaultNodeType: PatternElement[] = [
	{ color: '#2bea1dff', id: 'main', name: 'main', path: [], inactivePath: [] },
	{ color: '#efe708ff', id: 'helpers', name: 'helpers', path: [], inactivePath: [] },
	{ color: '#9d2dffff', id: 'ffmpeg', name: 'ffmpeg', path: [], inactivePath: [] },
	{ color: '#502dffff', id: 'afterEffect', name: 'afterEffect', path: [], inactivePath: [] },
	{ color: '#ff2d9dff', id: 'moho', name: 'moho', path: [], inactivePath: [] },
	{ color: '#2d84ffff', id: 'ai', name: 'ai', path: [], inactivePath: [] },
	{ color: '#6900c5ff', id: 'ffprobe', name: 'ffprobe', path: [], inactivePath: [] },
	// { color: '#7d51a3ff', id: 'ffplay', name: 'ffplay', path: [], inactivePath: [] },
];

const programmsPathDefault: PatternElement[] = [
	{ color: null, id: 'ffmpeg', name: 'ffmpeg', path: [], inactivePath: [] },
	{ color: null, id: 'ffprobe', name: 'ffprobe', path: [], inactivePath: [] },
	{ color: null, id: 'ffplay', name: 'ffplay', path: [], inactivePath: [] },
	{ color: null, id: 'afterEffect', name: 'afterEffect', path: [], inactivePath: [] },
	{ color: null, id: 'moho', name: 'moho', path: [], inactivePath: [] },
];
const folderPathDefault: PatternElement[] = [{ color: null, id: 'whisper', name: 'whisper', path: [], inactivePath: [] }];

// ========================
// TAURI-BACKED STORE FACTORY
// ========================
// Используется для сторов, которые должны персистироваться в JSON-файлах через Tauri
// (а не только в localStorage). localStorage остаётся как быстрый кэш при старте.
//
// Вызов loadFromTauri() происходит из AppMain.tsx после инициализации Tauri API.

type TauriPatternStore = PatternStore & {
	loadFromTauri: () => Promise<void>;
};

const createTauriPatternStore = (localKey: string, getCmd: string, setCmd: string, defaultTypes: PatternElement[] = [], domain?: PatternDomain) => {
	const defaultNamesSet = new Set(defaultTypes.map((d) => d.name));
	const markDefaults = (items: PatternElement[]): PatternElement[] =>
		items.map((it) => (defaultNamesSet.has(it.name) && !it.isDefault ? { ...it, isDefault: true } : it));

	let initialState: PatternElement[] = [];
	try {
		initialState = loadFromLocalStorage(localKey);
	} catch {}
	if (!initialState || initialState.length === 0) {
		initialState = defaultTypes.map((item) => ({
			...item,
			inactivePath: item.inactivePath || [],
			isDefault: true,
		}));
		try {
			saveToLocalStorage(localKey, initialState);
		} catch {}
	} else {
		// миграция: поднимаем флаг isDefault на записях с именем из defaults
		initialState = markDefaults(initialState);
	}

	const tauriSave = (elements: PatternElement[]) => {
		saveToLocalStorage(localKey, elements);
		if (typeof window !== 'undefined' && (window as any).electronAPI) {
			(window as any).electronAPI.invoke(setCmd, elements).catch((e: unknown) => console.warn(`[TauriStore:${localKey}] save failed:`, e));
		}
	};

	const store = create<TauriPatternStore>()((set, get) => ({
		patternStore: initialState,

		loadFromTauri: async () => {
			try {
				const data = (await (window as any).electronAPI.invoke(getCmd)) as PatternElement[];
				if (Array.isArray(data) && data.length > 0) {
					const withInactive = data.map((item: PatternElement) => ({ ...item, inactivePath: item.inactivePath || [] }));
					const tagged = markDefaults(withInactive);
					set({ patternStore: tagged });
					saveToLocalStorage(localKey, tagged);
				}
			} catch (e) {
				console.warn(`[TauriStore:${localKey}] loadFromTauri failed:`, e);
			}
		},

		addPatternElement: (name, path, color) => {
			const newElement: PatternElement = { id: nanoid(5), name, path, color: color ?? null, inactivePath: [] };
			set((state) => {
				const updated = [...state.patternStore, newElement];
				tauriSave(updated);
				return { patternStore: updated };
			});
			if (domain) patternDomainRegistry[domain]?.onAdd?.(get());
		},

		updatePatternElementName: (id, name) => {
			set((state) => {
				const updated = state.patternStore.map((el) => {
					if (el.id !== id) return el;
					if (el.isDefault) return el; // дефолтные нельзя переименовать
					return { ...el, name };
				});
				tauriSave(updated);
				return { patternStore: updated };
			});
		},

		updatePatternElementPath: (id, path) => {
			let updatedElement: PatternElement | undefined;
			set((state) => {
				const updated = state.patternStore.map((el) => {
					if (el.id === id) {
						updatedElement = { ...el, path };
						return updatedElement;
					}
					return el;
				});
				tauriSave(updated);
				return { patternStore: updated };
			});
			if (domain && updatedElement) patternDomainRegistry[domain]?.onChange?.(updatedElement.path, get());
		},

		updatePatternElementColor: (id, color) => {
			set((state) => {
				const updated = state.patternStore.map((el) => (el.id === id ? { ...el, color } : el));
				tauriSave(updated);
				return { patternStore: updated };
			});
		},

		removePatternElement: (id) => {
			set((state) => {
				const target = state.patternStore.find((el) => el.id === id);
				if (target?.isDefault) return state; // дефолтные нельзя удалить
				const updated = state.patternStore.filter((el) => el.id !== id);
				tauriSave(updated);
				return { patternStore: updated };
			});
			if (domain) patternDomainRegistry[domain]?.onRemove?.(get());
		},

		movePatternElement: (dragIndex, hoverIndex) => {
			set((state) => {
				const elements = [...state.patternStore];
				const [removed] = elements.splice(dragIndex, 1);
				elements.splice(hoverIndex, 0, removed);
				tauriSave(elements);
				return { patternStore: elements };
			});
		},

		restoreDefault: () => {
			// Возвращаем флаг isDefault при сбросе — иначе после сброса защита
			// удаления/переименования теряется.
			const defaults = defaultTypes.map((item) => ({
				...item,
				inactivePath: item.inactivePath || [],
				isDefault: true,
			}));
			set({ patternStore: defaults });
			tauriSave(defaults);
		},

		movePluginToInactive: (pluginName) => {
			set((state) => {
				const updated = state.patternStore.map((el) => {
					if (el.path.includes(pluginName)) {
						return { ...el, path: el.path.filter((n) => n !== pluginName), inactivePath: [...(el.inactivePath || []), pluginName] };
					}
					return el;
				});
				tauriSave(updated);
				return { patternStore: updated };
			});
		},

		restorePluginFromInactive: (pluginName) => {
			set((state) => {
				const updated = state.patternStore.map((el) => {
					if (el.inactivePath?.includes(pluginName)) {
						return { ...el, path: [...el.path, pluginName], inactivePath: el.inactivePath.filter((n) => n !== pluginName) };
					}
					return el;
				});
				tauriSave(updated);
				return { patternStore: updated };
			});
		},
	}));

	return store;
};

// ========================
// STORE EXPORTS
// ========================

export const pathPattern_store = createPathPatternStore('pathPattern');
export const folderPath_store = createPathPatternStore('dopMaterialFolderPath', folderPathDefault, 'programPath');
export const typeOfdata_store = createPathPatternStore('typeOfData', defaultTypeData, 'dataType');
export const typeOfNodes_store = createPathPatternStore('typeOfNodes', defaultNodeType, 'nodeType');

// Tauri-backed сторы: данные живут в JSON-файлах в app_data_dir
export const typeOfFile_store = createTauriPatternStore('typeOfFile', 'file-types:get', 'file-types:set', defaultFileTypes, 'fileType');
export const programPathPattern_store = createTauriPatternStore('programPathPattern', 'program-paths:get', 'program-paths:set', programmsPathDefault);

// Функции для прямого вызова из plugin_store
export const movePluginToInactiveInAllStores = (pluginName: string) => {
	console.log(`[Direct] Moving ${pluginName} to inactive in typeOfNodes_store`);
	const state = typeOfNodes_store.getState();
	state.movePluginToInactive(pluginName);
};

export const restorePluginFromInactiveInAllStores = (pluginName: string) => {
	console.log(`[Direct] Restoring ${pluginName} from inactive in typeOfNodes_store`);
	const state = typeOfNodes_store.getState();
	state.restorePluginFromInactive(pluginName);
};

// Функция для автоматического добавления плагина в паттерн по colorType
export const addPluginToPatternByColor = (colorType: string, pluginName: string) => {
	console.log(`[PatternStore] 🔵 ===== AUTO-ADD CALLED =====`);
	console.log(`[PatternStore] ColorType: "${colorType}", Plugin: "${pluginName}"`);

	const state = typeOfNodes_store.getState();
	console.log(`[PatternStore] Current patternStore (${state.patternStore.length} patterns):`);
	state.patternStore.forEach((p) => {
		console.log(`  - ${p.name} (id: ${p.id}): [${p.path.join(', ')}]`);
	});

	// Ищем паттерн (сначала точное совпадение)
	let targetPattern = state.patternStore.find((pattern) => pattern.name === colorType);
	console.log(`[PatternStore] Search result (exact match):`, targetPattern?.name || 'NOT FOUND');

	// Если не нашли, пробуем case-insensitive
	if (!targetPattern) {
		targetPattern = state.patternStore.find((pattern) => pattern.name.toLowerCase() === colorType.toLowerCase());
		console.log(`[PatternStore] Search result (case-insensitive):`, targetPattern?.name || 'NOT FOUND');
	}

	// ЕСЛИ НАШЛИ ПАТТЕРН - ДОБАВЛЯЕМ!
	if (targetPattern) {
		console.log(`[PatternStore] ✅ Found pattern: ${targetPattern.name}`);

		// Проверяем, нет ли уже такого плагина
		if (!targetPattern.path.includes(pluginName)) {
			console.log(`[PatternStore] ➕ Adding ${pluginName} to ${targetPattern.name}`);

			// Обновляем стор
			const updatedElements = state.patternStore.map((pattern) => {
				if (pattern.id === targetPattern!.id) {
					return {
						...pattern,
						path: [...pattern.path, pluginName],
					};
				}
				return pattern;
			});

			// Сохраняем в стор и localStorage
			state.patternStore = updatedElements;
			saveToLocalStorage('typeOfNodes', updatedElements);

			console.log(`[PatternStore] ✅ Successfully added! New path:`, updatedElements.find((p) => p.id === targetPattern!.id)?.path);
		} else {
			console.log(`[PatternStore] ⚠️ Plugin already exists in ${targetPattern.name}`);
		}
	} else {
		console.log(`[PatternStore] ❌ No pattern found with name: ${colorType}`);
	}

	console.log(`[PatternStore] 🔵 ===== AUTO-ADD END =====`);
};
