import { create } from 'zustand';

export type EdgesInfo = {
	id: string; // уникальный идентификатор
	source: string; // тип соединения
	target: string;
};

type State = {
	allEdgesInFlow: EdgesInfo[];
	addEdgesInFlow: (edges: EdgesInfo) => void;
	removeEdgesInFlow: (edgesId: string) => void;
};

export const useAllEdgesInFlow = create<State>((set, get) => ({
	allEdgesInFlow: [],

	addEdgesInFlow: (edges) =>
		set((state) => ({
			allEdgesInFlow: [...state.allEdgesInFlow, edges],
		})),

	removeEdgesInFlow: (edgesId) =>
		set((state) => ({
			allEdgesInFlow: state.allEdgesInFlow.filter((n) => n.id !== edgesId),
		})),
}));
