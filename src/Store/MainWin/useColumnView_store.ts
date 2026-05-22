// stores/useColumnViewStore.ts
import { create } from 'zustand';
import { calcColumnWidth, COLUMN_DEFAULT_WIDTH, COLUMN_MIN_WIDTH, ColumnViewState, invalidateDirCache, readDirContent } from '../helpers/readDirContent';

interface ColumnInstance {
	columns: any[];
	loading: boolean;
	error?: string;
	sourceType: 'gd' | 'local';
	multiSelectedPaths: string[];
	multiSelectAnchor: { colIndex: number; path: string } | null;
}

interface UniversalColumnViewState {
	instances: {
		gd: ColumnInstance;
		local: ColumnInstance;
	};
	lastActiveInstance: 'gd' | 'local' | null;
	lastSelectedItem: { colIndex: number; item: any } | null;
	openRoot: (instanceType: 'gd' | 'local', rootPath: string, options?: { ensureDir?: boolean }) => Promise<void>;
	selectItem: (instanceType: 'gd' | 'local', colIndex: number, item: any) => Promise<void>;
	refreshColumn: (instanceType: 'gd' | 'local', colIndex: number) => Promise<void>;
	refreshAffectedColumns: (instanceType: 'gd' | 'local', affectedPaths: string[]) => void;
	removeItemAndTrimColumns: (instanceType: 'gd' | 'local', deletedPath: string) => Promise<void>;
	setColumnWidth: (instanceType: 'gd' | 'local', index: number, width: number) => void;
	setSourceType: (instanceType: 'gd' | 'local', sourceType: 'gd' | 'local') => void;
	reset: (instanceType: 'gd' | 'local') => void;
	addItemToColumn: (
		instanceType: 'gd' | 'local',
		colIndex: number,
		item: { name: string; path: string; isDir: boolean },
	) => void;
	toggleMultiSelect: (instanceType: 'gd' | 'local', colIndex: number, path: string) => void;
	setMultiSelectedPaths: (instanceType: 'gd' | 'local', paths: string[], anchor: { colIndex: number; path: string }) => void;
	clearMultiSelection: (instanceType: 'gd' | 'local') => void;
}

