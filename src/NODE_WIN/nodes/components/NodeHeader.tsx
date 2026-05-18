import { useNodeContext } from '@/NODE_WIN/hooks/useNodeContext';
import { complimentColor } from '@/NODE_WIN/utils/complimentColor';
import { getMultiVersionPlugins } from '@/NODE_WIN/definitions';
import { colorTypes_store } from '@/Store/Color/colorTypes_store';
import { IconButton, Stack, Typography } from '@mui/material';
import { useNodesData, useReactFlow } from '@xyflow/react';
import { X } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';

import { NodeName } from './NodeName';
import NodeCost from './NodeCost';

function NodeHeader() {
	const nodeId = useNodeContext();
	const node = useNodesData(nodeId) as any;

	const colorTypes = colorTypes_store((s) => s.colorTypes);
	const defColor = colorTypes.default as string;
	const [backgroundColor, setBackgroundColor] = useState<string>(defColor);

	const textColor = complimentColor(backgroundColor);

	const { deleteElements } = useReactFlow();

	const handleRemove = useCallback(() => {
		deleteElements({ nodes: [{ id: nodeId }] });
	}, [nodeId, deleteElements]);

	useEffect(() => {
		// ✅ Читаем isValid из node.data
		const nodeColorType = node.data.colorType;

		if (node.data.isValid) {
			setBackgroundColor(colorTypes[nodeColorType] as string);
		} else {
			setBackgroundColor(defColor);
		}
	}, [node.data.isValid, node.data.colorType, colorTypes, defColor]); // ✅ Зависимость от node.data.isValid

	const showVersion = useMemo(() => {
		const pid = node.data?.pluginId;
		const pver = node.data?.pluginVersion;
		if (!pid || !pver) return null;
		return getMultiVersionPlugins().has(pid) ? pver : null;
	}, [node.data?.pluginId, node.data?.pluginVersion]);

	return (
		<Stack direction={'row'} alignItems={'center'} p={'6px 14px'} bgcolor={backgroundColor} borderRadius={'4px 4px 0 0'} color={textColor}>
			{showVersion && (
				<Typography sx={{ fontSize: '14px', fontWeight: 600, opacity: 0.35, mr: 1, ml: -0.5, lineHeight: 1, userSelect: 'none' }}>
					{showVersion}
				</Typography>
			)}
			<NodeName />
			<NodeCost textColor={textColor} />
			{node.data.isUnique ? null : (
				<IconButton onClick={handleRemove} size='small' sx={{ color: textColor }}>
					<X />
				</IconButton>
			)}
		</Stack>
	);
}

export default memo(NodeHeader);
