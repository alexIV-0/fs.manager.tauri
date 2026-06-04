import { Box, IconButton, Typography } from '@mui/material';
import { commands } from '@/Utils/specta';
import { FolderSymlink, BookmarkX } from 'lucide-react';
import { bottomBoxStyle, topShadowStyle } from '../mainStyles';
import { localFolders_stor } from '@/Store/MainWin/localFolders_store';
import { useColumnView_Store } from '@/Store/MainWin/useColumnView_store';

export function TopPanelLocal() {
	const { localFolder, updateLocalFolder } = localFolders_stor();
	const { instances } = useColumnView_Store();

	const handleOpenInFinder = () => {
		const cols = instances.local.columns;
		const pathToOpen = cols[cols.length - 1]?.path;
		if (pathToOpen) commands.shellOpenPath(pathToOpen);
	};

	return (
		<Box
			sx={{
				...bottomBoxStyle,
				...topShadowStyle,
				position: 'relative',
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'space-between',
				pl: 2,
				mb: 1,
				height: 26,
			}}
		>
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
				Папка для обработки
			</Typography>
			<Box sx={{ display: 'flex', alignItems: 'center' }}>
				<IconButton sx={{ p: 0 }} size='small' onClick={handleOpenInFinder}>
					<FolderSymlink strokeWidth={1} size={20} />
				</IconButton>
			</Box>
			<Box sx={{ display: 'flex', alignItems: 'center' }}>
				<IconButton sx={{ p: 0, margin: '0 10px' }} size='small' onClick={() => updateLocalFolder('')}>
					<BookmarkX strokeWidth={1} />
				</IconButton>
			</Box>
		</Box>
	);
}
