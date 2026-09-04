// Host-API плагинов — ЕДИНСТВЕННАЯ живая копия.
//
// Раньше эти обёртки лежали в `plugins-dev/_template/tauri.ts` и при сборке
// (esbuild bundle:true) инлайнились в каждый плагин. Получалось 38 замороженных
// копий: правка одной опечатки требовала пересборки и переотдачи 38 архивов, а
// узнать, какой снимок SDK несёт установленный плагин, было нельзя вообще.
//
// Теперь объект строится здесь, в приложении, и передаётся плагину третьим
// аргументом (`ctx`) — тем самым, который `processItem` уже передавал. Следствия:
//   • багфикс здесь действует на все плагины сразу, без пересборки;
//   • module-local состояния в плагине больше нет → загрузчик может кэшировать
//     модуль (см. PluginAPI/loader.ts), утечка module-map закрыта;
//   • код оказался в `src/` → его можно покрыть тестами.
//
// ВАЖНО: этот файл НЕ раздаётся плагинам через importmap (в отличие от соседних
// fs.ts/path.ts — те полифилы `node:*`). Он живёт только в приложении.
//
// Вызовы идут через `tauriAPI.invoke` (а не через сырой `invoke` из @tauri-apps),
// потому что там разрешаются алиасы команд и применяются `argMappers` —
// позиционные вызовы вроде `ffprobe_get_info(filePath)` работают только благодаря им.

// Относительный путь, а не алиас `@/`: этот файл попадает и в программу
// plugins-dev/tsconfig.json (плагины импортируют из него тип PluginContext),
// а там алиасы не настроены.
import { tauriAPI } from '../Utils/tauri-api';

// ─── Низкоуровневый invoke ───────────────────────────────────────────────────

export function invokeHost(cmd: string, ...args: any[]): Promise<any> {
	// Явная ошибка вместо `cannot read 'invoke' of undefined` из глубины плагина.
	if (typeof tauriAPI?.invoke !== 'function') {
		return Promise.reject(new Error(`[pluginHost] IPC недоступен: tauriAPI.invoke отсутствует (команда "${cmd}")`));
	}
	return tauriAPI.invoke(cmd, ...args);
}

// ─── Типы ────────────────────────────────────────────────────────────────────

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
	// useHashCheck убран: Rust его принимал, но не читал — API обещал проверку
	// целостности, которой не было. Целостность теперь обеспечивает шов хранилища
	// (`hydrate`/`copyFromCloud`), а не пост-проверка хешей.
}

export interface SearchPattern {
	type: 'files' | 'folders';
	ext: string[];
}

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
	/** Служебное: полосу подставляет движок обработки, плагин её не задаёт. */
	runLane?: string;
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
	/** Стороны ПОТОКА, как они записаны в файле (без учёта поворота). */
	width: number;
	height: number;
	/** Поворот из матрицы отображения в градусах: 0, ±90, 180, ±270. */
	rotation: number;
	/** Стороны КАДРА, который увидят фильтры `-vf`: ffmpeg разворачивает видео сам,
	 *  ДО фильтров, поэтому у снятого вертикально ролика width/height потока
	 *  горизонтальные, а фильтр получает вертикальный кадр. Для всего, что зависит
	 *  от геометрии кадра (титры, оверлеи, crop), брать именно эти. */
	displayWidth: number;
	displayHeight: number;
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

export interface ExecOptions {
	cwd?: string;
	env?: Record<string, string>;
	/** ID ноды — если передан, Rust стримит stdout/stderr процесса в лог-окно. */
	nodeId?: string;
}

export interface ExecResult {
	stdout: string;
	stderr: string;
	exit_code: number;
	killed: boolean;
}

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
	/** Убивать предыдущий AfterFX.exe перед запуском (Windows). По умолчанию true. */
	killPreviousInstance?: boolean;
	/** Служебное: полосу подставляет движок обработки, плагин её не задаёт. */
	runLane?: string;
}

export interface SystemFont {
	name: string;
	path: string;
	loadable: boolean;
}

// ─── Шов облачного хранилища ─────────────────────────────────────────────────
//
// Файлы могут лежать в облаке и не быть скачанными. Чтобы плагинам НЕ пришлось
// про это знать, шов встроен прямо в `fs`. Шов трёх видов, и путать их нельзя:
//
//   • нужны БАЙТЫ (read, copy, hash)  → гидратируем, то есть ждём скачивания;
//   • нужны МЕТАДАННЫЕ (stat, info)   → отвечаем из каталога, НЕ качаем;
//   • нужно ЗНАТЬ, ЕСТЬ ЛИ (exists)   → отвечаем из каталога, НЕ качаем.
//
// Если бы `stat` и `exists` гидратировали, первый же обход проекта скачал бы весь
// архив: сканирование зовёт их на каждый найденный файл.
//
// Вне зеркала всё это — no-op: обычные локальные пути работают ровно как раньше.

interface PathInfoLite {
	inMirror: boolean;
	exists: boolean;
	local: boolean;
	isFolder: boolean;
	size: number | null;
	mtime: number | null;
	fileId: string | null;
}

/** Сведения о пути без скачивания. При любой ошибке — молча вниз, на диск. */
async function pathInfo(p: string): Promise<PathInfoLite | null> {
	try {
		return (await invokeHost('storage_path_info', { path: p })) as PathInfoLite;
	} catch {
		return null;
	}
}

/**
 * Убедиться, что по пути лежит актуальный файл, и вернуть этот же путь.
 * Вне зеркала — no-op, поэтому вызов безопасно стоит перед любым чтением содержимого.
 */
async function hydrate(p: string): Promise<string> {
	try {
		const r = (await invokeHost('storage_ensure_local', { path: p })) as { path: string };
		return r?.path ?? p;
	} catch {
		// Хранилище не настроено или путь не наш — работаем как раньше.
		return p;
	}
}

