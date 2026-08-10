// Панель передач: что сейчас едет и что недавно упало.
//
// Завершённые показываем намеренно — ошибка, о которой никто не узнал, это
// ошибка, которая повторится. Особенно важно для заливки: там бывает случай
// «байты уехали, а подтверждение не прошло», и он требует внимания человека.

import {
	Box,
	IconButton,
	LinearProgress,
	Popover,
	Stack,
	Tooltip,
	Typography,
} from '@mui/material';
import { ArrowDown, ArrowUp, Trash2, TriangleAlert, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import type { TransferRow } from '@/bindings';
import { commands } from '@/Utils/specta';

/** Пока что-то едет — опрашиваем чаще, в покое почти не трогаем. */
const TICK_ACTIVE = 400;
const TICK_IDLE = 2500;

function humanSize(bytes: number | null | undefined): string {
	if (!bytes) return '';
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

export function useTransfers() {
	const [rows, setRows] = useState<TransferRow[]>([]);
	const timer = useRef<number | null>(null);

	useEffect(() => {
		let alive = true;

		const poll = async () => {
			const r = await commands.storageTransfers(50);
			if (!alive) return;
			const list = r.status === 'ok' ? r.data : [];
			setRows(list);

			const active = list.some((t) => t.state === 'active' || t.state === 'queued');
			timer.current = window.setTimeout(poll, active ? TICK_ACTIVE : TICK_IDLE);
		};

		void poll();
		return () => {
			alive = false;
			if (timer.current) window.clearTimeout(timer.current);
		};
	}, []);

	const active = rows.filter((t) => t.state === 'active' || t.state === 'queued').length;
	const failed = rows.filter((t) => t.state === 'error').length;
	return { rows, active, failed };
}

/** Компактный индикатор для нижней панели колонки. Разворачивается в список. */
export function TransfersIndicator() {
	const { rows, active, failed } = useTransfers();
	const [anchor, setAnchor] = useState<HTMLElement | null>(null);

	if (rows.length === 0) return null;

	return (
		<>
			<Box
				onClick={(e) => setAnchor(e.currentTarget)}
				sx={{
					display: 'flex',
					alignItems: 'center',
					gap: '4px',
					px: 1,
					cursor: 'pointer',
					userSelect: 'none',
					color: failed > 0 ? 'error.main' : 'text.secondary',
					opacity: failed > 0 ? 0.9 : 0.7,
				}}
			>
				{failed > 0 ? <TriangleAlert size={12} strokeWidth={1.5} /> : <ArrowDown size={12} strokeWidth={1} />}
				<Typography variant='caption' sx={{ fontSize: 10 }}>
					{active > 0 ? `передач: ${active}` : failed > 0 ? `ошибок: ${failed}` : 'передачи'}
				</Typography>
			</Box>

			<Popover
				open={!!anchor}
				anchorEl={anchor}
				onClose={() => setAnchor(null)}
				anchorOrigin={{ vertical: 'top', horizontal: 'left' }}
				transformOrigin={{ vertical: 'bottom', horizontal: 'left' }}
			>
				<Box sx={{ width: 420, maxHeight: 360, overflowY: 'auto', p: 1 }}>
					<Stack direction='row' alignItems='center' justifyContent='space-between' sx={{ mb: 0.5 }}>
						<Typography variant='caption' sx={{ color: 'text.disabled' }}>
							Передачи
						</Typography>
						<Tooltip title='Убрать завершённые' arrow>
							<IconButton
								size='small'
								onClick={() => void commands.storageClearFinishedTransfers()}
								sx={{ p: '2px' }}
							>
								<Trash2 size={12} strokeWidth={1} />
							</IconButton>
						</Tooltip>
					</Stack>

					{rows.map((t) => {
						const running = t.state === 'active' || t.state === 'queued';
						const pct =
							t.bytesTotal && t.bytesTotal > 0
								? Math.min(100, Math.round((t.bytesDone / t.bytesTotal) * 100))
								: null;

						return (
							<Box key={t.id} sx={{ py: '3px', borderBottom: '1px solid', borderColor: 'divider' }}>
								<Stack direction='row' alignItems='center' spacing={0.5}>
									{t.direction === 'up' ? (
										<ArrowUp size={11} strokeWidth={1.5} opacity={0.6} />
									) : (
										<ArrowDown size={11} strokeWidth={1.5} opacity={0.6} />
									)}
									<Typography variant='caption' noWrap sx={{ flex: 1, fontSize: 11 }}>
										{t.name}
									</Typography>
									<Typography
										variant='caption'
										sx={{ fontSize: 10, color: 'text.disabled', fontVariantNumeric: 'tabular-nums' }}
									>
										{pct !== null ? `${pct}%` : humanSize(t.bytesDone)}
									</Typography>
									{running && (
										<Tooltip title='Отменить' arrow>
											<IconButton
												size='small'
												onClick={() => void commands.storageCancelTransfer(t.id)}
												sx={{ p: '1px' }}
											>
												<X size={11} strokeWidth={1.5} />
											</IconButton>
										</Tooltip>
									)}
								</Stack>

								{running && (
									<LinearProgress
										variant={pct === null ? 'indeterminate' : 'determinate'}
										value={pct ?? 0}
										sx={{ height: 2, mt: '2px' }}
									/>
								)}

								{t.error && (
									<Typography
										variant='caption'
										sx={{ display: 'block', fontSize: 10, color: 'error.main', opacity: 0.85 }}
									>
										{t.error}
									</Typography>
								)}
							</Box>
						);
					})}
				</Box>
			</Popover>
		</>
	);
}
