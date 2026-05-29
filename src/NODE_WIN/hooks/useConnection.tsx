import { CustomNode, Property } from '@/NODE_WIN/definitions/types';
import { isEdgeActive } from '@/NODE_WIN/utils/edgeActive';
import type { Connection, Edge } from '@xyflow/react';
import { addEdge, useReactFlow } from '@xyflow/react';
import { useCallback } from 'react';
import { useCascadeValidation } from './useCascadeValidation';

// Хелпер: новые edges создаются всегда активными.
function withActive(connection: Connection): Connection & { data: { active: true } } {
	return { ...connection, data: { active: true } } as any;
}

// Хэндлеры Loop ноды — не описаны в data.properties, обрабатываем отдельно
const LOOP_HANDLES = new Set(['loopInput', 'inputInLoop', 'outputInLoop', 'loopResult']);

function isLoopNode(node: CustomNode): boolean {
	return node.data?.executionType === 'loop';
}

function isSpyNode(node: CustomNode): boolean {
	return node.type === 'spy';
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
				reactFlow.setEdges((edges) => addEdge(withActive(connection), edges));

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

			// Spy-нода не имеет properties — пропускаем стандартную проверку и
			// добавляем edge напрямую. Тип пробрасывается через cascade validation.
			if (isSpyNode(targetNode) || isSpyNode(sourceNode)) {
				reactFlow.setEdges((edges) => addEdge(withActive(connection), edges));
				setTimeout(() => {
					if (connection.target) handleEdgeAdd(connection.target);
				}, 0);
				return;
			}

			// Стандартная проверка для обычных нод
			const targetProperty = targetNode.data.properties.find((p: Property) => p.id === connection.targetHandle);
			const sourceProperty = sourceNode.data.properties.find((p: Property) => p.id === connection.sourceHandle);

			if (!targetProperty || !sourceProperty) return;

			reactFlow.setEdges((edges) => addEdge(withActive(connection), edges));

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

			// Слот target-хендлера занят активным коннектором — отклоняем.
			// Inactive (от выключенных нод) не блокируют слот — можно подменить источник.
			const existingActive = reactFlow.getEdges().some((e) =>
				e.target === connection.target &&
				e.targetHandle === connection.targetHandle &&
				isEdgeActive(e)
			);
			if (existingActive) return false;

			// Если один из участников — Loop нода с loop хэндлером — разрешаем
			const targetIsLoop = isLoopNode(targetNode) && LOOP_HANDLES.has(connection.targetHandle ?? '');
			const sourceIsLoop = isLoopNode(sourceNode) && LOOP_HANDLES.has(connection.sourceHandle ?? '');

			if (targetIsLoop || sourceIsLoop) return true;

			// ── SPY как target: принимает любой тип на 'in' ──────────────────
			if (isSpyNode(targetNode) && connection.targetHandle === 'in') return true;

			// ── SPY как source ('out'): проверяем тип downstream-цели против
			// computedOutput.out у spy (он зеркалит upstream-тип). Если spy ещё
			// не получил вход — разрешаем (тип проверится после cascade).
			if (isSpyNode(sourceNode) && connection.sourceHandle === 'out') {
				const targetProperty = targetNode.data.properties.find((p: Property) => p.id === connection.targetHandle);
				if (!targetProperty?.acceptedTypes) return true;
				if (targetProperty.acceptedTypes.includes('all')) return true;
				const co = sourceNode.data.computedOutput as Record<string, { value: any; type: string }> | null;
				const spyType = co?.['out']?.type;
				if (!spyType) return true; // ещё не определился — разрешаем
				return targetProperty.acceptedTypes.includes(spyType);
			}

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