// ─── fs ──────────────────────────────────────────────────────────────────────

function hashRaw(p: string, algo: 'sha256' | 'sha1' | 'md5' = 'sha256'): Promise<string> {
	return invokeHost('hash_file', { path: p, algo });
}

export const fs = {
	/** true если путь существует (файл или папка).
	 *
	 * Для облачного файла возвращает true, даже если он ещё не скачан: он
	 * существует, просто пока не здесь. Иначе код вида «нет файла — пропускаем»
	 * молча выбрасывал бы из обработки всё, что лежит в облаке. */
	async exists(p: string): Promise<boolean> {
		const info = await pathInfo(p);
		if (info?.inMirror) return info.exists;
		return invokeHost('path_exists', { path: p });
	},

	/** Проверка что путь существует И это файл. */
	async existsFile(p: string): Promise<boolean> {
		const info = await pathInfo(p);
		if (info?.inMirror) return info.exists && !info.isFolder;
		if (!(await invokeHost('path_exists', { path: p }))) return false;
		try {
			const s = await invokeHost('get_stat', { path: p });
			return Boolean(s?.isFile);
		} catch {
			return false;
		}
	},

	/** Проверка что путь существует И это папка. */
	async existsFolder(p: string): Promise<boolean> {
		const info = await pathInfo(p);
		if (info?.inMirror) return info.exists && info.isFolder;
		if (!(await invokeHost('path_exists', { path: p }))) return false;
		try {
			const s = await invokeHost('get_stat', { path: p });
			return Boolean(s?.isDir);
		} catch {
			return false;
		}
	},

	/** Чтение содержимого: здесь нужны байты, поэтому облачный файл скачивается. */
	async read(p: string): Promise<string> {
		return invokeHost('read_file_sync', { filePath: await hydrate(p) });
	},

	write(p: string, content: string): Promise<any> {
		return invokeHost('write_file', { filePath: p, content });
	},

	/** Настоящий append (O_APPEND): дописывает в конец, не перезаписывая файл.
	 * Создаёт файл и родительские папки при необходимости. Для jsonl-логов краш-безопасно. */
	append(p: string, content: string): Promise<any> {
		return invokeHost('append_file', { filePath: p, content });
	},

	/** Копирование: источник нужен целиком, поэтому облачный файл скачивается.
	 * Для режима «переписать устаревший» есть `fs.copyFromCloud`. */
	async copy(src: string, dst: string, opts: CopyMoveOptions = { overwrite: true }): Promise<void> {
		return invokeHost('copy_item', {
			sourcePath: await hydrate(src),
			destinationPath: dst,
			options: opts,
		});
	},

	async move(src: string, dst: string, opts: CopyMoveOptions = { overwrite: true }): Promise<void> {
		return invokeHost('move_item', {
			sourcePath: await hydrate(src),
			destinationPath: dst,
			options: opts,
		});
	},

	/**
	 * Копирование с режимом «переписать устаревший» — правильный путь для
	 * облачных источников: проверить актуальность по индексу → скачать ТОЛЬКО
	 * если устарело → скопировать → запомнить версию. Ни одного байта по сети,
	 * если источник не менялся. Вне зеркала — сравнение по mtime, как раньше.
	 */
	copyFromCloud(
		src: string,
		dst: string,
		overwriteOldest = true,
	): Promise<{ action: 'copied' | 'skippedExists' | 'skippedUpToDate'; bytes: number | null; hydrated: boolean }> {
		return invokeHost('storage_copy_from_mirror', { src, dest: dst, overwriteOldest });
	},

	/** Удаляет файл или папку (рекурсивно). Возвращает true если что-то было удалено.
	 *
	 * Файл зеркала убирается И из каталога. Удалить только копию значило бы оставить
	 * его в облаке «только онлайн»: место занято, на сайте он виден, а любая гидрация
	 * вернёт его в IN — и он пойдёт по пайплайну заново. Двухступенчатое удаление
	 * (первое нажатие — копия, второе — облако) существует для человека, где защищает
	 * от случайного нажатия; у пайплайна «удалить после копирования» — явная
	 * инструкция ноды, и переспрашивать некого.
	 *
	 * Признак «за путём стоит запись в каталоге» — `fileId`. Файл внутри зеркала, но
	 * без записи (временный файл шага, ещё не залитый результат) удаляется как раньше:
	 * в облаке удалять нечего.
	 */
	async remove(p: string): Promise<boolean> {
		const info = await pathInfo(p);
		if (info?.inMirror && info.fileId) {
			// Первый вызов снимает локальную копию, второй — запись в каталоге:
			// `storage_delete` двухступенчатый, и разрешение на облако мы даём сразу.
			//
			// Ошибку НЕ глотаем и на обычное удаление НЕ падаем: убрать файл с диска,
			// когда облако его не отпустило, — ровно тот исход, ради которого этот
			// код и написан.
			const stage = await invokeHost('storage_delete', { path: p, allowOnline: true });
			if (stage === 'localCopy') await invokeHost('storage_delete', { path: p, allowOnline: true });
			return true;
		}
		return invokeHost('delete_item', { itemPath: p });
	},

	/** Создаёт папку (рекурсивно). Если уже есть — ничего не делает. */
	mkdir(p: string): Promise<void> {
		return invokeHost('test_and_create_folder', { path: p });
	},

	/** Метаданные. Для облачного файла берутся из каталога — НЕ качаем. */
	async stat(p: string): Promise<Stat> {
		const info = await pathInfo(p);
		if (info?.inMirror && !info.local && info.exists) {
			const ms = (info.mtime ?? 0) * 1000;
			return {
				size: info.size ?? 0,
				mtimeMs: ms,
				atimeMs: ms,
				ctimeMs: ms,
				birthtimeMs: ms,
				isFile: !info.isFolder,
				isDir: info.isFolder,
				isSymlink: false,
			};
		}
		return invokeHost('get_stat', { path: p });
	},

	info(p: string): Promise<FileInfo> {
		return invokeHost('get_file_info', { path: p });
	},

	/**
	 * @deprecated Для облачных источников используй `fs.copyFromCloud` — он
	 * сравнивает ВЕРСИЮ источника, а не время, и не качает лишнего.
	 *
	 * Сравнение по mtime плохо работает с облаком: у нескачанного файла локального
	 * времени нет, а `origin_mtime` из каталога бэкенд пока не заполняет. Поэтому
	 * для путей в зеркале отвечаем консервативно «да, копировать».
	 */
	async isSourceNewer(src: string, dst: string): Promise<boolean> {
		try {
			const info = await pathInfo(src);
			if (info?.inMirror) {
				if (!info.mtime) return true;
				const d = await fs.stat(dst);
				return info.mtime * 1000 > d.mtimeMs;
			}
			const [s, d] = await Promise.all([fs.stat(src), fs.stat(dst)]);
			return s.mtimeMs > d.mtimeMs;
		} catch {
			return true; // не смогли выяснить — считаем что копировать надо
		}
	},

	/** { files, folders } — имена в папке. Rust поддерживает только ключи
	 * 'files' и 'folders'; кастомные типы фильтруйте через fs.filesByExt. */
	someFromFolder(folder: string, search?: SearchPattern[]): Promise<{ files: string[]; folders: string[] }> {
		return invokeHost('get_some_from_folder', { path: folder, search: search ?? null });
	},

	/** Рекурсивный поиск по фильтру. Те же ограничения по ключам. */
	recursiveFind(folder: string, search?: SearchPattern[]): Promise<{ files: string[]; folders: string[] }> {
		return invokeHost('recursive_find_files', { path: folder, search: search ?? null });
	},

	/** Имена файлов в папке, отфильтрованные по расширениям. Пустой exts — без фильтра. */
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

	/** Имена подпапок. */
	async folders(folder: string, recursive = false): Promise<string[]> {
		const search: SearchPattern[] = [{ type: 'folders', ext: [] }];
		const result = recursive ? await fs.recursiveFind(folder, search) : await fs.someFromFolder(folder, search);
		return result.folders ?? [];
	},

	/** Хэш содержимого — нужны байты, поэтому облачный файл скачивается.
	 * Зовём `hashRaw` как обычную функцию, а не через `this`: иначе деструктуризация
	 * (`const { hash } = ctx`) ломала бы метод, а именно так плагины его и получают. */
	async hash(p: string, algo: 'sha256' | 'sha1' | 'md5' = 'sha256'): Promise<string> {
		return hashRaw(await hydrate(p), algo);
	},

	_hashRaw: hashRaw,

	/** Превращает локальный путь в URL для нативного fetch (asset://...).
	 * Используется в http-плагинах для FormData.append('file', blob). */
	toFetchUrl(p: string): string {
		const win = window as any;
		const conv = win.__TAURI__?.core?.convertFileSrc || win.__TAURI_INTERNALS__?.convertFileSrc;
		if (typeof conv === 'function') return conv(p);
		// Раньше здесь был самодельный `asset://localhost/...` — он молча отдавал
		// вероятно-неверный URL, и ошибка всплывала позже и не по адресу.
		// Лучше упасть здесь с понятным текстом.
		throw new Error('[pluginHost] convertFileSrc недоступен — не могу построить asset-URL для fetch');
	},

	/** Пишет ArrayBuffer / Uint8Array в файл через Rust (base64 IPC).
	 *
	 * ВНИМАНИЕ: base64 раздувает payload в ~1.33 раза и держит его строкой в
	 * памяти. Для файлов в сотни МБ и больше это неприемлемо — там нужен
	 * потоковый Rust-путь, а не эта функция. */
	async writeBytes(p: string, bytes: ArrayBuffer | Uint8Array): Promise<number> {
		const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
		// Чанк 32k символов: apply() со всем массивом падает на stack-limit.
		// subarray без Array.from — лишняя копия на каждый чанк не нужна.
		let binary = '';
		const chunk = 0x8000;
		for (let i = 0; i < u8.length; i += chunk) {
			binary += String.fromCharCode.apply(null, u8.subarray(i, i + chunk) as unknown as number[]);
		}
		const b64 = btoa(binary);
		return (await invokeHost('write_binary_file', { filePath: p, dataB64: b64 })) as number;
	},
};

