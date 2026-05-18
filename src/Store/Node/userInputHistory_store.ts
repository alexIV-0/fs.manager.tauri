import { createPersistentStore } from '../helpers/createPersistentStore';

type UserInputHistoryState = {
	history: Record<string, string[]>;
	addToHistory: (key: string, value: string) => void;
	removeFromHistory: (key: string, value: string) => void;
};

export const userInputHistory_store = createPersistentStore<UserInputHistoryState>(
	'user-input-history',
	(set, get) => ({
		history: {},
		addToHistory: (key, value) => {
			const current = get().history[key] ?? [];
			if (current.includes(value)) return;
			set({ history: { ...get().history, [key]: [value, ...current] } });
		},
		removeFromHistory: (key, value) => {
			const current = get().history[key] ?? [];
			set({ history: { ...get().history, [key]: current.filter((v) => v !== value) } });
		},
	}),
);
