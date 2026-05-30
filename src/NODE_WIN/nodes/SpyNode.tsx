import { CustomNode } from '@/NODE_WIN/definitions/types';
import { colorTypes_store } from '@/Store/Color/colorTypes_store';
import { Box } from '@mui/material';
import { Handle, NodeProps, Position, useEdges, useNodesData, useReactFlow } from '@xyflow/react';
import { memo, useMemo } from 'react';

// Reroute / passthrough node. Тип портов берётся от upstream-ноды через computedOutput.
// Никаких настроек, заголовка, comment'а. Только два хендлера и точка цвета входящего типа.
const NODE_W = 80;
const NODE_H = 28;
const HANDLE = 14;

function SpyNode(props: NodeProps) {
	const nodeId = props.id;
	const edges = useEdges();
	const reactFlow = useReactFlow();
	const colorTypes = colorTypes_store((s) => s.colorTypes);

	const incomingEdge = edges.find((e) => e.target === nodeId && e.targetHandle === 'in');
	useNodesData(incomingEdge?.source ?? '');

	const color = useMemo(() => {
		if (!incomingEdge) return colorTypes.default as string;
		const sourceNode = reactFlow.getNode(incomingEdge.source) as CustomNode | undefined;
		if (!sourceNode?.data?.isValid) return colorTypes.error as string;
		const co = sourceNode.data.computedOutput as Record<string, { value: any; type: string }> | null;
		const t = co?.[incomingEdge.sourceHandle ?? '']?.type;
		if (!t) return colorTypes.default as string;
		return (colorTypes[t] as string) ?? (colorTypes.default as string);
	}, [incomingEdge, edges, reactFlow, colorTypes]);

	const hasIncoming = !!incomingEdge;

	// Inline-стили для хендлеров перебивают глобальный .react-flow__handle (position: relative)
	const handleBase: React.CSSProperties = {
		position: 'absolute',
		top: '50%',
		width: HANDLE,
		height: HANDLE,
		transform: 'translateY(-50%)',
		backgroundColor: color,
		border: '2px solid rgba(0,0,0,0.3)',
	};

	return (
		<Box
			sx={{
				position: 'relative',
				width: NODE_W,
				height: NODE_H,
				borderRadius: `${NODE_H / 2}px`,
				bgcolor: color,
				opacity: hasIncoming ? 1 : 0.5,
				transition: 'background-color 0.2s ease, opacity 0.2s ease',
				boxShadow: '0 1px 2px rgba(0,0,0,0.3)',
			}}
		>
			<Handle
				id='in'
				type='target'
				position={Position.Left}
				style={{ ...handleBase, left: -HANDLE / 2 }}
				isConnectableStart={false}
				isConnectable={!hasIncoming}
			/>
			<Handle
				id='out'
				type='source'
				position={Position.Right}
				style={{ ...handleBase, right: -HANDLE / 2, left: 'auto' }}
				isConnectable={true}
			/>
		</Box>
	);
}

export default memo(SpyNode);
