import { useRef, useState } from 'react';
import { Box, Typography } from '@mui/material';
import { SquareArrowOutDownRight } from 'lucide-react';
import { greyColor } from '@/Store/Color/grayColor';

interface NodeResizeProps {
	width: number;
	height: number;
	onChange: (width: number, height: number) => void;
	minWidth?: number;
	minHeight?: number;
}

export function NodeResize({ width, height, onChange, minWidth = 200, minHeight = 80 }: NodeResizeProps) {
	const gray40 = greyColor(40);
	const gray60 = greyColor(60);
	const startX = useRef(0);
	const startY = useRef(0);
	const startW = useRef(0);
	const startH = useRef(0);

	const onMouseDown = (e: React.MouseEvent) => {
		e.preventDefault();
		e.stopPropagation();
		startX.current = e.clientX;
		startY.current = e.clientY;
		startW.current = width;
		startH.current = height;

		const onMove = (ev: MouseEvent) => {
			const newW = Math.max(minWidth, startW.current + (ev.clientX - startX.current));
			const newH = Math.max(minHeight, startH.current + (ev.clientY - startY.current));
			onChange(Math.round(newW), Math.round(newH));
		};

		const onUp = () => {
			document.removeEventListener('mousemove', onMove);
			document.removeEventListener('mouseup', onUp);
		};

		document.addEventListener('mousemove', onMove);
		document.addEventListener('mouseup', onUp);
	};

	return (
		<Box
			onMouseDown={onMouseDown}
			sx={{
				position: 'absolute',
				right: 0,
				bottom: 0,
				display: 'flex',
				alignItems: 'center',
				gap: 0.5,
				cursor: 'nwse-resize',
				zIndex: 10,
				px: 0.75,
				py: 0.35,
				bgcolor: `${greyColor(20)}cc`,
				border: `1px solid ${gray40}`,
				borderTopLeftRadius: 6,
				'&:hover': { bgcolor: `${greyColor(30)}cc` },
			}}
		>
			<Typography variant='caption' sx={{ fontSize: 9, color: gray60, fontFamily: 'monospace' }}>
				{width}×{height}
			</Typography>
			<SquareArrowOutDownRight size={11} color={gray60} />
		</Box>
	);
}
