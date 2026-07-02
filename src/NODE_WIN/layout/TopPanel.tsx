import { greyColor } from '@/Store/Color/grayColor';
import { commands, unwrap } from '@/Utils/specta';
import { usePathStore } from '@/Store/Node/usePathStore';
import { isScanningStore } from '@/Store/MainWin/isScaning_store';
import { runProcessingForSingleFolder } from '@/PROCESSING/runProcessingForSingleFolder';
import { abortNow } from '@/PROCESSING/utils/processingAbort';
import { Box, Button, Divider, IconButton, Stack, Typography } from '@mui/material';
import { useReactFlow } from '@xyflow/react';
import { Play, Square } from 'lucide-react';
import { memo, useCallback, useState } from 'react';
import PresetsModal from './PresetsModal';
import DocModal from './DocModal';
import { syncTgSearchSidecar } from '@/NODE_WIN/utils/syncTgSearchSidecar';
import { syncPostSourcesSidecar } from '@/NODE_WIN/utils/syncPostSourcesSidecar';
import { ensureProjectFolders } from '@/NODE_WIN/utils/ensureProjectFolders';

interface TopPanelProps {
	title: string | null;
}

function TopPanel({ title }: TopPanelProps) {
	const platform = window.navigator.userAgent;
	const isWindows = platform.includes('Windows');
	const folderName = title?.split(isWindows ? '\\' : '/').pop();

	const [presetsOpen, setPresetsOpen] = useState(false);
	const [docOpen, setDocOpen] = useState(false);

	const reactFlow = useReactFlow();
	const { path } = usePathStore();
	const { isScanningProcess } = isScanningStore();

	const handleStart = useCallback(async () => {
		if (!path || isScanningProcess) return;

		// Сначала сохраняем текущее состояние нод
		const flow = reactFlow.toObject();
		unwrap(await commands.saveFlowToOptionsFolder(path, flow as any));
		await ensureProjectFolders(path, flow);
		await syncTgSearchSidecar(path, flow);
		await syncPostSourcesSidecar(path, flow);

		// Запускаем обработку только для этой папки
		await runProcessingForSingleFolder(path);
	}, [path, reactFlow, isScanningProcess]);

	const handleStop = useCallback(() => {
		abortNow();
		commands.abortProcessing();
		const { setIsScanning, setIsScanningProcess } = isScanningStore.getState();
		setIsScanningProcess(false);
		setIsScanning(false);
	}, []);

	return (
		<>
			<Stack
				direction='row'
				height='40px'
				alignItems='center'
				position='fixed'
				top={0}
				left={0}
				right={0}
				zIndex={1300}
				sx={{ backgroundColor: greyColor(15), borderBottom: `1px solid ${greyColor(40)}` }}
			>
				{/* Левая часть — название папки */}
				<Typography variant='body2' px={2} sx={{ opacity: 0.6 }}>
					{folderName}
				</Typography>
				<Divider orientation='vertical' flexItem />

				{/* Центр — кнопки запуска/остановки */}
				<Box
					sx={{
						position: 'absolute',
						left: '50%',
						transform: 'translateX(-50%)',
						display: 'flex',
						alignItems: 'center',
						gap: 2,
					}}
				>
					<IconButton
						size='small'
						onClick={handleStart}
						disabled={isScanningProcess}
						sx={{ color: isScanningProcess ? greyColor(40) : '#4caf50' }}
					>
						<Play size={25} strokeWidth={2} />
					</IconButton>

					<IconButton
						size='small'
						onClick={handleStop}
						disabled={!isScanningProcess}
						sx={{ color: !isScanningProcess ? greyColor(40) : '#f44336' }}
					>
						<Square size={25} strokeWidth={2} />
					</IconButton>
				</Box>

				{/* Правая часть — прибита к правому краю */}
				<Box
					sx={{
						marginLeft: 'auto',
						display: 'flex',
						alignItems: 'center',
						height: '100%',
						px: 1,
						gap: 0.5,
					}}
				>
					<Divider orientation='vertical' flexItem />
					<Button
						size='small'
						variant='text'
						sx={{ minWidth: 0, px: 1, py: 0, fontSize: 12, height: 22 }}
						onClick={() => setPresetsOpen(true)}
					>
						Presets
					</Button>
					<Button size='small' variant='text' sx={{ minWidth: 0, px: 1, py: 0, fontSize: 12, height: 22 }} onClick={() => setDocOpen(true)}>
						Doc
					</Button>
				</Box>
			</Stack>

			{/* Modal: Presets */}
			<PresetsModal open={presetsOpen} onClose={() => setPresetsOpen(false)} />

			{/* Modal: Documentation */}
			<DocModal open={docOpen} onClose={() => setDocOpen(false)} />
		</>
	);
}

export default memo(TopPanel);
