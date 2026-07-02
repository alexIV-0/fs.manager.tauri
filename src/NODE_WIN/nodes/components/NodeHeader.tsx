import { useNodeContext } from '@/NODE_WIN/hooks/useNodeContext';
import { useCascadeValidation } from '@/NODE_WIN/hooks/useCascadeValidation';
import { complimentColor } from '@/NODE_WIN/utils/complimentColor';
import { getMultiVersionPlugins } from '@/NODE_WIN/definitions';
import { colorTypes_store } from '@/Store/Color/colorTypes_store';
import { IconButton, Stack, Typography } from '@mui/material';
import { useNodesData, useReactFlow } from '@xyflow/react';
import { Power, X } from 'lucide-react';
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

	const { deleteElements, updateNode } = useReactFlow();
	const { handleNodePropertyChange } = useCascadeValidation();

	const handleRemove = useCallback(() => {
		deleteElements({ nodes: [{ id: nodeId }] });
	}, [nodeId, deleteElements]);

	const isDisabled = !!node.data.disabled;

	const { setEdges } = useReactFlow();

	const handleToggleDisabled = useCallback(
		(e: React.MouseEvent) => {
			// stopPropagation чтобы клик не доходил до react-flow и не селектил ноду
			e.stopPropagation();
			const newDisabled = !isDisabled;
			updateNode(nodeId, (n) => ({
				...n,
				data: newDisabled
					? { ...n.data, disabled: true, isValid: false, computedOutput: null }
					: { ...n.data, disabled: false },
			}));

			// Флипаем active на всех edges, связанных с этой нодой.
			setEdges((edges) => {
				if (newDisabled) {
					// Disable: все edges ноды → inactive.
					return edges.map((edge) =>
						edge.source === nodeId || edge.target === nodeId
							? { ...edge, data: { ...(edge.data as any), active: false } }
							: edge,
					);
				}
				// Enable: пытаемся активировать edges. Если target-слот уже занят
				// другим активным коннектором (замена) — оставляем неактивным.
				// Это conservative conflict avoidance; явный resolver — этап 4.
				const occupiedSlots = new Set<string>();
				for (const edge of edges) {
					const isOurs = edge.source === nodeId || edge.target === nodeId;
					const active = (edge.data as any)?.active !== false;
					if (!isOurs && active) {
						occupiedSlots.add(`${edge.target}::${edge.targetHandle ?? ''}`);
					}
				}
				return edges.map((edge) => {
					const isOurs = edge.source === nodeId || edge.target === nodeId;
					if (!isOurs) return edge;
					const slot = `${edge.target}::${edge.targetHandle ?? ''}`;
					if (occupiedSlots.has(slot)) {
						return { ...edge, data: { ...(edge.data as any), active: false } };
					}
					occupiedSlots.add(slot);
					return { ...edge, data: { ...(edge.data as any), active: true } };
				});
			});

			// setTimeout нужен чтобы zustand закоммитил state — иначе cascade прочитает
			// stale node и normal-path validateAndUpdateNode перезатрёт disabled:true
			// (он спредит nodeData, захваченный в начале функции, через ...nodeData).
			setTimeout(() => handleNodePropertyChange(nodeId), 0);
		},
		[nodeId, isDisabled, updateNode, setEdges, handleNodePropertyChange],
	);

	useEffect(() => {
		// ✅ Читаем isValid из node.data
		const nodeColorType = node.data.colorType;

		if (node.data.isValid && !isDisabled) {
			setBackgroundColor(colorTypes[nodeColorType] as string);
		} else {
			setBackgroundColor(defColor);
		}
	}, [node.data.isValid, node.data.colorType, colorTypes, defColor, isDisabled]);

	const showVersion = useMemo(() => {
		const pid = node.data?.pluginId;
		const pver = node.data?.pluginVersion;
		if (!pid || !pver) return null;
		return getMultiVersionPlugins().has(pid) ? pver : null;
	}, [node.data?.pluginId, node.data?.pluginVersion]);

	return (
		<Stack direction={'row'} alignItems={'center'} p={'6px 14px'} bgcolor={backgroundColor} borderRadius={'4px 4px 0 0'} color={textColor}>
			{(!node.data.isUnique || (node.data as any).disablable) && (
				<IconButton
					onClick={handleToggleDisabled}
					size='small'
					sx={{ color: textColor, opacity: isDisabled ? 0.5 : 1, mr: 0.5, ml: -0.5 }}
					title={isDisabled ? 'Включить ноду' : 'Выключить ноду'}
				>
					<Power size={16} strokeWidth={2} />
				</IconButton>
			)}
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
