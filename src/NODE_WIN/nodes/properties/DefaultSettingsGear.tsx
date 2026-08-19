import type { ReactNode } from 'react';
import { useCallback, useState } from 'react';
import { Box, Checkbox, FormControlLabel, IconButton, MenuItem, Popover, Select, Stack, TextField, Tooltip, Typography } from '@mui/material';
import { Settings } from 'lucide-react';
import { useReactFlow } from '@xyflow/react';
import { useNodeContext } from '@/NODE_WIN/hooks/useNodeContext';
import { CustomNodeData, Property } from '@/NODE_WIN/definitions/types';
import { greyColor } from '@/Store/Color/grayColor';
import { NUMERIC_FORMATS, numericConfigFor, secondsToTimecode, timecodeToSeconds } from '@/Utils/numericFormat';

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
 */
export default function DefaultSettingsGear({ property }: DefaultSettingsGearProps) {
	const nodeId = useNodeContext();
	const reactFlow = useReactFlow();
	const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);

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
		<>
			<Tooltip title='Дефолтные настройки' placement='top' arrow>
				<IconButton
					disableRipple
					size='small'
					className='nodrag'
					onClick={(e) => setAnchorEl(e.currentTarget)}
					sx={{ width: 26, padding: 0, color: greyColor(45), '&:hover': { color: greyColor(75) } }}
				>
					<Settings size={17} strokeWidth={1.25} />
				</IconButton>
			</Tooltip>

			<Popover
				open={Boolean(anchorEl)}
				anchorEl={anchorEl}
				onClose={() => setAnchorEl(null)}
				anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
				transformOrigin={{ vertical: 'top', horizontal: 'right' }}
				slotProps={{ paper: { className: 'nodrag', sx: { p: 1.5, width: 330, bgcolor: greyColor(12) } } }}
			>
				<Stack gap={1}>
					<Typography variant='caption' sx={{ color: greyColor(60), fontFamily: 'monospace' }}>
						// дефолтные настройки (для этого флоу)
					</Typography>

					<LabeledRow label='format'>
						<Select
							size='small'
							value={config.format}
							onChange={(e) => setCp({ format: e.target.value })}
							sx={{ ...selSx, minWidth: 130 }}
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

					{isTimecode && (
						<Typography variant='caption' sx={{ color: greyColor(45), fontFamily: 'monospace' }}>
							// HH:MM:SS, шаг и хранение в секундах
						</Typography>
					)}
				</Stack>
			</Popover>
		</>
	);
}

const selSx = { fontSize: 13, fontFamily: 'monospace', '& .MuiSelect-select': { py: 0.25 } } as const;

const boxSx = (w: number) => ({
	width: w,
	'& input': { py: 0.25, fontSize: 13, fontFamily: 'monospace', textAlign: 'center' },
});

function Dots() {
	return (
		<Box component='span' sx={{ color: greyColor(45), fontFamily: 'monospace' }}>
			…
		</Box>
	);
}

function LabeledRow({ label, children }: { label: string; children: ReactNode }) {
	return (
		<Stack direction='row' alignItems='center' justifyContent='space-between' gap={1}>
			<Typography variant='caption' sx={{ color: greyColor(70), fontFamily: 'monospace' }}>
				{label}
			</Typography>
			{children}
		</Stack>
	);
}

function CheckRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
	return (
		<FormControlLabel
			sx={{ ml: 0, gap: 0.5 }}
			control={<Checkbox size='small' checked={checked} onChange={(e) => onChange(e.target.checked)} sx={{ p: 0 }} />}
			label={
				<Typography variant='caption' sx={{ color: greyColor(70), fontFamily: 'monospace' }}>
					{label}
				</Typography>
			}
		/>
	);
}

/**
 * Число с коммитом на blur/Enter (как `TcBox` рядом и как `NumInput` в pluginBuilder).
 *
 * Раньше поле было полностью управляемым `type='number'` и коммитило каждое
 * нажатие. Пустая строка даёт `Number('') === 0`, поэтому стереть значение
 * целиком было нельзя — в поле тут же впечатывался нуль; промежуточные `0.` и
 * `-` тоже отдаются невалидными, и набранная точка терялась. Пока поле в фокусе,
 * его содержимое — черновик, наружу уходит только готовое число.
 */
function NumBox({ value, onChange, w = 70, integer }: { value: number; onChange: (v: number) => void; w?: number; integer?: boolean }) {
	const [text, setText] = useState(String(value));
	const [editing, setEditing] = useState(false);

	const revert = () => {
		setText(String(value));
		setEditing(false);
	};

	const commit = () => {
		setEditing(false);
		const t = text.trim().replace(',', '.');
		const n = Number(t);
		if (t === '' || !Number.isFinite(n)) {
			setText(String(value)); // пусто или мусор — возвращаем прежнее
			return;
		}
		const next = integer ? Math.round(n) : n;
		setText(String(next));
		onChange(next);
	};

	return (
		<TextField
			size='small'
			// Именно text, а не number: number-поле не умеет держать черновик.
			inputMode='decimal'
			value={editing ? text : String(value)}
			onFocus={() => {
				setText(String(value));
				setEditing(true);
			}}
			onChange={(e) => setText(e.target.value)}
			onBlur={commit}
			onKeyDown={(e) => {
				if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
				if (e.key === 'Escape') revert();
			}}
			sx={boxSx(w)}
		/>
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
			sx={boxSx(90)}
		/>
	);
}
