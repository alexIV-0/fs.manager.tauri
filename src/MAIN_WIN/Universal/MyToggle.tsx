import * as React from 'react';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';

const toggleStyle = {
	width: 66,
	height: 26,
};

interface MyToggleProps {
	butt: string[];
	handleChange: (event: React.MouseEvent<HTMLElement>, newAlignment: string | null) => void;
	selectedValue: string; // теперь только текущее значение
	sx?: any;
}

export default function MyToggle({ butt, selectedValue, handleChange, sx }: MyToggleProps) {
	return (
		<ToggleButtonGroup color='primary' value={selectedValue} exclusive onChange={handleChange} size='small' sx={sx}>
			{butt.map((item: string, index: number) => (
				<ToggleButton key={index} sx={toggleStyle} value={item}>
					{item} {/* Отображаем само значение item */}
				</ToggleButton>
			))}
		</ToggleButtonGroup>
	);
}
