import { useReactFlow } from '@xyflow/react';
import { useCallback } from 'react';
import { CustomNodeData, Property } from '../definitions/types';
import { isValueValid } from '../utils/validation';
import { getPropertyValueAndType } from '../utils/getPropertyData';

export const useUpdateFlow = () => {
	const reactFlow = useReactFlow();

	const updateNodeProperty = useCallback(
		(nodeId: string, propertyId: string, value: any) => {
			// Обновляем ноду
			reactFlow.updateNode(nodeId, (node) => {
				const nodeData = node.data as CustomNodeData;

				// Обновляем конкретное property
				const nodeProperties = nodeData.properties.map((p) => {
					if (p.id !== propertyId) return p;
					return { ...p, controlProps: { ...p.controlProps, value } };
				}) as Property[];

				// Проверяем валидность ноды
				const isValid = nodeProperties.filter((p) => p.required).every(isValueValid);

				// Получаем output property
				const outputPropertyId = nodeData.output?.sourceProperty;
				const outputProperty = outputPropertyId ? nodeProperties.find((p) => p.id === outputPropertyId) : null;

				// ✅ Вычисляем computedOutput
				const computedOutput =
					isValid && outputProperty ? { [outputPropertyId as string]: getPropertyValueAndType(outputProperty) } : null;

				return {
					...node,
					data: {
						...nodeData,
						properties: nodeProperties,
						isValid,
						computedOutput, // ✅ Записываем в node.data
					},
				};
			});
		},
		[reactFlow],
	);

	return { updateNodeProperty };
};
