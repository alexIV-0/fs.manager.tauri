import { Box, IconButton, Typography } from '@mui/material';
import { FolderSymlink } from 'lucide-react';
import { bottomBoxStyle, topShadowStyle } from '../mainStyles';
import { useColumnView_Store } from '@/Store/MainWin/useColumnView_store';

export function TopPanelGD() {
	const { instances } = useColumnView_Store();

	const handleOpenInFinder = () => {
		const cols = instances.gd.columns;
		const pathToOpen = cols[cols.length - 1]?.path;
		if (pathToOpen) window.electronAPI.invoke('shell:openPath', pathToOpen);
	};

	return (
		<Box
			sx={{
				...bottomBoxStyle,
				...topShadowStyle,
				position: 'relative',
				display: 'flex',
				alignItems: 'center',
				pl: 2,
				mb: 1,
				height: 26,
			}}
		>
			<IconButton sx={{ p: 0 }} size='small' onClick={handleOpenInFinder}>
				<FolderSymlink strokeWidth={1} size={20} />
			</IconButton>
			<Typography
				variant='caption'
				sx={{
					position: 'absolute',
					left: 0,
					right: 0,
					textAlign: 'center',
					color: 'text.disabled',
					pointerEvents: 'none',
					userSelect: 'none',
					fontWeight: 500,
				}}
			>
				Папка Пользователя
			</Typography>
		</Box>
	);
}
