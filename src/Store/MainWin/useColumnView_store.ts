// stores/useColumnViewStore.ts
import { create } from 'zustand';
import { calcColumnWidth, COLUMN_DEFAULT_WIDTH, COLUMN_MIN_WIDTH, ColumnViewState, invalidateDirCache, readDirContent, sameStorage, type FileItem } from '../helpers/readDirContent';
import { useColumnFocus_store } from './columnFocus_store';

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
	// Путь колонки, активной для вставки/подсветки: при клике по папке — путь открытой
	// папки (следующая колонка), при клике по файлу/пустому месту — путь кликнутой колонки.
	activeColumnPath: string | null;
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
	// Оптимистично добавляет элемент в колонку с путём parentPath и сразу делает его
	// активным выбором + активирует панель (чтобы только что созданную папку/файл
	// можно было переименовать по Enter). Если колонки с таким путём нет — no-op.
	addAndSelectItemByPath: (
		instanceType: 'gd' | 'local',
		parentPath: string,
		item: { name: string; path: string; isDir: boolean },
	) => void;
	toggleMultiSelect: (instanceType: 'gd' | 'local', colIndex: number, path: string) => void;
	setMultiSelectedPaths: (instanceType: 'gd' | 'local', paths: string[], anchor: { colIndex: number; path: string }) => void;
	clearMultiSelection: (instanceType: 'gd' | 'local') => void;
	// Полностью снимает выбор в панели: и мульти-выбор, и одиночную подсветку
	// (selected) во всех её колонках.
	clearInstanceSelection: (instanceType: 'gd' | 'local') => void;
	// Делает панель (gd/local) активной для клавиатуры: ставит фокус и
	// синхронизирует lastSelectedItem с уже выбранным элементом этой панели
	// (или с первым элементом корневой колонки, если ничего не выбрано).
	focusInstance: (instanceType: 'gd' | 'local') => void;
}

/**
 * Одинаковы ли строки колонки — с точки зрения ОТРИСОВКИ.
 *
 * Путь один и тот же ещё не значит «рисовать нечего»: у облачного файла меняется
 * состояние синхронизации, проценты передачи, пин, агрегат папки, архивность. Всё это
 * влияет на то, что человек видит, поэтому входит в сравнение.
 *
 * Функция существует ровно для защиты от мерцания: без сравнения каждая проверка папки
 * пересоздавала бы массив и перерисовывала список целиком.
 */
