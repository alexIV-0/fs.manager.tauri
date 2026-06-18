import { TimeRangeProperty, CustomNodeData } from '@/NODE_WIN/definitions/types';
import { useNodeContext } from '@/NODE_WIN/hooks/useNodeContext';
import { Slider, Stack, TextField } from '@mui/material';
import { useReactFlow } from '@xyflow/react';
import { useCallback, useState } from 'react';
import { colorTypes_store } from '@/Store/Color/colorTypes_store';
import PropertyLabelEditor from './PropertyLabelEditor';
import TooltipOrDelete from './TooltipOrDelete';

interface TimeRangeProps {
	property: TimeRangeProperty;
	onChange?: (value: [number, number]) => void;
}

const DAY_MIN = 1440; // 24:00 в минутах
const MAX_SECONDS = 86400; // 24 часа в секундах

type FormatType = 'timecode' | 'float' | 'integer';

interface FormatConfig {
	format: FormatType;
	step?: number;
	unit?: 'minutes' | 'seconds'; // по умолчанию 'minutes' для совместимости
	range?: [number, number]; // [min, max]
	decimals?: number;
	allowManualOverride?: boolean; // позволить ввод за пределами слайдера
}

function getFormatConfig(controlProps: any): FormatConfig {
	const unit = controlProps?.unit ?? 'minutes';
	const defaultRange: [number, number] =
		unit === 'seconds' ? [0, MAX_SECONDS] : [0, DAY_MIN];
	const range = Array.isArray(controlProps?.range)
		? (controlProps.range as [number, number])
		: defaultRange;

	return {
		format: controlProps?.format ?? 'timecode',
		step: controlProps?.step ?? 5,
		unit,
		range,
		decimals: controlProps?.decimals ?? 2,
		allowManualOverride: controlProps?.allowManualOverride ?? true,
	};
}

function clampValue(v: number, min: number, max: number): number {
	if (!Number.isFinite(v)) return min;
	return Math.max(min, Math.min(max, Math.round(v)));
}

function clampValueToRange(v: number, config: FormatConfig): number {
	const [min, max] = config.range!;
	return clampValue(v, min, max);
}

// Форматирование в зависимости от типа
function formatValue(val: number, config: FormatConfig): string {
	const [min, max] = config.range!;
	const v = clampValue(val, min, max);
	if (config.format === 'timecode') {
		if (config.unit === 'seconds') {
			const m = Math.floor(v / 60);
			const s = v % 60;
			return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
		} else {
			const h = Math.floor(v / 60);
			const m = v % 60;
			return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
		}
	} else if (config.format === 'float') {
		return v.toFixed(config.decimals!);
	} else {
		return String(Math.round(v));
	}
}

// Парсинг в зависимости от типа
function parseValue(input: string, config: FormatConfig, allowOverride: boolean = false): number {
	const t = input.trim();
	if (t === '') return config.range![0];
	const [min, max] = config.range!;

	let parsed = 0;
	if (config.format === 'timecode') {
		if (t.includes(':')) {
			const parts = t.split(':');
			const first = parseInt(parts[0], 10) || 0;
			const second = parseInt(parts[1], 10) || 0;
			if (config.unit === 'seconds') {
				parsed = first * 60 + second;
			} else {
				parsed = first * 60 + second;
			}
		} else {
			// число — для секунд это просто число, для минут трактуем как часы
			const n = parseFloat(t.replace(',', '.'));
			if (!Number.isFinite(n)) return min;
			if (config.unit === 'seconds') {
				parsed = Math.round(n);
			} else {
				parsed = Math.round(n * 60);
			}
		}
	} else if (config.format === 'float') {
		const n = parseFloat(t.replace(',', '.'));
		parsed = Number.isFinite(n) ? n : min;
	} else {
		const n = parseInt(t, 10);
		parsed = Number.isFinite(n) ? n : min;
	}

	// Если allowOverride — не ограничиваем диапазоном (позволяем ручной ввод)
	// Иначе зажимаем к диапазону слайдера
	if (allowOverride) {
		return parsed;
	}
	return clampValue(parsed, min, max);
}