// ─── http ────────────────────────────────────────────────────────────────────
// Все запросы выполняются в Rust через reqwest → нет CORS-ограничений WebView.

export const http = {
	/** GET/POST/... с опциональным строковым телом. Не бросает при 4xx/5xx. */
	fetch(
		url: string,
		opts: { method?: string; headers?: [string, string][]; body?: string } = {},
	): Promise<HttpResponse> {
		return invokeHost('http_fetch', { url, method: opts.method, headers: opts.headers, body: opts.body });
	},

	/** Multipart/form-data upload с локальными файлами (читаются в Rust). */
	upload(
		url: string,
		opts: { files?: UploadFile[]; fields?: UploadField[]; headers?: [string, string][] } = {},
	): Promise<HttpResponse> {
		return invokeHost('http_upload', { url, files: opts.files, fields: opts.fields, headers: opts.headers });
	},

	/** Скачивает URL в локальный файл, возвращает количество байт.
	 * `nodeId`/`statusText` — чтобы прогресс был виден в статусбаре/ноде. */
	download(
		url: string,
		dest: string,
		opts: { headers?: [string, string][]; nodeId?: string; statusText?: string } = {},
	): Promise<number> {
		return invokeHost('http_download', {
			url,
			dest,
			headers: opts.headers,
			nodeId: opts.nodeId,
			statusText: opts.statusText,
		});
	},
};

