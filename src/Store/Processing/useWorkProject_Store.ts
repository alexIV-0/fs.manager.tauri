import { create } from 'zustand';

// Хранится снаружи Zustand — не вызывает лишних ре-рендеров
const registeredPaths = new Set<string>();

interface WorkProjectState {
	workProject: any[];
	addWorkProjectState: (objForProcess: any) => void;
	takeNextItem: () => any | null;
	clearWorkProjectState: () => void;
	hasItems: () => boolean;
}

export const useWorkProject_Store = create<WorkProjectState>((set, get) => ({
	workProject: [],

	addWorkProjectState: (objForProcess) => {
		const key: string | undefined = objForProcess?.description?.pathForDelete;
		if (key) {
			if (registeredPaths.has(key)) return; // дедупликация
			registeredPaths.add(key);
		}
		set((state) => ({
			workProject: [...state.workProject, objForProcess],
		}));
	},

	takeNextItem: () => {
		const { workProject } = get();
		if (workProject.length === 0) return null;
		const [item, ...rest] = workProject;
		// Путь оставляем в registeredPaths: пока сессия идёт, повторно тот же файл
		// в очередь не попадёт (даже если deleteAfter=false и он остаётся на диске,
		// и очередной скан его снова найдёт). Сбрасывается только в clearWorkProjectState.
		set({ workProject: rest });
		return item;
	},

	clearWorkProjectState: () => {
		registeredPaths.clear();
		set({ workProject: [] });
	},

	hasItems: () => get().workProject.length > 0,
}));