export default function TimeRange({ property, onChange }: TimeRangeProps) {
	const nodeId = useNodeContext();
	const reactFlow = useReactFlow();
	const { controlProps } = property;
	const colorTypes = colorTypes_store((s) => s.colorTypes);
	const config = getFormatConfig(controlProps);
	const [sliderMin, sliderMax] = config.range!;

	const editLabel = controlProps?.editLabel ?? false;
	const tooltip = controlProps?.tooltip ?? '';
	const isDynamic = editLabel && !tooltip;

	const initVal = Array.isArray(controlProps.value) ? controlProps.value : [sliderMin, sliderMax];
	const [range, setRange] = useState<[number, number]>([
		clampValueToRange(initVal[0] ?? sliderMin, config),
		clampValueToRange(initVal[1] ?? sliderMax, config),
	]);
	const [startText, setStartText] = useState<string>(formatValue(range[0], config));
	const [endText, setEndText] = useState<string>(formatValue(range[1], config));

	// Нормализуем (lo ≤ hi), синхронизируем окошки и сохраняем в ноду.
	const commit = useCallback(
		(next: [number, number]) => {
			const lo = Math.min(next[0], next[1]);
			const hi = Math.max(next[0], next[1]);
			// Зажимаем к диапазону слайдера, но позволяем ручному вводу выходить за границы
			const loFixed = clampValue(lo, sliderMin, sliderMax);
			const hiFixed = clampValue(hi, sliderMin, sliderMax);
			const fixed: [number, number] = [loFixed, hiFixed];
			setRange(fixed);
			setStartText(formatValue(loFixed, config));
			setEndText(formatValue(hiFixed, config));
			onChange?.(fixed);
		},
		[onChange, config, sliderMin, sliderMax],
	);

	const handleSaveLabel = useCallback(
		(newLabel: string) => {
			reactFlow.updateNode(nodeId, (node) => {
				const nodeData = node.data as CustomNodeData;
				const updatedProperties = nodeData.properties.map((p) =>
					p.id !== property.id ? p : { ...p, controlProps: { ...p.controlProps, label: newLabel } },
				);
				return { ...node, data: { ...nodeData, properties: updatedProperties } };
			});
		},
		[nodeId, property.id, reactFlow],
	);

	const handleDelete = useCallback(() => {
		reactFlow.updateNode(nodeId, (node) => {
			const nodeData = node.data as CustomNodeData;
			return {
				...node,
				data: { ...nodeData, properties: nodeData.properties.filter((p) => p.id !== property.id) },
			};
		});
	}, [nodeId, property.id, reactFlow]);

	// Слайдер: live-обновление окошек на drag, сохранение — на commit.
	const onSlider = (_: Event, v: number | number[]) => {
		if (!Array.isArray(v)) return;
		setRange([v[0], v[1]] as [number, number]);
		setStartText(formatValue(v[0], config));
		setEndText(formatValue(v[1], config));
	};
	const onSliderCommit = (_: Event | React.SyntheticEvent, v: number | number[]) => {
		if (Array.isArray(v)) commit([v[0], v[1]] as [number, number]);
	};

	const boxSx = {
		width: 64,
		'& .MuiInputBase-input': {
			fontFamily: 'monospace',
			fontSize: '0.9rem',
			textAlign: 'center',
			padding: '4px 6px',
			color: colorTypes.default as string,
		},
	};

	const handleStartBlur = () => {
		const parsed = parseValue(startText, config, config.allowManualOverride);
		commit([parsed, range[1]]);
	};

	const handleEndBlur = () => {
		const parsed = parseValue(endText, config, config.allowManualOverride);
		commit([range[0], parsed]);
	};

	return (
		<Stack direction='column' px='12px' className='nodrag' gap={0.5}>
			<Stack direction='row' alignItems='center' position='relative' gap={1}>
				<PropertyLabelEditor label={controlProps?.label ?? ''} editLabel={editLabel} onSave={handleSaveLabel} />
				<TooltipOrDelete isDynamic={isDynamic} tooltip={tooltip} onDelete={handleDelete} />
			</Stack>

			<Stack direction='row' alignItems='center' gap={1}>
				<TextField
					value={startText}
					onChange={(e) => setStartText(e.target.value)}
					onBlur={handleStartBlur}
					onKeyDown={(e) => {
						if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
					}}
					size='small'
					placeholder={config.format === 'timecode' ? '00:00' : '0'}
					sx={boxSx}
				/>

				<Slider
					value={range}
					min={sliderMin}
					max={sliderMax}
					step={config.step}
					disableSwap
					onChange={onSlider}
					onChangeCommitted={onSliderCommit}
					valueLabelDisplay='off'
					sx={{ flex: 1, mx: 0.5 }}
				/>

				<TextField
					value={endText}
					onChange={(e) => setEndText(e.target.value)}
					onBlur={handleEndBlur}
					onKeyDown={(e) => {
						if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
					}}
					size='small'
					placeholder={config.format === 'timecode' ? '24:00' : String(sliderMax)}
					sx={boxSx}
				/>
			</Stack>
		</Stack>
	);
}
