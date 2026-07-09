// Авто-загрузка зависимостей в Settings → Paths.
//
// Чисто аддитивно к ручному выбору: скачивает ffmpeg/ffprobe и whisper-модели и
// подключает их в ТЕ ЖЕ сторы, что и ручной пикер:
//   • ffmpeg/ffprobe → programPathPattern_store (programPaths.json → resolve_program_path)
//   • папка моделей  → folderPath_store(whisper) (её сканирует #whisperModels и плагин)
// Пользователь в любой момент может переопределить путь вручную.

import { greenColor, greyColor, redColor, cyanColor, yellowColor } from '@/Store/Color/grayColor';
import { folderPath_store, programPathPattern_store } from '@/Store/MainWin/pathPattern_store';
import { commands, unwrap } from '@/Utils/specta';
import { Box, Button, CircularProgress, FormControlLabel, LinearProgress, Switch, TextField, Tooltip, Typography } from '@mui/material';
import { listen } from '@tauri-apps/api/event';
import { CheckCircle2, Download, FolderInput } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { FfmpegInstallResult, FfmpegStatus, WhisperModel } from '@/bindings';

// ── Событие прогресса от Rust (deps_commands.rs emit_progress) ──────────────────
type DepsProgress = {
	id: string; // "ffmpeg" | имя файла модели
	phase: 'download' | 'extract' | 'verify' | 'done' | 'error';
	text: string;
	downloaded: number;
	total: number | null;
	percent: number;
};

/** Привязывает путь к записи стора по имени (ffmpeg/ffprobe/whisper). */
function connectPath(store: typeof programPathPattern_store | typeof folderPath_store, name: string, path: string) {
	const st = store.getState();
	const entry = st.patternStore.find((e) => e.name === name);
	if (entry) st.updatePatternElementPath(entry.id, [path]);
}

// ════════════════════════════════════════════════════════════════════════════════
// ffmpeg / ffprobe
// ════════════════════════════════════════════════════════════════════════════════

export function FfmpegDownloadSection() {
	const [status, setStatus] = useState<FfmpegStatus | null>(null);
	const [busy, setBusy] = useState(false);
	const [progress, setProgress] = useState<DepsProgress | null>(null);
	const [result, setResult] = useState<FfmpegInstallResult | null>(null);

	const refreshStatus = () => commands.depsFfmpegStatus().then((r) => setStatus(unwrap(r))).catch(() => {});

	useEffect(() => {
		refreshStatus();
		const un = listen<DepsProgress>('deps-progress', (e) => {
			if (e.payload.id === 'ffmpeg') setProgress(e.payload);
		});
		return () => {
			un.then((f) => f()).catch(() => {});
		};
	}, []);

	const handleDownload = async () => {
		setBusy(true);
		setResult(null);
		setProgress(null);
		try {
			const res = unwrap(await commands.depsDownloadFfmpeg());
			setResult(res);
			if (res.ok && res.ffmpegPath && res.ffprobePath) {
				connectPath(programPathPattern_store, 'ffmpeg', res.ffmpegPath);
				connectPath(programPathPattern_store, 'ffprobe', res.ffprobePath);
				await refreshStatus();
			}
		} catch (e) {
			setResult({
				ok: false,
				version: null,
				source: null,
				ffmpegPath: null,
				ffprobePath: null,
				missingRequired: [String(e)],
				missingOptional: [],
			});
		} finally {
			setBusy(false);
			setProgress(null);
		}
	};

	const installed = status?.installed;

	return (
		<Box sx={{ px: 1, pb: 1 }}>
			<Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
				<Button
					variant='outlined'
					size='small'
					disabled={busy}
					onClick={handleDownload}
					startIcon={busy ? <CircularProgress size={16} /> : <Download size={16} />}
					sx={{ textTransform: 'none', borderColor: cyanColor(60), color: greyColor(90) }}
				>
					{busy ? 'Скачивание…' : 'Скачать ffmpeg + ffprobe'}
				</Button>

				{installed && (
					<Tooltip title={status?.version ?? ''}>
						<Typography variant='caption' sx={{ color: greenColor(75), display: 'flex', alignItems: 'center', gap: 0.5 }}>
							<CheckCircle2 size={14} /> установлен
						</Typography>
					</Tooltip>
				)}
			</Box>

			{busy && progress && (
				<Box sx={{ mt: 1 }}>
					<Typography variant='caption' sx={{ color: greyColor(70) }}>
						{progress.text}
					</Typography>
					<LinearProgress
						variant={progress.percent > 0 ? 'determinate' : 'indeterminate'}
						value={progress.percent}
						sx={{ mt: 0.5, height: 4, borderRadius: 2 }}
					/>
				</Box>
			)}

			{result && (
				<Box sx={{ mt: 1 }}>
					{result.ok ? (
						<Typography variant='caption' sx={{ color: greenColor(75) }}>
							✅ {result.version} — {result.source}
							{result.missingOptional.length > 0 && (
								<Box component='span' sx={{ color: yellowColor(70), display: 'block' }}>
									⚠️ нет необязательных: {result.missingOptional.join(', ')}
								</Box>
							)}
						</Typography>
					) : (
						<Typography variant='caption' sx={{ color: redColor(75) }}>
							❌ сборка не содержит обязательных возможностей: {result.missingRequired.join(', ')}
						</Typography>
					)}
				</Box>
			)}
		</Box>
	);
}

