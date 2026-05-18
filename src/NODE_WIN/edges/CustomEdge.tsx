import { useColorFromTargetNode } from '@/NODE_WIN/hooks';
import { Button, Zoom } from '@mui/material';
import { BaseEdge, EdgeLabelRenderer, getBezierPath, useReactFlow, type EdgeProps } from '@xyflow/react';
import { X } from 'lucide-react';
import { memo, useState } from 'react';
import './index.css';

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
	const { setEdges } = useReactFlow();
	const color = useColorFromTargetNode(props);

	const toggleButtonVisibility = (state: boolean) => () => {
		setTimeout(() => {
			setIsHovered(state);
		}, 100);
	};

	const onDelete = () => {
		setEdges((edges) => edges.filter((edge) => edge.id !== props.id));
	};

	return (
		<g onMouseEnter={toggleButtonVisibility(true)} onMouseLeave={toggleButtonVisibility(false)}>
			<BaseEdge path={edgePath} style={{ '--edge-color': color } as React.CSSProperties} />
			<EdgeLabelRenderer>
				<div
					className='button-edge__label nodrag nopan'
					style={{
						transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
					}}
				>
					<Zoom in={isHovered}>
						<Button className='button-edge__button' size='small' variant='contained' onClick={onDelete}>
							<X size={24} strokeWidth={1.25} />
						</Button>
					</Zoom>
				</div>
			</EdgeLabelRenderer>
		</g>
	);
}

export default memo(CustomEdge);
