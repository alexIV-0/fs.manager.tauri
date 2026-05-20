import { Box, TextField, Typography } from '@mui/material';
import { greyColor } from '@/Store/Color/grayColor';
import MyTooltip from '@/MAIN_WIN/Universal/MyTooltip';

// Универсальная строка настройки с выравниванием значений по одной вертикали:
//
//   [label] [?] ⋯⋯⋯⋯⋯⋯⋯ [value ------RIGHT EDGE------] [unit fixed-left]
//                                                 ^ все значения заканчиваются здесь
//
// Жёсткая ширина у value и у unit → правый край value всегда на одной позиции
// независимо от текста единицы («мс», «мин», «дней», «записей»).

type NumberVariant = {
	type: 'number';
	value: number;
	onChange: (n: number) => void;
	min?: number;
};

type TextVariant = {
	type: 'text';
	value: string;
	onChange: (s: string) => void;
	placeholder?: string;
};

type CustomVariant = {
	type: 'custom';
	node: React.ReactNode;
};

type Props = {
	label: string | React.ReactNode;
	tooltip?: string;
	unit?: string;
	// фиксированная ширина поля значения (прилегает к правой границе «колонки значений»)
	valueWidth?: number;
	// фиксированная ширина колонки единиц (всегда одна для всех строк секции)
	unitWidth?: number;
	// доп. элемент справа от строки (например, кнопка удаления)
	trailing?: React.ReactNode;
} & (NumberVariant | TextVariant | CustomVariant);

const DEFAULT_VALUE_WIDTH = 80;
const DEFAULT_UNIT_WIDTH = 70;
// Ширина зарезервированной колонки под action-иконку (корзина и т.п.).
// Резервируется даже если trailing пустой, чтобы значение не смещалось.
const TRAILING_WIDTH = 28;

const numberFieldSx = (greyLight: string, greyHover: string, width: number) => ({
	width,
	'& .MuiInput-underline:before': { borderBottomColor: greyLight },
	'& .MuiInput-underline:hover:not(.Mui-disabled):before': {
		borderBottomColor: greyHover,
	},
	'& input': {
		textAlign: 'right' as const,
		fontSize: '0.92rem',
		padding: '2px 0',
	},
	// прячем стрелочки у number-input
	'& input[type=number]': { MozAppearance: 'textfield' },
	'& input[type=number]::-webkit-inner-spin-button': {
		WebkitAppearance: 'none',
		margin: 0,
	},
	'& input[type=number]::-webkit-outer-spin-button': {
		WebkitAppearance: 'none',
		margin: 0,
	},
});

export default function MySettingRow(props: Props) {
	const { label, tooltip, unit, valueWidth = DEFAULT_VALUE_WIDTH, unitWidth = DEFAULT_UNIT_WIDTH, trailing } = props;

	const greyLight = greyColor(30);
	const greyHover = greyColor(55);

	let field: React.ReactNode;
	if (props.type === 'number') {
		field = (
			<TextField
				variant='standard'
				type='number'
				value={Number.isFinite(props.value) ? props.value : ''}
				onChange={(e) => {
					const n = Number(e.target.value);
					if (Number.isFinite(n)) props.onChange(Math.max(props.min ?? 0, n));
				}}
				sx={numberFieldSx(greyLight, greyHover, valueWidth)}
			/>
		);
	} else if (props.type === 'text') {
		field = (
			<TextField
				variant='standard'
				value={props.value}
				placeholder={props.placeholder}
				onChange={(e) => props.onChange(e.target.value)}
				sx={{
					width: valueWidth,
					'& .MuiInput-underline:before': { borderBottomColor: greyLight },
					'& input': {
						textAlign: 'right' as const,
						fontSize: '0.92rem',
						padding: '2px 0',
					},
				}}
			/>
		);
	} else {
		field = <Box sx={{ width: valueWidth, display: 'flex', justifyContent: 'flex-end' }}>{props.node}</Box>;
	}

	return (
		<Box
			sx={{
				display: 'flex',
				alignItems: 'flex-end',
				gap: 0.5,
				py: 0.25,
				minHeight: 24,
				px: 0.75,
				mx: -0.75, // компенсируем padding, чтобы раскладка сохранилась
				borderRadius: '3px',
				transition: 'background-color 120ms ease',
				'&:hover': {
					backgroundColor: 'rgba(255, 255, 255, 0.025)',
				},
				'&:focus-within': {
					backgroundColor: 'rgba(255, 255, 255, 0.05)',
				},
			}}
		>
			<Typography
				component='div'
				sx={{
					color: greyColor(75),
					fontSize: '0.92rem',
					lineHeight: 1.3,
					flex: '0 0 auto',
				}}
			>
				{label}
			</Typography>
			{tooltip && <MyTooltip text={tooltip} />}
			<Box
				sx={{
					flex: 1,
					borderBottom: `1px dotted ${greyColor(22)}`,
					mx: 0.75,
					mb: '4px',
					minWidth: 12,
				}}
			/>
			<Box sx={{ flex: `0 0 ${valueWidth}px`, display: 'flex', justifyContent: 'flex-end' }}>{field}</Box>
			<Box
				sx={{
					flex: `0 0 ${unitWidth}px`,
					pl: 0.75,
					display: 'flex',
					alignItems: 'center',
				}}
			>
				{unit && <Typography sx={{ color: greyColor(55), fontSize: '0.85rem' }}>{unit}</Typography>}
			</Box>
			<Box
				sx={{
					flex: `0 0 ${TRAILING_WIDTH}px`,
					display: 'flex',
					justifyContent: 'center',
					alignItems: 'center',
				}}
			>
				{trailing}
			</Box>
		</Box>
	);
}