// ════════════════════════════════════════════════════════════════════════════════
// Whisper-модели
// ════════════════════════════════════════════════════════════════════════════════

// Сколько моделей качать одновременно при «Скачать всё» (ручные клики не лимитируются).
const ALL_CONCURRENCY = 3;

export function WhisperModelsSection() {
	const [models, setModels] = useState<WhisperModel[]>([]);
	const [dir, setDir] = useState<string>('');
	// Параллельные загрузки: состояние пер-файл (ключ — filename).
	const [downloading, setDownloading] = useState<Set<string>>(new Set());
	const [progressByFile, setProgressByFile] = useState<Record<string, DepsProgress>>({});
	const [errorByFile, setErrorByFile] = useState<Record<string, string>>({});

	// Реактивно следим за подключённой папкой whisper.
	const folderEntries = folderPath_store((s) => s.patternStore);
	const whisperEntry = folderEntries.find((e) => e.name === 'whisper');
	const connectedDir = whisperEntry?.path?.[0] ?? '';

	const refreshList = () => commands.depsListWhisperModels().then((r) => setModels(unwrap(r))).catch(() => {});

	useEffect(() => {
		refreshList();
		commands.depsWhisperModelsDir().then((r) => setDir(unwrap(r))).catch(() => {});
		// Один слушатель на все модели: прогресс роутится по payload.id (= filename).
		const un = listen<DepsProgress>('deps-progress', (e) => {
			const p = e.payload;
			if (!p.id.startsWith('ggml-')) return; // ffmpeg-прогресс обрабатывается отдельно
			setProgressByFile((prev) => ({ ...prev, [p.id]: p }));
		});
		return () => {
			un.then((f) => f()).catch(() => {});
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const isConnected = !!dir && connectedDir === dir;

	const handleConnect = () => {
		if (dir) connectPath(folderPath_store, 'whisper', dir);
	};

	const downloadOne = async (m: WhisperModel) => {
		if (m.downloaded || downloading.has(m.filename)) return;
		setDownloading((s) => new Set(s).add(m.filename));
		setErrorByFile((e) => {
			const n = { ...e };
			delete n[m.filename];
			return n;
		});
		try {
			// unwrap ОБЯЗАТЕЛЕН: команды specta при ошибке Rust не бросают, а возвращают
			// { status:"error" } — без unwrap ошибка проглатывалась и модель «молча» не качалась.
			unwrap(await commands.depsDownloadWhisperModel(m.filename));
			// Папку подключаем только при УСПЕШНОМ скачивании (первой же модели достаточно).
			if (dir && folderPath_store.getState().patternStore.find((e) => e.name === 'whisper')?.path?.[0] !== dir) {
				connectPath(folderPath_store, 'whisper', dir);
			}
			await refreshList();
		} catch (e) {
			setErrorByFile((er) => ({ ...er, [m.filename]: e instanceof Error ? e.message : String(e) }));
		} finally {
			setDownloading((s) => {
				const n = new Set(s);
				n.delete(m.filename);
				return n;
			});
			setProgressByFile((p) => {
				const n = { ...p };
				delete n[m.filename];
				return n;
			});
		}
	};

	// «Скачать всё недостающее» — пул из ALL_CONCURRENCY воркеров, чтобы не открывать
	// десяток многогигабайтных стримов разом.
	const handleDownloadAll = async () => {
		const queue = models.filter((m) => !m.downloaded && !downloading.has(m.filename));
		const workers = Array.from({ length: Math.min(ALL_CONCURRENCY, queue.length) }, async () => {
			let next: WhisperModel | undefined;
			while ((next = queue.shift())) await downloadOne(next);
		});
		await Promise.all(workers);
	};

	const pendingCount = models.filter((m) => !m.downloaded).length;

	return (
		<Box sx={{ px: 1, pb: 1 }}>
			<Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1, flexWrap: 'wrap' }}>
				<Typography variant='caption' sx={{ color: greyColor(60) }}>
					Папка моделей: {dir || '…'}
				</Typography>
				{dir && !isConnected && (
					<Button
						size='small'
						variant='text'
						onClick={handleConnect}
						startIcon={<FolderInput size={14} />}
						sx={{ textTransform: 'none', color: cyanColor(70), py: 0 }}
					>
						подключить
					</Button>
				)}
				{isConnected && (
					<Typography variant='caption' sx={{ color: greenColor(75), display: 'flex', alignItems: 'center', gap: 0.5 }}>
						<CheckCircle2 size={13} /> подключена
					</Typography>
				)}
				<Box sx={{ flex: 1 }} />
				{pendingCount > 0 && (
					<Button
						size='small'
						variant='outlined'
						onClick={handleDownloadAll}
						startIcon={<Download size={14} />}
						sx={{ textTransform: 'none', borderColor: cyanColor(60), color: greyColor(90), py: 0 }}
					>
						Скачать всё ({pendingCount})
					</Button>
				)}
			</Box>

			<Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
				{models.map((m) => {
					const isActive = downloading.has(m.filename);
					const prog = progressByFile[m.filename];
					const err = errorByFile[m.filename];
					return (
						<Box
							key={m.filename}
							sx={{
								py: 0.5,
								px: 1,
								borderRadius: 1,
								bgcolor: greyColor(12),
							}}
						>
							<Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
								<Typography variant='body2' sx={{ flex: 1, color: greyColor(90) }}>
									{m.name}
									{m.recommended && (
										<Box component='span' sx={{ ml: 1, fontSize: 11, color: cyanColor(70) }}>
											рекоменд.
										</Box>
									)}
								</Typography>
								<Typography variant='caption' sx={{ color: greyColor(55), minWidth: 64, textAlign: 'right' }}>
									{m.sizeLabel}
								</Typography>

								{m.downloaded ? (
									<Tooltip title='скачано'>
										<CheckCircle2 size={18} color={greenColor(70)} />
									</Tooltip>
								) : (
									<Button
										size='small'
										variant='text'
										disabled={isActive}
										onClick={() => downloadOne(m)}
										sx={{ minWidth: 0, p: 0.5 }}
									>
										{isActive ? <CircularProgress size={16} /> : <Download size={16} color={greyColor(80)} />}
									</Button>
								)}
							</Box>

							{isActive && (
								<Box sx={{ mt: 0.5 }}>
									<LinearProgress
										variant={prog && prog.percent > 0 ? 'determinate' : 'indeterminate'}
										value={prog?.percent ?? 0}
										sx={{ height: 3, borderRadius: 2 }}
									/>
									{prog?.text && (
										<Typography variant='caption' sx={{ color: greyColor(60), fontSize: 10 }}>
											{prog.text}
										</Typography>
									)}
								</Box>
							)}

							{err && (
								<Typography variant='caption' sx={{ display: 'block', color: redColor(75), wordBreak: 'break-all', fontSize: 10 }}>
									❌ {err}
								</Typography>
							)}
						</Box>
					);
				})}
			</Box>
		</Box>
	);
}

// ════════════════════════════════════════════════════════════════════════════════
// Локальный telegram-bot-api server (большие файлы Telegram >20МБ)
// ════════════════════════════════════════════════════════════════════════════════

type TgServerCfg = {
	enabled: boolean;
	binPath: string;
	apiId: string;
	apiHash: string;
	port: number;
};

const TG_DEFAULT: TgServerCfg = { enabled: false, binPath: '', apiId: '', apiHash: '', port: 8081 };

export function TgServerSection() {
	const [cfg, setCfg] = useState<TgServerCfg>(TG_DEFAULT);
	const [busy, setBusy] = useState(false);
	const [progress, setProgress] = useState<DepsProgress | null>(null);
	const [msg, setMsg] = useState<string>('');

	useEffect(() => {
		commands
			.appSettingsGet()
			.then((r) => {
				const t = ((unwrap(r) as any)?.tgServer ?? {}) as Partial<TgServerCfg>;
				setCfg({ ...TG_DEFAULT, ...t });
			})
			.catch(() => {});
		const un = listen<DepsProgress>('deps-progress', (e) => {
			if (e.payload.id === 'tgserver') setProgress(e.payload);
		});
		return () => {
			un.then((f) => f()).catch(() => {});
		};
	}, []);

	// Сохраняем секцию tgServer целиком (patch мержит по верхнему ключу).
	const save = (patch: Partial<TgServerCfg>) => {
		setCfg((prev) => {
			const next = { ...prev, ...patch };
			commands.appSettingsPatch({ tgServer: next } as any).catch(() => {});
			return next;
		});
	};

	const handleDownload = async () => {
		setBusy(true);
		setMsg('');
		setProgress(null);
		try {
			const path = unwrap(await commands.depsDownloadTgServer());
			save({ binPath: path });
			setMsg('✅ скачано: ' + path);
		} catch (e) {
			setMsg('❌ ' + String(e));
		} finally {
			setBusy(false);
			setProgress(null);
		}
	};

	const field = (label: string, key: keyof TgServerCfg, placeholder = '', width = 180) => (
		<TextField
			label={label}
			value={String((cfg as any)[key] ?? '')}
			placeholder={placeholder}
			size='small'
			onChange={(e) => save({ [key]: key === 'port' ? Number(e.target.value) || 0 : e.target.value } as any)}
			sx={{ width, '& .MuiInputBase-input': { fontSize: 12 }, '& label': { fontSize: 12 } }}
		/>
	);

	return (
		<Box sx={{ px: 1, pb: 1 }}>
			<Typography variant='caption' sx={{ color: greyColor(60), display: 'block', mb: 1 }}>
				Локальный Bot API server — снимает лимит Telegram 20/50 МБ → до 2 ГБ. Нужен бинарь (скачать ниже или
				указать путь), <code>api_id</code>/<code>api_hash</code> с my.telegram.org и форум-группы с ботом-админом.
			</Typography>

			<FormControlLabel
				control={<Switch size='small' checked={cfg.enabled} onChange={(e) => save({ enabled: e.target.checked })} />}
				label={<Typography variant='caption' sx={{ color: greyColor(85) }}>Включить (стартовать при обработке)</Typography>}
				sx={{ mb: 0.5 }}
			/>

			<Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 1 }}>
				{field('api_id', 'apiId', '1234567', 130)}
				{field('api_hash', 'apiHash', 'a1b2c3…', 240)}
				{field('Порт', 'port', '8081', 90)}
			</Box>

			<Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center', mb: 1 }}>
				<Button
					variant='outlined'
					size='small'
					disabled={busy}
					onClick={handleDownload}
					startIcon={busy ? <CircularProgress size={16} /> : <Download size={16} />}
					sx={{ textTransform: 'none', borderColor: cyanColor(60), color: greyColor(90) }}
				>
					{busy ? 'Скачивание…' : 'Скачать бинарь (под мою ОС)'}
				</Button>
				<Typography variant='caption' sx={{ color: greyColor(55) }}>
					из релиза tg-bot-api-builds
				</Typography>
			</Box>

			<Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center', mb: 0.5 }}>
				{field('Путь к telegram-bot-api', 'binPath', '/…/telegram-bot-api', 420)}
				<Button
					variant='text'
					size='small'
					startIcon={<FolderInput size={14} />}
					onClick={async () => {
						try {
							const picked = unwrap(await commands.selectFiles({ multiSelect: false } as any));
							if (Array.isArray(picked) && picked[0]) save({ binPath: picked[0] });
						} catch {
							/* отмена выбора — ок */
						}
					}}
					sx={{ textTransform: 'none', color: cyanColor(70) }}
				>
					Указать файл
				</Button>
				{cfg.binPath && (
					<Typography variant='caption' sx={{ color: greenColor(75), display: 'flex', alignItems: 'center', gap: 0.5 }}>
						<CheckCircle2 size={14} /> путь задан
					</Typography>
				)}
			</Box>

			{busy && progress && (
				<Box sx={{ mt: 1 }}>
					<Typography variant='caption' sx={{ color: greyColor(70) }}>{progress.text}</Typography>
					<LinearProgress
						variant={progress.percent > 0 ? 'determinate' : 'indeterminate'}
						value={progress.percent}
						sx={{ mt: 0.5, height: 4, borderRadius: 2 }}
					/>
				</Box>
			)}

			{msg && (
				<Typography
					variant='caption'
					sx={{ display: 'block', mt: 0.5, color: msg.startsWith('✅') ? greenColor(75) : redColor(75), wordBreak: 'break-all' }}
				>
					{msg}
				</Typography>
			)}
		</Box>
	);
}
