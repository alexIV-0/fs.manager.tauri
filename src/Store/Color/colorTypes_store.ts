// colorTypes_store.ts
import { create } from 'zustand';
import { defGray } from './grayColor';

export type ColorTypesMap = Record<string, string | null>;

type ColorTypesStore = {
	colorTypes: ColorTypesMap;
	setColorTypes: (map: ColorTypesMap) => void;
};

export const colorTypes_store = create<ColorTypesStore>((set) => ({
	colorTypes: { default: defGray },
	setColorTypes: (map) => set({ colorTypes: map }),
}));
