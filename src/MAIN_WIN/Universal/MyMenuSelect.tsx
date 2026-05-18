import React from 'react';
import { FormControl, InputLabel, Select, MenuItem, SelectChangeEvent } from '@mui/material';

interface CustomSelectProps {
	label: string;
	value?: string;
	onChange: (event: SelectChangeEvent<string>) => void;
	options: any;
	sx?: object; // Опциональные стили для кастомизации
	placeholder?: string; // Опциональная надпись, например, 'None' или 'Select'
}

const CustomMenuSelect: React.FC<CustomSelectProps> = ({ label, value, onChange, options, sx, placeholder }) => {
	return (
		<FormControl variant='standard' sx={{ ml: 1, minWidth: 160, ...sx }}>
			<InputLabel>{label}</InputLabel>
			<Select
				value={value}
				onChange={onChange}
				inputProps={{ sx: { paddingLeft: '10px' } }}
				renderValue={(selected) => selected}
			>
				{/* Добавляем placeholder как первый пункт меню */}
				{placeholder && (
					<MenuItem value={placeholder} sx={{ fontStyle: 'italic' }}>
						{placeholder}
					</MenuItem>
				)}

				{options.map((option: any, index: React.Key | null | undefined) => (
					<MenuItem sx={{ m: 0, p: '0 12px', minHeight: '1.5rem', fontSize: '1.1rem' }} key={index} value={option}>
						{option}
					</MenuItem>
				))}
			</Select>
		</FormControl>
	);
};

export default CustomMenuSelect;
