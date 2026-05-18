import { blueColor, greenColor, redColor, steelColor } from '@/Store/Color/grayColor';
import { useProcessingStatus_store } from '@/Store/Node/useProcessingStatus_store';
import { Box, Stack, StackProps } from '@mui/material';
import { useNodesData } from '@xyflow/react';
import { memo, PropsWithChildren } from 'react';

interface NodeShellProps extends PropsWithChildren {
	sx?: StackProps['sx'];
	nodeId?: string;
}

function NodeShell({ children, sx, nodeId }: NodeShellProps) {
	const activeNodeId = useProcessingStatus_store((s) => s.activeNodeId);
	const status = useProcessingStatus_store((s) => (nodeId ? s.nodeStatuses[nodeId] : undefined));

	const nodeData = useNodesData(nodeId ?? '');
	const isLoop = (nodeData?.data as any)?.executionType === 'loop';

	const isActive = !!nodeId && activeNodeId === nodeId;
	const isError = status === 'error';
	const isDone = status === 'done';

	const getShadow = () => {
		if (isError) return `0 0 16px 4px ${redColor(20)}`;
		if (isActive) return `0 0 20px 6px ${blueColor(40)}`;
		if (isDone) return `0 0 20px -2px ${greenColor(40, 40)}`;
		return undefined;
	};

	return (
		<Box
			className='node-shell'
			sx={{
				boxShadow: getShadow(),
				borderRadius: 'inherit',
				transition: 'box-shadow 0.3s ease',
				animation: isActive ? 'nodePulse 1.2s ease-in-out infinite' : 'none',
				'@keyframes nodePulse': {
					'0%': { boxShadow: `0 0 12px 3px ${blueColor(25)}` },
					'50%': { boxShadow: `0 0 24px 24px ${blueColor(35, 85)}` },
					'100%': { boxShadow: `0 0 12px 3px ${blueColor(25)}` },
				},
			}}
		>
			<Stack
				direction='column'
				gap={2}
				overflow='hidden'
				sx={{
					...sx,
					...(isLoop ? { height: '100%' } : {}),
				}}
			>
				{children}
			</Stack>
		</Box>
	);
}

export default memo(NodeShell);
