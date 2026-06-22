import { ValueRangeProperty, CustomNodeData } from '@/NODE_WIN/definitions/types';
import { useNodeContext } from '@/NODE_WIN/hooks/useNodeContext';
import { Slider, Stack, TextField } from '@mui/material';
import { useNodesData, useReactFlow } from '@xyflow/react';
import { useCallback, useRef, useState } from 'react';
import { colorTypes_store } from '@/Store/Color/colorTypes_store';
import PropertyLabelEditor from './PropertyLabelEditor';
import TooltipOrDelete from './TooltipOrDelete';
import { blueColor } from '@/Store/Color/grayColor';

interface ValueRangeProps {
	property: ValueRangeProperty;
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
	const defaultRange: [number, number] = unit === 'seconds' ? [0, MAX_SECONDS] : [0, DAY_MIN];
	const range = Array.isArray(controlProps?.range) ? (controlProps.range as [number, number]) : defaultRange;

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

export default function ValueRange({ property, onChange }: ValueRangeProps) {
	const nodeId = useNodeContext();
	const reactFlow = useReactFlow();
	const { controlProps } = property;
	const colorTypes = colorTypes_store((s) => s.colorTypes);
	const config = getFormatConfig(controlProps);
	const [sliderMin, sliderMax] = config.range!;
	const minColor = blueColor(40, 80);
	const maxColor = blueColor(70, 80);

	// Получаем статус валидности ноды — реактивно (getNode не подписан на обновления).
	const reactiveData = useNodesData(nodeId)?.data as CustomNodeData | undefined;
	const isNodeValid = reactiveData?.isValid ?? true;

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

	// Какой бегунок схвачен в текущем жесте + «храповик» (peak) значений.
	// grabbed фиксируем на pointerdown по data-index — это надёжнее, чем activeThumb
	// от MUI (который при равных значениях/пересечении может относиться к другому бегунку).
	const dragRef = useRef<{ grabbed: number; lo: number; hi: number } | null>(null);

	const applyRange = (lo: number, hi: number) => {
		setRange([lo, hi]);
		setStartText(formatValue(lo, config));
		setEndText(formatValue(hi, config));
	};

	const onSliderPointerDown = (e: React.PointerEvent) => {
		const thumb = (e.target as HTMLElement).closest('.MuiSlider-thumb');
		const idx = thumb?.getAttribute('data-index');
		if (idx === '0' || idx === '1') {
			dragRef.current = { grabbed: Number(idx), lo: range[0], hi: range[1] };
		} else {
			dragRef.current = null; // клик по рельсе — обычное поведение
		}
	};

	// Слайдер: live-обновление окошек на drag, сохранение — на commit.
	// activeThumb — индекс реально двигающегося бегунка; v[activeThumb] = позиция пальца.
	const onSlider = (_: Event, v: number | number[], activeThumb: number) => {
		if (!Array.isArray(v)) return;
		const st = dragRef.current;
		if (!st) {
			// Клик по рельсе — просто ставим отсортированные значения.
			applyRange(Math.min(v[0], v[1]), Math.max(v[0], v[1]));
			return;
		}
		const finger = v[activeThumb];
		let lo: number;
		let hi: number;
		if (st.grabbed === 0) {
			// Тянем минимум: максимум «храповиком» растёт за ним, но не опускается обратно.
			lo = finger;
			hi = Math.max(st.hi, finger);
		} else {
			// Тянем максимум: минимум «храповиком» падает за ним, но не поднимается обратно.
			hi = finger;
			lo = Math.min(st.lo, finger);
		}
		st.lo = lo;
		st.hi = hi;
		applyRange(lo, hi);
	};
	const onSliderCommit = (_: Event | React.SyntheticEvent, v: number | number[]) => {
		const st = dragRef.current;
		dragRef.current = null;
		if (st) {
			commit([st.lo, st.hi]);
		} else if (Array.isArray(v)) {
			commit([v[0], v[1]] as [number, number]);
		}
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
					onPointerDown={onSliderPointerDown}
					onChange={onSlider}
					onChangeCommitted={onSliderCommit}
					valueLabelDisplay='off'
					sx={{
						flex: 1,
						mx: 0.5,
						'& .MuiSlider-thumb': {
							width: '10px',
							height: '20px',
							borderRadius: '2px',
							border: 'none',
							// Бегунки полностью статичны: никаких анимаций и смены стиля на hover.
							// Любое изменение box-shadow/opacity при наведении вызывало перерисовку
							// и мерцание. Цвета min/max и так разные — отдельная подсветка не нужна.
							opacity: 1,
							transition: 'none',
							boxShadow: 'none',
							'&:hover, &.Mui-active, &.Mui-focusVisible': {
								boxShadow: 'none',
							},
							// MUI добавляет невидимый ::after 42×42px (зона касания) — он торчит
							// за пределы прямоугольника и перекрывает соседний бегунок. Сжимаем
							// его до размера самого бегунка, чтобы зоны не накладывались.
							'&::after': {
								width: '100%',
								height: '100%',
								borderRadius: '2px',
							},
							// Левый бегунок (min): сдвигаем влево на половину ширины,
							// чтобы при равных значениях он стоял встык, а не поверх правого.
							'&[data-index="0"]': {
								backgroundColor: isNodeValid ? minColor : '#888888',
								transform: 'translate(calc(-50% - 4px), -50%)',
							},
							// Правый бегунок (max): сдвигаем вправо на половину ширины.
							'&[data-index="1"]': {
								backgroundColor: isNodeValid ? maxColor : '#888888',
								transform: 'translate(calc(-50% + 6px), -50%)',
							},
						},
						'& .MuiSlider-rail': {
							backgroundColor: colorTypes.default as string,
							opacity: 0.2,
							height: '4px',
						},
						'& .MuiSlider-track': {
							backgroundColor: colorTypes.default as string,
							opacity: 0.5,
							height: '4px',
						},
					}}
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
