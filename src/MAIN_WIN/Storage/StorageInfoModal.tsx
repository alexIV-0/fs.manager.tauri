// Модалка «Информация»: дерево ТОЛЬКО из папок с итогами по поддереву.
//
// Четыре колонки — имя, файлов, размер, локально. Последняя превращает справку в
// маленький менеджер места: видно не только «сколько там», но и «сколько уже у
// меня», а значит есть что освобождать.
//
// Раскрытие ленивое: один агрегирующий запрос на уровень. Сразу тянуть всё
// дерево значило бы считать поддеревья, в которые человек не заглянет.

import {
	Box,
	Button,
	CircularProgress,
	Dialog,
	DialogContent,
	DialogTitle,
	Stack,
	Tooltip,
	Typography,
} from '@mui/material';
import { ChevronDown, ChevronRight, CircleHelp, Folder } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import type { SubtreeStats } from '@/bindings';
import { commands } from '@/Utils/specta';

function humanSize(bytes: number): string {
	if (!bytes) return '—';
	if (bytes < 1024) return `${bytes} Б`;
	const units = ['КБ', 'МБ', 'ГБ', 'ТБ'];
	let v = bytes / 1024;
	let i = 0;
	while (v >= 1024 && i + 1 < units.length) {
		v /= 1024;
		i += 1;
	}
	return `${v.toFixed(1)} ${units[i]}`;
}

const join = (base: string, name: string) => (base ? `${base}/${name}` : name);

interface Props {
	open: boolean;
	projectId: string | null;
	/** С какой папки начинать. `''` — корень проекта. */
	rootPath: string;
	title?: string;
	onClose: () => void;
	/** Перейти к папке в основном интерфейсе. */
	onNavigate?: (folderPath: string) => void;
}

