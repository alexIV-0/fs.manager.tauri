// Helper для плагинов в Tauri WebView.
// Оборачивает window.tauriAPI.invoke в типизированные асинхронные API.
//
// Использование в плагине:
//   import { fs, ffmpeg, exec, ae, paths } from '../_template/tauri';
//   const info = await ffmpeg.probe(filePath);
//   if (!(await fs.exists(dest))) await fs.copy(src, dest);
//
// При сборке (build-plugin.js) этот файл встраивается в бандл плагина (bundle: true),
// никаких внешних зависимостей не появляется.

// ─── Низкоуровневый invoke ───────────────────────────────────────────────────

type InvokeFn = (cmd: string, ...args: any[]) => Promise<any>;
const api = (): { invoke: InvokeFn } => (window as any).tauriAPI;

// ─── fs: файловые операции через Tauri IPC ───────────────────────────────────

export interface Stat {
	size: number;
	mtimeMs: number;
	atimeMs: number;
	ctimeMs: number;
	birthtimeMs: number;
	isFile: boolean;
	isDir: boolean;
	isSymlink: boolean;
}

export interface FileInfo {
	path: string;
	name: string;
	size: number;
	isDir: boolean;
	isFile: boolean;
	modified?: number;
	created?: number;
	extension: string;
}

export interface CopyMoveOptions {
	overwrite?: boolean;
	useHashCheck?: boolean;
}

export interface SearchPattern {
	type: 'files' | 'folders';
	ext: string[];
}