function sameItem(a: FileItem, b: FileItem): boolean {
	return a.path === b.path && a.isDir === b.isDir && sameStorage(a.storage, b.storage);
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
	activeColumnPath: null,

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
						// Колонки ОБНУЛЯЕМ. Раньше при ошибке оставались прежние, и панель
						// показывала содержимое предыдущей папки под новым заголовком —
						// самый неприятный вид вранья: данные выглядят настоящими.
						columns: [{ path: rootPath, items: [] }],
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

		// Любой выбор в панели делает её фокусной колонкой для клавиатуры.
		useColumnFocus_store.getState().setFocusedColumn(instanceType);

		set((state) => ({
			lastActiveInstance: instanceType,
			lastSelectedItem: { colIndex, item },
			// папка → путь открываемой папки (станет следующей колонкой); файл → путь его колонки
			activeColumnPath: item.isDir ? item.path : (columns[colIndex]?.path ?? null),
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
				// Пропускаем обновление, если не изменилось НИЧЕГО — включая состояние
				// синхронизации. Сравнивать только пути было ошибкой: у облачных файлов
				// путь не меняется никогда, меняются значок и проценты. Из-за этого
				// свежие данные приходили и молча выбрасывались как «то же самое», и
				// значок обновлялся лишь при уходе в другую папку и обратно (там колонка
				// пересобирается заново, а не сравнивается).
				if (oldItems.length === items.length && oldItems.every((item: FileItem, i: number) => sameItem(item, items[i])))
					return state;

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

	addAndSelectItemByPath: (instanceType, parentPath, item) => {
		const cols = get().instances[instanceType].columns;
		if (cols.findIndex((c) => c.path === parentPath) === -1) return; // родитель не открыт колонкой

		useColumnFocus_store.getState().setFocusedColumn(instanceType);

		set((state) => {
			const sCols = state.instances[instanceType].columns;
			const idx = sCols.findIndex((c) => c.path === parentPath);
			if (idx === -1) return state;

			const col = sCols[idx];
			const exists = col.items.some((it: any) => it.path === item.path);
			const items = exists
				? col.items
				: [...col.items, item].sort((a: any, b: any) => {
						if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
						return a.name.localeCompare(b.name, 'ru', { sensitivity: 'base' });
					});

			return {
				lastActiveInstance: instanceType,
				lastSelectedItem: { colIndex: idx, item },
				activeColumnPath: parentPath,
				instances: {
					...state.instances,
					[instanceType]: {
						...state.instances[instanceType],
						columns: sCols.map((c, i) => (i === idx ? { ...c, items, selected: item.name } : c)),
						multiSelectedPaths: [],
						multiSelectAnchor: { colIndex: idx, path: item.path },
					},
				},
			};
		});
	},

	toggleMultiSelect: (instanceType: 'gd' | 'local', colIndex: number, path: string) => {
		useColumnFocus_store.getState().setFocusedColumn(instanceType);
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
		useColumnFocus_store.getState().setFocusedColumn(instanceType);
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

	// Снимает и мульти-выбор, и одиночную подсветку во всех колонках панели.
	// Зовётся при уходе в другую панель (верх↔низ), чтобы клавиатура (Enter/Delete)
	// и подсветка не действовали на «остаточный» выбор в неактивной панели.
	clearInstanceSelection: (instanceType: 'gd' | 'local') => {
		set((state) => ({
			instances: {
				...state.instances,
				[instanceType]: {
					...state.instances[instanceType],
					multiSelectedPaths: [],
					multiSelectAnchor: null,
					columns: state.instances[instanceType].columns.map((col) =>
						col.selected ? { ...col, selected: null } : col,
					),
				},
			},
		}));
	},

	focusInstance: (instanceType: 'gd' | 'local') => {
		useColumnFocus_store.getState().setFocusedColumn(instanceType);

		const { columns } = get().instances[instanceType];

		// Ищем самую глубокую колонку с уже выбранным элементом, чтобы
		// клавиатура продолжила навигацию с того места, где её оставили.
		let target: { colIndex: number; item: any } | null = null;
		columns.forEach((col, i) => {
			if (col.selected) {
				const it = col.items.find((x: any) => x.name === col.selected);
				if (it) target = { colIndex: i, item: it };
			}
		});

		// Ничего не выбрано — встаём на первый элемент корневой колонки.
		if (!target && columns[0]?.items?.length) {
			target = { colIndex: 0, item: columns[0].items[0] };
		}

		set((state) => ({
			lastActiveInstance: instanceType,
			lastSelectedItem: target ?? state.lastSelectedItem,
			instances: target
				? {
						...state.instances,
						[instanceType]: {
							...state.instances[instanceType],
							columns: state.instances[instanceType].columns.map((col, i) =>
								i === target!.colIndex ? { ...col, selected: target!.item.name } : col,
							),
						},
					}
				: state.instances,
		}));
	},
}));

export { COLUMN_DEFAULT_WIDTH };

/**
 * Строки, на которые действует действие, вызванное на строке `item`.
 *
 * ── Зачем отдельная функция ─────────────────────────────────────────────────
 * Контекстное меню вызывают ПРАВОЙ кнопкой по одной строке, но выделено может быть
 * десять. Пока каждый пункт брал свой `path`, «Удалить» на выделении из десяти
 * файлов удаляло один — тот, по которому кликнули, — а остальные девять оставались
 * подсвеченными, будто с ними тоже что-то сделали. Клавиатура (Delete, Ctrl+C) при
 * этом работала по всему выделению: одно и то же действие вело себя по-разному в
 * зависимости от того, чем его позвали.
 *
 * Правило одно и то же везде: клик по строке ВНУТРИ выделения — работаем со всем
 * выделением, клик по строке снаружи — только по ней (выделение при этом снимает
 * сам компонент через `onSelect`).
 *
 * Возвращаются полные строки, а не пути: облачным пунктам меню нужно состояние
 * синхронизации каждой строки, чтобы посчитать, скольким из них нужны байты. Строки
 * берём из уже прочитанных колонок — второго чтения диска здесь не будет.
 */
export function selectionTargets(item: FileItem): FileItem[] {
	const { instances } = useColumnView_Store.getState();

	for (const type of ['gd', 'local'] as const) {
		const selected = instances[type].multiSelectedPaths;
		if (!selected.includes(item.path)) continue;

		// Порядок берём из выделения, а данные — из колонок: строка обязана прийти со
		// своим состоянием синхронизации, иначе облачные пункты меню посчитают её
		// локальной.
		const byPath = new Map<string, FileItem>();
		for (const col of instances[type].columns) {
			for (const row of (col.items ?? []) as FileItem[]) byPath.set(row.path, row);
		}
		// Строки может уже не быть в колонках (папку перечитали) — тогда её путь всё
		// равно наш, просто без данных каталога.
		return selected.map((p) => byPath.get(p) ?? { name: p.split(/[\\/]/).filter(Boolean).pop() ?? p, path: p, isDir: false });
	}

	return [item];
}
