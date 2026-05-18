import { useState, memo, useCallback } from 'react';
import { Box, IconButton, InputBase, Paper, Typography } from '@mui/material';
import { Edit2, X } from 'lucide-react';
import { greyColor } from '@/Store/Color/grayColor';
import type { UiJsonData, UiPropertyData } from './types';
import { validateUiJson, toCamelCase } from './types';

interface NodeHeaderProps {
	label: string;
	color: string;
	isValid: boolean;
	type: string;
	onLabelChange: (label: string) => void;
}

export const NodeHeader = memo(function NodeHeader({ label, color, isValid, type, onLabelChange }: NodeHeaderProps) {
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState(label);

	const startEdit = () => {
		setDraft(label);
		setEditing(true);
	};
	const commit = () => {
		setEditing(false);
		if (draft.trim()) onLabelChange(draft.trim());
		else setDraft(label);
	};

	return (
		<Box sx={{ bgcolor: color, px: 1.5, py: 0.75, display: 'flex', alignItems: 'center', gap: 0.75 }}>
			<Box
				sx={{
					width: 8,
					height: 8,
					borderRadius: '50%',
					flexShrink: 0,
					bgcolor: isValid ? '#81c784' : '#ef5350',
					boxShadow: isValid ? '0 0 6px #81c784' : '0 0 6px #ef5350',
				}}
			/>
			{editing ? (
				<Paper component='form' sx={{ flex: 1, display: 'flex', alignItems: 'center', px: 1, py: 0.25, bgcolor: 'rgba(0,0,0,0.2)' }}>
					<InputBase
						value={draft}
						autoFocus
						onChange={(e) => setDraft(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === 'Enter') commit();
							if (e.key === 'Escape') {
								setEditing(false);
								setDraft(label);
							}
						}}
						onBlur={commit}
						sx={{ flex: 1, fontSize: 13, fontWeight: 700, color: '#fff' }}
					/>
					<IconButton size='small' onClick={commit} sx={{ p: 0.25, color: '#fff' }}>
						<X size={12} />
					</IconButton>
				</Paper>
			) : (
				<Typography variant='body2' fontWeight={700} sx={{ fontSize: 13, cursor: 'pointer', flex: 1 }} onDoubleClick={startEdit}>
					{label || 'Node Name'}
					<Edit2 size={10} style={{ marginLeft: 6, opacity: 0.4, verticalAlign: 'middle' }} />
				</Typography>
			)}
			<Typography variant='caption' sx={{ fontSize: 9, opacity: 0.7, fontFamily: 'monospace' }}>
				{type}
			</Typography>
		</Box>
	);
});
