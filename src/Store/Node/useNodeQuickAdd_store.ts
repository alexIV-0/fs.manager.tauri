import { createPersistentStore } from '../helpers/createPersistentStore';

const MAX_RECENT = 5;

export type QuickAddEntry = {
	type: string;
	label: string;
};

type NodeQuickAddState = {
	lastUsed: QuickAddEntry[];
	usageCount: Record<string, number>;
	addUsed: (entry: QuickAddEntry) => void;
};

export const useNodeQuickAdd_store = createPersistentStore<NodeQuickAddState>(
	'node-quick-add',
	(set, get) => ({
		lastUsed: [],
		usageCount: {},
		addUsed: (entry) => {
			const { lastUsed, usageCount } = get();
			const newCount = { ...usageCount, [entry.type]: (usageCount[entry.type] ?? 0) + 1 };
			const filtered = lastUsed.filter((e) => e.type !== entry.type);
			const newLastUsed = [entry, ...filtered].slice(0, MAX_RECENT);
			set({ lastUsed: newLastUsed, usageCount: newCount });
		},
	}),
);
