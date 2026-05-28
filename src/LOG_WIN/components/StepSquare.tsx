import { Box } from '@mui/material';
import type { StepInfo } from '../types';
import { STEP_COLOR } from '../utils';

export function StepSquare({ status }: { status: StepInfo['status'] }) {
	const color = STEP_COLOR[status];
	const isRunning = status === 'running';
	return (
		<Box
			component='span'
			sx={{
				display: 'inline-block',
				width: 10,
				height: 10,
				borderRadius: '2px',
				bgcolor: color,
				flexShrink: 0,
				animation: isRunning ? 'pulse 1s ease-in-out infinite' : undefined,
			}}
		/>
	);
}
