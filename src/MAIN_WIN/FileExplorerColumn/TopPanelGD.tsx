import { Box, IconButton, Typography } from '@mui/material';
import { commands } from '@/Utils/specta';
import { FolderSymlink } from 'lucide-react';
import { bottomBoxStyle, topShadowFor } from '../mainStyles';
import { useActiveFolderIsOnline } from '../hooks/useActiveFolderIsOnline';
import { useColumnView_Store } from '@/Store/MainWin/useColumnView_store';
import { ensureMirrorDir } from '@/Utils/storageSeam';

export function TopPanelGD() {
	const { instances } = useColumnView_Store();
	const isOnlineFolder = useActiveFolderIsOnline();

	const handleOpenInFinder = async () => {
		const cols = instances.gd.columns;
		const pathToOpen = cols[cols.length - 1]?.path;
		if (!pathToOpen) return;
		// Папка облачного проекта может существовать только в каталоге. Открыть
		// несуществующую папку нельзя — создаём ровно ту, которую попросили.
		await ensureMirrorDir(pathToOpen);
		commands.shellOpenPath(pathToOpen);
	};

	return (
		<Box
			sx={{
				...bottomBoxStyle,
				...topShadowFor(isOnlineFolder),
				position: 'relative',
				display: 'flex',
				alignItems: 'center',
				pl: 2,
				mb: 1,
				height: 26,
			}}
		>
			<IconButton sx={{ p: 0 }} size='small' onClick={() => void handleOpenInFinder()}>
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