export const fs = {
	/** true если путь существует (файл или папка). Не бросает и не шумит в логи —
	 * использует Rust-команду path_exists, которая возвращает bool. */
	exists(p: string): Promise<boolean> {
		return api().invoke('path_exists', { path: p });
	},

	/** Проверка что путь существует И это файл. */
	async existsFile(p: string): Promise<boolean> {
		if (!(await api().invoke('path_exists', { path: p }))) return false;
		try {
			const s = await api().invoke('get_stat', { path: p });
			return Boolean(s?.isFile);
		} catch {
			return false;
		}
	},

	/** Проверка что путь существует И это папка. */
	async existsFolder(p: string): Promise<boolean> {
		if (!(await api().invoke('path_exists', { path: p }))) return false;
		try {
			const s = await api().invoke('get_stat', { path: p });
			return Boolean(s?.isDir);
		} catch {
			return false;
		}
	},

	read(p: string): Promise<string> {
		return api().invoke('read_file_sync', { filePath: p });
	},

	write(p: string, content: string): Promise<any> {
		return api().invoke('write_file', { filePath: p, content });
	},

	copy(src: string, dst: string, opts: CopyMoveOptions = { overwrite: true }): Promise<void> {
		return api().invoke('copy_item', { sourcePath: src, destinationPath: dst, options: opts });
	},

	move(src: string, dst: string, opts: CopyMoveOptions = { overwrite: true }): Promise<void> {
		return api().invoke('move_item', { sourcePath: src, destinationPath: dst, options: opts });
	},

	/** Удаляет файл или папку (рекурсивно). Возвращает true если что-то было удалено. */
	remove(p: string): Promise<boolean> {
		return api().invoke('delete_item', { itemPath: p });
	},

	/** Создаёт папку (рекурсивно). Если уже есть — ничего не делает. */
	mkdir(p: string): Promise<void> {
		return api().invoke('test_and_create_folder', { path: p });
	},

	stat(p: string): Promise<Stat> {
		return api().invoke('get_stat', { path: p });
	},

	info(p: string): Promise<FileInfo> {
		return api().invoke('get_file_info', { path: p });
	},

	/** Возвращает true если source.mtime > dest.mtime. Используется для overwriteOldest. */
	async isSourceNewer(src: string, dst: string): Promise<boolean> {
		try {
			const [s, d] = await Promise.all([fs.stat(src), fs.stat(dst)]);
			return s.mtimeMs > d.mtimeMs;
		} catch {
			return true; // если что-то пошло не так — считаем что нужно копировать
		}
	},

	/** Возвращает { files: string[], folders: string[] } — имена в папке.
	 * Rust-команда поддерживает только ключи 'files' и 'folders'; кастомные типы
	 * (video, image...) фильтруйте сами по ext через fs.filesByExt. */
	someFromFolder(folder: string, search?: SearchPattern[]): Promise<{ files: string[]; folders: string[] }> {
		return api().invoke('get_some_from_folder', { path: folder, search: search ?? null });
	},

	/** Рекурсивный поиск по фильтру. Аналогичные ограничения по ключам. */
	recursiveFind(folder: string, search?: SearchPattern[]): Promise<{ files: string[]; folders: string[] }> {
		return api().invoke('recursive_find_files', { path: folder, search: search ?? null });
	},

	/** Возвращает имена файлов в папке, отфильтрованные по расширениям.
	 * Если exts пустой массив — без фильтрации. */
	async filesByExt(folder: string, exts: string[], recursive = false): Promise<string[]> {
		const search: SearchPattern[] = [{ type: 'files', ext: [] }];
		const result = recursive ? await fs.recursiveFind(folder, search) : await fs.someFromFolder(folder, search);
		const files = result.files ?? [];
		if (!exts || exts.length === 0) return files;
		const set = new Set(exts.map((e) => e.toLowerCase().replace(/^\./, '')));
		return files.filter((name) => {
			const dot = name.lastIndexOf('.');
			const ext = dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
			return set.has(ext);
		});
	},

	/** Возвращает имена подпапок. */
	async folders(folder: string, recursive = false): Promise<string[]> {
		const search: SearchPattern[] = [{ type: 'folders', ext: [] }];
		const result = recursive ? await fs.recursiveFind(folder, search) : await fs.someFromFolder(folder, search);
		return result.folders ?? [];
	},

	hash(p: string, algo: 'sha256' | 'sha1' | 'md5' = 'sha256'): Promise<string> {
		return api().invoke('hash_file', { path: p, algo });
	},

	/** Превращает локальный путь в URL для нативного fetch (asset://...).
	 * Используется в http-плагинах для FormData.append('file', blob).
	 * convertFileSrc — это синхронная утилита из @tauri-apps/api/core, но мы
	 * импортируем её через global, чтобы не тянуть npm-зависимость в плагины. */
	toFetchUrl(p: string): string {
		const win = window as any;
		// В Tauri runtime есть глобальный helper convertFileSrc; в renderer проекта
		// уже используется через '@tauri-apps/api/core', и Vite-bundle делает
		// его доступным как window.__TAURI__.core.convertFileSrc (через preload).
		const conv = win.__TAURI__?.core?.convertFileSrc || win.__TAURI_INTERNALS__?.convertFileSrc;
		if (typeof conv === 'function') return conv(p);
		// Fallback: asset:// URL руками (rule-of-thumb из tauri-runtime).
		return `asset://localhost/${encodeURIComponent(p)}`;
	},

	/** Пишет ArrayBuffer / Uint8Array в файл через Rust (base64 IPC). */
	async writeBytes(p: string, bytes: ArrayBuffer | Uint8Array): Promise<number> {
		const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
		// Эффективное btoa: разбиваем на куски, иначе на больших файлах падает
		// stack-limit. 32k символов на chunk — безопасно.
		let binary = '';
		const chunk = 0x8000;
		for (let i = 0; i < u8.length; i += chunk) {
			binary += String.fromCharCode.apply(null, Array.from(u8.subarray(i, i + chunk)));
		}
		const b64 = btoa(binary);
		const written = (await api().invoke('write_binary_file', { filePath: p, dataB64: b64 })) as number;
		return written;
	},
};

// ─── HTTP utilities (для AI-плагинов) ────────────────────────────────────────
// Все запросы выполняются в Rust через reqwest → нет CORS-ограничений WebView.

export interface HttpResponse {
	status: number;
	ok: boolean;
	body: string;
}

export interface UploadFile {
	field: string;
	path: string;
	mime?: string;
	filename?: string;
}

export interface UploadField {
	field: string;
	value: string;
}

