import { Property, CustomNodeData, isDynamicProperty } from '@/NODE_WIN/definitions/types';
import { useNodeContext } from '@/NODE_WIN/hooks/useNodeContext';
import { useCascadeValidation } from '@/NODE_WIN/hooks/useCascadeValidation';
import { colorTypes_store } from '@/Store/Color/colorTypes_store';
import { Stack, Typography, TextField } from '@mui/material';
import { useEdges, useNodesData, useReactFlow, useUpdateNodeInternals } from '@xyflow/react';
import { useEffect, useState, useRef, useCallback } from 'react';

import TooltipOrDelete from './TooltipOrDelete';
import { CustomNode } from '@/NODE_WIN/definitions/types';
import InputHandle from '../components/InputHandle';

export default function LinkProperty({ property }: { property: Property }) {
	const nodeId = useNodeContext();
	const reactFlow = useReactFlow();
	const updateNodeInternals = useUpdateNodeInternals();
	const colorTypes = colorTypes_store((s) => s.colorTypes);
	const edges = useEdges();
	const { handleEdgeRemoval, handleNodePropertyChange } = useCascadeValidation();

	// Раньше тут было голое useNodes() — широкая подписка на любое изменение в любой ноде.
	// Плюс useEffect ниже не имел `nodes` в deps, так что подписка работала впустую
	// (re-render без обновления label). Теперь — точечная подписка на source-ноду,
	// и sourceData в deps useEffect, чтобы label корректно обновлялся при изменении источника.
	const incomingEdge = edges.find((e) => e.target === nodeId && e.targetHandle === property.id);
	const sourceData = useNodesData(incomingEdge?.source ?? '');

	const [label, setLabel] = useState('');

	// --- editLabel state ---
	const editLabel = property.controlType === 'link' ? ((property.controlProps as any).editLabel ?? false) : false;
	const tooltip = property.controlProps?.tooltip ?? '';

	// Свойство добавлено пользователем через «+» → своя подсказка + корзина
	const isDynamic = isDynamicProperty(property);

	const [isEditingLabel, setIsEditingLabel] = useState(false);
	const [labelValue, setLabelValue] = useState(property.controlProps?.label ?? '');
	const inputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		const edge = edges.find((e) => e.target === nodeId && e.targetHandle === property.id);

		if (!edge) {
			setLabel('');
			return;
		}

		const sourceNode = reactFlow.getNode(edge.source) as CustomNode;
		if (!sourceNode?.data?.computedOutput) {
			setLabel('');
			return;
		}

		const computedOutput = sourceNode.data.computedOutput as Record<string, { value: any; type: string }>;
		const sourceProperty = computedOutput[edge.sourceHandle ?? ''];
		if (!sourceProperty) {
			setLabel('');
			return;
		}

		const displayValue = sourceProperty.value || sourceProperty.type || '';
		setLabel(Array.isArray(displayValue) ? displayValue.join(', ') : String(displayValue));
	}, [edges, sourceData, nodeId, property.id, reactFlow]);

	// Сохраняем label в node data
	const saveLabel = useCallback(
		(newLabel: string) => {
			reactFlow.updateNode(nodeId, (node) => {
				const nodeData = node.data as CustomNodeData;
				const updatedProperties = nodeData.properties.map((p) => {
					if (p.id !== property.id) return p;
					return {
						...p,
						controlProps: { ...p.controlProps, label: newLabel },
					};
				});
				return { ...node, data: { ...nodeData, properties: updatedProperties } };
			});
		},
		[nodeId, property.id, reactFlow],
	);

	// Удаляем этот динамический компонент и все его входящие edges
	const handleDelete = useCallback(() => {
		// 1. Находим все входящие edges на этот handle
		const incomingEdges = reactFlow.getEdges().filter((e) => e.target === nodeId && e.targetHandle === property.id);

		// 2. Удаляем edges из reactFlow
		if (incomingEdges.length > 0) {
			reactFlow.setEdges((eds) => eds.filter((e) => !(e.target === nodeId && e.targetHandle === property.id)));
		}

		// 3. Удаляем property из ноды
		reactFlow.updateNode(nodeId, (node) => {
			const nodeData = node.data as CustomNodeData;
			const updatedProperties = nodeData.properties.filter((p) => p.id !== property.id) as Property[];
			return { ...node, data: { ...nodeData, properties: updatedProperties } };
		});

		// 4. Каскадная валидация и обновление internals
		setTimeout(() => {
			incomingEdges.forEach((edge) => handleEdgeRemoval(edge));
			handleNodePropertyChange(nodeId);
			updateNodeInternals(nodeId);
		}, 0);
	}, [nodeId, property.id, reactFlow, handleEdgeRemoval, handleNodePropertyChange, updateNodeInternals]);

	const handleLabelDoubleClick = () => {
		if (!editLabel) return;
		setIsEditingLabel(true);
		setTimeout(() => inputRef.current?.focus(), 0);
	};

	const handleLabelBlur = () => {
		setIsEditingLabel(false);
		saveLabel(labelValue);
	};

	const handleLabelKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === 'Enter') {
			setIsEditingLabel(false);
			saveLabel(labelValue);
		}
		if (e.key === 'Escape') {
			setIsEditingLabel(false);
			setLabelValue(property.controlProps?.label ?? '');
		}
	};

	return (
		<Stack direction={'column'} px={'12px'} className='nodrag'>
			<Stack direction='row' alignItems='center' position='relative' gap={1}>
				{property.isInput && <InputHandle property={property} />}

				{isEditingLabel ? (
					<TextField
						inputRef={inputRef}
						value={labelValue}
						onChange={(e) => setLabelValue(e.target.value)}
						onBlur={handleLabelBlur}
						onKeyDown={handleLabelKeyDown}
						variant='standard'
						size='small'
						className='nodrag'
						sx={{ fontSize: '14px', flex: 1 }}
						slotProps={{ input: { style: { fontSize: '14px' } } }}
					/>
				) : (
					<Typography
						variant='subtitle2'
						className='nodrag'
						fontWeight={400}
						noWrap
						color={colorTypes.default as string}
						sx={{
							cursor: editLabel ? 'text' : 'default',
							flex: 1,
							borderBottom: editLabel ? '1px dashed transparent' : 'none',
							'&:hover': editLabel ? { borderBottomColor: 'rgba(255,255,255,0.3)' } : {},
						}}
						onDoubleClick={handleLabelDoubleClick}
					>
						{labelValue}
					</Typography>
				)}

				{/* Общий трейлинг: своя подсказка + корзина у динамического, tooltip у статического. */}
				<TooltipOrDelete isDynamic={isDynamic} tooltip={tooltip} onDelete={handleDelete} property={property} />
			</Stack>

			<Typography variant='body1' sx={{ fontSize: '12px' }}>
				{label || '...'}
			</Typography>
		</Stack>
	);
}
