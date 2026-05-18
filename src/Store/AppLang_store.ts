import { create } from 'zustand';

export type StateAppLang = {
	UI: string;
	TTip: string;
	//   addPathToFolder: (path: string) => void;
	//   addPathToProj: (path: string) => void;
};

export const useAppLang = create<StateAppLang>()((set, get) => ({
	UI: 'en',
	TTip: 'ru',
	//   addPathToFolder: (path: string) => set({ pathToFolder: path }),
	//   addPathToProj: (path: string) => set({ pathToProj: path }),
}));
