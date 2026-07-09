import { Modal, Box, Typography } from '@mui/material';
import { X, BarChart3 } from 'lucide-react';
import { greyColor, defGray } from '@/Store/Color/grayColor';

// Модалка статистики проекта. Пока — пустой каркас; в будущем это отдельный
// большой раздел (метрики обработки, автопостинга и т.д.) для конкретного проекта.
interface ProjectStatsModalProps {
	open: boolean;
	onClose: () => void;
	projectName: string;
	projectPath: string;
}

export function ProjectStatsModal({ open, onClose, projectName, projectPath }: ProjectStatsModalProps) {
	return (
		<Modal open={open} onClose={onClose}>
			<Box
				sx={{
					position: 'absolute',
					top: '50%',
					left: '50%',
					transform: 'translate(-50%, -50%)',
					width: '70%',
					height: '70%',
					display: 'flex',
					flexDirection: 'column',
					bgcolor: greyColor(18),
					border: `2px solid ${greyColor(40)}`,
					borderRadius: '4px',
					boxShadow: 24,
					overflow: 'hidden',
				}}
			>
				{/* Заголовок */}
				<Box
					sx={{
						display: 'flex',
						justifyContent: 'space-between',
						alignItems: 'center',
						p: 2,
						borderBottom: `1px solid ${greyColor(50)}`,
						flexShrink: 0,
					}}
				>
					<Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
						<BarChart3 size={20} />
						<Typography sx={{ fontSize: 18, fontWeight: 600 }}>Статистика — {projectName}</Typography>
					</Box>
					<Box
						component='button'
						onClick={onClose}
						sx={{
							background: 'none',
							border: 'none',
							cursor: 'pointer',
							padding: '4px',
							display: 'flex',
							alignItems: 'center',
							'&:hover': { opacity: 0.7 },
						}}
					>
						<X size={20} />
					</Box>
				</Box>

				{/* Контент — заглушка */}
				<Box
					sx={{
						flex: 1,
						display: 'flex',
						flexDirection: 'column',
						justifyContent: 'center',
						alignItems: 'center',
						gap: 1,
						p: 2,
					}}
				>
					<Typography color={defGray} sx={{ fontSize: 16 }}>
						Статистика проекта появится здесь
					</Typography>
					<Typography color={defGray} sx={{ fontSize: 12, opacity: 0.6 }}>
						{projectPath}
					</Typography>
				</Box>
			</Box>
		</Modal>
	);
}
