import { CustomNode } from '@/NODE_WIN/definitions/types';
import { useSavedState } from '@/Store/Node/useSavedState';
import {
	type Edge,
	type EdgeChange,
	type Node,
	type NodeChange,
	useEdgesState,
	useNodesState,
	useReactFlow,
} from '@xyflow/react';
import { useCallback } from 'react';
import { getNodeDefinitions } from '../definitions';
import { isValueValid } from '../utils/validation';
import { syncCostsFromManifest } from '../utils/syncCostsFromManifest';
import { useCascadeValidation } from './useCascadeValidation';

export const useFlowActions = () => {
	const { savedState } = useSavedState();
	const reactFlow = useReactFlow();

	const [nodes, setNodes, rfOnNodesChange] = useNodesState<Node>([]);
	const [edges, setEdges, rfOnEdgesChange] = useEdgesState<Edge>([]);

	const { handleEdgeRemoval } = useCascadeValidation();

	// 👉 оборачиваем стандартный onNodesChange
	const onNodesChange = useCallback(
		(changes: NodeChange[]) => {
			// Просто передаём в reactFlow, вся валидация теперь в node.data
			rfOnNodesChange(changes);
		},
		[rfOnNodesChange],
	);

	// 👉 оборачиваем стандартный onEdgesChange
	const onEdgesChange = useCallback(
		(changes: EdgeChange[]) => {
			// Собираем ВСЕ удаляемые edges ДО применения изменений,
			// пока они ещё существуют в reactFlow
			const removedEdges = changes
				.filter((change) => change.type === 'remove')
				.map((change) => reactFlow.getEdge((change as { id: string }).id))
				.filter((edge): edge is Edge => edge !== undefined);

			// Сначала применяем изменения — удаляем edges из стейта
			rfOnEdgesChange(changes);

			// ПОСЛЕ применения запускаем каскадную валидацию для всех затронутых нод
			// setTimeout нужен чтобы reactFlow успел обновить стейт edges
			if (removedEdges.length > 0) {
				setTimeout(() => {
					removedEdges.forEach((edge) => handleEdgeRemoval(edge));
				}, 0);
			}
		},
		[rfOnEdgesChange, handleEdgeRemoval, reactFlow],
	);

	const onBeforeDelete = useCallback(
		async (params: { nodes: Node[]; edges: Edge[] }) => {
			const nodesToDelete = params.nodes.filter((node) => node.deletable !== false);

			// ✅ Явно собираем ВСЕ edges связанные с удаляемыми нодами
			const deletingIds = new Set(nodesToDelete.map((n) => n.id));
			const allEdges = reactFlow.getEdges();
			const relatedEdges = allEdges.filter((e) => deletingIds.has(e.source) || deletingIds.has(e.target));
			// Объединяем с edges которые ReactFlow передал сам (без дублей)
			const existingEdgeIds = new Set(params.edges.map((e) => e.id));
			const extraEdges = relatedEdges.filter((e) => !existingEdgeIds.has(e.id));
			const edgesToDelete = [...params.edges, ...extraEdges];

			const loopIds = new Set(nodesToDelete.filter((n) => (n.data as any)?.executionType === 'loop').map((n) => n.id));
			if (loopIds.size > 0) {
				const allNodes = reactFlow.getNodes();
				const childNodes = allNodes.filter((n) => n.parentId && loopIds.has(n.parentId));
				if (childNodes.length > 0) {
					reactFlow.deleteElements({ nodes: childNodes });
				}
			}

			return {
				nodes: nodesToDelete,
				edges: edgesToDelete, // ✅ все связанные edges
			};
		},
		[reactFlow],
	);

	const onInit = useCallback(() => {
		if (!savedState) {
			return;
		}

		if (!savedState.nodes || savedState.nodes.length === 0) {
			const definitions = getNodeDefinitions();

			const initialNodes = definitions
				.filter((node) => (node.data as any)?.required)
				.map((node, index, self) => {
					const prev = self[index - 1];
					const position = prev ? { x: prev.position.x, y: prev.position.y + (prev.height || 0) + 20 } : { x: 0, y: 0 };

					// ✅ Вычисляем isValid сразу при создании
					const isValid = (node.data.properties as any[]).filter((p) => p.required).every(isValueValid);

					return {
						...node,
						position,
						data: {
							...node.data,
							isValid,
							computedOutput: null, // Изначально output пустой
						},
					};
				});

			setNodes(initialNodes);
		} else {
			// ✅ Восстанавливаем сохранённые ноды (у них уже должен быть isValid и computedOutput)
			// Перезаписываем cost/costUnit актуальными значениями из plugin.json — старые флоу
			// подхватывают централизованную цену, новые продолжают работать как раньше.
			setNodes(syncCostsFromManifest(savedState.nodes));
		}

		setEdges(savedState.edges || []);

		if (savedState.viewport) {
			reactFlow.setViewport(savedState.viewport);
		}

		console.log('[useFlowActions] ✅ onInit completed');
	}, [savedState, setNodes, setEdges, reactFlow]);

	return {
		nodes,
		edges,
		onNodesChange,
		onEdgesChange,
		onBeforeDelete,
		onInit,
	};
};
