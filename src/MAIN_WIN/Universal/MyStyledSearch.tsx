// src/components/MyStyledSearch.tsx
import React from 'react';
import { TextField, InputAdornment } from '@mui/material';
import { Search } from 'lucide-react';
import { styled } from '@mui/material/styles';
import { defGray, greyColor } from '@/Store/Color/grayColor';

interface MyStyledSearchProps {
	value: string;
	placeholder?: string;
	onChange: (value: string) => void;
	fullWidth?: boolean;
	size?: 'small' | 'medium';
}

const StyledTextField = styled(TextField)(({ theme }) => {
	const defaultColor = defGray; // Цвет по умолчанию
	const focusedColor = greyColor(85); // Цвет при фокусе

	return {
		'& .MuiOutlinedInput-root': {
			'& fieldset': {
				border: 'none',
			},
			'&:hover fieldset': {
				border: 'none',
			},
			'&.Mui-focused fieldset': {
				border: 'none',
			},
			// Настройка нижнего подчёркивания
			'&:after': {
				borderBottom: `1px solid ${defaultColor}`,
				left: 0,
				right: 0,
				bottom: 0,
				content: '""',
				position: 'absolute',
				transition: 'transform 200ms cubic-bezier(0.0, 0, 0.2, 1) 0ms',
				transform: 'scaleX(0)',
				pointerEvents: 'none',
			},
			'&.Mui-focused:after': {
				borderBottom: `1px solid ${focusedColor}`,
				transform: 'scaleX(1)',
			},
			'&:before': {
				borderBottom: `1px solid ${defaultColor}`,
				left: 0,
				right: 0,
				bottom: 0,
				content: '""',
				position: 'absolute',
				transition: 'transform 200ms cubic-bezier(0.0, 0, 0.2, 1) 0ms',
				pointerEvents: 'none',
			},
		},
	};
});

export const MyStyledSearch: React.FC<MyStyledSearchProps> = ({ value, placeholder = 'Поиск...', onChange, fullWidth = true, size = 'small' }) => {
	return (
		<StyledTextField
			fullWidth={fullWidth}
			size={size}
			placeholder={placeholder}
			value={value}
			onChange={(e) => onChange(e.target.value)}
			slotProps={{
				input: {
					startAdornment: (
						<InputAdornment position='start'>
							<Search strokeWidth={0.5} size={20} />
						</InputAdornment>
					),
				},
			}}
		/>
	);
};
