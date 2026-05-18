import { create } from 'zustand';

export type NodeProcessingStatus = 'idle' | 'running' | 'done' | 'error';

interface ProcessingEvent {
	nodeId: string;
	status: NodeProcessingStatus;
	message?: string;
}

interface ProcessingStatusState {
	// id ноды которая сейчас выполняется (null = нет активной)
	activeNodeId: string | null;
	// статус по каждой ноде: nodeId → status
	nodeStatuses: Record<string, NodeProcessingStatus>;
	// текст статус-бара
	statusText: string;
	// идёт ли обработка
	isRunning: boolean;

	setActiveNode: (nodeId: string | null) => void;
	setNodeStatus: (nodeId: string, status: NodeProcessingStatus, message?: string) => void;
	setStatusText: (text: string) => void;
	setIsRunning: (value: boolean) => void;
	resetAll: () => void;
}

export const useProcessingStatus_store = create<ProcessingStatusState>((set) => ({
	activeNodeId: null,
	nodeStatuses: {},
	statusText: '',
	isRunning: false,

	setActiveNode: (nodeId) => set({ activeNodeId: nodeId }),

	setNodeStatus: (nodeId, status, message) =>
		set((state) => ({
			nodeStatuses: {
				...state.nodeStatuses,
				[nodeId]: status,
			},
			statusText: message ?? state.statusText,
		})),

	setStatusText: (text) => set({ statusText: text }),

	setIsRunning: (value) => set({ isRunning: value }),

	resetAll: () =>
		set({
			activeNodeId: null,
			nodeStatuses: {},
			statusText: '',
			isRunning: false,
		}),
}));
