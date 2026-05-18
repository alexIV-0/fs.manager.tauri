import { XYPosition, Node } from '@xyflow/react';
import { create } from 'zustand';

// export type NodeInfo = {
// 	id: string; // уникальный идентификатор
// 	type: string; // тип ноды (например, 'folderIn')
// 	position: XYPosition;
// 	data: any; //все дополнительные настройки
// };

type State = {
	allNodeInFlow: Node[];
	addNodeInFlow: (node: Node) => void;
	removeNodeInFlow: (nodeId: string) => void;
	getNodeById: (nodeId: string) => Node | '';
	updateNodeProps: (nodeId: string, propName: string, value: any) => void;
};

export const useAllNodeInFlow = create<State>((set, get) => ({
	allNodeInFlow: [],

	addNodeInFlow: (node) =>
		set((state) => ({
			allNodeInFlow: [...state.allNodeInFlow, node],
		})),

	removeNodeInFlow: (nodeId) =>
		set((state) => ({
			allNodeInFlow: state.allNodeInFlow.filter((n) => n.id !== nodeId),
		})),
	updateNodeProps: (nodeId, propName, value) =>
		set((state) => ({
			allNodeInFlow: state.allNodeInFlow.map((node) =>
				node.id === nodeId
					? {
							...node,
							data: {
								...node.data,
								[propName]: value,
							},
					  }
					: node
			),
		})),

	getNodeById: (nodeId) => get().allNodeInFlow.find((n) => n.id === nodeId) || '',
}));
