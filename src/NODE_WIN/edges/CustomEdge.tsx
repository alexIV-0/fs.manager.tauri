import { useColorFromTargetNode } from '@/NODE_WIN/hooks';
import { useCascadeValidation } from '@/NODE_WIN/hooks/useCascadeValidation';
import { isEdgeActive } from '@/NODE_WIN/utils/edgeActive';
import { Button, Stack, Zoom } from '@mui/material';
import { BaseEdge, EdgeLabelRenderer, getBezierPath, useReactFlow, type EdgeProps, type Edge, type Node } from '@xyflow/react';
import { Split, X } from 'lucide-react';
import { nanoid } from 'nanoid';
import { memo, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { getNodeDefinitions } from '../definitions';
import './index.css';

const SPY_W = 80;
const SPY_H = 28;

function CustomEdge(props: EdgeProps) {
	const { sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition } = props;
	const [isHovered, setIsHovered] = useState(false);
	const [edgePath, labelX, labelY] = getBezierPath({
		sourceX,
		sourceY,
		sourcePosition,
		targetX,
		targetY,
		targetPosition,
	});
	const { setEdges, setNodes, screenToFlowPosition } = useReactFlow();
	const { cascadeValidation } = useCascadeValidation();
	const color = useColorFromTargetNode(props);
	const active = isEdgeActive({ data: (props as any).data } as Edge);

	const toggleButtonVisibility = (state: boolean) => () => {
		setTimeout(() => {
			setIsHovered(state);
		}, 100);
	};

	const onDelete = () => {
		setEdges((edges) => edges.filter((edge) => edge.id !== props.id));
	};

	// Вставка spy-ноды на edge: разрывает текущий edge на два и вставляет spy в точке клика.
	const insertSpy = (clientX: number, clientY: number) => {
		const spyDef = getNodeDefinitions().find((n: any) => n.type === 'spy');
		if (!spyDef) return;

		const flowPos = screenToFlowPosition({ x: clientX, y: clientY });
		const position = { x: flowPos.x - SPY_W / 2, y: flowPos.y - SPY_H / 2 };

		const newId = nanoid(5);
		const newSpy: Node = {
			...(spyDef as any),
			id: newId,
			position,
			data: {
				...(spyDef as any).data,
				id: newId,
				isValid: false,
				computedOutput: null,
				disabled: false,
			},
		};

		setNodes((nodes) => [...nodes, newSpy]);
		setEdges((edges) => {
			const original = edges.find((e) => e.id === props.id);
			if (!original) return edges;
			const remaining = edges.filter((e) => e.id !== props.id);
			// Новые edges наследуют active от оригинального (по умолчанию active).
			const inheritActive = (original.data as any)?.active !== false;
			const e1: Edge = {
				id: `e-${original.source}-${newId}`,
				source: original.source,
				sourceHandle: original.sourceHandle,
				target: newId,
				targetHandle: 'in',
				data: { active: inheritActive },
			};
			const e2: Edge = {
				id: `e-${newId}-${original.target}`,
				source: newId,
				sourceHandle: 'out',
				target: original.target,
				targetHandle: original.targetHandle,
				data: { active: inheritActive },
			};
			return [...remaining, e1, e2];
		});

		// Прогоняем каскад от только что вставленной spy: иначе её computedOutput.out
		// останется null (edge без типа/цвета), а downstream-нода не переинициализирует
		// inheritedValue под новый источник. setTimeout(0) — ждём коммита setNodes/setEdges
		// в стор (тот же приём, что в useConnection.onConnect).
		setTimeout(() => cascadeValidation(newId), 0);
	};

	// Middle-click (wheel) по edge — вставка spy в точке клика.
	// stopPropagation нужен потому что panOnDrag={[1]} в FlowNodeView вешает пан на средний клик.
	const onEdgeMouseDown = (e: ReactMouseEvent<SVGGElement>) => {
		if (e.button !== 1) return;
		e.preventDefault();
		e.stopPropagation();
		insertSpy(e.clientX, e.clientY);
	};

	const onSplitClick = (e: ReactMouseEvent<HTMLButtonElement>) => {
		e.stopPropagation();
		insertSpy(e.clientX, e.clientY);
	};

	return (
		<g
			onMouseEnter={toggleButtonVisibility(true)}
			onMouseLeave={toggleButtonVisibility(false)}
			onMouseDown={onEdgeMouseDown}
			opacity={active ? 1 : 0.35}
		>
			<BaseEdge
				path={edgePath}
				style={{
					'--edge-color': color,
					strokeDasharray: active ? undefined : '6 4',
				} as React.CSSProperties}
			/>
			<EdgeLabelRenderer>
				<div
					className='button-edge__label nodrag nopan'
					style={{
						transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
					}}
				>
					<Zoom in={isHovered}>
						<Stack direction='row' gap={0.5}>
							<Button className='button-edge__button' size='small' variant='contained' onClick={onSplitClick} title='Вставить Spy'>
								<Split size={20} strokeWidth={1.5} />
							</Button>
							<Button className='button-edge__button' size='small' variant='contained' onClick={onDelete} title='Удалить'>
								<X size={24} strokeWidth={1.25} />
							</Button>
						</Stack>
					</Zoom>
				</div>
			</EdgeLabelRenderer>
		</g>
	);
}

export default memo(CustomEdge);
