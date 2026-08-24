import { SliderProperty, CustomNodeData, Property, isDynamicProperty } from '@/NODE_WIN/definitions/types';
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
import { clampForFormat, formatNumeric, normalizeNumeric, numericConfigKey, parseNumeric, sliderConfig } from '@/Utils/numericFormat';

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
	const isDynamic = isDynamicProperty(property);

	const config = sliderConfig(controlProps);
	const configKey = numericConfigKey(config);
	const { min: minValue, max: maxValue } = config;

	const initialValue = Number(controlProps.value ?? controlProps.initValue ?? 0);
	const [actualValue, setActualValue] = useState<number>(normalizeNumeric(initialValue, config));
	const [inputValue, setInputValue] = useState<string>(() => formatNumeric(normalizeNumeric(initialValue, config), config));
	const [isFocused, setIsFocused] = useState(false);

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

	// Слайдер отдаёт значения кратные step, но для float step вида 0.1 всплывает
	// плавающая точка (0.30000000000000004) — приводим к формату.
	const handleSliderChange = (_event: Event, value: number | number[]) => {
		const newValue = clampForFormat(typeof value === 'number' ? value : value[0], config);
		setActualValue(newValue);
		setInputValue(formatNumeric(newValue, config));
		onChange?.(newValue);
	};

	const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		if (!allowManualInput) return;
		const value = e.target.value;
		// В таймкоде допустимы ':' — общий числовой фильтр их бы съел.
		const allowed = config.format === 'timecode' ? /^-?[0-9:.,]*$/ : /^-?[0-9]*[.,]?[0-9]*$/;
		if (!allowed.test(value)) return;
		setInputValue(value);
	};

	const handleInputBlur = () => {
		if (!allowManualInput) return;
		setIsFocused(false);
		const parsed = parseNumeric(inputValue, config, config.allowManualOverride);
		if (parsed === null) {
			setInputValue(formatNumeric(actualValue, config)); // мусор на входе — откат
			return;
		}
		setActualValue(parsed);
		setInputValue(formatNumeric(parsed, config));
		onChange?.(parsed);
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

	// Сам слайдер границы не переступает, даже если ручной ввод вывел значение за них.
	const sliderValue = clampForFormat(actualValue, config);

	// Значение/настройки пришли снаружи (вход, шестерёнка, pluginBuilder) —
	// пересобираем и значение, и текст в поле (формат мог поменяться).
	useEffect(() => {
		const next = normalizeNumeric(Number(controlProps.value ?? controlProps.initValue ?? 0), config);
		setActualValue(next);
		setInputValue(formatNumeric(next, config));
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [controlProps.value, configKey]);

	return (
		<Stack direction='column' px='12px' className='nodrag' gap={0.5}>
			<Stack direction='row' alignItems='center' position='relative' gap={1}>
				{property.isInput && <InputHandle property={property} />}

				<PropertyLabelEditor label={controlProps?.label ?? ''} editLabel={editLabel} onSave={handleSaveLabel} />

				<TooltipOrDelete isDynamic={isDynamic} tooltip={tooltip} onDelete={handleDelete} property={property} />
			</Stack>

			<Box sx={{ display: 'flex', alignItems: 'center', gap: 2, width: '100%' }}>
				{showMinMaxLabels && (
					<Typography sx={{ color: '#ffffff4a', fontWeight: 'bold', fontSize: '1rem', minWidth: '30px', whiteSpace: 'nowrap', flexShrink: 0 }}>
						{formatNumeric(minValue, config)}
					</Typography>
				)}

				<Box sx={{ flex: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
					<Slider min={minValue} max={maxValue} value={sliderValue} onChange={handleSliderChange} step={config.step} size='small' />

					{allowManualInput ? (
						<TextField
							value={isFocused ? inputValue : formatNumeric(actualValue, config)}
							onChange={handleInputChange}
							onBlur={handleInputBlur}
							onFocus={handleInputFocus}
							onKeyDown={handleKeyDown}
							size='small'
							sx={{
								width: config.format === 'timecode' ? '106px' : '70px',
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
						<Typography sx={{ color: defColor, fontSize: '1rem', minWidth: '40px', textAlign: 'right', whiteSpace: 'nowrap' }}>
							{formatNumeric(actualValue, config)}
						</Typography>
					)}
				</Box>

				{showMinMaxLabels && (
					<Typography sx={{ color: '#ffffff4a', fontWeight: 'bold', fontSize: '1rem', minWidth: '30px', whiteSpace: 'nowrap', flexShrink: 0 }}>
						{formatNumeric(maxValue, config)}
					</Typography>
				)}
			</Box>
		</Stack>
	);
}

export default memo(CustomSlider);
