// src/NODE_WIN/nodes/properties/GearPopover.tsx
//
// Общие примитивы «выпадающих настроек» — иконка-кнопка + попап с монопространственными
// строками. Внешний вид задан один раз здесь, чтобы все такие попапы выглядели одинаково:
//   • DefaultSettingsGear — дефолтные настройки числового свойства (slider / valueRange);
//   • NodeEncodeSettings  — настройки кодирования в шапке ноды.
//
// Здесь только оболочка и строки. Что внутри — дело вызывающего.

import type { ReactNode } from 'react';
import { useState } from 'react';
import type { SxProps, Theme } from '@mui/material';
import { Box, Checkbox, FormControlLabel, IconButton, Popover, Stack, TextField, Tooltip, Typography } from '@mui/material';
import { greyColor } from '@/Store/Color/grayColor';

/** Стиль MUI-Select внутри попапа. */
export const gearSelSx = { fontSize: 13, fontFamily: 'monospace', '& .MuiSelect-select': { py: 0.25 } } as const;

/** Стиль числового/текстового поля внутри попапа. */
export const gearBoxSx = (w: number) => ({
	width: w,
	'& input': { py: 0.25, fontSize: 13, fontFamily: 'monospace', textAlign: 'center' },
});

interface GearPopoverProps {
	/** Подсказка на кнопке. */
	tooltip: string;
	/** Иконка кнопки. */
	icon: ReactNode;
	/** Стиль кнопки — цвет наследуется от места (шапка ноды / строка свойства). */
	iconSx?: SxProps<Theme>;
	/** Ширина попапа, px. */
	width?: number;
	/** Строка-комментарий сверху (в стиле `// …`). */
	caption?: string;
	children: ReactNode;
}

/** Кнопка + попап с настройками (открывается под кнопкой, выравнивание по правому краю). */
export function GearPopover({ tooltip, icon, iconSx, width = 330, caption, children }: GearPopoverProps) {
	const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);

	return (
		<>
			<Tooltip title={tooltip} placement='top' arrow>
				<IconButton
					disableRipple
					size='small'
					className='nodrag'
					onClick={(e) => {
						// Чтобы клик не дошёл до react-flow и не выделил ноду.
						e.stopPropagation();
						setAnchorEl(e.currentTarget);
					}}
					sx={iconSx}
				>
					{icon}
				</IconButton>
			</Tooltip>

			<Popover
				open={Boolean(anchorEl)}
				anchorEl={anchorEl}
				onClose={() => setAnchorEl(null)}
				anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
				transformOrigin={{ vertical: 'top', horizontal: 'right' }}
				slotProps={{ paper: { className: 'nodrag', sx: { p: 1.5, width, bgcolor: greyColor(12) } } }}
			>
				<Stack gap={1}>
					{caption && (
						<Typography variant='caption' sx={{ color: greyColor(60), fontFamily: 'monospace' }}>
							{caption}
						</Typography>
					)}
					{children}
				</Stack>
			</Popover>
		</>
	);
}

/** Многоточие-разделитель между границами диапазона. */
export function Dots() {
	return (
		<Box component='span' sx={{ color: greyColor(45), fontFamily: 'monospace' }}>
			…
		</Box>
	);
}

/** Строка «подпись — контрол». */
export function LabeledRow({ label, children }: { label: string; children: ReactNode }) {
	return (
		<Stack direction='row' alignItems='center' justifyContent='space-between' gap={1}>
			<Typography variant='caption' sx={{ color: greyColor(70), fontFamily: 'monospace' }}>
				{label}
			</Typography>
			{children}
		</Stack>
	);
}

/** Строка-галочка. */
export function CheckRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
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

/** Комментарий-подсказка в стиле `// …`. */
export function GearHint({ children }: { children: ReactNode }) {
	return (
		<Typography variant='caption' sx={{ color: greyColor(45), fontFamily: 'monospace' }}>
			{children}
		</Typography>
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
export function NumBox({
	value,
	onChange,
	w = 70,
	integer,
	min,
	max,
}: {
	value: number;
	onChange: (v: number) => void;
	w?: number;
	integer?: boolean;
	min?: number;
	max?: number;
}) {
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
		let next = integer ? Math.round(n) : n;
		if (min !== undefined) next = Math.max(min, next);
		if (max !== undefined) next = Math.min(max, next);
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
			sx={gearBoxSx(w)}
		/>
	);
}
