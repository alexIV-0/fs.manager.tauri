// Настройки облачного хранилища.
//
// Здесь и только здесь задаётся то, без чего к живому бэкенду не подключиться:
// адрес сайта и machine token. Всё остальное — политика кэша — имеет разумные
// значения по умолчанию, и большинству их трогать не надо.

import {
	Alert,
	Box,
	Button,
	Chip,
	CircularProgress,
	Divider,
	FormControl,
	IconButton,
	InputLabel,
	MenuItem,
	Select,
	Stack,
	TextField,
	Tooltip,
	Typography,
} from '@mui/material';
import { Check, CloudOff, FlaskConical, FolderOpen, Plus, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import type { ConnectionConfig } from '@/bindings';
import { storage_store } from '@/Store/MainWin/storage_store';
import { commands, unwrap } from '@/Utils/specta';

/** Варианты «сколько держать локальную копию». 0 — никогда не удалять. */
const KEEP_OPTIONS = [
	{ v: 2, label: '2 часа' },
	{ v: 4, label: '4 часа' },
	{ v: 8, label: '8 часов' },
	{ v: 24, label: 'сутки' },
	{ v: 48, label: 'двое суток' },
	{ v: 168, label: '7 дней' },
	{ v: 0, label: 'никогда не удалять' },
];

const EMPTY: ConnectionConfig = {
	baseUrl: '',
	token: '',
	mirrorRoot: '',
	keepHours: 4,
	maxMirrorGb: 100,
	hotPatterns: ['options/*.json'],
	// Режимом распоряжается подключение, интерфейс его не задаёт.
	demo: false,
};

export default function TabStorage() {
	const { status, busy, error, connect, connectMock, disconnect, refreshStatus } = storage_store();
	const [cfg, setCfg] = useState<ConnectionConfig>(EMPTY);
	const [saved, setSaved] = useState(false);
	const [mirrorBytes, setMirrorBytes] = useState<number | null>(null);
	const [evicting, setEvicting] = useState(false);

	useEffect(() => {
		void (async () => {
			const r = await commands.storageGetConfig();
			if (r.status === 'ok') setCfg({ ...EMPTY, ...r.data });
			void refreshStatus();
			const mb = await commands.storageMirrorBytes();
			if (mb.status === 'ok') setMirrorBytes(mb.data);
		})();
	}, [refreshStatus]);

	const patch = (p: Partial<ConnectionConfig>) => {
		setCfg((c) => ({ ...c, ...p }));
		setSaved(false);
	};

	const save = async () => {
		const r = await commands.storageSetConfig(cfg);
		if (r.status === 'ok') {
			// Токен возвращается замаскированным — иначе следующее сохранение
			// затёрло бы настоящее значение маской.
			setCfg({ ...EMPTY, ...r.data });
			setSaved(true);
		}
	};

	const pickMirror = async () => {
		const picked = unwrap(await commands.selectFolders({ multiSelect: false }));
		if (Array.isArray(picked) && picked[0]) patch({ mirrorRoot: picked[0] });
	};

	const runEviction = async () => {
		setEvicting(true);
		try {
			const r = await commands.storageRunEviction(null);
			if (r.status === 'ok') {
				const mb = await commands.storageMirrorBytes();
				if (mb.status === 'ok') setMirrorBytes(mb.data);
			}
		} finally {
			setEvicting(false);
		}
	};

	const gb = mirrorBytes === null ? null : (mirrorBytes / 1024 ** 3).toFixed(2);

	return (
		<Box sx={{ p: 2, maxWidth: 720, display: 'flex', flexDirection: 'column', gap: 2 }}>
			{/* ── Состояние ─────────────────────────────────────────────────── */}
			<Stack direction='row' spacing={1} alignItems='center'>
				{status.connected ? (
					<Chip
						size='small'
						icon={status.mock ? <FlaskConical size={13} /> : <Check size={13} />}
						color={status.mock ? 'warning' : 'success'}
						variant='outlined'
						label={status.mock ? 'демо-данные' : 'подключено'}
					/>
				) : (
					<Chip size='small' icon={<CloudOff size={13} />} variant='outlined' label='не подключено' />
				)}
				{status.connected && !status.mock && (
					<Typography variant='caption' sx={{ color: 'text.disabled' }}>
						{status.baseUrl}
					</Typography>
				)}
			</Stack>

			{/* Две разные беды. `lastError` — «подключились, но бэкенд ответил плохо»
			    (клиент поднят, работаем по индексу). `error` — сама команда упала, то
			    есть подключения не случилось совсем. Второе не показывалось нигде, и
			    нажатие на «Демо» выглядело как полное бездействие. */}
			{error && (
				<Alert severity='error' sx={{ py: 0 }}>
					{error}
				</Alert>
			)}
			{status.lastError && (
				<Alert severity='warning' sx={{ py: 0 }}>
					{status.lastError}
				</Alert>
			)}

			{/* Что умеет бэкенд. Показываем честно: недоступные операции гасятся в
			    интерфейсе по этим же флагам, и человек должен понимать почему. */}
			{status.connected && (
				<Stack direction='row' spacing={0.5} flexWrap='wrap' useFlexGap>
					{(
						[
							['переименование', status.caps.rename],
							['копирование', status.caps.copy],
							['multipart', status.caps.multipart],
							['клиенты', status.caps.clients],
							['расшаривание', status.caps.sharing],
						] as const
					).map(([label, on]) => (
						<Chip
							key={label}
							size='small'
							variant='outlined'
							label={label}
							icon={on ? <Check size={11} /> : <X size={11} />}
							sx={{ opacity: on ? 0.9 : 0.4, height: 20, fontSize: 10 }}
						/>
					))}
				</Stack>
			)}

			<Divider />

			{/* ── Подключение ───────────────────────────────────────────────── */}
			<Typography variant='subtitle2'>Подключение</Typography>

			<TextField
				size='small'
				label='Адрес сайта'
				placeholder='https://hub.example.com'
				value={cfg.baseUrl}
				onChange={(e) => patch({ baseUrl: e.target.value })}
				helperText='Путь /api/storage/v1 добавляется автоматически'
			/>

			<TextField
				size='small'
				label='Machine token'
				type='password'
				value={cfg.token}
				onChange={(e) => patch({ token: e.target.value })}
				helperText='Создаётся в личном кабинете. Токен должен быть НЕ привязан к проекту — иначе он не пустит даже администратора'
			/>

			<Stack direction='row' spacing={1}>
				<TextField
					size='small'
					label='Папка зеркала'
					value={cfg.mirrorRoot}
					onChange={(e) => patch({ mirrorRoot: e.target.value })}
					fullWidth
					helperText='Единственная папка, за которой следит клиент. Рабочая папка обработки настраивается отдельно и сюда не относится'
				/>
				<Button onClick={() => void pickMirror()} sx={{ minWidth: 40, height: 40 }}>
					<FolderOpen size={16} strokeWidth={1} />
				</Button>
			</Stack>

			<Stack direction='row' spacing={1} alignItems='center'>
				<Button variant='outlined' size='small' onClick={() => void save()}>
					Сохранить
				</Button>
				<Button
					variant='contained'
					size='small'
					onClick={() => void connect()}
					disabled={busy || !cfg.baseUrl}
					startIcon={busy ? <CircularProgress size={12} /> : undefined}
				>
					Подключить
				</Button>
				<Tooltip title='Локальные демо-данные без бэкенда: дерево, скачивание, заливка' arrow>
					<Button size='small' onClick={() => void connectMock()} disabled={busy}>
						Демо
					</Button>
				</Tooltip>
				{/* Выйти из демо иначе было нельзя: режим запоминается и поднимается при
				    запуске, а живого бэкенда может ещё не быть. */}
				{status.connected && (
					<Tooltip title='Отключить хранилище. Скачанные файлы останутся на диске' arrow>
						<Button size='small' color='inherit' onClick={() => void disconnect()} disabled={busy}>
							Отключить
						</Button>
					</Tooltip>
				)}
				{saved && (
					<Typography variant='caption' sx={{ color: 'success.main' }}>
						сохранено
					</Typography>
				)}
			</Stack>

			<Divider />

			{/* ── Кэш ───────────────────────────────────────────────────────── */}
			<Typography variant='subtitle2'>Локальные копии</Typography>

			<Stack direction='row' spacing={1}>
				<FormControl size='small' sx={{ minWidth: 200 }}>
					<InputLabel>Хранить копию</InputLabel>
					<Select
						label='Хранить копию'
						value={cfg.keepHours ?? 4}
						onChange={(e) => patch({ keepHours: Number(e.target.value) })}
					>
						{KEEP_OPTIONS.map((o) => (
							<MenuItem key={o.v} value={o.v}>
								{o.label}
							</MenuItem>
						))}
					</Select>
				</FormControl>

				<TextField
					size='small'
					type='number'
					label='Предел зеркала, ГБ'
					value={cfg.maxMirrorGb ?? 100}
					onChange={(e) => patch({ maxMirrorGb: Number(e.target.value) })}
					sx={{ width: 180 }}
					helperText='Аварийный клапан поверх времени'
				/>
			</Stack>

			<Alert severity='info' icon={false} sx={{ py: 0.5 }}>
				<Typography variant='caption'>
					Два правила не отключаются настройками: <b>незалитое</b> и <b>запиненное</b> не удаляются никогда.
					Файл, которого ещё нет в облаке, — единственная копия.
				</Typography>
			</Alert>

			<Stack direction='row' spacing={1} alignItems='center'>
				<Typography variant='caption' sx={{ color: 'text.secondary' }}>
					Занято локально: {gb === null ? '—' : `${gb} ГБ`}
				</Typography>
				<Button
					size='small'
					onClick={() => void runEviction()}
					disabled={evicting || !status.connected}
					startIcon={evicting ? <CircularProgress size={11} /> : undefined}
				>
					Освободить сейчас
				</Button>
			</Stack>

			<Divider />

			{/* ── Всегда горячие ────────────────────────────────────────────── */}
			<Typography variant='subtitle2'>Всегда горячие файлы</Typography>
			<Alert severity='info' icon={false} sx={{ py: 0.5 }}>
				<Typography variant='caption' component='div'>
					Эти файлы не удаляются по таймеру и всегда доступны мгновенно. Указывай{' '}
					<b>мелкие файлы, которые читаются часто</b> — настройки и сайдкары. Видео сюда добавлять не нужно:
					они займут диск и не дадут его освободить.
					<br />
					Маски пишутся от корня проекта: <code>options/*.json</code>, <code>IN/*.txt</code>. Маска без
					слэша (<code>*.aep</code>) ловит файл на любой глубине.
				</Typography>
			</Alert>
			<Stack spacing={0.5}>
				{(cfg.hotPatterns ?? []).map((p, i) => (
					<Stack key={i} direction='row' spacing={0.5} alignItems='center'>
						<TextField
							size='small'
							value={p}
							placeholder='options/*.json'
							onChange={(e) => {
								const next = [...(cfg.hotPatterns ?? [])];
								next[i] = e.target.value;
								patch({ hotPatterns: next });
							}}
							sx={{ flex: 1 }}
							slotProps={{ input: { sx: { fontFamily: 'monospace', fontSize: 12 } } }}
						/>
						<IconButton
							size='small'
							onClick={() => patch({ hotPatterns: (cfg.hotPatterns ?? []).filter((_, j) => j !== i) })}
						>
							<Trash2 size={13} strokeWidth={1} />
						</IconButton>
					</Stack>
				))}
				<Button
					size='small'
					startIcon={<Plus size={13} strokeWidth={1} />}
					onClick={() => patch({ hotPatterns: [...(cfg.hotPatterns ?? []), ''] })}
					sx={{ alignSelf: 'flex-start' }}
				>
					маска
				</Button>
				<Typography variant='caption' sx={{ color: 'text.disabled', fontSize: 10 }}>
					Пустой список означает значение по умолчанию — <code>options/*.json</code>. Сайдкары должны
					оставаться горячими: их читает поиск по всем проектам.
				</Typography>
			</Stack>

		</Box>
	);
}