export const http = {
	/** GET/POST/... запрос с опциональным строковым телом.
	 * Возвращает { status, ok, body }. Не бросает при 4xx/5xx. */
	fetch(
		url: string,
		opts: { method?: string; headers?: [string, string][]; body?: string } = {},
	): Promise<HttpResponse> {
		return api().invoke('http_fetch', {
			url,
			method: opts.method,
			headers: opts.headers,
			body: opts.body,
		});
	},

	/** Multipart/form-data upload с локальными файлами (читаются в Rust).
	 * files: [{ field, path, mime?, filename? }], fields: [{ field, value }]. */
	upload(
		url: string,
		opts: { files?: UploadFile[]; fields?: UploadField[]; headers?: [string, string][] } = {},
	): Promise<HttpResponse> {
		return api().invoke('http_upload', {
			url,
			files: opts.files,
			fields: opts.fields,
			headers: opts.headers,
		});
	},

	/** Скачивает URL в локальный файл. Возвращает количество байт.
	 *  Передай `nodeId` и/или `statusText`, чтобы прогресс скачивания отображался
	 *  в статусбаре/ноде (тот же формат, что у ffmpeg-прогресса). Без них —
	 *  тихое скачивание, как раньше. */
	download(
		url: string,
		dest: string,
		opts: { headers?: [string, string][]; nodeId?: string; statusText?: string } = {},
	): Promise<number> {
		return api().invoke('http_download', {
			url,
			dest,
			headers: opts.headers,
			nodeId: opts.nodeId,
			statusText: opts.statusText,
		});
	},
};

// ─── ffmpeg / ffprobe ────────────────────────────────────────────────────────

export interface FfprobeStream {
	codec_type: 'video' | 'audio' | 'subtitle' | string;
	codec_name?: string;
	profile?: string;
	level?: number;
	pix_fmt?: string;
	width?: number;
	height?: number;
	r_frame_rate?: string;
	avg_frame_rate?: string;
	time_base?: string;
	duration?: string;
	duration_ts?: number;
	sample_aspect_ratio?: string;
	display_aspect_ratio?: string;
	color_range?: string;
	color_space?: string;
	color_primaries?: string;
	color_transfer?: string;
	sample_rate?: string;
	channels?: number;
	channel_layout?: string;
	bit_rate?: string;
	[k: string]: any;
}

export interface FfmpegExecOptions {
	durationSec?: number;
	nodeId?: string;
	statusText?: string;
}

export interface FfmpegExecResult {
	exit_code: number;
	stdout: string;
	stderr: string;
	killed: boolean;
}

/** Полный info-объект о медиафайле — совместим со старым getFullInfoFromVideoFile. */
export interface VideoFileInfo {
	durationInSeconds: number;
	durationInTimcode: string;
	fps: number;
	avg_frame_rate?: string;
	r_frame_rate?: string;
	time_base?: string;
	width: number;
	height: number;
	codec_name: string;
	profile?: string;
	level?: number;
	pix_fmt?: string;
	color_range?: string;
	color_space?: string;
	color_primaries?: string;
	color_transfer?: string;
	sar?: string;
	dar?: string;
	hasAudio: boolean;
	hasVideo: boolean;
	audioCodec?: string;
	audioSampleRate?: number;
	audioChannels?: number;
	audioChannelLayout?: string;
	audioBitrate?: number;
}

