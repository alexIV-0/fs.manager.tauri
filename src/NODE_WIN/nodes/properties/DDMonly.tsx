import { Box, Checkbox, MenuItem, Select } from '@mui/material';
import { useStore } from '@xyflow/react';
import { useRef } from 'react';

interface DDMItem {
	value: string;
	label?: string;
	color?: string;
}

interface DDMProps {
	items: DDMItem[];
	value: string | string[];
	onChange: (value: string | string[]) => void;
	multiSelect?: boolean;
	fontSize?: number;
}

export default function DDMonly({ items, value, onChange, multiSelect = false, fontSize = 15 }: DDMProps) {
	// useViewport() триггерит ре-рендер на каждый pan-tick (x/y меняются непрерывно).
	// Селектор на transform[2] подписывает только на zoom — стабильно.
	const zoom = useStore((s) => s.transform[2]);
	const anchorRef = useRef<HTMLDivElement>(null);

	const handleChange = (raw: string | string[]) => {
		if (multiSelect) {
			onChange(typeof raw === 'string' ? raw.split(',') : raw);
		} else {
			onChange(raw as string);
		}
	};

	// Нормализуем value для отображения
	const normalizedValue = multiSelect
		? Array.isArray(value)
			? value
			: [value]
		: Array.isArray(value)
			? (value[0] ?? '')
			: value;

	return (
		<Box ref={anchorRef} sx={{ width: '100%' }}>
			<Select
				multiple={multiSelect}
				value={normalizedValue}
				onChange={(e) => handleChange(e.target.value as string | string[])}
				variant='standard'
				disableUnderline
				fullWidth
				className='nodrag'
				sx={{
					fontSize,
					'.MuiSelect-select': { py: 0 },
				}}
				MenuProps={{
					disablePortal: false,
					anchorOrigin: { vertical: 'bottom', horizontal: 'left' },
					transformOrigin: { vertical: 'top', horizontal: 'left' },
					PaperProps: {
						sx: {
							// Масштабируем меню под текущий zoom канваса
							transform: `scale(${zoom}) !important`,
							transformOrigin: 'top left',
							// Компенсируем сдвиг от scale — иначе меню уедет вниз/вправо
							marginTop: `${-(1 - zoom) * 0}px`,
						},
					},
				}}
				renderValue={multiSelect ? (selected) => (selected as string[]).join(', ') : undefined}
			>
				{items.map((item) => (
					<MenuItem key={item.value} value={item.value} sx={{ fontSize }}>
						{multiSelect && (
							<Checkbox
								size='small'
								checked={Array.isArray(normalizedValue) && (normalizedValue as string[]).includes(item.value)}
								sx={{ p: 0, mr: 1 }}
							/>
						)}
						{item.color && (
							<Box
								component='span'
								sx={{
									display: 'inline-block',
									width: 8,
									height: 8,
									borderRadius: '50%',
									backgroundColor: item.color,
									mr: 1,
									flexShrink: 0,
								}}
							/>
						)}
						{item.label ?? item.value}
					</MenuItem>
				))}
			</Select>
		</Box>
	);
}
