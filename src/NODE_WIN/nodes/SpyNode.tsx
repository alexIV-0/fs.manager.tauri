import { CustomNode } from '@/NODE_WIN/definitions/types';
import { complimentColor } from '@/NODE_WIN/utils/complimentColor';
import { isEdgeActive } from '@/NODE_WIN/utils/edgeActive';
import { colorTypes_store } from '@/Store/Color/colorTypes_store';
import { useEditableField } from '@/hooks/useEditableField';
import { Box, TextField, Typography } from '@mui/material';
import { Handle, NodeProps, Position, useEdges, useNodesData, useReactFlow, useUpdateNodeInternals } from '@xyflow/react';
import { memo, useEffect, useMemo } from 'react';

// Reroute / passthrough node. Тип портов берётся от upstream-ноды через computedOutput.
// Своих настроек/comment'а нет — только два хендлера, точка цвета входящего типа и
// редактируемое имя (чтобы reroute-узлы в графе не были безликими).
const NODE_W = 80;
const NODE_H = 28;
const HANDLE = 14;

function SpyNode(props: NodeProps) {
	const nodeId = props.id;
	const selected = props.selected;
	const edges = useEdges();
	const reactFlow = useReactFlow();
	const { updateNode } = reactFlow;
	const updateNodeInternals = useUpdateNodeInternals();
	const colorTypes = colorTypes_store((s) => s.colorTypes);

	// Собственные данные ноды — реактивно, чтобы имя обновлялось после переименования.
	const self = useNodesData(nodeId) as CustomNode | null;
	const label = (self?.data?.label as string) ?? 'Spy';

	const { isEditing, startEditing, inputProps } = useEditableField({
		initialValue: label,
		onSave: (newLabel) => {
			updateNode(nodeId, (n) => ({ ...n, data: { ...n.data, label: newLabel } }));
		},
	});

	// Имя (и режим правки — поле фиксировано 140px) меняет ширину пилюли → правый хендл
	// уезжает. React Flow кеширует позиции хендлов с момента монтирования, поэтому без
	// явного пересчёта рёбра приходят в старую точку. updateNodeInternals перемеряет
	// хендлы по актуальному DOM.
	useEffect(() => {
		updateNodeInternals(nodeId);
	}, [label, isEditing, nodeId, updateNodeInternals]);

	// Только активный вход. Inactive-коннектор (от выключенной ноды) — «история»:
	// слот должен оставаться свободным для подмены источника (то же правило, что
	// в InputHandle.tsx). Иначе isConnectable={!hasIncoming} мёртво глушит хендл и
	// validateConnection даже не спрашивается.
	const incomingEdge = edges.find((e) => e.target === nodeId && e.targetHandle === 'in' && isEdgeActive(e));
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
	const textColor = complimentColor(color);

	// Inline-стили для хендлеров перебивают глобальный .react-flow__handle (position: relative)
	const handleBase: React.CSSProperties = {
		position: 'absolute',
		top: '50%',
		width: HANDLE,
		height: HANDLE,
		transform: 'translateY(-50%)',
		backgroundColor: color,
		border: '2px solid rgba(0,0,0,0.3)',
		zIndex: 1,
	};

	return (
		<Box
			sx={{
				position: 'relative',
				minWidth: NODE_W,
				maxWidth: 240,
				width: 'fit-content',
				height: NODE_H,
				borderRadius: `${NODE_H / 2}px`,
				bgcolor: color,
				opacity: hasIncoming ? 1 : 0.5,
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'center',
				px: 1.5,
				transition: 'background-color 0.2s ease, opacity 0.2s ease',
				// Подсветку выделения рисуем кольцом на самой пилюле (повторяет её радиус),
				// а дефолтный outline обёртки гасим в index.css (.react-flow__node-spy.selected).
				// box-shadow статичный, без transition — анимация тени на нодах RF вызывает
				// мерцание слоя канваса (см. project_reactflow_boxshadow_flicker).
				boxShadow: selected ? '0 0 0 3px #18b835c8, 0 1px 2px rgba(0,0,0,0.3)' : '0 1px 2px rgba(0,0,0,0.3)',
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

			{isEditing ? (
				<TextField
					{...inputProps}
					variant='standard'
					className='nodrag'
					sx={{
						width: 140,
						'& input': {
							color: textColor,
							fontWeight: 500,
							fontSize: '1rem',
							padding: 0,
							textAlign: 'center',
						},
						'& .MuiInput-underline:before': { borderBottomColor: textColor },
						'& .MuiInput-underline:after': { borderBottomColor: textColor },
						'& .MuiInput-underline:hover:not(.Mui-disabled):before': { borderBottomColor: textColor },
					}}
				/>
			) : (
				<Typography
					onDoubleClick={(e) => {
						e.stopPropagation();
						e.preventDefault();
						startEditing();
					}}
					sx={{
						cursor: 'text',
						color: textColor,
						fontWeight: 500,
						fontSize: '1rem',
						lineHeight: 1,
						whiteSpace: 'nowrap',
						overflow: 'hidden',
						textOverflow: 'ellipsis',
						userSelect: 'none',
					}}
				>
					{label}
				</Typography>
			)}

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
