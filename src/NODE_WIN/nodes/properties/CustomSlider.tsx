import { SliderProperty, CustomNodeData, Property } from '@/NODE_WIN/definitions/types';
import { useNodeContext } from '@/NODE_WIN/hooks/useNodeContext';
import { useCascadeValidation } from '@/NODE_WIN/hooks/useCascadeValidation';
import { Box, Slider, Stack, TextField, Typography } from '@mui/material';
import { useReactFlow, useUpdateNodeInternals } from '@xyflow/react';
import { memo, useState, useCallback, useEffect } from 'react';
import { greyColor } from '@/Store/Color/grayColor';
import { colorTypes_store } from '@/Store/Color/colorTypes_store';
import InputHandle from '../components/InputHandle';
import PropertyLabelEditor from './PropertyLabelEditor';
import TooltipOrDelete from './TooltipOrDelete';

interface CustomSliderProps {
	property: SliderProperty;
	onChange?: (value: number) => void;
}

function CustomSlider({ property, onChange }: CustomSliderProps) {
	const nodeId = useNodeContext();
	const reactFlow = useReactFlow();
	const updateNodeInternals = useUpdateNodeInternals();
	const { controlProps } = property;
	const colorTypes = colorTypes_store((s) => s.colorTypes);
	const defColor = colorTypes.default as string;
	const { handleEdgeRemoval, handleNodePropertyChange } = useCascadeValidation();

	const editLabel = controlProps?.editLabel ?? false;
	const tooltip = controlProps?.tooltip ?? '';
	const isDynamic = editLabel && !tooltip;

	const initialValue = controlProps.value ?? controlProps.initValue ?? 0;
	const [actualValue, setActualValue] = useState<number>(Number(initialValue));
	const [inputValue, setInputValue] = useState<string>(String(initialValue));
	const [isFocused, setIsFocused] = useState(false);

	const minValue = controlProps.minValue ?? 0;
	const maxValue = controlProps.maxValue ?? 100;
	const step = controlProps.step ?? 1;
	const allowManualInput = controlProps.isTextInput ?? controlProps.useValuesAsLabels ?? false;
	const showMinMaxLabels = controlProps.minMaxValueVisible ?? true;

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

	const handleSliderChange = (_event: Event, value: number | number[]) => {
		const newValue = typeof value === 'number' ? value : value[0];
		setActualValue(newValue);
		setInputValue(String(newValue));
		onChange?.(newValue);
	};

	const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		if (!allowManualInput) return;
		const value = e.target.value;
		if (!/^-?[0-9]*\.?[0-9]*$/.test(value)) return;
		setInputValue(value);
	};

	const handleInputBlur = () => {
		if (!allowManualInput) return;
		setIsFocused(false);
		const parsedValue = parseFloat(inputValue) || 0;
		setActualValue(parsedValue);
		setInputValue(String(parsedValue));
		onChange?.(parsedValue);
	};

	const handleInputFocus = () => {
		if (!allowManualInput) return;
		setIsFocused(true);
	};

	const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
		if (e.key === 'Enter') {
			(e.target as HTMLInputElement).blur();
		}
	};

	const sliderValue = Math.max(minValue, Math.min(maxValue, actualValue));

	useEffect(() => {
		setActualValue(Number(controlProps.value ?? controlProps.initValue ?? 0));
		setInputValue(String(controlProps.value ?? controlProps.initValue ?? 0));
	}, [controlProps.value]);

	return (
		<Stack direction='column' px='12px' className='nodrag' gap={0.5}>
			<Stack direction='row' alignItems='center' position='relative' gap={1}>
				{property.isInput && <InputHandle property={property} />}

				<PropertyLabelEditor label={controlProps?.label ?? ''} editLabel={editLabel} onSave={handleSaveLabel} />

				<TooltipOrDelete isDynamic={isDynamic} tooltip={tooltip} onDelete={handleDelete} />
			</Stack>

			<Box sx={{ display: 'flex', alignItems: 'center', gap: 2, width: '100%' }}>
				{showMinMaxLabels && (
					<Typography sx={{ color: '#ffffff4a', fontWeight: 'bold', fontSize: '1rem', minWidth: '30px' }}>{minValue}</Typography>
				)}

				<Box sx={{ flex: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
					<Slider min={minValue} max={maxValue} value={sliderValue} onChange={handleSliderChange} step={step} size='small' />

					{allowManualInput ? (
						<TextField
							value={isFocused ? inputValue : actualValue}
							onChange={handleInputChange}
							onBlur={handleInputBlur}
							onFocus={handleInputFocus}
							onKeyDown={handleKeyDown}
							size='small'
							sx={{
								width: '70px',
								'& .MuiInputBase-input': {
									fontFamily: 'monospace',
									fontSize: '1rem',
									padding: '4px 8px',
									textAlign: 'right',
									color: greyColor(85),
								},
							}}
						/>
					) : (
						<Typography sx={{ color: defColor, fontSize: '1rem', minWidth: '40px', textAlign: 'right' }}>{actualValue}</Typography>
					)}
				</Box>

				{showMinMaxLabels && (
					<Typography sx={{ color: '#ffffff4a', fontWeight: 'bold', fontSize: '1rem', minWidth: '30px' }}>{maxValue}</Typography>
				)}
			</Box>
		</Stack>
	);
}

export default memo(CustomSlider);
