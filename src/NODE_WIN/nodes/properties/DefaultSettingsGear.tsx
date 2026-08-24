import { useCallback, useState } from 'react';
import { MenuItem, Select, Stack, TextField } from '@mui/material';
import { Settings } from 'lucide-react';
import { useReactFlow } from '@xyflow/react';
import { useNodeContext } from '@/NODE_WIN/hooks/useNodeContext';
import { CustomNodeData, Property } from '@/NODE_WIN/definitions/types';
import { greyColor } from '@/Store/Color/grayColor';
import { NUMERIC_FORMATS, numericConfigFor, secondsToTimecode, timecodeToSeconds } from '@/Utils/numericFormat';
import { CheckRow, Dots, GearHint, GearPopover, LabeledRow, NumBox, gearBoxSx, gearSelSx } from './GearPopover';

interface DefaultSettingsGearProps {
	property: Property;
}

/**
 * Шестерёнка «дефолтные настройки» рядом с tooltip.
 * Открывает попап с настройками уровня pluginBuilder, но для КОНКРЕТНОГО флоу
 * (per-flow override). Меняются только значения по умолчанию — имя/label здесь
 * не редактируется. Изменения пишутся в controlProps свойства → сохраняются в
 * options.json автоматически. Поддерживаются числовые контролы: valueRange и slider.
 *
 * Набор полей зависит от формата (см. `Utils/numericFormat.ts`):
 *   • timecode — границы вводятся таймкодом HH:MM:SS, шаг — в секундах;
 *   • float    — шаг + decimals;
 *   • integer  — шаг, значения целые;
 *   • auto     — как есть (legacy-режим слайдера).
 *
 * Оболочка попапа и строки — общие (`GearPopover`), как у настроек кодирования в шапке ноды.
 */
export default function DefaultSettingsGear({ property }: DefaultSettingsGearProps) {
	const nodeId = useNodeContext();
	const reactFlow = useReactFlow();

	const cp = property.controlProps as any;

	const setCp = useCallback(
		(patch: Record<string, unknown>) => {
			reactFlow.updateNode(nodeId, (node) => {
				const nodeData = node.data as CustomNodeData;
				const updatedProperties = nodeData.properties.map((p) =>
					p.id === property.id ? { ...p, controlProps: { ...p.controlProps, ...patch } } : p,
				) as Property[];
				return { ...node, data: { ...nodeData, properties: updatedProperties } };
			});
		},
		[nodeId, property.id, reactFlow],
	);

	// Шестерёнка осмысленна только для числовых контролов.
	const isSlider = property.controlType === 'slider';
	if (property.controlType !== 'valueRange' && !isSlider) return null;

	const config = numericConfigFor(property.controlType, cp);
	const isTimecode = config.format === 'timecode';
	const { min, max } = config;

	// Границы у valueRange лежат в `range`, у slider — в minValue/maxValue.
	const setBounds = (lo: number, hi: number) => (isSlider ? setCp({ minValue: lo, maxValue: hi }) : setCp({ range: [lo, hi] }));

	return (
		<GearPopover
			tooltip='Дефолтные настройки'
			icon={<Settings size={17} strokeWidth={1.25} />}
			iconSx={{ width: 26, padding: 0, color: greyColor(45), '&:hover': { color: greyColor(75) } }}
			caption='// дефолтные настройки (для этого флоу)'
		>
			<LabeledRow label='format'>
				<Select
					size='small'
					value={config.format}
					onChange={(e) => setCp({ format: e.target.value })}
					sx={{ ...gearSelSx, minWidth: 130 }}
				>
					{NUMERIC_FORMATS.map((f) => (
						<MenuItem key={f} value={f}>
							{f}
						</MenuItem>
					))}
				</Select>
			</LabeledRow>

			{/* Шаг — в единицах хранения (для таймкода это секунды/минуты). */}
			<LabeledRow label='step'>
				<NumBox value={config.step} onChange={(v) => setCp({ step: v })} />
			</LabeledRow>

			<LabeledRow label='range'>
				<Stack direction='row' alignItems='center' gap={0.5}>
					{isTimecode ? (
						<>
							<TcBox value={min} onChange={(v) => setBounds(v, max)} />
							<Dots />
							<TcBox value={max} onChange={(v) => setBounds(min, v)} />
						</>
					) : (
						<>
							<NumBox value={min} onChange={(v) => setBounds(v, max)} w={64} />
							<Dots />
							<NumBox value={max} onChange={(v) => setBounds(min, v)} w={64} />
						</>
					)}
				</Stack>
			</LabeledRow>

			{/* Знаки после запятой имеют смысл только у float. */}
			{config.format === 'float' && (
				<LabeledRow label='decimals'>
					<NumBox value={config.decimals} onChange={(v) => setCp({ decimals: v })} integer />
				</LabeledRow>
			)}

			<CheckRow
				label='allowManualOverride'
				checked={config.allowManualOverride}
				onChange={(v) => setCp({ allowManualOverride: v })}
			/>

			{/* Слайдер: чем показывать значение и нужны ли подписи границ. */}
			{isSlider && (
				<>
					<CheckRow
						label='isTextInput'
						checked={cp.isTextInput ?? cp.useValuesAsLabels ?? false}
						onChange={(v) => setCp({ isTextInput: v })}
					/>
					<CheckRow
						label='minMaxValueVisible'
						checked={cp.minMaxValueVisible ?? true}
						onChange={(v) => setCp({ minMaxValueVisible: v })}
					/>
				</>
			)}

			{isTimecode && <GearHint>// HH:MM:SS, шаг и хранение в секундах</GearHint>}
		</GearPopover>
	);
}

/** Ввод границы таймкодом HH:MM:SS (значение — секунды). Коммит на blur/Enter. */
function TcBox({ value, onChange }: { value: number; onChange: (v: number) => void }) {
	const [text, setText] = useState(() => secondsToTimecode(value));
	const [editing, setEditing] = useState(false);

	const commit = () => {
		setEditing(false);
		const sec = text.trim() === '' ? null : text.includes(':') ? timecodeToSeconds(text) : Number(text.trim());
		if (sec === null || !Number.isFinite(sec)) {
			setText(secondsToTimecode(value)); // мусор на входе — откат
			return;
		}
		const next = Math.max(0, Math.round(sec));
		setText(secondsToTimecode(next));
		onChange(next);
	};

	return (
		<TextField
			size='small'
			value={editing ? text : secondsToTimecode(value)}
			placeholder='00:00:00'
			onFocus={() => {
				setText(secondsToTimecode(value));
				setEditing(true);
			}}
			onChange={(e) => setText(e.target.value)}
			onBlur={commit}
			onKeyDown={(e) => {
				if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
				if (e.key === 'Escape') {
					setText(secondsToTimecode(value));
					setEditing(false);
				}
			}}
			sx={gearBoxSx(90)}
		/>
	);
}
