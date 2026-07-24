import { CustomNode } from '@/NODE_WIN/definitions/types';
import { useSavedState } from '@/Store/Node/useSavedState';
import {
	type Edge,
	type EdgeChange,
	type Node,
	type NodeChange,
	type XYPosition,
	useEdgesState,
	useNodesState,
	useReactFlow,
} from '@xyflow/react';
import { useCallback } from 'react';
import { getNodeDefinitions } from '../definitions';
import { isValueValid } from '../utils/validation';
import { syncCostsFromManifest } from '../utils/syncCostsFromManifest';
import { findLoopAtPoint, getAbsolutePosition, getNodeSize, sortLoopsFirst } from '../utils/loopGrouping';
import { useCascadeValidation } from './useCascadeValidation';
import { useUndoRedo } from './useUndoRedo';

export const useFlowActions = () => {
	const { savedState } = useSavedState();
	const reactFlow = useReactFlow();

	const [nodes, setNodes, rfOnNodesChange] = useNodesState<Node>([]);
	const [edges, setEdges, rfOnEdgesChange] = useEdgesState<Edge>([]);

	const { handleEdgeRemoval, cascadeValidation } = useCascadeValidation();

	// Undo/Redo (Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z / Ctrl+Y). Восстановление идёт через
	// прямые setNodes/setEdges (минуя onNodesChange), поэтому истории не плодит.
	const { record: recordHistory, resetHistory } = useUndoRedo({ setNodes, setEdges, maxHistory: 50 });

	// 👉 оборачиваем стандартный onNodesChange
	const onNodesChange = useCallback(
		(changes: NodeChange[]) => {
			// История: снимок до-действенного состояния (ДО применения изменений).
			recordHistory(changes);
			// Просто передаём в reactFlow, вся валидация теперь в node.data
			rfOnNodesChange(changes);
		},
		[rfOnNodesChange, recordHistory],
	);

	// 👉 оборачиваем стандартный onEdgesChange
	const onEdgesChange = useCallback(
		(changes: EdgeChange[]) => {
			// История: снимок до-действенного состояния (ДО применения изменений).
			recordHistory(changes);
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
		[rfOnEdgesChange, handleEdgeRemoval, reactFlow, recordHistory],
	);

	// 👉 Привязка/отвязка нод к Loop по завершении перетаскивания.
	//  • нода попала в границы Loop → становится его ребёнком (parentId + относительная позиция);
	//  • нода вытащена наружу → отвязывается (parentId снимается, позиция → абсолютная).
	// Loop-ноды сами не переусыновляются (их таскают целиком вместе с детьми).
	const onNodeDragStop = useCallback(
		(_evt: unknown, primary: Node, draggedNodes: Node[]) => {
			const dragged = (draggedNodes && draggedNodes.length ? draggedNodes : [primary]).filter(Boolean);
			const movable = dragged.filter((n) => (n.data as any)?.executionType !== 'loop');
			if (movable.length === 0) return;

			const draggedIds = new Set(dragged.map((n) => n.id));
			const changes = new Map<string, { parentId?: string; position: XYPosition }>();

			for (const n of movable) {
				const abs = getAbsolutePosition(reactFlow, n.id);
				if (!abs) continue;
				const { w, h } = getNodeSize(n);
				const center = { x: abs.x + w / 2, y: abs.y + h / 2 };

				// Целью не может быть сама нода или другая нода из текущего перетаскивания.
				const targetLoop = findLoopAtPoint(reactFlow, center, draggedIds);
				const newParent = targetLoop?.id;
				const currentParent = (n as any).parentId as string | undefined;
				if (newParent === currentParent) continue;

				if (newParent) {
					const loopAbs = getAbsolutePosition(reactFlow, newParent);
					if (!loopAbs) continue;
					changes.set(n.id, { parentId: newParent, position: { x: abs.x - loopAbs.x, y: abs.y - loopAbs.y } });
				} else {
					changes.set(n.id, { parentId: undefined, position: abs });
				}
			}

			if (changes.size === 0) return;

			reactFlow.setNodes((nodes) => {
				const updated = nodes.map((n) => {
					const c = changes.get(n.id);
					if (!c) return n;
					if (c.parentId) {
						// extent не задаём — иначе ноду нельзя будет вытащить обратно наружу.
						return { ...n, parentId: c.parentId, extent: undefined, position: c.position };
					}
					const { parentId, extent, ...rest } = n as any;
					return { ...rest, position: c.position } as Node;
				});
				return sortLoopsFirst(updated);
			});

			setTimeout(() => {
				changes.forEach((_c, id) => cascadeValidation(id));
			}, 0);
		},
		[reactFlow, cascadeValidation],
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

		// Свежий проект — чистая история undo/redo (ноды выше выставлены прямым
		// setNodes/setEdges, минуя onNodesChange, так что мусора там и так нет).
		resetHistory();

		console.log('[useFlowActions] ✅ onInit completed');
	}, [savedState, setNodes, setEdges, reactFlow, resetHistory]);

	return {
		nodes,
		edges,
		onNodesChange,
		onEdgesChange,
		onNodeDragStop,
		onBeforeDelete,
		onInit,
	};
};
