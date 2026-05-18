// connectionValidation.ts
import { Node, Edge, Connection } from '@xyflow/react';

export interface ValidationResult {
	isValid: boolean;
	sourceId: string;
	targetId: string;
	sourceHandle?: string;
	targetHandle?: string;
	sourceType?: string;
	targetType?: string;
	dataValue?: any; // 👈 добавили сюда
	error?: string;
}

type CustomNode = Node<any>;

export const handleValidation = (connection: Connection, nodes: CustomNode[], edges: Edge[]): ValidationResult => {
	if (!connection.source || !connection.target) {
		return { isValid: false, sourceId: '', targetId: '', error: 'Missing source or target' };
	}
	// debugger;
	if (!connection.sourceHandle || !connection.targetHandle) {
		return {
			isValid: false,
			sourceId: connection.source,
			targetId: connection.target,
			error: 'Missing handles',
		};
	}

	const { source, target, sourceHandle, targetHandle } = connection;

	const sourceNode = nodes.find((n) => n.id === source);
	const targetNode = nodes.find((n) => n.id === target);
	// console.log('sourceNode', sourceNode);
	// console.log('targetNode', targetNode);
	// debugger;

	if (!sourceNode || !targetNode || sourceNode.id === targetNode.id) {
		return { isValid: false, sourceId: source, targetId: target, error: 'Node not found' };
	}

	// const sourceNodeConfig = nodeTypeHandleConfig[sourceNode.type || ''];
	// const targetNodeConfig = nodeTypeHandleConfig[targetNode.type || ''];

	// if (!sourceNodeConfig || !targetNodeConfig) {
	// 	// Если конфигов нет — просто пропускаем валидацию, но всё равно возвращаем dataValue
	// 	return {
	// 		isValid: false,
	// 		sourceId: source,
	// 		targetId: target,
	// 		sourceHandle,
	// 		targetHandle,
	// 	};
	// }

	// const sourceHandleConfig = sourceHandle ? sourceNodeConfig.outputs?.[sourceHandle] : undefined;
	// const targetHandleConfig = targetHandle ? targetNodeConfig.inputs?.[targetHandle] : undefined;
	const sourceHandleConfig = sourceHandle ? sourceNode.data.output?.[sourceHandle] : undefined;
	const targetHandleConfig = targetHandle ? targetNode.data.input?.[targetHandle] : undefined;

	if (!sourceHandleConfig || !targetHandleConfig) {
		return {
			isValid: false,
			sourceId: source,
			targetId: target,
			sourceHandle,
			targetHandle,
			error: 'Handle not found',
		};
	}

	const isTypeCompatible = targetHandleConfig.allowedTypes?.includes(sourceHandleConfig.id);

	if (!isTypeCompatible) {
		return {
			isValid: false,
			sourceId: source,
			targetId: target,
			sourceHandle,
			targetHandle,
			error: 'Types incompatible',
		};
	}

	if (targetHandleConfig.maxConnections !== undefined && targetHandleConfig.maxConnections !== -1) {
		const existingConnections = edges.filter((e) => e.target === target && e.targetHandle === targetHandle);
		if (existingConnections.length + 1 > targetHandleConfig.maxConnections) {
			return {
				isValid: false,
				sourceId: source,
				targetId: target,
				sourceHandle,
				targetHandle,
				error: 'Max connections exceeded',
			};
		}
	}

	return {
		isValid: true,
		sourceId: source,
		targetId: target,
		sourceHandle,
		targetHandle,
		sourceType: sourceHandleConfig?.type,
	};
};
