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

function clampMin(v: number): number {
	if (!Number.isFinite(v)) return 0;
	return Math.max(0, Math.min(DAY_MIN, Math.round(v)));
}

// минуты → "HH:MM" (1440 → "24:00")
function minutesToHHMM(min: number): string {
	const m = clampMin(min);
	const h = Math.floor(m / 60);
	const mm = m % 60;
	return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

// "HH:MM" | "H:MM" | число(часы) → минуты (0..1440)
function parseHHMM(input: string): number {
	const t = input.trim();
	if (t === '') return 0;
	if (t.includes(':')) {
		const [hRaw, mRaw] = t.split(':');
		const h = parseInt(hRaw, 10) || 0;
		const m = parseInt(mRaw, 10) || 0;
		return clampMin(h * 60 + m);
	}
	// просто число — трактуем как часы (6 → 06:00, 6.5 → 06:30)
	const n = parseFloat(t.replace(',', '.'));
	return Number.isFinite(n) ? clampMin(Math.round(n * 60)) : 0;
}

export default function TimeRange({ property, onChange }: TimeRangeProps) {
	const nodeId = useNodeContext();
	const reactFlow = useReactFlow();
	const { controlProps } = property;
	const colorTypes = colorTypes_store((s) => s.colorTypes);

	const editLabel = controlProps?.editLabel ?? false;
	const tooltip = controlProps?.tooltip ?? '';
	const isDynamic = editLabel && !tooltip;

	const initVal = Array.isArray(controlProps.value) ? controlProps.value : [0, DAY_MIN];
	const [range, setRange] = useState<[number, number]>([
		clampMin(initVal[0] ?? 0),
		clampMin(initVal[1] ?? DAY_MIN),
	]);
	const [startText, setStartText] = useState<string>(minutesToHHMM(range[0]));
	const [endText, setEndText] = useState<string>(minutesToHHMM(range[1]));

	// Нормализуем (lo ≤ hi), синхронизируем окошки и сохраняем в ноду.
	const commit = useCallback(
		(next: [number, number]) => {
			const lo = clampMin(Math.min(next[0], next[1]));
			const hi = clampMin(Math.max(next[0], next[1]));
			const fixed: [number, number] = [lo, hi];
			setRange(fixed);
			setStartText(minutesToHHMM(lo));
			setEndText(minutesToHHMM(hi));
			onChange?.(fixed);
		},
		[onChange],
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
		setStartText(minutesToHHMM(v[0]));
		setEndText(minutesToHHMM(v[1]));
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
					onBlur={() => commit([parseHHMM(startText), range[1]])}
					onKeyDown={(e) => {
						if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
					}}
					size='small'
					placeholder='00:00'
					sx={boxSx}
				/>

				<Slider
					value={range}
					min={0}
					max={DAY_MIN}
					step={5}
					disableSwap
					onChange={onSlider}
					onChangeCommitted={onSliderCommit}
					valueLabelDisplay='off'
					sx={{ flex: 1, mx: 0.5 }}
				/>

				<TextField
					value={endText}
					onChange={(e) => setEndText(e.target.value)}
					onBlur={() => commit([range[0], parseHHMM(endText)])}
					onKeyDown={(e) => {
						if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
					}}
					size='small'
					placeholder='24:00'
					sx={boxSx}
				/>
			</Stack>
		</Stack>
	);
}
