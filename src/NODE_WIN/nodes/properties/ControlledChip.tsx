import { Chip, ChipProps, Input } from '@mui/material';
import { memo } from 'react';
import { greyColor } from '@/Store/Color/grayColor';

interface ControlledChipProps extends Omit<ChipProps, 'onChange'> {
	isEditing: boolean;
	editingValue?: string;
	chipRef?: React.RefObject<HTMLDivElement>;
	onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
	onBlur?: () => void;
	onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}

const ControlledChip = memo<ControlledChipProps>((props) => {
	const { isEditing, editingValue, chipRef, onChange, onBlur, onKeyDown, ...chipProps } = props;

	if (isEditing) {
		return (
			<Chip
				{...chipProps}
				ref={chipRef}
				className='ca-chip nodrag'
				sx={{
					// Растягиваем чип на всю оставшуюся ширину строки
					// flex: '1 1 0px',
					width: '100%', // 👈 вся строка
					minWidth: '50px', // Минимальная ширина, чтобы инпут не схлопывался
					maxWidth: '100%',
					// backgroundColor: greyColor(100),
					// '&:hover': {
					// 	backgroundColor: greyColor(120),
					// },
					// Настройка внутренних отступов для корректного отображения инпута
					'& .MuiChip-label': {
						width: '100%',
						display: 'flex',
						paddingLeft: '12px',
						paddingRight: '12px',
					},
				}}
				label={
					<Input
						autoFocus
						value={editingValue}
						onChange={onChange}
						onBlur={onBlur}
						onKeyDown={onKeyDown}
						disableUnderline
						autoComplete='off'
						inputProps={{
							autoComplete: 'off',
							autoCorrect: 'off',
							autoCapitalize: 'off',
							spellCheck: false,
							'data-1p-ignore': 'true',
							'data-lpignore': 'true',
							'data-form-type': 'other',
						}}
						sx={{
							width: '100%',
							padding: 0,
							fontSize: 'inherit',
							color: 'inherit',
							'& input': {
								padding: 0,
							},
						}}
					/>
				}
			/>
		);
	}

	return (
		<Chip
			{...chipProps}
			className='ca-chip nodrag'
			sx={{
				maxWidth: '100%',
				...chipProps.sx,
			}}
		/>
	);
});

export default ControlledChip;
