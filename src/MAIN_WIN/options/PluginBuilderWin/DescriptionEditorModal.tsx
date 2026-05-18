import { useState, useEffect } from 'react';
import { Button, Dialog, DialogActions, DialogContent, DialogTitle } from '@mui/material';
import { greyColor } from '@/Store/Color/grayColor';
import { RichTextEditor } from '@/components/RichTextEditor';

interface DescriptionEditorModalProps {
	open: boolean;
	value: string;
	onClose: () => void;
	onChange: (v: string) => void;
}

export function DescriptionEditorModal({ open, value, onClose, onChange }: DescriptionEditorModalProps) {
	const gray60 = greyColor(60);
	const [localValue, setLocalValue] = useState(value);

	useEffect(() => {
		if (open) {
			setLocalValue(value);
		}
	}, [open, value]);

	const handleSaveAndClose = () => {
		onChange(localValue);
		onClose();
	};

	return (
		<Dialog open={open} onClose={onClose} maxWidth='md' fullWidth>
			<DialogTitle sx={{ fontSize: 13, py: 1, pb: 0.75, color: gray60 }}>description — Rich Text</DialogTitle>
			<DialogContent sx={{ p: 2 }}>
				<RichTextEditor key={open ? 'open' : 'closed'} value={localValue} onChange={setLocalValue} minHeight={240} />
			</DialogContent>
			<DialogActions>
				<Button size='small' onClick={onClose}>
					Закрыть
				</Button>
				<Button size='small' variant='contained' onClick={handleSaveAndClose}>
					Сохранить и закрыть
				</Button>
			</DialogActions>
		</Dialog>
	);
}