// ─── Чистые хелперы (тестируемые, без IPC) ───────────────────────────────────

/**
 * Секунды → таймкод.
 *
 * Два формата, и выбор теперь ЯВНЫЙ:
 *   fps задан и > 0  → `HH:MM:SS:FF` (кадры)
 *   иначе            → `HH:MM:SS,mmm` (миллисекунды, SRT-стиль)
 *
 * Раньше `getInfo` звал это с `fps || 25`, и у файла без видеопотока таймкод
 * считался по ВЫДУМАННЫМ 25 fps. Теперь при неизвестном fps честно отдаём
 * миллисекунды вместо фальшивых кадров.
 */
export function secondsToTimecode(seconds: number, fps?: number): string {
	const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
	const hours = Math.floor(safe / 3600);
	const minutes = Math.floor((safe % 3600) / 60);
	const secs = Math.floor(safe % 60);
	const tc = [hours, minutes, secs].map((v) => String(v).padStart(2, '0')).join(':');

	if (fps === undefined || !Number.isFinite(fps) || fps <= 0) {
		const ms = Math.round((safe % 1) * 1000);
		return `${tc},${String(ms).padStart(3, '0')}`;
	}
	const frames = Math.round((safe % 1) * fps);
	return `${tc}:${String(frames).padStart(2, '0')}`;
}

/** "30000/1001" → 29.97. Возвращает 0 для "0/0", пустой строки и деления на ноль. */
export function parseFrameRate(str?: string): number {
	if (!str || str === '0/0') return 0;
	const [n, d] = str.split('/').map(Number);
	if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0) return 0;
	return n / d;
}

// Окно соседних кадров для скользящего среднего (с каждой стороны).
const SCENE_WINDOW = 3;
// Во сколько раз оценка должна превышать локальное среднее, чтобы считаться склейкой.
const SCENE_RATIO = 3.0;
// Абсолютный пол: ниже — шум (движение мыши, артефакты сжатия), не склейка.
const SCENE_MIN_SCORE = 0.3;
// Минимальный интервал между склейками (сек) — не даём рассыпать видео покадрово.
const SCENE_MIN_GAP = 0.4;

/**
 * Разбор scene-score'ов из stdout ffmpeg в список точек реза.
 *
 * Почему адаптивно, а не фиксированным порогом / Otsu:
 *   • Hard cut — оценка резко высокая на ОДНОМ кадре, соседи низкие → всплеск.
 *   • Панорама/motion blur — оценка высокая на СЕРИИ кадров → локальное среднее
 *     тоже высокое → отношение score/среднее ≈ 1 → НЕ склейка.
 *   • Запись экрана — оценки равномерно-шумные → ничего не торчит над фоном,
 *     плюс отсекается абсолютным полом → склеек нет (а не 733).
 * Otsu делил любое распределение надвое даже без реальных склеек — отсюда баг.
 *
 * Ноль в начале — это не «склейка в нуле», а начало первого сегмента: результат
 * читается как список границ, поэтому пустой ответ невозможен по построению.
 */
