import { Box, Typography } from '@mui/material';
import { greyColor } from '@/Store/Color/grayColor';
import { CONTROL_TYPES_LIST, CONTROL_TYPE_COLORS } from '../types';
import { useDraggable } from '@dnd-kit/core';

function SidebarItem({ controlType, label }: { controlType: string; label: string }) {
	const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
		id: `template-${controlType}`,
		data: { type: 'template', controlType },
	});
	const color = CONTROL_TYPE_COLORS[controlType] ?? '#aaa';

	return (
		<Box
			ref={setNodeRef}
			{...attributes}
			{...listeners}
			sx={{
				display: 'flex',
				alignItems: 'center',
				gap: 1,
				px: 1.5,
				py: 0.75,
				cursor: 'grab',
				borderRadius: 0.75,
				bgcolor: `${color}12`,
				borderLeft: `3px solid ${color}`,
				opacity: isDragging ? 0.35 : 1,
				'&:hover': { bgcolor: `${color}22` },
				transition: 'background-color 0.15s, opacity 0.15s',
			}}
		>
			<Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: color, flexShrink: 0 }} />
			<Typography sx={{ fontSize: 13, color, fontWeight: 500, userSelect: 'none' }}>{label}</Typography>
		</Box>
	);
}

export function SidebarComponentList() {
	const gray40 = greyColor(40);
	const gray60 = greyColor(60);

	return (
		<Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
			<Box sx={{ px: 1.5, py: 1, borderBottom: `1px solid ${gray40}` }}>
				<Typography variant='caption' sx={{ fontWeight: 600, opacity: 0.7, fontSize: 11 }}>
					Компоненты
				</Typography>
			</Box>
			<Box sx={{ flex: 1, overflow: 'auto', p: 1, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
				{CONTROL_TYPES_LIST.map(({ controlType, label }) => (
					<SidebarItem key={controlType} controlType={controlType} label={label} />
				))}
			</Box>
			<Box sx={{ px: 1.5, py: 1, borderTop: `1px solid ${gray40}`, opacity: 0.4 }}>
				<Typography variant='caption' sx={{ fontSize: 10, color: gray60 }}>
					Перетащи компонент в ноду
				</Typography>
			</Box>
		</Box>
	);
}
