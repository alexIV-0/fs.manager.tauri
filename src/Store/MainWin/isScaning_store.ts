import { create } from 'zustand';

type IsScanningStore = {
	isScanning: boolean;
	isScanningProcess: boolean;
	mainFolderIndex: number;
	curentFolderIndex: number;
	setIsScanning: (value: boolean) => void;
	setIsScanningProcess: (value: boolean) => void;
	setMainFolderIndex: (value: number) => void;
	setCurentFolderIndex: (value: number) => void;
};

export const isScanningStore = create<IsScanningStore>((set, get) => ({
	isScanning: false,
	isScanningProcess: false,
	mainFolderIndex: -1,
	curentFolderIndex: -1,
	setIsScanning: (value: boolean) => set({ isScanning: value }),
	setIsScanningProcess: (value: boolean) => set({ isScanningProcess: value }),
	setMainFolderIndex: (value: number) => set({ mainFolderIndex: value }),
	setCurentFolderIndex: (value: number) => set({ curentFolderIndex: value }),
}));
