import { useStatusBar_Store } from '@/Store/Processing/useStatusBar_Store';
import { useElectronEventListener } from '@/hooks/useElectronEventListener';
import { Typography } from '@mui/material';

function StatusBar() {
	// тут будем выводить текст из какого нибудь темпового стора, куда я буду помещать текст того что происходит
	// нужно его настроить что бы он мог растягиваться когда текст будет длинным в 2 строки. вряд ли будет больше
	const { statusBar, setStatusBarState } = useStatusBar_Store();

	useElectronEventListener(
		window.electronAPI.onProcessingEvent,
		window.electronAPI.removeProcessingEvent,
		(event: { type: string; payload: any }) => {
			if (event.type === 'statusbar') {
				setStatusBarState(event.payload.text);
			}
		},
	);
	return (
		// <Box sx={{ height: '36px', display: 'flex', alignItems: 'center', ml: '10px' }}>
		<Typography
			variant='body1'
			sx={{
				fontSize: '1.4rem',
				whiteSpace: 'pre-wrap', // Позволяет переносить текст на новую строку
				wordBreak: 'break-word', // Переносит длинные слова
			}}
		>
			{statusBar}
		</Typography>
		// </Box>
	);
}

export default StatusBar;