export function StorageInfoModal({ open, projectId, rootPath, title, onClose, onNavigate }: Props) {
	const [stats, setStats] = useState<Record<string, SubtreeStats>>({});
	const [expanded, setExpanded] = useState<Set<string>>(new Set());
	const [loading, setLoading] = useState<Set<string>>(new Set());

	const load = useCallback(
		async (path: string) => {
			if (!projectId) return;
			setLoading((s) => new Set(s).add(path));
			const r = await commands.storageSubtreeStats(projectId, path);
			if (r.status === 'ok') setStats((s) => ({ ...s, [path]: r.data }));
			setLoading((s) => {
				const n = new Set(s);
				n.delete(path);
				return n;
			});
		},
		[projectId],
	);

	useEffect(() => {
		if (open && projectId) {
			setStats({});
			setExpanded(new Set([rootPath]));
			void load(rootPath);
		}
	}, [open, projectId, rootPath, load]);

	const toggle = (path: string) => {
		setExpanded((s) => {
			const n = new Set(s);
			if (n.has(path)) n.delete(path);
			else {
				n.add(path);
				if (!stats[path]) void load(path);
			}
			return n;
		});
	};

	const root = stats[rootPath];

	const renderLevel = (path: string, depth: number) => {
		const st = stats[path];
		if (!st) return null;

		return st.children.map((c) => {
			const childPath = c.isFolder ? join(path, c.name) : path;
			const isOpen = c.isFolder && expanded.has(childPath);

			return (
				<Box key={`${path}/${c.name}`}>
					<Stack
						direction='row'
						alignItems='center'
						spacing={1}
						sx={{
							py: '2px',
							pl: `${8 + depth * 16}px`,
							pr: 1,
							// Служебные папки не прячем, но приглушаем: «проект 52 ГБ»
							// включает логи и статистику, и это надо отличать от контента.
							opacity: c.internal ? 0.45 : 1,
							'&:hover': { bgcolor: 'action.hover' },
						}}
					>
						{c.isFolder ? (
							<Box
								onClick={() => toggle(childPath)}
								sx={{ display: 'flex', cursor: 'pointer', width: 12 }}
							>
								{isOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
							</Box>
						) : (
							<Box sx={{ width: 12 }} />
						)}

						{c.isFolder ? <Folder size={12} strokeWidth={1} opacity={0.6} /> : <Box sx={{ width: 12 }} />}

						<Typography
							variant='caption'
							noWrap
							onDoubleClick={() => c.isFolder && onNavigate?.(childPath)}
							sx={{ flex: 1, fontSize: 12, cursor: c.isFolder ? 'pointer' : 'default' }}
						>
							{c.name || <i style={{ opacity: 0.6 }}>файлы здесь</i>}
						</Typography>

						<Typography variant='caption' sx={num}>
							{c.files || '—'}
						</Typography>
						<Typography variant='caption' sx={num}>
							{humanSize(c.bytes)}
						</Typography>
						<Typography variant='caption' sx={{ ...num, color: c.localBytes ? 'success.main' : 'text.disabled' }}>
							{humanSize(c.localBytes)}
						</Typography>
					</Stack>

					{isOpen && renderLevel(childPath, depth + 1)}
					{isOpen && loading.has(childPath) && (
						<Box sx={{ pl: `${24 + depth * 16}px`, py: '2px' }}>
							<CircularProgress size={10} />
						</Box>
					)}
				</Box>
			);
		});
	};

	return (
		<Dialog open={open} onClose={onClose} maxWidth='sm' fullWidth>
			{/* `component='div'`: по умолчанию DialogTitle — это `h2`, а внутри лежит
			    `subtitle2`, то есть `h6`. Заголовок внутри заголовка — невалидный HTML,
			    и React ругается в консоль на каждое открытие модалки. */}
			<DialogTitle component='div' sx={{ pb: 1 }}>
				<Typography variant='subtitle2'>{title ?? 'Информация'}</Typography>
			</DialogTitle>

			<DialogContent dividers sx={{ p: 0 }}>
				{/* «Не знаю» и «пусто» — разные вещи. Показать «0 файлов» там, где мы
				    просто не спрашивали, значит соврать. */}
				{root && !root.known ? (
					<Stack alignItems='center' spacing={1} sx={{ py: 3 }}>
						<CircleHelp size={20} strokeWidth={1} opacity={0.5} />
						<Typography variant='caption' sx={{ color: 'text.disabled' }}>
							Этот проект ещё не синхронизирован — содержимое неизвестно
						</Typography>
						<Button
							size='small'
							onClick={() => {
								if (projectId) void commands.storageCatchUp(projectId).then(() => load(rootPath));
							}}
						>
							Загрузить дерево
						</Button>
					</Stack>
				) : (
					<>
						<Stack
							direction='row'
							spacing={1}
							sx={{ py: '4px', px: 1, borderBottom: '1px solid', borderColor: 'divider' }}
						>
							<Box sx={{ width: 24 }} />
							<Typography variant='caption' sx={{ flex: 1, color: 'text.disabled', fontSize: 10 }}>
								Папка
							</Typography>
							<Typography variant='caption' sx={{ ...num, color: 'text.disabled', fontSize: 10 }}>
								Файлов
							</Typography>
							<Typography variant='caption' sx={{ ...num, color: 'text.disabled', fontSize: 10 }}>
								Размер
							</Typography>
							<Tooltip title='Сколько из этого уже скачано на этот компьютер' arrow>
								<Typography variant='caption' sx={{ ...num, color: 'text.disabled', fontSize: 10 }}>
									Локально
								</Typography>
							</Tooltip>
						</Stack>

						<Box sx={{ maxHeight: 400, overflowY: 'auto' }}>
							{loading.has(rootPath) && !root ? (
								<Box sx={{ p: 2, textAlign: 'center' }}>
									<CircularProgress size={14} />
								</Box>
							) : (
								renderLevel(rootPath, 0)
							)}
						</Box>

						{root && (
							<Stack
								direction='row'
								spacing={1}
								sx={{ py: '4px', px: 1, borderTop: '1px solid', borderColor: 'divider' }}
							>
								<Box sx={{ width: 24 }} />
								<Typography variant='caption' sx={{ flex: 1, fontSize: 11 }}>
									Всего
								</Typography>
								<Typography variant='caption' sx={{ ...num, fontSize: 11 }}>
									{root.files}
								</Typography>
								<Typography variant='caption' sx={{ ...num, fontSize: 11 }}>
									{humanSize(root.bytes)}
								</Typography>
								<Typography variant='caption' sx={{ ...num, fontSize: 11, color: 'success.main' }}>
									{humanSize(root.localBytes)}
								</Typography>
							</Stack>
						)}
					</>
				)}
			</DialogContent>
		</Dialog>
	);
}

const num = {
	width: 68,
	textAlign: 'right' as const,
	fontSize: 11,
	fontVariantNumeric: 'tabular-nums' as const,
};