function secondsToTimecode(seconds: number, fps?: number): string {
	const hours = Math.floor(seconds / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	const secs = Math.floor(seconds % 60);
	const fr = fps !== undefined ? Math.round((seconds % 1) * fps) : Math.round((seconds % 1) * 1000);
	const tc = [hours, minutes, secs].map((v) => String(v).padStart(2, '0')).join(':');
	return fps === undefined ? `${tc},${String(fr).padStart(3, '0')}` : `${tc}:${String(fr).padStart(2, '0')}`;
}

export const ffmpeg = {
	/** Запускает ffprobe и возвращает массив streams. */
	async probe(filePath: string): Promise<FfprobeStream[]> {
		const jsonStr = (await api().invoke('ffprobe_get_info', filePath)) as string;
		return JSON.parse(jsonStr).streams ?? [];
	},

	/** Удобные хелперы — извлекают video/audio stream из probe-результата. */
	pickVideo(streams: FfprobeStream[]): FfprobeStream | undefined {
		return streams.find((s) => s.codec_type === 'video');
	},

	pickAudio(streams: FfprobeStream[]): FfprobeStream | undefined {
		return streams.find((s) => s.codec_type === 'audio');
	},

	/** Высокоуровневая инфа о медиафайле — совместимо со старым getFullInfoFromVideoFile. */
	async getInfo(filePath: string): Promise<VideoFileInfo> {
		const streams = await ffmpeg.probe(filePath);
		const video = ffmpeg.pickVideo(streams);
		const audio = ffmpeg.pickAudio(streams);
		if (!video && !audio) throw new Error(`No video/audio streams found in file: ${filePath}`);

		const parseFps = (str?: string): number => {
			if (!str || str === '0/0') return 0;
			const [n, d] = str.split('/').map(Number);
			return d ? n / d : 0;
		};

		let fps = parseFps(video?.avg_frame_rate);
		if (fps === 0) fps = parseFps(video?.r_frame_rate);
		fps = Number(fps.toFixed(3));

		let durationSec = Number(video?.duration);
		if (!durationSec || durationSec === 0) {
			const ts = Number(video?.duration_ts);
			const tbStr = video?.time_base;
			if (ts && tbStr) {
				const [num, den] = tbStr.split('/').map(Number);
				durationSec = ts * (num / den);
			}
		}
		if (!durationSec && audio?.duration) durationSec = Number(audio.duration);

		return {
			durationInSeconds: durationSec || 0,
			durationInTimcode: secondsToTimecode(durationSec || 0, fps || 25),
			fps,
			avg_frame_rate: video?.avg_frame_rate,
			r_frame_rate: video?.r_frame_rate,
			time_base: video?.time_base,
			width: video?.width || 0,
			height: video?.height || 0,
			codec_name: video?.codec_name || '',
			profile: video?.profile,
			level: video?.level,
			pix_fmt: video?.pix_fmt,
			color_range: video?.color_range,
			color_space: video?.color_space,
			color_primaries: video?.color_primaries,
			color_transfer: video?.color_transfer,
			sar: video?.sample_aspect_ratio,
			dar: video?.display_aspect_ratio,
			hasAudio: !!audio,
			hasVideo: !!video,
			audioCodec: audio?.codec_name,
			audioSampleRate: audio?.sample_rate ? Number(audio.sample_rate) : undefined,
			audioChannels: audio?.channels,
			audioChannelLayout: audio?.channel_layout,
			audioBitrate: audio?.bit_rate ? Number(audio.bit_rate) : undefined,
		};
	},

	/** Запускает ffmpeg с переданными аргументами. Прогресс эмитится в окно logWindow. */
	exec(args: string[], opts: FfmpegExecOptions = {}): Promise<FfmpegExecResult> {
		return api().invoke('ffmpeg_exec_with_progress', {
			args,
			durationSec: opts.durationSec,
			nodeId: opts.nodeId,
			statusText: opts.statusText,
		});
	},

	/** Удобный обёртчик для legacy-формы { command: string[], duration?, text?, nodeId? }.
	 *  Эквивалент Electron spawnFFmpegCommand. Бросает при ненулевом exit_code. */
	async run(
		command: { command: string[]; duration?: number; text?: string; nodeId?: string },
	): Promise<FfmpegExecResult> {
		const result = await ffmpeg.exec(command.command, {
			durationSec: command.duration,
			nodeId: command.nodeId,
			statusText: command.text,
		});
		if (result.exit_code !== 0) {
			const tail = result.stderr.split('\n').filter((l) => l.trim()).slice(-10).join('\n');
			throw new Error(`ffmpeg exited with code ${result.exit_code}\n${tail}`);
		}
		return result;
	},

	/** Снимает кадр из видеофайла и возвращает base64 data URL (image/png). */
	thumbnail(filePath: string, timestampSec?: number): Promise<string> {
		return api().invoke('ffmpeg_get_video_thumbnail', filePath, timestampSec);
	},

	/** Путь к бинарнику ffmpeg (из настроек или системный поиск). */
	getFfmpegPath(): Promise<string> {
		return api().invoke('ffmpeg_get_path');
	},

	getFfprobePath(): Promise<string> {
		return api().invoke('ffprobe_get_path');
	},

	/** Детект границ сцен (адаптивный, в духе PySceneDetect AdaptiveDetector).
	 *  `select='gte(scene,0)'` печатает scene-score КАЖДОГО кадра — нужно, чтобы
	 *  считать локальное среднее по соседям. Возвращает массив таймштампов. */
	async detectScenes(filePath: string): Promise<number[]> {
		const result = await ffmpeg.exec(
			['-v', 'info', '-vsync', '0', '-i', filePath, '-vf', "select='gte(scene,0)',metadata=print:file=-:key=lavfi.scene_score", '-f', 'null', '-'],
			{ statusText: `[detectScenes] ${filePath}` },
		);
		// metadata=print:file=- пишет в stdout (в нашем Rust-spawn'е stdout захватывается).
		return parseSceneTimestamps(result.stdout);
	},

	/** Детект чёрных кадров через blackframe-фильтр. Возвращает массив таймштампов. */
	async detectBlackFrames(filePath: string, amount = 98): Promise<number[]> {
		const result = await ffmpeg.exec(
			['-i', filePath, '-vf', `blackframe=amount=${amount}`, '-an', '-f', 'null', '-'],
			{ statusText: `[detectBlackFrames] ${filePath}` },
		);
		const matches = [...result.stderr.matchAll(/t:([\d.]+)/g)];
		const timestamps = [...new Set(matches.map((m) => parseFloat(m[1])))];
		timestamps.unshift(0);
		return timestamps;
	},
};

// ── Internal: scene-cut parser (adaptive, PySceneDetect-style) ───────────────
//
// Почему адаптивно, а не фиксированным порогом / Otsu:
//   • Hard cut    — оценка резко высокая на ОДНОМ кадре, соседи низкие → всплеск.
//   • Панорама/   — оценка высокая на СЕРИИ кадров подряд → локальное среднее
//     motion blur   тоже высокое → отношение score/среднее ≈ 1 → НЕ склейка.
//   • Запись      — оценки равномерно-шумные → ничего не торчит над фоном +
//     экрана        отсекается абсолютным полом → склеек нет (а не 733).
// Otsu делил любое распределение надвое даже без реальных склеек — отсюда баг.

// Окно соседних кадров для скользящего среднего (с каждой стороны).
const SCENE_WINDOW = 3;
// Во сколько раз оценка должна превышать локальное среднее, чтобы считаться склейкой.
const SCENE_RATIO = 3.0;
// Абсолютный пол: ниже — это шум (движение мыши, артефакты сжатия), не склейка.
const SCENE_MIN_SCORE = 0.3;
// Минимальный интервал между склейками (сек) — не даём рассыпать видео покадрово.
const SCENE_MIN_GAP = 0.4;

function parseSceneTimestamps(stdout: string): number[] {
	type Frame = { time: number; score: number };
	const lines = stdout.split(/\r?\n/);
	const frames: Frame[] = [];
	for (let i = 0; i < lines.length - 1; i++) {
		const tm = lines[i].match(/pts_time:([\d.]+)/);
		if (!tm) continue;
		const sm = lines[i + 1]?.match(/lavfi\.scene_score=([\d.]+)/);
		if (!sm) continue;
		frames.push({ time: parseFloat(tm[1]), score: parseFloat(sm[1]) });
	}
	if (frames.length === 0) return [0];

	const cuts: number[] = [];
	let lastCut = -Infinity;

	for (let i = 0; i < frames.length; i++) {
		const cur = frames[i];
		if (cur.score < SCENE_MIN_SCORE) continue; // абсолютный пол — отсекаем шум

		// Скользящее среднее по соседям + проверка, что кадр — локальный пик.
		let sum = 0, n = 0, isPeak = true;
		for (let j = i - SCENE_WINDOW; j <= i + SCENE_WINDOW; j++) {
			if (j < 0 || j >= frames.length || j === i) continue;
			sum += frames[j].score;
			n++;
			if (frames[j].score > cur.score) isPeak = false;
		}
		const avg = n > 0 ? sum / n : 0;

		// Склейка = резкий всплеск над локальным фоном И локальный максимум.
		if (isPeak && cur.score >= SCENE_RATIO * avg && cur.time - lastCut >= SCENE_MIN_GAP) {
			cuts.push(cur.time);
			lastCut = cur.time;
		}
	}

	cuts.unshift(0);
	return [...new Set(cuts)].sort((a, b) => a - b);
}

// ─── exec: произвольная внешняя команда ──────────────────────────────────────

export interface ExecOptions {
	cwd?: string;
	env?: Record<string, string>;
	/** ID ноды — если передан, Rust будет стримить stdout/stderr процесса в лог-окно
	 *  как processing-event'ы (видно прогресс в реальном времени). */
	nodeId?: string;
}

export interface ExecResult {
	stdout: string;
	stderr: string;
	exit_code: number;
	killed: boolean;
}

export function exec(cmd: string, args: string[] = [], opts: ExecOptions = {}): Promise<ExecResult> {
	return api().invoke('exec_command', {
		cmd,
		args,
		cwd: opts.cwd,
		env: opts.env ? Object.entries(opts.env) : undefined,
		nodeId: opts.nodeId,
	});
}

// ─── After Effects ───────────────────────────────────────────────────────────

export interface AEResult {
	success: boolean;
	data?: any;
	error?: string;
	/** Путь к сохранённому временному скрипту (с подставленными параметрами). */
	temp_script_path?: string;
}

export interface RunScriptInAEArgs {
	aePath: string;
	scriptPath: string;
	inObj: Record<string, any>;
	tempDir?: string;
	keepTempFiles?: boolean;
	timeoutSec?: number;
}

export const ae = {
	/** Запускает AE и выполняет JSX-скрипт. Rust подставляет inObj в `var inObj = {}`
	 * и оборачивает первый вызов `funcName(inObj)` обвязкой для записи результата
	 * в JSON. Возвращает { success, data?, error? }. */
	runScript(args: RunScriptInAEArgs): Promise<AEResult> {
		// Tauri-команда `run_script_in_ae(args: RunScriptInAEArgs)` ожидает payload
		// с полем `args` (snake_case ключи внутри).
		return api().invoke('run_script_in_ae', {
			args: {
				ae_path: args.aePath,
				script_path: args.scriptPath,
				in_obj: args.inObj,
				temp_dir: args.tempDir,
				keep_temp_files: args.keepTempFiles,
				timeout_sec: args.timeoutSec,
			},
		});
	},

	/** Просто запускает AE с .jsx-файлом без ожидания результата. */
	launchWithScript(aePath: string, scriptPath: string): Promise<void> {
		return api().invoke('launch_ae_with_script', aePath, scriptPath);
	},
};

// ─── Paths / formatNameByPattern (Rust-side, для $YYYY $DD и т.п. ── но JS аналог
// в плагинах часто гораздо умнее, потому что знает description.localFolder/projectName).

export const paths = {
	/** Папка пользовательских настроек приложения. */
	optionsFolder(): Promise<string> {
		return api().invoke('get_user_data_path');
	},

	join(segments: string[]): Promise<string> {
		return api().invoke('path_join', segments);
	},

	/** Системная temp-папка (через Rust os_tmpdir). */
	tmpdir(): Promise<string> {
		return api().invoke('os_tmpdir');
	},

	/** Корневая папка plugins-dev (ИСХОДНИКИ плагинов, только dev!). В проде её НЕТ —
	 *  для доступа к ресурсам самого плагина используй pluginInstallPath(). */
	pluginsDev(): Promise<string> {
		return api().invoke('get_plugins_dev_path');
	},

	/** Установочная папка конкретного плагина (где лежат его ассеты: бинарники, модели).
	 *  Работает и в dev (distr-plugins/<id>@<ver>), и в prod (app_data/plugins/<id>@<ver>) —
	 *  в отличие от pluginsDev(). id/version бери из 3-го аргумента плагина (pluginCtx). */
	async pluginInstallPath(pluginId: string, version?: string): Promise<string | null> {
		// ВАЖНО: позиционные аргументы — у plugin_manager_get_plugin есть argMapper
		// (pluginId, version?), который ждёт их по порядку, а не единым объектом.
		const info: any = await api().invoke('plugin_manager_get_plugin', pluginId, version);
		return info?.path ?? null;
	},

	/** Сегмент платформы для путей к нативным бинарникам:
	 *  `mac-arm64` | `mac-x64` | `win-x64` | `win-arm64` | `linux-x64` | `linux-arm64`. */
	platformTarget(): Promise<string> {
		return api().invoke('get_platform_target');
	},
};

// ─── Системная инфа ──────────────────────────────────────────────────────────

export const system = {
	/** Реальное количество логических ядер CPU. В отличие от
	 *  `navigator.hardwareConcurrency` (Safari clamp'ит до 8) — даёт честное число. */
	cpuCount(): Promise<number> {
		return api().invoke('get_cpu_count');
	},
};

// ─── Шрифты (системный список через Rust fontsGetList) ───────────────────────

export interface SystemFont {
	name: string;
	path: string;
	loadable: boolean;
}

export const fonts = {
	list(): Promise<SystemFont[]> {
		return api().invoke('fonts_get_list');
	},

	/** Поиск шрифта по нормализованному имени (без -/_/пробелов, case-insensitive).
	 * Возвращает первый match или null. */
	async find(fontName: string): Promise<SystemFont | null> {
		const normalize = (s: string) => s.toLowerCase().replace(/[-_ ]/g, '');
		const target = normalize(fontName);
		const all = await fonts.list();
		return all.find((f) => normalize(f.name) === target) ?? null;
	},
};

// ─── Logging / statusbar (через processItem-овский ctx.send) ──────────────────
// Эти эмиты — fallback, если плагин не получил ctx; обычно лучше использовать
// `ctx.send('log', ...)` который ему передаёт processItem. Но в legacy-плагинах
// часто sendToMW вызывается напрямую — этот path и обслуживается ниже.

export const log = {
	info(text: string): Promise<void> {
		return api().invoke('send_log', { level: 'info', text });
	},
	warn(text: string): Promise<void> {
		return api().invoke('send_log', { level: 'warn', text });
	},
	error(text: string): Promise<void> {
		return api().invoke('send_log', { level: 'error', text });
	},
};

export const statusBar = {
	set(text: string): Promise<void> {
		return api().invoke('set_status_bar', { text });
	},
};

// ─── sendToMW: маршрутизация в processItem через module-local binding ───────
// Каждый плагин-бандл имеет свою копию этого файла (esbuild bundle:true), значит
// своё `_bound`. processItem.ts перед вызовом плагина дёргает pluginModule.onLoad({ sendToMW }),
// который запоминает per-execution sendToMW в `_bound`. Чтобы избежать гонок при
// MAX_PARALLEL > 1 и нескольких одновременных вызовах ОДНОГО плагина — loader.ts
// делает cache-bust по execToken и создаёт свежий module-instance на каждый вызов.

let _bound: ((type: string, payload: any) => void) | undefined;

export function sendToMW(type: string, payload: any): void {
	if (_bound) {
		_bound(type, payload);
		return;
	}
	// Fallback (вне processing-контекста): прямой IPC.
	if (type === 'statusbar') {
		const text = typeof payload === 'string' ? payload : payload?.text ?? '';
		api().invoke('set_status_bar', { text: String(text) }).catch(() => {});
	} else if (type === 'log') {
		const level = (payload?.level as 'info' | 'warn' | 'error' | 'debug') ?? 'info';
		const text = typeof payload === 'string' ? payload : payload?.text ?? payload?.message ?? '';
		api().invoke('send_log', { level, text: String(text) }).catch(() => {});
	}
}

export function onLoad(apiCtx: any): void {
	if (apiCtx && typeof apiCtx.sendToMW === 'function') {
		_bound = apiCtx.sendToMW;
	}
}