export const useColumnView_Store = create<UniversalColumnViewState>((set, get) => ({
	instances: {
		gd: {
			columns: [],
			loading: false,
			error: undefined,
			sourceType: 'gd',
			multiSelectedPaths: [],
			multiSelectAnchor: null,
		},
		local: {
			columns: [],
			loading: false,
			error: undefined,
			sourceType: 'local',
			multiSelectedPaths: [],
			multiSelectAnchor: null,
		},
	},
	lastActiveInstance: null,
	lastSelectedItem: null,

	openRoot: async (instanceType: 'gd' | 'local', rootPath: string, options?: { ensureDir?: boolean }) => {
		try {
			set((state) => ({
				instances: {
					...state.instances,
					[instanceType]: {
						...state.instances[instanceType],
						loading: true,
						error: undefined,
					},
				},
			}));

			const items = await readDirContent(rootPath, options?.ensureDir);

			set((state) => ({
				instances: {
					...state.instances,
					[instanceType]: {
						...state.instances[instanceType],
						columns: [{ path: rootPath, items, width: calcColumnWidth(items) }],
						loading: false,
					},
				},
			}));
		} catch (e: any) {
			set((state) => ({
				instances: {
					...state.instances,
					[instanceType]: {
						...state.instances[instanceType],
						error: e.message,
						loading: false,
					},
				},
			}));
		}
	},

	selectItem: async (instanceType, colIndex, item) => {
		const { instances } = get();
		const instance = instances[instanceType];
		const { columns } = instance;

		const updatedCols = columns.map((col, i) => (i === colIndex ? { ...col, selected: item.name } : col));

		set((state) => ({
			lastActiveInstance: instanceType,
			lastSelectedItem: { colIndex, item },
			instances: {
				...state.instances,
				[instanceType]: {
					...state.instances[instanceType],
					columns: updatedCols,
					multiSelectedPaths: [],
					multiSelectAnchor: { colIndex, path: item.path },
				},
			},
		}));

		if (!item.isDir) {
			updatedCols.splice(colIndex + 1);
			set((state) => ({
				instances: {
					...state.instances,
					[instanceType]: {
						...state.instances[instanceType],
						columns: updatedCols,
					},
				},
			}));
			return;
		}

		try {
			set((state) => ({
				instances: {
					...state.instances,
					[instanceType]: {
						...state.instances[instanceType],
						loading: true,
						error: undefined,
					},
				},
			}));

			const nextItems = await readDirContent(item.path);
			updatedCols.splice(colIndex + 1);
			updatedCols.push({ path: item.path, items: nextItems, width: calcColumnWidth(nextItems) });

			set((state) => ({
				instances: {
					...state.instances,
					[instanceType]: {
						...state.instances[instanceType],
						columns: updatedCols,
						loading: false,
					},
				},
			}));
		} catch (e: any) {
			set((state) => ({
				instances: {
					...state.instances,
					[instanceType]: {
						...state.instances[instanceType],
						error: e.message,
						loading: false,
					},
				},
			}));
		}
	},

	refreshColumn: async (instanceType: 'gd' | 'local', colIndex: number) => {
		const colPath = get().instances[instanceType].columns[colIndex]?.path;
		if (!colPath) return;

		try {
			invalidateDirCache(colPath);
			const items = await readDirContent(colPath);

			// ВАЖНО: читаем columns из АКТУАЛЬНОГО state внутри set-колбэка,
			// а не из захваченного выше значения. Иначе при параллельном
			// refreshColumn для двух колонок (источник + приёмник DnD) оба
			// читают одни и те же старые columns и затирают изменения друг друга
			// — UI откатывается к предыдущему состоянию.
			set((state) => {
				const currentCols = state.instances[instanceType].columns;
				// За время await колонки могли пересобраться — ищем по пути,
				// а не по индексу, чтобы не обновить не ту колонку.
				const idx = currentCols.findIndex((c) => c.path === colPath);
				if (idx === -1) return state;

				const oldItems = currentCols[idx].items;
				// Пропускаем обновление если содержимое не изменилось — избегаем лишних ре-рендеров и мерцания.
				if (
					oldItems.length === items.length &&
					oldItems.every((item, i) => item.path === items[i].path)
				) return state;

				const updatedCols = [...currentCols];
				updatedCols[idx] = { ...currentCols[idx], items };

				return {
					instances: {
						...state.instances,
						[instanceType]: {
							...state.instances[instanceType],
							columns: updatedCols,
						},
					},
				};
			});
		} catch (e: any) {
			set((state) => ({
				instances: {
					...state.instances,
					[instanceType]: {
						...state.instances[instanceType],
						error: e.message,
					},
				},
			}));
		}
	},

	refreshAffectedColumns: (instanceType: 'gd' | 'local', affectedPaths: string[]) => {
		const { instances, refreshColumn } = get();
		const instance = instances[instanceType];
		const { columns } = instance;

		affectedPaths.forEach((p) => invalidateDirCache(p));

		columns.forEach((col, index) => {
			const shouldRefresh = affectedPaths.some(
				(affectedPath) => affectedPath.startsWith(col.path) || col.path.startsWith(affectedPath),
			);

			if (shouldRefresh) {
				invalidateDirCache(col.path);
				refreshColumn(instanceType, index);
			}
		});
	},

	// 🔹 удаление элемента с обрезкой дочерних колонок
	// Используется при удалении папки или файла из контекстного меню.
	// Логика:
	// 1. Находим колонку где deletedPath был selected (т.е. по нему открылась дочерняя колонка)
	// 2. Снимаем selected с этого элемента
	// 3. Срезаем все колонки правее (дочерние)
	// 4. Обновляем содержимое родительской колонки (убираем удалённый элемент из списка)
	removeItemAndTrimColumns: async (instanceType: 'gd' | 'local', deletedPath: string) => {
		const { instances } = get();
		const { columns } = instances[instanceType];

		// имя удалённого элемента
		const deletedName = deletedPath.split('/').pop() ?? deletedPath.split('\\').pop() ?? '';
		// путь до родительской папки
		const parentPath = deletedPath.substring(0, deletedPath.length - deletedName.length - 1);

		// ищем индекс колонки где этот элемент был selected
		// это колонка с path === parentPath и selected === deletedName
		const parentColIndex = columns.findIndex((col) => col.path === parentPath);

		if (parentColIndex === -1) {
			// элемент не найден в колонках — просто ничего не делаем
			return;
		}

		// обновляем содержимое родительской колонки и срезаем все правее
		try {
			invalidateDirCache(parentPath);
			const freshItems = await readDirContent(parentPath);

			set((state) => {
				const cols = [...state.instances[instanceType].columns];
				// обновляем родительскую колонку: новое содержимое + снимаем selected
				cols[parentColIndex] = {
					...cols[parentColIndex],
					items: freshItems,
					selected: undefined,
				};
				// срезаем все дочерние колонки
				const trimmed = cols.slice(0, parentColIndex + 1);

				return {
					instances: {
						...state.instances,
						[instanceType]: {
							...state.instances[instanceType],
							columns: trimmed,
						},
					},
				};
			});
		} catch (e: any) {
			// если readDir упал (например папка тоже удалена) — просто срезаем колонки
			set((state) => {
				const cols = [...state.instances[instanceType].columns];
				const trimmed = cols.slice(0, parentColIndex + 1);
				return {
					instances: {
						...state.instances,
						[instanceType]: {
							...state.instances[instanceType],
							columns: trimmed,
						},
					},
				};
			});
		}
	},

	setColumnWidth: (instanceType: 'gd' | 'local', index: number, width: number) => {
		const { instances } = get();
		const instance = instances[instanceType];
		const { columns } = instance;

		const updatedCols = [...columns];
		const clamped = Math.max(COLUMN_MIN_WIDTH, width);
		if (updatedCols[index]) {
			updatedCols[index] = { ...updatedCols[index], width: clamped };

			set((state) => ({
				instances: {
					...state.instances,
					[instanceType]: {
						...state.instances[instanceType],
						columns: updatedCols,
					},
				},
			}));
		}
	},

	setSourceType: (instanceType: 'gd' | 'local', sourceType: 'gd' | 'local') => {
		set((state) => ({
			instances: {
				...state.instances,
				[instanceType]: {
					...state.instances[instanceType],
					sourceType,
				},
			},
		}));
	},

	reset: (instanceType: 'gd' | 'local') => {
		set((state) => ({
			instances: {
				...state.instances,
				[instanceType]: {
					columns: [],
					loading: false,
					error: undefined,
					sourceType: instanceType,
					multiSelectedPaths: [],
					multiSelectAnchor: null,
				},
			},
		}));
	},

	addItemToColumn: (instanceType: 'gd' | 'local', colIndex: number, item: { name: string; path: string; isDir: boolean }) => {
		const { instances } = get();
		const columns = [...instances[instanceType].columns];
		const col = columns[colIndex];
		if (!col) return;

		// Не добавляем если уже есть
		if (col.items.some((i: any) => i.path === item.path)) return;

		// Вставляем с сортировкой — папки сначала, потом по имени
		const newItems = [...col.items, item].sort((a, b) => {
			if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
			return a.name.localeCompare(b.name, 'ru', { sensitivity: 'base' });
		});

		columns[colIndex] = { ...col, items: newItems };

		set((state) => ({
			instances: {
				...state.instances,
				[instanceType]: {
					...state.instances[instanceType],
					columns,
				},
			},
		}));
	},

	toggleMultiSelect: (instanceType: 'gd' | 'local', colIndex: number, path: string) => {
		set((state) => {
			const prev = state.instances[instanceType].multiSelectedPaths;
			// When starting a new multi-selection, include the single-selected item from the same column
			let base = prev;
			if (prev.length === 0 && state.lastSelectedItem) {
				const last = state.lastSelectedItem;
				if (last.colIndex === colIndex && !prev.includes(last.item.path)) {
					base = [last.item.path];
				}
			}
			const exists = base.includes(path);
			const multiSelectedPaths = exists ? base.filter((p) => p !== path) : [...base, path];
			return {
				lastActiveInstance: instanceType,
				instances: {
					...state.instances,
					[instanceType]: {
						...state.instances[instanceType],
						multiSelectedPaths,
						multiSelectAnchor: { colIndex, path },
					},
				},
			};
		});
	},

	setMultiSelectedPaths: (instanceType: 'gd' | 'local', paths: string[], anchor: { colIndex: number; path: string }) => {
		set((state) => ({
			lastActiveInstance: instanceType,
			instances: {
				...state.instances,
				[instanceType]: {
					...state.instances[instanceType],
					multiSelectedPaths: paths,
					multiSelectAnchor: anchor,
				},
			},
		}));
	},

	clearMultiSelection: (instanceType: 'gd' | 'local') => {
		set((state) => ({
			instances: {
				...state.instances,
				[instanceType]: {
					...state.instances[instanceType],
					multiSelectedPaths: [],
					multiSelectAnchor: null,
				},
			},
		}));
	},
}));

export { COLUMN_DEFAULT_WIDTH };
