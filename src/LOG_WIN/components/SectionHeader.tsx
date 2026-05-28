import React from 'react';
import { Box, Chip, Typography } from '@mui/material';
import { Inbox } from 'lucide-react';

export function SectionHeader({ icon, title, count }: { icon: React.ReactNode; title: string; count: number }) {
	return (
		<Box
			sx={{
				display: 'flex',
				alignItems: 'center',
				gap: 0.75,
				px: 2,
				py: 0.75,
				bgcolor: 'background.paper',
				borderBottom: '1px solid',
				borderColor: 'divider',
			}}
		>
			{icon}
			<Typography variant='caption' sx={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: 'text.secondary' }}>
				{title}
			</Typography>
			<Chip label={count} size='small' sx={{ height: 16, fontSize: 10 }} />
		</Box>
	);
}

export function EmptyState({ text }: { text: string }) {
	return (
		<Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 1.5, color: 'text.disabled' }}>
			<Inbox size={14} />
			<Typography variant='caption'>{text}</Typography>
		</Box>
	);
}
