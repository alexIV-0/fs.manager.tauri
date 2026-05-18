import React from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions, Button, Box } from '@mui/material';

interface CustomDialogProps {
	open: boolean;
	onClose: () => void;
	onAdd: () => void;
	title?: string;
	children: React.ReactNode;
	rightElement?: React.ReactNode; // Добавляем опциональный элемент для правой стороны заголовка
}

const MyCustomDialog: React.FC<CustomDialogProps> = ({ open, onClose, onAdd, title, children, rightElement }) => {
	return (
		<Dialog
			open={open}
			onClose={onClose}
			fullWidth
			maxWidth='sm'
			PaperProps={{
				style: {
					width: `85vw`,
					maxWidth: `85vw`,
					height: `80vh`,
				},
			}}
		>
			{/* Оборачиваем заголовок и правый элемент в Box с flex */}
			<DialogTitle>
				<Box display='flex' justifyContent='space-between' alignItems='center' sx={{ height: '100%', p: '0 3px' }}>
					<span>{title}</span>
					{/* Здесь рендерим переданный правый элемент, если он есть */}
					{rightElement && <Box sx={{ height: '100%', aspectRatio: 1 }}>{rightElement}</Box>}
				</Box>
			</DialogTitle>
			<DialogContent>{children}</DialogContent>
			<DialogActions>
				<Button onClick={onClose} color='primary'>
					Cancel
				</Button>
				<Button onClick={onAdd} color='primary'>
					Save
				</Button>
			</DialogActions>
		</Dialog>
	);
};

export default MyCustomDialog;
