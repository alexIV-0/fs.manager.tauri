// useFlowTypes.ts
import GenericEdge from '@/NODE_WIN/edges/CustomEdge';
import { isNodeDefinitionsInitialized, getNodeDefinitions } from '../definitions';
import GenericNode from '../nodes/GenericNode';
import SpyNode from '../nodes/SpyNode';

export const edgeTypes = {
	default: GenericEdge,
};

// Кастомные рендереры по type. Для всего остального — GenericNode.
const CUSTOM_NODE_RENDERERS: Record<string, any> = {
	spy: SpyNode,
};

// Функция, которая ВСЕГДА берет актуальные ноды
export function getNodeTypes() {
	// Проверяем, инициализированы ли ноды
	if (!isNodeDefinitionsInitialized()) {
		// console.log('[nodeTypes] Node definitions not ready yet, returning empty');
		return {};
	}

	const nodes = getNodeDefinitions();
	// console.log('[nodeTypes] Building nodeTypes from', nodes.length, 'nodes');

	return nodes.reduce(
		(acc, node) => {
			if (node.type) {
				acc[node.type] = CUSTOM_NODE_RENDERERS[node.type] ?? GenericNode;
			}
			return acc;
		},
		{} as Record<string, any>,
	);
}
