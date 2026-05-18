import { CustomNode } from '@/NODE_WIN/definitions/types';
import { useNodeContext } from '@/NODE_WIN/hooks/useNodeContext';
import { complimentColor } from '@/NODE_WIN/utils/complimentColor';
import { colorTypes_store } from '@/Store/Color/colorTypes_store';
import { useEditableField } from '@/hooks/useEditableField';
import { TextField, Typography } from '@mui/material';
import { useNodesData, useReactFlow } from '@xyflow/react';

export const NodeName = () => {
	const nodeId = useNodeContext();
	const node = useNodesData(nodeId) as CustomNode;
	const { updateNode } = useReactFlow();
	const colorTypes = colorTypes_store((s) => s.colorTypes);
	const curColor = colorTypes[node.data.colorType] || colorTypes.default;
	const textColor = complimentColor(curColor as string);

	const { isEditing, startEditing, inputProps } = useEditableField({
		initialValue: node.data.label,
		onSave: (newLabel) => {
			updateNode(nodeId, (n) => ({ ...n, data: { ...n.data, label: newLabel } }));
		},
	});

	return isEditing ? (
		<TextField
			{...inputProps}
			variant='standard'
			className='nodrag'
			sx={{
				'& input': { color: textColor, fontWeight: 500, fontSize: '1.3rem', padding: 0 },
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
			sx={{ cursor: 'text', color: textColor, fontWeight: 500, fontSize: '1.3rem' }}
		>
			{node.data.label}
		</Typography>
	);
};
