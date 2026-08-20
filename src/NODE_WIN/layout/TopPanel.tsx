import { greyColor } from '@/Store/Color/grayColor';
import { commands } from '@/Utils/specta';
import { usePathStore } from '@/Store/Node/usePathStore';
import { isScanningStore } from '@/Store/MainWin/isScaning_store';
import { runProcessingForSingleFolder } from '@/PROCESSING/runProcessingForSingleFolder';
import { abortNow } from '@/PROCESSING/utils/processingAbort';
import { RUN_PROCESSING } from '@/PROCESSING/runLanes';
import { Box, Button, Divider, IconButton, Stack, Tooltip, Typography } from '@mui/material';
import { useReactFlow } from '@xyflow/react';
import { FileText, Play, Square } from 'lucide-react';
import { memo, useCallback, useState } from 'react';
import PresetsModal from './PresetsModal';
import DocModal from './DocModal';
import { saveFlow } from '@/NODE_WIN/utils/saveFlow';
import { ProjectDescriptionModal } from '@/components/ProjectDescriptionModal';

interface TopPanelProps {
	title: string | null;
}

function TopPanel({ title }: TopPanelProps) {
	const platform = window.navigator.userAgent;
	const isWindows = platform.includes('Windows');
	const folderName = title?.split(isWindows ? '\\' : '/').pop();

	const [presetsOpen, setPresetsOpen] = useState(false);
	const [docOpen, setDocOpen] = useState(false);
	const [descOpen, setDescOpen] = useState(false);

	const reactFlow = useReactFlow();
	const { path } = usePathStore();
	const { isScanningProcess } = isScanningStore();

	const handleStart = useCallback(async () => {
		if (!path || isScanningProcess) return;

		// Сначала сохраняем текущее состояние нод
		await saveFlow(path, reactFlow.toObject());

		// Запускаем обработку только для этой папки
		await runProcessingForSingleFolder(path);
	}, [path, reactFlow, isScanningProcess]);

	const handleStop = useCallback(() => {
		abortNow();
		// Полоса обработки: постинг — отдельный прогон, его процессы этот стоп не касается.
		commands.abortProcessing(RUN_PROCESSING);
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

				{/* Описание проекта — размер и толщина как у иконок главного окна */}
				<Tooltip title='Описание проекта' arrow>
					<span>
						<IconButton
							size='small'
							disabled={!path}
							onClick={() => setDescOpen(true)}
							sx={{ p: 0, mx: '12px', color: greyColor(65), '&:hover': { color: greyColor(90) } }}
						>
							<FileText strokeWidth={1} />
						</IconButton>
					</span>
				</Tooltip>

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

			{/* Modal: описание проекта — здесь проект уже открыт, путь под рукой */}
			{path && (
				<ProjectDescriptionModal
					open={descOpen}
					onClose={() => setDescOpen(false)}
					projectName={folderName ?? ''}
					projectPath={path}
				/>
			)}
		</>
	);
}

export default memo(TopPanel);
