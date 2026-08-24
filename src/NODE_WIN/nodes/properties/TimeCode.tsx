import { TimeCodeProperty, CustomNodeData, CustomNode, Property, isDynamicProperty } from '@/NODE_WIN/definitions/types';
import { useNodeContext } from '@/NODE_WIN/hooks/useNodeContext';
import { useCascadeValidation } from '@/NODE_WIN/hooks/useCascadeValidation';
import { Stack, TextField } from '@mui/material';
import { useEdges, useReactFlow, useUpdateNodeInternals } from '@xyflow/react';
import { useEffect, useState, useCallback } from 'react';
import { colorTypes_store } from '@/Store/Color/colorTypes_store';
import InputHandle from '../components/InputHandle';
import PropertyLabelEditor from './PropertyLabelEditor';
import TooltipOrDelete from './TooltipOrDelete';

interface TimeCodeProps {
	property: TimeCodeProperty;
	onChange?: (value: number) => void;
}

// Преобразует секунды в таймкод HH:MM:SS
function secondsToTimecode(totalSeconds: number): string {
	const absSeconds = Math.abs(totalSeconds);
	const hours = Math.floor(absSeconds / 3600);
	const minutes = Math.floor((absSeconds % 3600) / 60);
	const seconds = Math.floor(absSeconds % 60);

	const sign = totalSeconds < 0 ? '-' : '';
	return `${sign}${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

// Парсит пользовательский ввод и преобразует в секунды
function parseUserInput(input: string): number {
	if (!input || input === '') return 0;

	const trimmed = input.trim();

	if (trimmed.includes(':')) {
		const parts = trimmed.split(':').map((p) => parseInt(p) || 0);

		if (parts.length === 3) {
			const [hours, minutes, seconds] = parts;
			return hours * 3600 + minutes * 60 + seconds;
		} else if (parts.length === 2) {
			const [minutes, seconds] = parts;
			return minutes * 60 + seconds;
		}
	}

	const normalized = trimmed.replace(',', '.');

	if (normalized.includes('.')) {
		const parts = normalized.split('.');
		let totalSeconds = 0;

		if (parts.length >= 1 && parts[0]) {
			const minutes = parseInt(parts[0]) || 0;
			totalSeconds += minutes * 60;
		}
		if (parts.length >= 2 && parts[1]) {
			let seconds = parseInt(parts[1]) || 0;
			const extraMinutes = Math.floor(seconds / 60);
			seconds = seconds % 60;
			totalSeconds += extraMinutes * 60 + seconds;
		}
		if (parts.length >= 3 && parts[2]) {
			const hours = parseInt(parts[2]) || 0;
			totalSeconds += hours * 3600;
		}

		return totalSeconds;
	}

	return parseInt(normalized) || 0;
}

export default function TimeCode({ property, onChange }: TimeCodeProps) {
	const nodeId = useNodeContext();
	const reactFlow = useReactFlow();
	const updateNodeInternals = useUpdateNodeInternals();
	const edges = useEdges();
	const { controlProps } = property;
	const { handleEdgeRemoval, handleNodePropertyChange } = useCascadeValidation();

	const colorTypes = colorTypes_store((s) => s.colorTypes);

	const editLabel = controlProps?.editLabel ?? false;
	const tooltip = controlProps?.tooltip ?? '';
	const isDynamic = isDynamicProperty(property);

	const [isExternal, setIsExternal] = useState(false);
	const [displayValue, setDisplayValue] = useState('00:00:00');

	// Проверяем входящее подключение
	useEffect(() => {
		const edge = edges.find((e) => e.target === nodeId && e.targetHandle === property.id);

		if (!edge) {
			setIsExternal(false);
			const initSeconds = controlProps.value ?? 0;
			setDisplayValue(secondsToTimecode(initSeconds));
			return;
		}

		const sourceNode = reactFlow.getNode(edge.source) as CustomNode;
		if (!sourceNode?.data?.computedOutput) {
			setIsExternal(false);
			return;
		}

		const computedOutput = sourceNode.data.computedOutput as Record<string, { value: any; type: string }>;
		const sourceProperty = computedOutput[edge.sourceHandle as string];

		if (!sourceProperty) {
			setIsExternal(false);
			return;
		}

		const externalSeconds = parseFloat(sourceProperty.value as string) || 0;
		setIsExternal(true);
		setDisplayValue(secondsToTimecode(externalSeconds));
	}, [edges, nodeId, property.id, controlProps.value, reactFlow]);

	// Сохраняем label в node data
	const handleSaveLabel = useCallback(
		(newLabel: string) => {
			reactFlow.updateNode(nodeId, (node) => {
				const nodeData = node.data as CustomNodeData;
				const updatedProperties = nodeData.properties.map((p) => {
					if (p.id !== property.id) return p;
					return { ...p, controlProps: { ...p.controlProps, label: newLabel } };
				});
				return { ...node, data: { ...nodeData, properties: updatedProperties } };
			});
		},
		[nodeId, property.id, reactFlow],
	);

	// Удаляем этот динамический компонент
	const handleDelete = useCallback(() => {
		const incomingEdges = reactFlow.getEdges().filter((e) => e.target === nodeId && e.targetHandle === property.id);

		if (incomingEdges.length > 0) {
			reactFlow.setEdges((eds) => eds.filter((e) => !(e.target === nodeId && e.targetHandle === property.id)));
		}

		reactFlow.updateNode(nodeId, (node) => {
			const nodeData = node.data as CustomNodeData;
			const updatedProperties = nodeData.properties.filter((p) => p.id !== property.id) as Property[];
			return { ...node, data: { ...nodeData, properties: updatedProperties } };
		});

		setTimeout(() => {
			incomingEdges.forEach((edge) => handleEdgeRemoval(edge));
			handleNodePropertyChange(nodeId);
			updateNodeInternals(nodeId);
		}, 0);
	}, [nodeId, property.id, reactFlow, handleEdgeRemoval, handleNodePropertyChange, updateNodeInternals]);

	const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		if (isExternal) return;
		const value = e.target.value;
		if (!/^[0-9.,:\s]*$/.test(value)) return;
		setDisplayValue(value);
	};

	const handleBlur = () => {
		if (isExternal) return;
		const parsedSeconds = displayValue === '' ? 0 : parseUserInput(displayValue);
		setDisplayValue(secondsToTimecode(parsedSeconds));
		onChange?.(parsedSeconds);
	};

	const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
		if (e.key === 'Enter') {
			(e.target as HTMLInputElement).blur();
		}
	};

	return (
		<Stack direction='column' px='12px' className='nodrag' gap={0.5}>
			<Stack direction='row' alignItems='center' position='relative' gap={1}>
				{property.isInput && <InputHandle property={property} />}

				<PropertyLabelEditor label={controlProps?.label ?? ''} editLabel={editLabel} onSave={handleSaveLabel} />

				<TooltipOrDelete isDynamic={isDynamic} tooltip={tooltip} onDelete={handleDelete} property={property} />
			</Stack>

			<TextField
				value={displayValue}
				onChange={handleInputChange}
				onBlur={handleBlur}
				onKeyDown={handleKeyDown}
				disabled={isExternal}
				size='small'
				placeholder='00:00:00'
				sx={{
					'& .MuiInputBase-input': {
						fontFamily: 'monospace',
						fontSize: '1rem',
						color: isExternal ? '#ffffff80' : (colorTypes.default as string),
					},
					'& .MuiOutlinedInput-root': {
						'& fieldset': {
							borderColor: isExternal ? '#ffffff20' : undefined,
						},
					},
				}}
			/>
		</Stack>
	);
}
