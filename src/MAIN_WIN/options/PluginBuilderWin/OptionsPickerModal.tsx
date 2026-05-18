import { useState } from 'react';
import { Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Stack, Tooltip, Typography } from '@mui/material';
import { greyColor } from '@/Store/Color/grayColor';
import { HASH_OPTIONS, PATTERN_OPTIONS, SPECIAL_OPTIONS } from './types';

interface OptionsPickerModalProps {
	open: boolean;
	title?: string;
	currentOptions: string[];
	onClose: () => void;
	onApply: (options: string[]) => void;
}

export function OptionsPickerModal({ open, title = 'Выбор опций', currentOptions, onClose, onApply }: OptionsPickerModalProps) {
	const gray40 = greyColor(40);
	const gray60 = greyColor(60);
	const [selected, setSelected] = useState<string[]>(currentOptions);

	const toggle = (val: string) => {
		setSelected((prev) => (prev.includes(val) ? prev.filter((o) => o !== val) : [...prev, val]));
	};

	const handleApply = () => {
		onApply(selected);
		onClose();
	};

	const renderSection = (label: string, items: { value: string; desc: string }[] | string[], colorMap?: Record<string, string>) => (
		<Box sx={{ mb: 1.5 }}>
			<Typography variant='caption' sx={{ color: gray60, display: 'block', mb: 0.5, fontWeight: 600 }}>
				{label}
			</Typography>
			<Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
				{items.map((item) => {
					const value = typeof item === 'string' ? item : item.value;
					const desc = typeof item === 'string' ? '' : item.desc;
					const isSelected = selected.includes(value);
					const chip = (
						<Chip
							key={value}
							label={value}
							size='small'
							color={isSelected ? 'primary' : 'default'}
							onClick={() => toggle(value)}
							sx={{ cursor: 'pointer', fontSize: 10 }}
						/>
					);
					return desc ? (
						<Tooltip key={value} title={desc}>
							{chip}
						</Tooltip>
					) : (
						chip
					);
				})}
			</Box>
		</Box>
	);

	return (
		<Dialog open={open} onClose={onClose} maxWidth='sm' fullWidth>
			<DialogTitle sx={{ fontSize: 14, py: 1.5, pb: 1 }}>{title}</DialogTitle>
			<DialogContent sx={{ p: 2 }}>
				{renderSection('#-теги (динамические источники)', HASH_OPTIONS)}
				{renderSection('$-паттерны (из PatternKeys)', PATTERN_OPTIONS)}
				{renderSection('Специальные', SPECIAL_OPTIONS)}
			</DialogContent>
			<DialogActions>
				<Stack direction='row' justifyContent='space-between' width='100%' alignItems='center'>
					<Typography variant='caption' sx={{ opacity: 0.5 }}>
						Выбрано: {selected.length}
					</Typography>
					<Box>
						<Button size='small' onClick={onClose} sx={{ mr: 0.5 }}>
							Отмена
						</Button>
						<Button size='small' variant='contained' onClick={handleApply}>
							Применить
						</Button>
					</Box>
				</Stack>
			</DialogActions>
		</Dialog>
	);
}
