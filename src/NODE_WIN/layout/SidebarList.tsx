import { complimentColor } from '@/NODE_WIN/utils/complimentColor';
import { colorTypes_store } from '@/Store/Color/colorTypes_store';
import { Box, BoxProps, Typography } from '@mui/material';
import { memo, useMemo } from 'react';
import { CustomNodeData } from '../definitions/types';
import { getMultiVersionPlugins } from '../definitions';

interface SideNodeProps extends BoxProps {
	nodeData: CustomNodeData;
}

const SideNode = ({ nodeData, ...props }: SideNodeProps) => {
	const colorTypes = colorTypes_store((s) => s.colorTypes);
	const curColor = colorTypes[nodeData.colorType] || colorTypes.default;
	const textColor: string = complimentColor(curColor as string);

	const showVersion = useMemo(() => {
		if (!nodeData.pluginId || !nodeData.pluginVersion) return null;
		const multi = getMultiVersionPlugins();
		return multi.has(nodeData.pluginId) ? nodeData.pluginVersion : null;
	}, [nodeData.pluginId, nodeData.pluginVersion]);

	return (
		<Box
			{...props}
			sx={{
				height: '30px',
				borderRadius: '4px',
				transition: 'border-color 0.2s ease',
				backgroundColor: props.draggable ? curColor : colorTypes.default,
				cursor: props.draggable ? 'pointer' : 'not-allowed',
				position: 'relative',
			}}
		>
			{showVersion && (
				<Typography
					sx={{
						position: 'absolute',
						left: 6,
						top: '50%',
						transform: 'translateY(-50%)',
						fontSize: '10px',
						fontWeight: 600,
						color: textColor,
						opacity: 0.35,
						lineHeight: 1,
						userSelect: 'none',
					}}
				>
					{showVersion}
				</Typography>
			)}
			<Typography
				sx={{
					fontSize: '16px',
					fontWeight: 500,
					color: textColor,
					textAlign: 'center',
					lineHeight: '30px',
				}}
			>
				{nodeData.label}
			</Typography>
		</Box>
	);
};

export default memo(SideNode);
