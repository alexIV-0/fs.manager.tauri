import { useStatusBar_Store } from '@/Store/Processing/useStatusBar_Store';
import { isScanningStore } from '@/Store/MainWin/isScaning_store';
import { useTauriEventListener } from '@/hooks/useTauriEventListener';
import { statusTextSx } from './Universal/StatusRow';
import { Typography } from '@mui/material';

function StatusBar() {
	// Приглушение в простое — общее правило всех трёх строк (см. StatusRow).
	const { isScanning } = isScanningStore();
	// тут будем выводить текст из какого нибудь темпового стора, куда я буду помещать текст того что происходит
	// нужно его настроить что бы он мог растягиваться когда текст будет длинным в 2 строки. вряд ли будет больше
	const { statusBar, setStatusBarState } = useStatusBar_Store();

	useTauriEventListener(
		window.tauriAPI.onProcessingEvent,
		window.tauriAPI.removeProcessingEvent,
		(event: { type: string; payload: any }) => {
			if (event.type === 'statusbar') {
				setStatusBarState(event.payload.text);
			}
		},
	);
	return (
		<Typography variant='body1' sx={statusTextSx(isScanning)}>
			{statusBar}
		</Typography>
	);
}

export default StatusBar;
