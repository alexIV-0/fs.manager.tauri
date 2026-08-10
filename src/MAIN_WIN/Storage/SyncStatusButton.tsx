// Кнопка синхронизации в верхней панели + модалка с двумя закладками.
//
// Кнопка сделана в том же виде, что счётчик итераций рядом: рамка, тёмный фон,
// монospace. Две стрелки — скачивание и заливка, рядом процент. В покое кнопка
// приглушена, но не исчезает: пропадающий элемент в панели сбивает раскладку и
// заставляет искать его заново.

import {
	Box,
	Dialog,
	DialogContent,
	DialogTitle,
	IconButton,
	LinearProgress,
	List,
	ListItem,
	Stack,
	Tab,
	Tabs,
	Tooltip,
	Typography,
} from '@mui/material';
import { ArrowDown, ArrowUp, CloudOff, HardDriveDownload, Pin, Trash2, TriangleAlert, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { LocalFileRow, TransferRow } from '@/bindings';
import { storage_store } from '@/Store/MainWin/storage_store';
import { commands } from '@/Utils/specta';

/** Пока что-то едет — опрашиваем часто, в покое почти не трогаем. */
const TICK_ACTIVE = 500;
const TICK_IDLE = 3000;

function humanSize(bytes: number | null | undefined): string {
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

/** «2 часа назад» — по этому времени считается вытеснение, и его надо понимать. */
function sinceText(unixSec: number): string {
	if (!unixSec) return '—';
	const mins = Math.max(0, Math.round((Date.now() / 1000 - unixSec) / 60));
	if (mins < 60) return `${mins} мин назад`;
	const hours = Math.round(mins / 60);
	if (hours < 24) return `${hours} ч назад`;
	return `${Math.round(hours / 24)} дн назад`;
}

interface Summary {
	down: number;
	up: number;
	failed: number;
	/** 0..1 по всем активным передачам вместе. `null` — размеры неизвестны. */
	progress: number | null;
}

function summarize(rows: TransferRow[]): Summary {
	const active = rows.filter((t) => t.state === 'active' || t.state === 'queued');
	const done = active.reduce((s, t) => s + t.bytesDone, 0);
	const total = active.reduce((s, t) => s + (t.bytesTotal ?? 0), 0);
	return {
		down: active.filter((t) => t.direction === 'down').length,
		up: active.filter((t) => t.direction === 'up').length,
		failed: rows.filter((t) => t.state === 'error').length,
		// Общий процент — по байтам, а не по числу файлов: иначе один большой файл
		// и десять мелких дают одинаковый вклад, и полоса врёт.
		progress: total > 0 ? Math.min(1, done / total) : null,
	};
}

export function SyncStatusButton() {
	const connected = storage_store((s) => s.status.connected);
	// Показываем кнопку и когда хранилище заведено, но ещё не подключено: иначе
	// «не подключено» и «кнопки нет» выглядят одинаково, и непонятно, что сломалось.
	const configured = storage_store((s) => s.status.configured);
	const [rows, setRows] = useState<TransferRow[]>([]);
	const [open, setOpen] = useState(false);
	const timer = useRef<number | null>(null);

	// Опрос вместо событий: передачи живут в Rust, а событий по ним пока нет.
	// Частота падает в покое, поэтому в простое это почти бесплатно.
	useEffect(() => {
		if (!connected) {
			setRows([]);
			return;
		}
		let alive = true;
		const poll = async () => {
			const r = await commands.storageTransfers(100);
			if (!alive) return;
			const list = r.status === 'ok' ? r.data : [];
			setRows(list);
			const busy = list.some((t) => t.state === 'active' || t.state === 'queued');
			timer.current = window.setTimeout(poll, busy ? TICK_ACTIVE : TICK_IDLE);
		};
		void poll();
		return () => {
			alive = false;
			if (timer.current) window.clearTimeout(timer.current);
		};
	}, [connected]);

	if (!connected && !configured) return null;

	const s = summarize(rows);
	const pct = s.progress === null ? null : Math.round(s.progress * 100);
	const busy = s.down + s.up > 0;

	return (
		<>
			<Tooltip
				title={
					!connected
						? 'Хранилище не подключено. Настройки → Хранилище'
						: busy
							? `Скачивается: ${s.down}, заливается: ${s.up}`
							: s.failed > 0
								? `Ошибок передачи: ${s.failed}`
								: 'Синхронизация: очередь пуста'
				}
			>
				<Box
					onClick={() => setOpen(true)}
					sx={{
						display: 'flex',
						alignItems: 'center',
						gap: '2px',
						mr: '10px',
						px: '8px',
						py: '2px',
						border: `0.5px solid ${s.failed > 0 ? '#f85149' : 'rgba(150,150,150,0.5)'}`,
						borderRadius: '3px',
						backgroundColor: 'rgba(0,0,0,0.35)',
						cursor: 'pointer',
						fontSize: '16px',
						fontFamily: 'monospace',
						userSelect: 'none',
						// В покое приглушаем, но не убираем: исчезающий элемент панели
						// сдвигает соседей и его приходится искать заново.
						opacity: busy || s.failed > 0 ? 1 : 0.45,
						'&:hover': { opacity: 0.8 },
					}}
				>
					{connected ? (
						<>
							<ArrowDown size={15} strokeWidth={1.5} style={{ color: s.down > 0 ? '#58a6ff' : undefined }} />
							<ArrowUp size={15} strokeWidth={1.5} style={{ color: s.up > 0 ? '#3fb950' : undefined }} />
							{s.failed > 0 && <TriangleAlert size={15} strokeWidth={1.5} style={{ color: '#f85149' }} />}
						</>
					) : (
						<CloudOff size={15} strokeWidth={1.5} />
					)}
					<Box component='span' sx={{ minWidth: 30, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
						{!connected ? 'off' : pct !== null ? `${pct}%` : busy ? '…' : '—'}
					</Box>
				</Box>
			</Tooltip>

			<SyncModal open={open} onClose={() => setOpen(false)} rows={rows} />
		</>
	);
}

// ─── Модалка ────────────────────────────────────────────────────────────────

function SyncModal({ open, onClose, rows }: { open: boolean; onClose: () => void; rows: TransferRow[] }) {
	const [tab, setTab] = useState(0);

	return (
		<Dialog open={open} onClose={onClose} maxWidth='md' fullWidth>
			<DialogTitle component='div' sx={{ pb: 0 }}>
				<Typography variant='subtitle2'>Синхронизация</Typography>
			</DialogTitle>

			<Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ px: 2, minHeight: 36 }}>
				<Tab label='Передачи' sx={{ minHeight: 36, fontSize: 12 }} />
				<Tab label='Локальные копии' sx={{ minHeight: 36, fontSize: 12 }} />
			</Tabs>

			<DialogContent dividers sx={{ p: 0, minHeight: 300, maxHeight: '80%' }}>
				{tab === 0 ? <TransfersTab rows={rows} /> : <LocalCopiesTab open={open && tab === 1} />}
			</DialogContent>
		</Dialog>
	);
}

function TransfersTab({ rows }: { rows: TransferRow[] }) {
	if (rows.length === 0) {
		return (
			<Typography variant='caption' sx={{ display: 'block', p: 2, color: 'text.disabled' }}>
				Передач не было
			</Typography>
		);
	}

	return (
		<List disablePadding>
			{rows.map((t) => {
				const running = t.state === 'active' || t.state === 'queued';
				const pct = t.bytesTotal && t.bytesTotal > 0 ? Math.min(100, Math.round((t.bytesDone / t.bytesTotal) * 100)) : null;

				return (
					<ListItem key={t.id} divider sx={{ display: 'block', py: '4px' }}>
						<Stack direction='row' alignItems='center' spacing={1}>
							{t.direction === 'up' ? (
								<ArrowUp size={13} strokeWidth={1.5} opacity={0.7} />
							) : (
								<ArrowDown size={13} strokeWidth={1.5} opacity={0.7} />
							)}
							<Typography variant='body2' noWrap sx={{ flex: 1, minWidth: 0, fontSize: 12 }}>
								{t.name}
							</Typography>
							<Typography variant='caption' sx={{ color: 'text.disabled', fontSize: 11 }}>
								{humanSize(t.bytesTotal)}
							</Typography>
							<Typography variant='caption' sx={{ width: 44, textAlign: 'right', fontSize: 11, fontVariantNumeric: 'tabular-nums' }}>
								{pct !== null ? `${pct}%` : t.state}
							</Typography>
							{running && (
								<Tooltip title='Отменить' arrow>
									<IconButton size='small' sx={{ p: '2px' }} onClick={() => void commands.storageCancelTransfer(t.id)}>
										<X size={12} strokeWidth={1.5} />
									</IconButton>
								</Tooltip>
							)}
						</Stack>

						{running && (
							<LinearProgress variant={pct === null ? 'indeterminate' : 'determinate'} value={pct ?? 0} sx={{ height: 2, mt: '2px' }} />
						)}

						{/* Ошибку показываем целиком: «байты уехали, но подтверждение не
						    прошло» — случай, требующий человека, и прятать его нельзя. */}
						{t.error && (
							<Typography variant='caption' sx={{ display: 'block', fontSize: 10, color: 'error.main' }}>
								{t.error}
							</Typography>
						)}
					</ListItem>
				);
			})}
		</List>
	);
}

function LocalCopiesTab({ open }: { open: boolean }) {
	const [files, setFiles] = useState<LocalFileRow[] | null>(null);
	const [busyId, setBusyId] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	const load = useCallback(async () => {
		const r = await commands.storageLocalFiles();
		if (r.status === 'ok') setFiles(r.data);
		else setError(r.error);
	}, []);

	useEffect(() => {
		if (open) void load();
	}, [open, load]);

	const drop = async (fileId: string) => {
		setBusyId(fileId);
		setError(null);
		const r = await commands.storageDropLocal(fileId);
		if (r.status === 'error') setError(r.error);
		setBusyId(null);
		await load();
	};

	if (error) {
		return (
			<Typography variant='caption' sx={{ display: 'block', p: 2, color: 'error.main' }}>
				{error}
			</Typography>
		);
	}
	if (files === null) return null;
	if (files.length === 0) {
		return (
			<Typography variant='caption' sx={{ display: 'block', p: 2, color: 'text.disabled' }}>
				Локальных копий нет — всё только в облаке
			</Typography>
		);
	}

	const total = files.reduce((s, f) => s + f.sizeBytes, 0);

	return (
		<>
			<Stack direction='row' spacing={1} sx={{ px: 2, py: '4px', alignItems: 'center' }}>
				<HardDriveDownload size={13} strokeWidth={1} opacity={0.6} />
				<Typography variant='caption' sx={{ color: 'text.disabled', fontSize: 11 }}>
					{files.length} файлов занимают {humanSize(total)}. Здесь только синхронизированные копии — удалить их безопасно, файл останется в
					облаке.
				</Typography>
			</Stack>

			<List disablePadding>
				{files.map((f) => (
					<ListItem key={f.fileId} divider sx={{ py: '3px', gap: 1 }}>
						<Box sx={{ flex: 1, minWidth: 0 }}>
							<Typography variant='body2' noWrap sx={{ fontSize: 12 }}>
								{f.name}
							</Typography>
							<Typography variant='caption' noWrap sx={{ display: 'block', fontSize: 10, color: 'text.disabled' }}>
								{f.project || f.path}
							</Typography>
						</Box>

						{f.pinned && (
							<Tooltip title='Оставлен оффлайн — вытеснение его не тронет' arrow>
								<Pin size={12} strokeWidth={1.5} opacity={0.6} />
							</Tooltip>
						)}

						<Typography variant='caption' sx={{ fontSize: 11, color: 'text.disabled', width: 90, textAlign: 'right' }}>
							{sinceText(f.lastAccess)}
						</Typography>
						<Typography variant='caption' sx={{ fontSize: 11, width: 70, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
							{humanSize(f.sizeBytes)}
						</Typography>

						<Tooltip title='Удалить локальную копию (файл останется в облаке)' arrow>
							<IconButton size='small' sx={{ p: '2px' }} disabled={busyId === f.fileId} onClick={() => void drop(f.fileId)}>
								<Trash2 size={13} strokeWidth={1.5} />
							</IconButton>
						</Tooltip>
					</ListItem>
				))}
			</List>
		</>
	);
}
