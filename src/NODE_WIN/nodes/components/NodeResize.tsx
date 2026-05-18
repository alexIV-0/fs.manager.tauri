import { Box } from '@mui/material';
import { NodeResizeControl, useStore } from '@xyflow/react';
import { SquareArrowOutDownRight } from 'lucide-react';
import { memo } from 'react';

const controlStyle = {
	background: 'transparent',
	border: 'none',
	zIndex: 100,
};

function NodeResize() {
	// useViewport() подписывает на весь viewport-объект (x, y, zoom) — ре-рендер
	// на каждый пиксель pan'а. Селектор ниже подписывает только на zoom.
	const zoom = useStore((s) => s.transform[2]);
	const clamp = (num: number, min: number, max: number) => Math.min(Math.max(num, min), max);
	const size = Math.round(clamp(zoom, 0, 1) * 15);

	return (
		<NodeResizeControl style={controlStyle} minWidth={100} minHeight={50}>
			<Box
				sx={{
					position: 'absolute',
					color: 'white',
					display: 'flex',
					transform: `translate(-100%, -100%)`,
					transformOrigin: 'bottom right',
				}}
			>
				<SquareArrowOutDownRight size={size} strokeWidth={1.25} />
			</Box>
		</NodeResizeControl>
	);
}

export default memo(NodeResize);
