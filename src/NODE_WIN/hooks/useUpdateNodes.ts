import { useReactFlow, useUpdateNodeInternals } from '@xyflow/react';
import { useCallback } from 'react';

function setByPathImmutable(obj: any, path: string, value: any) {
	const keys = path.split('.');
	let newObj = { ...obj };
	let current = newObj;

	for (let i = 0; i < keys.length - 1; i++) {
		const key = keys[i];
		if (!(key in current) || typeof current[key] !== 'object' || current[key] === null) {
			current[key] = {};
		}
		current[key] = { ...current[key] }; // создаём новый объект на каждом уровне
		current = current[key];
	}

	current[keys[keys.length - 1]] = value;

	return newObj;
}

export const useNodeUpdater = () => {
	const { setNodes } = useReactFlow();
	const updateNodeInternals = useUpdateNodeInternals();

	const updateNodeData = useCallback(
		(nodeId: string, updates: Record<string, any>) => {
			setNodes((nodes) =>
				nodes.map((node) => {
					if (node.id !== nodeId) return node;

					let newData = { ...node.data };
					for (const path in updates) {
						newData = setByPathImmutable(newData, path, updates[path]);
					}

					return {
						...node,
						data: newData,
					};
				})
			);

			updateNodeInternals(nodeId); // всегда после апдейта
		},
		[setNodes, updateNodeInternals]
	);

	return { updateNodeData };
};
