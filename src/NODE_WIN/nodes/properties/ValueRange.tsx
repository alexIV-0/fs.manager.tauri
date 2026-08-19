import { ValueRangeProperty, CustomNodeData, isDynamicProperty } from '@/NODE_WIN/definitions/types';
import { useNodeContext } from '@/NODE_WIN/hooks/useNodeContext';
import { Slider, Stack, TextField } from '@mui/material';
import { useNodesData, useReactFlow } from '@xyflow/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { colorTypes_store } from '@/Store/Color/colorTypes_store';
import PropertyLabelEditor from './PropertyLabelEditor';
import TooltipOrDelete from './TooltipOrDelete';
import { blueColor } from '@/Store/Color/grayColor';
import { clampForFormat, formatNumeric, normalizeNumeric, numericConfigKey, parseNumeric, valueRangeConfig } from '@/Utils/numericFormat';

interface ValueRangeProps {
	property: ValueRangeProperty;
	onChange?: (value: [number, number]) => void;
}

export default function ValueRange({ property, onChange }: ValueRangeProps) {
	const nodeId = useNodeContext();
	const reactFlow = useReactFlow();
	const { controlProps } = property;
	const colorTypes = colorTypes_store((s) => s.colorTypes);
	const config = valueRangeConfig(controlProps);
	const configKey = numericConfigKey(config);
	const { min: sliderMin, max: sliderMax } = config;
	const minColor = blueColor(40, 80);
	const maxColor = blueColor(70, 80);

	// Получаем статус валидности ноды — реактивно (getNode не подписан на обновления).
	const reactiveData = useNodesData(nodeId)?.data as CustomNodeData | undefined;
	const isNodeValid = reactiveData?.isValid ?? true;

	const editLabel = controlProps?.editLabel ?? false;
	const tooltip = controlProps?.tooltip ?? '';
	const isDynamic = isDynamicProperty(property);

	const initVal = Array.isArray(controlProps.value) ? controlProps.value : [sliderMin, sliderMax];
	const [range, setRange] = useState<[number, number]>([
		normalizeNumeric(initVal[0] ?? sliderMin, config),
		normalizeNumeric(initVal[1] ?? sliderMax, config),
	]);
	const [startText, setStartText] = useState<string>(() => formatNumeric(range[0], config));
	const [endText, setEndText] = useState<string>(() => formatNumeric(range[1], config));

	// Пересобираем окошки, когда настройки правят снаружи (шестерёнка/pluginBuilder)
	// или значение пришло извне. Без этого смена format/range оставляла бы в полях
	// текст в старом формате до перемонтирования ноды.
	const valueKey = Array.isArray(controlProps.value) ? controlProps.value.join(',') : '';
	useEffect(() => {
		const v = Array.isArray(controlProps.value) ? controlProps.value : [sliderMin, sliderMax];
		const lo = normalizeNumeric(v[0] ?? sliderMin, config);
		const hi = normalizeNumeric(v[1] ?? sliderMax, config);
		setRange([lo, hi]);
		setStartText(formatNumeric(lo, config));
		setEndText(formatNumeric(hi, config));
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [configKey, valueKey]);

	// Нормализуем (lo ≤ hi), синхронизируем окошки и сохраняем в ноду.
	// allowOverride — путь ручного ввода: значение можно вывести за границы
	// слайдера, если настройка allowManualOverride включена.
	const commit = useCallback(
		(next: [number, number], allowOverride = false) => {
			const norm = (v: number) => (allowOverride && config.allowManualOverride ? v : clampForFormat(v, config));
			const a = norm(next[0]);
			const b = norm(next[1]);
			const fixed: [number, number] = [Math.min(a, b), Math.max(a, b)];
			setRange(fixed);
			setStartText(formatNumeric(fixed[0], config));
			setEndText(formatNumeric(fixed[1], config));
			onChange?.(fixed);
		},
		[onChange, configKey], // eslint-disable-line react-hooks/exhaustive-deps
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
		setStartText(formatNumeric(lo, config));
		setEndText(formatNumeric(hi, config));
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
		// Таймкоду HH:MM:SS нужно больше места, чем числу: 8 монопробельных
		// символов (было рассчитано на MM:SS) + паддинги.
		width: config.format === 'timecode' ? 96 : 64,
		'& .MuiInputBase-input': {
			fontFamily: 'monospace',
			fontSize: '0.9rem',
			textAlign: 'center',
			padding: '4px 6px',
			color: colorTypes.default as string,
		},
	};

	const handleStartBlur = () => {
		const parsed = parseNumeric(startText, config, config.allowManualOverride);
		if (parsed === null) {
			setStartText(formatNumeric(range[0], config)); // мусор на входе — откат
			return;
		}
		commit([parsed, range[1]], true);
	};

	const handleEndBlur = () => {
		const parsed = parseNumeric(endText, config, config.allowManualOverride);
		if (parsed === null) {
			setEndText(formatNumeric(range[1], config));
			return;
		}
		commit([range[0], parsed], true);
	};

	// Сам слайдер границы не переступает, даже если ручной ввод вывел значение
	// за них (иначе бегунок уезжает за рельсу).
	const sliderValue: [number, number] = [clampForFormat(range[0], config), clampForFormat(range[1], config)];

	return (
		<Stack direction='column' px='12px' className='nodrag' gap={0.5}>
			<Stack direction='row' alignItems='center' position='relative' gap={1}>
				<PropertyLabelEditor label={controlProps?.label ?? ''} editLabel={editLabel} onSave={handleSaveLabel} />
				<TooltipOrDelete isDynamic={isDynamic} tooltip={tooltip} onDelete={handleDelete} property={property} />
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
					placeholder={formatNumeric(sliderMin, config)}
					sx={boxSx}
				/>

				<Slider
					value={sliderValue}
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
					placeholder={formatNumeric(sliderMax, config)}
					sx={boxSx}
				/>
			</Stack>
		</Stack>
	);
}
