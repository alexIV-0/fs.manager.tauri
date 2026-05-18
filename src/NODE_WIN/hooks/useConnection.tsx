import { CustomNode, Property } from '@/NODE_WIN/definitions/types';
import type { Connection, Edge } from '@xyflow/react';
import { addEdge, useReactFlow } from '@xyflow/react';
import { useCallback } from 'react';
import { useCascadeValidation } from './useCascadeValidation';

// Хэндлеры Loop ноды — не описаны в data.properties, обрабатываем отдельно
const LOOP_HANDLES = new Set(['loopInput', 'inputInLoop', 'outputInLoop', 'loopResult']);

function isLoopNode(node: CustomNode): boolean {
	return node.data?.executionType === 'loop';
}

export const useConnection = () => {
	const reactFlow = useReactFlow();
	const { handleEdgeAdd } = useCascadeValidation();

	const onConnect = useCallback(
		(connection: Connection) => {
			const targetNode = reactFlow.getNode(connection.target) as CustomNode;
			const sourceNode = reactFlow.getNode(connection.source) as CustomNode;

			if (!targetNode || !sourceNode) return;

			// Если один из участников — Loop нода, пропускаем проверку properties
			// и сразу добавляем edge (валидация типов для loop хэндлеров не нужна)
			const targetIsLoop = isLoopNode(targetNode) && LOOP_HANDLES.has(connection.targetHandle ?? '');
			const sourceIsLoop = isLoopNode(sourceNode) && LOOP_HANDLES.has(connection.sourceHandle ?? '');

			if (targetIsLoop || sourceIsLoop) {
				reactFlow.setEdges((edges) => addEdge(connection, edges));

				if (sourceIsLoop && connection.target) {
					// Проверяем что computedOutput уже записан в Loop ноду
					// const loopNode = reactFlow.getNode(connection.source);
					// console.log('[onConnect] sourceIsLoop, loop node computedOutput:', loopNode?.data?.computedOutput);
					// console.log('[onConnect] sourceHandle:', connection.sourceHandle);
					// console.log('[onConnect] target:', connection.target);

					setTimeout(() => {
						// Проверяем ещё раз после таймаута
						const loopNodeAfter = reactFlow.getNode(connection.source);
						console.log('[onConnect setTimeout] loop node computedOutput:', loopNodeAfter?.data?.computedOutput);
						handleEdgeAdd(connection.target);
					}, 50); // увеличим до 50ms
				}
				return;
			}

			// Стандартная проверка для обычных нод
			const targetProperty = targetNode.data.properties.find((p: Property) => p.id === connection.targetHandle);
			const sourceProperty = sourceNode.data.properties.find((p: Property) => p.id === connection.sourceHandle);

			if (!targetProperty || !sourceProperty) return;

			reactFlow.setEdges((edges) => addEdge(connection, edges));

			setTimeout(() => {
				handleEdgeAdd(connection.target);
			}, 0);
		},
		[handleEdgeAdd, reactFlow],
	);

	const validateConnection = useCallback(
		(connection: Connection | Edge) => {
			const targetNode = reactFlow.getNode(connection.target) as CustomNode;
			const sourceNode = reactFlow.getNode(connection.source) as CustomNode;

			if (!targetNode || !sourceNode) return false;

			// Если один из участников — Loop нода с loop хэндлером — разрешаем
			const targetIsLoop = isLoopNode(targetNode) && LOOP_HANDLES.has(connection.targetHandle ?? '');
			const sourceIsLoop = isLoopNode(sourceNode) && LOOP_HANDLES.has(connection.sourceHandle ?? '');

			if (targetIsLoop || sourceIsLoop) return true;

			// Стандартная валидация для обычных нод
			const targetProperty = targetNode.data.properties.find((p: Property) => p.id === connection.targetHandle);
			const sourceProperty = sourceNode.data.properties.find((p: Property) => p.id === connection.sourceHandle);

			if (!targetProperty || !sourceProperty) return false;

			if (!targetProperty.acceptedTypes) return true;

			// ✅ если acceptedTypes содержит "all" — разрешаем любое соединение
			if (targetProperty.acceptedTypes.includes('all')) return true;

			// Проверяем реальный тип из computedOutput
			const sourceOutput = sourceNode.data.computedOutput as Record<string, { value: any; type: string }> | null;
			const sourceHandle = connection.sourceHandle as string;
			const actualType = sourceOutput?.[sourceHandle]?.type;

			if (actualType) {
				return targetProperty.acceptedTypes.includes(actualType);
			}

			// Тип не определён (computedOutput = null или тип ещё не вычислен) — разрешаем.
			// Реальная проверка типов произойдёт через каскадную валидацию после соединения.
			return true;
		},
		[reactFlow],
	);

	return { onConnect, validateConnection };
};
