import { Property, CustomNode } from '@/NODE_WIN/definitions/types';
import { useNodeContext } from '@/NODE_WIN/hooks/useNodeContext';
import { colorTypes_store } from '@/Store/Color/colorTypes_store';
import { Handle, Position, useEdges, useNodesData, useReactFlow } from '@xyflow/react';
import { useEffect, useState } from 'react';

/**
 * InputHandle - только отображение, вся логика валидации в useCascadeValidation
 */
export default function InputHandle({ property }: { property: Property }) {
	const nodeId = useNodeContext();
	const edges = useEdges();
	const reactFlow = useReactFlow();
	const colorTypes = colorTypes_store((s) => s.colorTypes);
	const [color, setColor] = useState(colorTypes.default);

	const handleConnections = edges.filter((edge) => edge.target === nodeId && edge.targetHandle === property.id);

	// Раньше тут было useNodes() — широкая подписка, ре-рендерящая на любое изменение
	// в любой ноде графа. На drag-tick это умножало работу × количество InputHandles.
	// Теперь подписываемся точечно на ту source-ноду, чьи isValid/computedOutput читаем ниже.
	const incomingEdge = edges.find((e) => e.target === nodeId && e.targetHandle === property.id);
	const sourceData = useNodesData(incomingEdge?.source ?? '');

	useEffect(() => {
		const edge = edges.find((e) => e.target === nodeId && e.targetHandle === property.id);

		if (!edge) {
			setColor(colorTypes.default);
			return;
		}

		const sourceNode = reactFlow.getNode(edge.source) as CustomNode;

		// Для Loop ноды — считаем валидной если есть computedOutput.inputInLoop
		const isLoopSource = edge.sourceHandle === 'inputInLoop' && (sourceNode?.data as any)?.executionType === 'loop';

		if (isLoopSource) {
			const loopOutput = (sourceNode?.data?.computedOutput as any)?.[edge.sourceHandle ?? ''];
			if (loopOutput?.type && colorTypes[loopOutput.type]) {
				setColor(colorTypes[loopOutput.type]);
			} else {
				setColor(colorTypes.default);
			}
			return;
		}

		// Стандартная логика для обычных нод
		if (!sourceNode?.data?.isValid) {
			setColor(colorTypes.error);
			return;
		}

		const computedOutput = sourceNode.data.computedOutput as Record<string, { value: any; type: string }> | null;
		const sourceOutput = computedOutput?.[edge.sourceHandle as string];

		if (sourceOutput?.type) {
			setColor(colorTypes[sourceOutput.type] ?? colorTypes.default);
		} else {
			setColor(colorTypes.default);
		}
	}, [edges, sourceData, nodeId, property.id, reactFlow, colorTypes]);

	return (
		<Handle
			id={property.id}
			type='target'
			position={Position.Left}
			style={{ backgroundColor: color as string }}
			isConnectableStart={false}
			isConnectable={handleConnections.length < 1}
		/>
	);
}
