import { create, StateCreator } from 'zustand';
import { persist } from 'zustand/middleware';
import { loadFromLocalStorage, saveToLocalStorage } from '@/Utils/loadSaveToLS';

/**
 * Адаптер для zustand/persist (Zustand 5).
 * В Zustand 5 persist передаёт в setItem объект { state, version },
 * а не JSON-строку — поэтому StateStorage здесь не подходит.
 * getItem возвращает { state, version } напрямую (не строку).
 */
const lsStorage = {
	getItem: (name: string): { state: unknown; version: number } | null => {
		const data = loadFromLocalStorage(name);
		if (data === null || data === undefined) return null;
		// Оборачиваем существующие данные в формат, который ждёт persist
		return { state: data, version: 0 };
	},
	setItem: (name: string, value: { state: unknown; version?: number }): void => {
		// value.state — это уже объект, а не строка
		saveToLocalStorage(name, value.state);
	},
	removeItem: (name: string): void => {
		localStorage.removeItem(name);
	},
};

/**
 * Создаёт Zustand-стор с автоматической персистентностью в localStorage.
 * Вместо ручного loadFromLocalStorage + saveToLocalStorage в каждом action —
 * достаточно просто вызвать set(), стор сохранится автоматически.
 *
 * @example
 * export const myStore = createPersistentStore<MyState>('my-key', (set) => ({
 *   value: 'default',
 *   setValue: (v) => set({ value: v }),
 * }));
 */
export function createPersistentStore<T extends object>(
	storageKey: string,
	stateCreator: StateCreator<T, [['zustand/persist', unknown]], []>,
) {
	return create<T>()(
		persist(stateCreator, {
			name: storageKey,
			storage: lsStorage,
		}),
	);
}