export function parseSceneTimestamps(stdout: string): number[] {
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

		let sum = 0;
		let n = 0;
		let isPeak = true;
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

// ─── ffmpeg / ffprobe ────────────────────────────────────────────────────────

/** Контейнеры, чей muxer знает `-movflags`. Остальным этот флаг — ошибка запуска. */
const FASTSTART_EXTS = ['.mp4', '.m4v', '.mov', '.m4a'];
const FASTSTART_MUXERS = ['mp4', 'mov', 'ipod', 'm4v', 'mov,mp4,m4a,3gp,3g2,mj2'];

/**
 * Дописывает `-movflags +faststart` всем выходам в mp4/mov.
 *
 * Зачем в хосте, а не в каждой ноде: без этого флага `moov` (индекс файла) лежит
 * В КОНЦЕ, и браузер не начинает играть файл, пока не скачает его целиком. Для
 * локальной папки это не важно, а для облака важно всегда: превью на сайте, наши
 * характеристики по Range (`ffprobe` читает только `moov`) и любой веб-плеер
 * упираются в это. Ставить флаг руками в 45 плагинах — значит забыть его в
 * сорок шестом; хост же одна живая копия и действует на все бандлы без пересборки.
 *
 * Правила безопасности (иначе флаг сломает чужую команду):
 *   • есть явный `-movflags` — не трогаем, автор знает лучше;
 *   • `-f <muxer>` не из семейства mov/mp4 — не трогаем (`-movflags` для чужого
 *     muxer'а это «Option movflags not found» и падение);
 *   • выход не файл (`-`, `/dev/null`, `NUL`) или расширение не наше — не трогаем;
 *   • вставляем ПЕРЕД последним аргументом: `-movflags` — опция выхода, после имени
 *     файла ffmpeg её не примет.
 *
 * Цена флага — второй проход по готовому файлу при закрытии (перенос `moov`),
 * качество и содержимое не меняются.
 */
export function withFaststart(args: string[]): string[] {
	if (!Array.isArray(args) || args.length < 2) return args;
	if (args.some((a) => a === '-movflags')) return args;

	const fIndex = args.lastIndexOf('-f');
	if (fIndex >= 0 && fIndex + 1 < args.length) {
		const muxer = String(args[fIndex + 1]).toLowerCase();
		if (!FASTSTART_MUXERS.includes(muxer)) return args;
	}

	const out = String(args[args.length - 1]);
	if (out === '-' || out === '/dev/null' || out.toUpperCase() === 'NUL') return args;

	const dot = out.lastIndexOf('.');
	if (dot < 0 || !FASTSTART_EXTS.includes(out.slice(dot).toLowerCase())) return args;

	return [...args.slice(0, -1), '-movflags', '+faststart', out];
}


export const ffmpeg = {
	/** Запускает ffprobe и возвращает массив streams. */
	async probe(filePath: string): Promise<FfprobeStream[]> {
		const jsonStr = (await invokeHost('ffprobe_get_info', filePath)) as string;
		try {
			return JSON.parse(jsonStr).streams ?? [];
		} catch (e) {
			// Раньше здесь вылетал безымянный SyntaxError, и найти виновный файл
			// было невозможно. ffprobe может отдать текст ошибки вместо JSON.
			const head = String(jsonStr ?? '').slice(0, 200);
			throw new Error(`[pluginHost] ffprobe вернул не JSON для "${filePath}": ${head}`);
		}
	},

	/** Поворот видеопотока в градусах: сначала матрица отображения, затем старый тег `rotate`. */
	rotation(video?: FfprobeStream): number {
		const list = (video as any)?.side_data_list;
		if (Array.isArray(list)) {
			const side = list.find((d: any) => Number.isFinite(Number(d?.rotation)));
			if (side) return Math.round(Number(side.rotation));
		}
		const tag = Number((video as any)?.tags?.rotate);
		return Number.isFinite(tag) ? Math.round(tag) : 0;
	},

	pickVideo(streams: FfprobeStream[]): FfprobeStream | undefined {
		return streams.find((s) => s.codec_type === 'video');
	},

	pickAudio(streams: FfprobeStream[]): FfprobeStream | undefined {
		return streams.find((s) => s.codec_type === 'audio');
	},

	/** Высокоуровневая инфа о медиафайле. */
	async getInfo(filePath: string): Promise<VideoFileInfo> {
		const streams = await ffmpeg.probe(filePath);
		const video = ffmpeg.pickVideo(streams);
		const audio = ffmpeg.pickAudio(streams);
		if (!video && !audio) throw new Error(`No video/audio streams found in file: ${filePath}`);

		let fps = parseFrameRate(video?.avg_frame_rate);
		if (fps === 0) fps = parseFrameRate(video?.r_frame_rate);
		fps = Number(fps.toFixed(3));

		let durationSec = Number(video?.duration);
		if (!durationSec || !Number.isFinite(durationSec)) {
			// duration_ts * time_base. `parseFrameRate` заодно прикрывает "0/0" и
			// деление на ноль — раньше здесь получался NaN.
			const ts = Number(video?.duration_ts);
			const tb = parseFrameRate(video?.time_base);
			durationSec = ts && tb ? ts * tb : 0;
		}
		if (!durationSec && audio?.duration) durationSec = Number(audio.duration);
		if (!Number.isFinite(durationSec)) durationSec = 0;

		// ±90 и ±270 меняют стороны местами; 0 и 180 — нет.
		const rotation = ffmpeg.rotation(video);
		const swapped = Math.abs(rotation) % 180 === 90;
		const codedW = video?.width || 0;
		const codedH = video?.height || 0;

		return {
			durationInSeconds: durationSec || 0,
			// fps не подставляем: у файла без видеопотока таймкод будет в
			// миллисекундах, а не в выдуманных кадрах.
			durationInTimcode: secondsToTimecode(durationSec || 0, fps > 0 ? fps : undefined),
			fps,
			avg_frame_rate: video?.avg_frame_rate,
			r_frame_rate: video?.r_frame_rate,
			time_base: video?.time_base,
			width: codedW,
			height: codedH,
			rotation,
			displayWidth: swapped ? codedH : codedW,
			displayHeight: swapped ? codedW : codedH,
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

	/** Запускает ffmpeg с переданными аргументами. Прогресс эмитится в лог-окно. */
	exec(args: string[], opts: FfmpegExecOptions = {}): Promise<FfmpegExecResult> {
		return invokeHost('ffmpeg_exec_with_progress', {
			args: withFaststart(args),
			durationSec: opts.durationSec,
			nodeId: opts.nodeId,
			statusText: opts.statusText,
			// Полоса прогона: до 2026-08-11 ffmpeg НЕ прерывался вообще — команда не
			// смотрела флаг и возвращала захардкоженный `killed: false`, поэтому Stop
			// оставлял транскод доигрывать до конца. Подменяется в processItem.
			runLane: (opts as any).runLane,
		});
	},

	/** Обёртка для формы { command, duration?, text?, nodeId? }. Бросает при ненулевом exit_code. */
	async run(command: { command: string[]; duration?: number; text?: string; nodeId?: string }): Promise<FfmpegExecResult> {
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

	/** Кадр из видеофайла как base64 data URL (image/png). */
	thumbnail(filePath: string, timestampSec?: number): Promise<string> {
		return invokeHost('ffmpeg_get_video_thumbnail', filePath, timestampSec);
	},

	getFfmpegPath(): Promise<string> {
		return invokeHost('ffmpeg_get_path');
	},

	getFfprobePath(): Promise<string> {
		return invokeHost('ffprobe_get_path');
	},

	/** Детект границ сцен (адаптивный, в духе PySceneDetect AdaptiveDetector).
	 *  `select='gte(scene,0)'` печатает scene-score КАЖДОГО кадра — нужно, чтобы
	 *  считать локальное среднее по соседям.
	 *
	 *  `-vsync 0` — устаревший псевдоним `-fps_mode passthrough`. Менять его сейчас
	 *  нельзя: `deps_commands` качает сборку ffmpeg сам, и на старых сборках нового
	 *  флага нет. Когда минимальная версия ffmpeg будет зафиксирована — заменить. */
	async detectScenes(filePath: string): Promise<number[]> {
		const result = await ffmpeg.exec(
			[
				'-v', 'info', '-vsync', '0', '-i', filePath,
				'-vf', "select='gte(scene,0)',metadata=print:file=-:key=lavfi.scene_score",
				'-f', 'null', '-',
			],
			{ statusText: `[detectScenes] ${filePath}` },
		);
		return parseSceneTimestamps(result.stdout);
	},

	/** Детект чёрных кадров через blackframe-фильтр. Ноль в начале — начало первого сегмента. */
	async detectBlackFrames(filePath: string, amount = 98): Promise<number[]> {
		const result = await ffmpeg.exec(
			['-i', filePath, '-vf', `blackframe=amount=${amount}`, '-an', '-f', 'null', '-'],
			{ statusText: `[detectBlackFrames] ${filePath}` },
		);
		const matches = [...result.stderr.matchAll(/t:([\d.]+)/g)];
		const timestamps = [...new Set(matches.map((m) => parseFloat(m[1])))];
		timestamps.unshift(0);
		return [...new Set(timestamps)].sort((a, b) => a - b);
	},
};

// ─── exec ────────────────────────────────────────────────────────────────────

export function exec(cmd: string, args: string[] = [], opts: ExecOptions = {}): Promise<ExecResult> {
	return execOnLane(undefined, cmd, args, opts);
}

/**
 * Тот же `exec`, но с явной ПОЛОСОЙ прогона — им пользуется движок обработки
 * (`processItem` подменяет `ctx.exec` на привязанный к своему прогону).
 *
 * Полоса решает, чей стоп убивает процесс. Обработка и постинг — независимые
 * раннеры, и раньше флаг прерывания был один на процесс: стоп обработки убивал
 * дочерние процессы постинга, а постинг, запущенный после остановленной обработки,
 * умирал сразу на каждом `exec`. Пусто = полоса обработки (так ведут себя старые
 * установленные бандлы плагинов, которые про полосы не знают).
 *
 * Плагину этого напрямую не видно: он зовёт `ctx.exec(...)`, полоса уже привязана.
 */
export function execOnLane(
	runLane: string | undefined,
	cmd: string,
	args: string[] = [],
	opts: ExecOptions = {},
): Promise<ExecResult> {
	return invokeHost('exec_command', {
		cmd,
		args,
		cwd: opts.cwd,
		env: opts.env ? Object.entries(opts.env) : undefined,
		nodeId: opts.nodeId,
		runLane,
	});
}

// ─── After Effects ───────────────────────────────────────────────────────────

export const ae = {
	/** Запускает AE и выполняет JSX-скрипт. Rust подставляет inObj в `var inObj = {}`. */
	runScript(args: RunScriptInAEArgs): Promise<AEResult> {
		// Команда ожидает payload с полем `args` и snake_case ключами внутри.
		return invokeHost('run_script_in_ae', {
			args: {
				ae_path: args.aePath,
				script_path: args.scriptPath,
				in_obj: args.inObj,
				temp_dir: args.tempDir,
				keep_temp_files: args.keepTempFiles,
				timeout_sec: args.timeoutSec,
				kill_previous_instance: args.killPreviousInstance,
			},
		});
	},

	/** Просто запускает AE с .jsx-файлом без ожидания результата. */
	launchWithScript(aePath: string, scriptPath: string): Promise<void> {
		return invokeHost('launch_ae_with_script', aePath, scriptPath);
	},
};

// ─── paths ───────────────────────────────────────────────────────────────────

export const paths = {
	/** Папка пользовательских настроек приложения. */
	optionsFolder(): Promise<string> {
		return invokeHost('get_user_data_path');
	},

	/** Rust `path_join(segments: Vec<String>)` ждёт named-payload `{ segments }`.
	 * Раньше сюда уходил голый массив без argMapper — вызов был сломан, просто
	 * его никто не звал. */
	join(segments: string[]): Promise<string> {
		return invokeHost('path_join', { segments });
	},

	/** Системная temp-папка. */
	tmpdir(): Promise<string> {
		return invokeHost('os_tmpdir');
	},

	/** Корневая папка plugins-dev (ИСХОДНИКИ плагинов, только dev!). В проде её НЕТ —
	 *  для доступа к ресурсам самого плагина используй pluginInstallPath(). */
	pluginsDev(): Promise<string> {
		return invokeHost('get_plugins_dev_path');
	},

	/** Установочная папка конкретного плагина (бинарники, модели). Работает и в dev
	 *  (distr-plugins/<id>@<ver>), и в prod (app_data/plugins/<id>@<ver>).
	 *  Позиционные аргументы — у команды есть argMapper (pluginId, version?). */
	async pluginInstallPath(pluginId: string, version?: string): Promise<string | null> {
		const info: any = await invokeHost('plugin_manager_get_plugin', pluginId, version);
		return info?.path ?? null;
	},

	/** Сегмент платформы: `mac-arm64` | `mac-x64` | `win-x64` | `win-arm64` | `linux-x64` | `linux-arm64`. */
	platformTarget(): Promise<string> {
		return invokeHost('get_platform_target');
	},
};

// ─── system / fonts ──────────────────────────────────────────────────────────

export const system = {
	/** Реальное число логических ядер. `navigator.hardwareConcurrency` в Safari clamp'ится до 8. */
	cpuCount(): Promise<number> {
		return invokeHost('get_cpu_count');
	},

	/** Открыть путь системным средством: на macOS смонтирует DMG, на Windows запустит installer. */
	openPath(targetPath: string): Promise<unknown> {
		return invokeHost('shell_open_path', { folderPath: targetPath });
	},
};

export const fonts = {
	list(): Promise<SystemFont[]> {
		return invokeHost('fonts_get_list');
	},

	/** Поиск шрифта по нормализованному имени (без -/_/пробелов, case-insensitive). */
	async find(fontName: string): Promise<SystemFont | null> {
		const normalize = (s: string) => s.toLowerCase().replace(/[-_ ]/g, '');
		const target = normalize(fontName);
		const all = await fonts.list();
		return all.find((f) => normalize(f.name) === target) ?? null;
	},
};

// ─── Сборка объекта для ctx ──────────────────────────────────────────────────

/** Сервисы, которые плагин получает третьим аргументом. */
/** Один аккаунт площадки БЕЗ токена: то, что отдаёт каталог. */
export interface AccountInfo {
	name: string;
	/** Telegram: каналы/чаты бота с темами форум-групп. У других площадок нет. */
	channels?: Array<{
		id?: number | string;
		username?: string;
		title?: string;
		topics?: Array<{ name?: string; threadId?: number }>;
	}>;
	[key: string]: any;
}

/**
 * Аккаунты площадок (VK, Telegram, YouTube…): каталог и токены.
 *
 * Появилось, потому что три постера (`autoPostVK`, `autoPostTG`, `tgSend`) ходили за
 * этим напрямую в `(window as any).tauriAPI` — то есть в обход единственной точки IPC.
 * Свой `invoke` в плагине означает и своё имя команды строкой: переименование в Rust
 * такой вызов ломает молча, ни компилятор, ни `tsc` его не видят.
 */
export const accounts = {
	/** Каталог аккаунтов платформы — БЕЗ токенов (их отдаёт только `getToken`). */
	list(mainFolderName: string, platform: string): Promise<AccountInfo[]> {
		return invokeHost('account_list', { mainFolderName, platform }).then((r) =>
			Array.isArray(r) ? (r as AccountInfo[]) : [],
		);
	},

	/** Токен аккаунта. СЕКРЕТ: не логировать, не писать в options.json, не показывать. */
	getToken(mainFolderName: string, platform: string, name: string): Promise<string> {
		return invokeHost('account_get_token', { mainFolderName, platform, name });
	},
};

/**
 * Метаданные учётки — то же, что отдаёт `vault_list`. Описано здесь, а не взято из
 * `bindings.ts`: этот файл импортируют плагины, и тянуть в них артефакт specta со
 * всеми командами ядра незачем (как и у `AccountInfo` выше).
 */
export interface VaultAccountMeta {
	slug: string;
	label: string;
	/** `local` — заведена на этой машине; `site` — копия выданного сайтом ключа. */
	source: string;
	/** `••••4f21` — узнать ключ глазами, не доставая его. */
	hint: string;
	secretVersion: number;
	/** Unix-секунды. `null` — бессрочно (только у локальных). */
	expiresAt: number | null;
	updatedAt: number;
	/** Срок копии вышел: секрет запрашивать заново, работать по нему нельзя. */
	expired: boolean;
	/**
	 * Адрес ЭТОЙ установки. Пусто — адрес знает сам плагин.
	 *
	 * У вендора с одним публичным API совпадает с сервисным и обычно пуст; у своих
	 * серверов различается: два своих ComfyUI — это один слаг (значит одна нода) и
	 * две учётки с разными адресами.
	 */
	baseUrl: string;
	/** `platform` — наша учётка, `client` — клиента. У локальных пусто. */
	owner: string;
	/**
	 * Есть ли у учётки ключ. `false` — законное состояние, а не сбой: свой сервер
	 * рядом может не требовать авторизации, у него есть только адрес. Плагин обязан
	 * это различать, иначе примет отсутствие ключа за поломку выдачи.
	 */
	hasSecret: boolean;
}

/**
 * Учётки внешних сервисов (ключи вендоров): каталог и секреты.
 *
 * Контракт: `ideasAndTest/VENDOR_KEYS_CONTRACT.md` §6. Плагин НЕ хранит ключ у себя и
 * не читает файлов — в его свойстве лежит только МЕТКА учётки, выбранная в ноде, а
 * значение достаётся здесь и ровно в момент вызова вендора.
 *
 * Отдельно от `accounts` намеренно: там аккаунты ПЛОЩАДОК (VK, Telegram, YouTube),
 * где владелец секрета — конкретный человек и нужна привязка «чей это токен». Здесь
 * сервисные ключи, у которых владелец — мы или клиент проекта. Ветки разные, сроки
 * жизни разные, отзыв разный; сливать их в одну поверхность нельзя.
 */
export const vault = {
	/** Учётки сервиса — БЕЗ секретов (метка, источник, адрес, подсказка, срок). */
	list(slug: string): Promise<VaultAccountMeta[]> {
		return invokeHost('vault_list', { slug }).then((r) => (Array.isArray(r) ? (r as VaultAccountMeta[]) : []));
	},

	/**
	 * Одна учётка по метке — то, что плагин обычно и хочет: адрес и признак ключа.
	 *
	 * Бросает, если метки нет: это не «работаем без ключа», а «в поле проекта
	 * выбрана учётка, которой на этой машине не существует».
	 */
	async account(slug: string, label: string): Promise<VaultAccountMeta> {
		const found = (await vault.list(slug)).find((a) => a.label === label);
		if (!found) throw new Error(`Учётки «${label}» для сервиса «${slug}» нет на этой машине`);
		return found;
	},

	/**
	 * Поля секрета учётки. СЕКРЕТ: не логировать, не класть в options.json, не
	 * показывать в UI и не отправлять никуда, кроме самого вендора.
	 *
	 * Протухшую копию хост не отдаёт вовсе — бросает. Это не сбой, а штатный конец
	 * срока: ключ надо запросить у сайта заново.
	 */
	getSecret(slug: string, label: string): Promise<Record<string, string>> {
		return invokeHost('vault_get_secret', { slug, label });
	},

	/**
	 * Единственное значение секрета — то, что нужно в 90 % случаев.
	 *
	 * Существует потому, что имя поля различается по независящей от плагина
	 * причине: у локально заведённой учётки оно из описания сервиса (`apiKey`,
	 * `authorization`), а у выданной сайтом — каноничное `secret`, потому что сайт
	 * хранит один секрет на сервис и имён полей пока не знает. Плагин, читающий
	 * поле по имени, сломался бы при переезде учётки с машины на сайт.
	 *
	 * Полей больше одного (OAuth-набор, логин с паролем) — зовите `getSecret` и
	 * разбирайте карту сами: угадывать «главное» поле здесь нечем.
	 */
	async getSecretValue(slug: string, label: string): Promise<string> {
		const fields = await vault.getSecret(slug, label);
		const values = Object.values(fields ?? {});
		if (values.length === 1) return values[0];
		if (values.length === 0) throw new Error(`Учётка '${label}' (${slug}) пуста`);
		throw new Error(
			`У учётки '${label}' (${slug}) полей больше одного (${Object.keys(fields).join(', ')}) — нужен getSecret`,
		);
	},

	/**
	 * Потребление в ЕДИНИЦАХ (`token` | `char` | `sec` | `image` | `run`), а не в
	 * деньгах: цена живёт на сайте, у сервиса, с датой начала действия.
	 *
	 * Звать СРАЗУ после ответа вендора, не дожидаясь конца обработки: вендор уже
	 * получил свои деньги, и упади машина следом — расход всё равно должен быть
	 * учтён.
	 *
	 * `taskId` берётся из `_description.dbItemId` — общий объект хост-сервисов
	 * состояния не имеет и знать текущую задачу не может.
	 *
	 * ⚠️ Ответ надо разбирать: `unpriced` и `noRate` означают, что строка НЕ
	 * записана и расход надо прислать позже. `duplicate` — норма: повтор той же
	 * тройки расход не удваивает, поэтому переотправка безопасна.
	 */
	reportUsage(
		taskId: string,
		entries: Array<{ service: string; unit: string; units: number }>,
		projectId?: string,
	): Promise<{
		recorded: number;
		duplicate: number;
		unknown: string[];
		unpriced: string[];
		noRate: string[];
	}> {
		return invokeHost('vault_report_usage', { taskId, projectId: projectId ?? null, entries });
	},
};


export const telegram = {
	/**
	 * База Bot API. Обычно официальная, но если поднят локальный
	 * `telegram-bot-api --local`, то localhost — и тогда снимается лимит 20 МБ, а
	 * файлы отдаются локальным путём. Знает об этом только хост, плагин — нет.
	 */
	async baseUrl(): Promise<string> {
		try {
			return await invokeHost('tg_base_url');
		} catch {
			return 'https://api.telegram.org';
		}
	},
};

export interface PluginHostServices {
	fs: typeof fs;
	http: typeof http;
	ffmpeg: typeof ffmpeg;
	exec: typeof exec;
	ae: typeof ae;
	paths: typeof paths;
	system: typeof system;
	fonts: typeof fonts;
	accounts: typeof accounts;
	vault: typeof vault;
	telegram: typeof telegram;
}

/**
 * Один и тот же объект для всех вызовов: состояния внутри нет, поэтому делить
 * его безопасно — именно это и позволило вернуть кэш модулей в loader.ts.
 */
export const hostServices: PluginHostServices = {
	fs,
	http,
	ffmpeg,
	exec,
	ae,
	paths,
	system,
	fonts,
	accounts,
	vault,
	telegram,
};

export type SendFn = (type: string, payload: any) => void;

/**
 * Полный третий аргумент плагина. Плагины импортируют этот тип:
 *
 *   import type { PluginContext } from '../../src/PluginAPI/host';
 *   export async function myFunc(_item: any, _description: any, ctx: PluginContext) {
 *     const { fs, ffmpeg, sendToMW } = ctx;
 *
 * Импорт ТИПА стирается при сборке — в бандл плагина ничего не попадает, а
 * взамен появляется автодополнение и проверка: `ffmpeg.exec()` возвращает
 * типизированный результат, поэтому колбэки над `stdout` больше не падают в
 * неявный `any` под `strict`.
 *
 * Живёт здесь, а не в processItem.ts, чтобы плагин не тянул типы из ядра
 * обработки (и чтобы не возникло кольцевого импорта).
 */
export interface PluginContext extends PluginHostServices {
	itemId: string;
	stepId?: string;
	signal: AbortSignal;
	pluginId: string;
	pluginVersion: string;
	pluginPath?: string;
	log: (level: 'info' | 'warn' | 'error' | 'debug', text: string, meta?: any) => void;
	send: SendFn;
	sendToMW: SendFn;

	/**
	 * Узаконенный шов для команд СВОЕЙ площадки: `vk_groups_get`,
	 * `youtube_upload_video` и подобных, у которых Rust-сторона существует ровно для
	 * этого плагина.
	 *
	 * Почему они не стали сервисами host'а: его дело — общие возможности (файлы,
	 * процессы, сеть, ffmpeg), а не знание про YouTube. Класть площадки в generic-хост
	 * значит делать его свалкой.
	 *
	 * Почему не `(window as any).tauriAPI`, как было до 2026-08-11 в пяти плагинах:
	 * своё обращение к глобалу обходит единственную точку IPC — теряются понятная
	 * ошибка при отсутствии `invoke` и возможность что-либо поменять централизованно.
	 *
	 * Имя команды остаётся строкой, но не бесконтрольной: тест
	 * `сырые_invoke_из_ts_существуют_в_рантайме` сканирует и `plugins-dev`, поэтому
	 * переименование команды в Rust уронит `cargo test`, а не прод.
	 *
	 * Для общих возможностей это НЕ дорога: там заводится сервис.
	 */
	invoke: (command: string, args?: Record<string, unknown>) => Promise<any>;
}
