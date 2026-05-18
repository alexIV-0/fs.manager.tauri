import { TextField, Typography } from '@mui/material';
import { colorTypes_store } from '@/Store/Color/colorTypes_store';
import { useEditableField } from '@/hooks/useEditableField';

interface PropertyLabelEditorProps {
	label: string;
	editLabel?: boolean;
	onSave: (newLabel: string) => void;
}

/**
 * Мини-компонент для отображения и редактирования label свойства.
 * Двойной клик → TextField. Enter/Blur → сохранение. Escape → отмена.
 */
export default function PropertyLabelEditor({ label, editLabel = false, onSave }: PropertyLabelEditorProps) {
	const colorTypes = colorTypes_store((s) => s.colorTypes);
	const defColor = colorTypes.default as string;

	const { isEditing, startEditing, inputProps } = useEditableField({ initialValue: label, onSave });

	if (isEditing) {
		return (
			<TextField
				{...inputProps}
				variant='standard'
				size='small'
				className='nodrag'
				sx={{ fontSize: '14px', flex: 1 }}
				slotProps={{ input: { style: { fontSize: '14px' } } }}
			/>
		);
	}

	return (
		<Typography
			variant='subtitle2'
			className='nodrag'
			fontWeight={400}
			noWrap
			color={defColor}
			sx={{
				cursor: editLabel ? 'text' : 'default',
				flex: 1,
				borderBottom: editLabel ? '1px dashed transparent' : 'none',
				'&:hover': editLabel ? { borderBottomColor: 'rgba(255,255,255,0.3)' } : {},
			}}
			onDoubleClick={() => editLabel && startEditing()}
		>
			{label}
		</Typography>
	);
}
