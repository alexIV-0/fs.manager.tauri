// Общие типы настроек — используются и в main, и в renderer.

export interface ProcessingSettings {
	maxParallel: number;
}

export interface ScanScheduleSettings {
	// Минимальная пауза между циклами сканирования (минуты, можно дробное).
	// Если предыдущий скан занял больше maxScanWaitMin — следующий запустится через этот интервал.
	minScanWaitMin: number;
	// Максимальная пауза между циклами сканирования (минуты, можно дробное).
	// Идеальный интервал между стартами сканов.
	maxScanWaitMin: number;
	// Задержка между папками внутри одного скана.
	foldersDelayMs: number;
}

export interface LocalArchiveEntry {
	enabled: boolean;
	// Сегменты пути: литеральные папки + $-маски, например
	// ["$localFolder", "archive", "$YYYY", "$projectName"].
	// Расширение добавляется шаблоном автоматически (.jsonl для local-archive, .json для stats).
	path: string[];
	// id шаблона (из registry)
	templateId: string;
}

export interface OnlineDbSettings {
	enabled: boolean;
	url: string;
	templateId: string;
}

export interface StorageSettings {
	localArchives: LocalArchiveEntry[]; // массив для поддержки нескольких архивов
	onlineDb: OnlineDbSettings;
}

export interface CleanupSettings {
	retentionDays: number | null;
	// Авто-отключение проектов: если папка OUT не модифицировалась более N дней,
	// проект автоматически отключается (чекбокс снимается).
	autoDisableDays: number | null;
}

export interface LoggingSettings {
	bufferSize: number;
}

export interface LogsArchiveSettings {
	// Сколько дней хранить архивные лог-файлы (logs/YYYY-MM-DD.jsonl). 0 — не удалять.
	retentionDays: number;
}

export interface AppSettings {
	version: number;
	processing: ProcessingSettings;
	scanSchedule: ScanScheduleSettings;
	resourcePools: Record<string, number>;
	storage: StorageSettings;
	cleanup: CleanupSettings;
	logging: LoggingSettings;
	logs: LogsArchiveSettings;
}

export type AppSettingsPatch = {
	[K in keyof Omit<AppSettings, 'version'>]?: Partial<AppSettings[K]>;
};

// ====== ColorTypes ======
export interface ColorTypeEntry {
	name: string;
	defaultLimit: number;
	orphan: boolean;
}

export interface ColorTypesFile {
	version: number;
	types: ColorTypeEntry[];
	lastScannedAt: string | null;
}

// ====== Archive templates ======
// Шаблоны теперь загружаются динамически из registry (electron/main/templates/registry.ts)
// через API window.templates.list()

export const APP_SETTINGS_VERSION = 1;
export const COLOR_TYPES_VERSION = 1;
export const FALLBACK_POOL_LIMIT = 10;

export const COLOR_TYPE_DEFAULT_LIMITS: Record<string, number> = {
	afterEffect: 1,
	moho: 1,
	ffmpeg: 2,
	ffprobe: 4,
	ai: 1,
	aiLocal: 1,
	helpers: 10,
	main: 5,
};

// Типы, требующие исполняемый файл (путь в programPaths.json).
// Показываем статус в UI ресурсных пулов.
export const COLOR_TYPE_REQUIRES_EXECUTABLE: Record<string, string> = {
	afterEffect: 'afterEffect',
	moho: 'moho',
	ffmpeg: 'ffmpeg',
	ffprobe: 'ffprobe',
};

// Системные типы — всегда присутствуют после rescan, ffplay исключён.
export const COLOR_TYPE_SYSTEM: string[] = ['afterEffect', 'moho', 'ffmpeg', 'ffprobe', 'ai', 'aiLocal', 'helpers', 'main'];
export const COLOR_TYPE_EXCLUDED: string[] = ['ffplay'];

export const DEFAULT_APP_SETTINGS: AppSettings = {
	version: APP_SETTINGS_VERSION,
	processing: {
		maxParallel: 3,
	},
	scanSchedule: {
		minScanWaitMin: 3,
		maxScanWaitMin: 15,
		foldersDelayMs: 200,
	},
	resourcePools: {},
	storage: {
		localArchives: [],
		onlineDb: { enabled: false, url: '', templateId: 'database-sync' },
	},
	cleanup: {
		retentionDays: null,
		autoDisableDays: null,
	},
	logging: {
		bufferSize: 5000,
	},
	logs: {
		retentionDays: 2,
	},
};

export const DEFAULT_COLOR_TYPES: ColorTypesFile = {
	version: COLOR_TYPES_VERSION,
	types: [],
	lastScannedAt: null,
};
