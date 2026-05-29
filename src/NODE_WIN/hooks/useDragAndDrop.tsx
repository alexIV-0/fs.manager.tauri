import { useReactFlow } from '@xyflow/react';
import { Node } from '@xyflow/react';
import { nanoid } from 'nanoid';
import { DragEvent, useCallback } from 'react';
import { getPropertyValueAndType } from '../utils/getPropertyData';
import { Property } from '../definitions/types';
import { isValueValid } from '../utils/validation';
import { getNodeDefinitions } from '../definitions';

export const useDragAndDrop = () => {
	const reactFlow = useReactFlow();

	const onDragOver = useCallback((event: DragEvent) => {
		event.preventDefault();
		event.dataTransfer.dropEffect = 'move';
	}, []);

	const onDrop = useCallback(
		(event: DragEvent) => {
			event.preventDefault();

			const nodeType = event.dataTransfer.getData('application/reactflow');
			const nodeReference = getNodeDefinitions().find((node) => node.type === nodeType);

			if (!nodeReference) return;

			const nodeWidth = typeof nodeReference.width === 'number' ? nodeReference.width : 0;

			// Позиция в координатах flow
			const flowPosition = reactFlow.screenToFlowPosition({
				x: event.clientX - nodeWidth / 2.5,
				y: event.clientY - 15,
			});

			// Ищем Loop ноду под курсором — если дроп произошёл внутри группы
			const allNodes = reactFlow.getNodes();
			const parentLoopNode = findParentLoopNode(allNodes, flowPosition);

			const newId = nanoid(5);

			// Вычисляем isValid
			const isValid = (nodeReference.data.properties as Property[]).filter((p) => p.required).every(isValueValid);

			// Вычисляем computedOutput
			let computedOutput = null;
			if (isValid) {
				const outputPropertyId = nodeReference.data.output?.sourceProperty;
				if (outputPropertyId) {
					const outputProperty = nodeReference.data.properties.find((p: Property) => p.id === outputPropertyId);
					if (outputProperty) {
						const { value, type } = getPropertyValueAndType(outputProperty);
						computedOutput = { [outputPropertyId]: { value, type } };
					}
				}
			}

			// Если дроп внутрь Loop группы — позиция относительно родителя
			let position = flowPosition;
			let parentId: string | undefined = undefined;

			if (parentLoopNode) {
				// Переводим в локальные координаты группы
				position = {
					x: flowPosition.x - parentLoopNode.position.x,
					y: flowPosition.y - parentLoopNode.position.y,
				};
				parentId = parentLoopNode.id;
			}

			const newNode: Node = {
				...nodeReference,
				position,
				id: newId,
				// Если нода внутри группы — добавляем parentId и extent
				...(parentId ? { parentId, extent: 'parent' } : {}),
				data: {
					...nodeReference.data,
					id: newId,
					isValid,
					computedOutput,
					disabled: false,
					pluginId: nodeReference.data.pluginId,
					pluginVersion: nodeReference.data.pluginVersion,
				},
			};

			reactFlow.setNodes((nodes) => [...nodes, newNode]);
		},
		[reactFlow],
	);

	return {
		onDragOver,
		onDrop,
	};
};

// Находит Loop ноду в которую попадает точка дропа
// Проверяем все ноды с executionType === 'loop' и смотрим входит ли точка в их bounds
function findParentLoopNode(nodes: Node[], position: { x: number; y: number }): Node | undefined {
	return nodes.find((node) => {
		if ((node.data as any)?.executionType !== 'loop') return false;

		const nodeX = node.position.x;
		const nodeY = node.position.y;
		const nodeW = node.measured?.width ?? (node as any).width ?? 600;
		const nodeH = node.measured?.height ?? (node as any).height ?? 400;

		return position.x >= nodeX && position.x <= nodeX + nodeW && position.y >= nodeY && position.y <= nodeY + nodeH;
	});
}
