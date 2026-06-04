import { PatternStore } from './pathPattern_store';

export type PatternDomain = 'pathPattern' | 'programPath' | 'fileType' | 'nodeType' | 'dataType';

type DomainHandlers = {
	onAdd?: (store: PatternStore) => void;
	onRemove?: (store: PatternStore) => void;
	onChange?: (_paths: any, store: PatternStore) => void;
};

export const patternDomainRegistry: Record<PatternDomain, DomainHandlers> = {
	pathPattern: {
		// onAdd: (store) => {
		// },
		// onRemove: (store) => {
		// },
		// onChange: (store) => {
		// }
	},

	programPath: {},

	fileType: {
		// onRemove: () => {
		// 	// пересобрать colorTypes
		// },
		// onChange: () => {},
	},

	nodeType: {
		// onAdd: () => {
		// 	// обновить node definitions
		// },
		onChange: async (_paths, store) => {
			// console.log('onChange', _paths);
			// await window.tauriAPI.invoke('getOptionsFolder');
		},
		onRemove: () => {
			// обновить node definitions
		},
	},

	dataType: {},
};
