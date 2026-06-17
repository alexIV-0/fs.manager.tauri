// global.d.ts — ambient-типы Tauri API: глобал window.tauriAPI + общие типы плагинов/UI.

// ==================== БАЗОВЫЕ ТИПЫ ====================
export interface PluginManifest {
	id: string;
	name: string;
	description: string;
	version: string;
	apiVersion: number;
	type: string[];
	main: string;
	ui?:
		| string
		| {
				data?: {
					colorType?: string;
					[key: string]: any;
				};
				[key: string]: any;
		  };
	external: string[];
	/** Ресурсный пул (local/online/ffmpeg/helpers); не задан — дефолт по colorType. */
	resourcePool?: string;
}

export interface PluginInfo {
	id: string;
	version: string;
	name: string;
	description: string;
	type: string[];
	hasUI: boolean;
	path: string;
	manifest: PluginManifest;
	uiType?: string | null;
	cost?: string;
	costUnit?: string;
}
export interface ExtendedPluginUINode extends PluginUINode {
	pluginId?: string;
	pluginVersion?: string;
	pluginPath?: string;
	pluginName?: string;
	uiType?: string | null;
}
export interface PluginUINode {
	id: string;
	type: string;
	position: { x: number; y: number };
	width: number;
	height: number;

	// Метаданные плагина
	pluginId?: string;
	pluginVersion?: string;
	pluginPath?: string;
	pluginName?: string;
	uiType?: string | null;
	data: {
		label: string;
		comment?: string;
		colorType?: string;
		properties: Array<{
			id: string;
			controlType: string;
			controlProps: Record<string, any>;
			outputType: string;
			isOutput?: boolean;
			required?: boolean;
		}>;
		output?: {
			functionName?: string;
			sourceProperty?: string;
		};
		isUnique?: boolean;
		required?: boolean;
		isValid?: boolean;
		description?: string;
		inputs?: Array<{ name: string; type: string; defaultValue?: any }>;
		outputs?: Array<{ name: string; type: string }>;
		controls?: Array<{ name: string; type: string; options?: any[]; defaultValue?: any }>;
		category?: string;
	};
	deletable?: boolean;
}

// ==================== ТИПЫ ДЛЯ ЗАГРУЖЕННЫХ ПЛАГИНОВ ====================
export interface LoadedPlugin {
	key: string;
	id: string;
	version: string;
	manifest: PluginManifest;
	module: any;
	path: string;
}

// ==================== ТИПЫ ДЛЯ СТОРА ====================
export interface StorePluginItem extends PluginInfo {
	enable: boolean;
	uiData?: ExtendedPluginUINode[];
}

// ==================== API ПЛАГИНОВ ====================
export interface PluginAPI {
	pluginId: string;
	version: string;
	log: (...args: any[]) => void;
	getPluginPath: () => string;
}

// ==================== EVENT TYPES ====================
export interface TauriEvent {
	type: string;
	payload: any;
}

// ==================== ОСНОВНОЙ INTERFACE ====================
export interface ITauriAPI {
	// Обработчики событий
	onUpdateData: (callback: (event: TauriEvent, data: any) => void) => void;
	requestData: () => void;
	removeUpdateData: (callback: (event: TauriEvent, data: any) => void) => void;
	openNodeWindow(arg0: string): void;

	// Универсальные IPC методы
	invoke: <T = unknown>(channel: string, ...args: any[]) => Promise<T>;
	on: (channel: string, listener: (event: any, ...args: any[]) => void) => void;
	off: (channel: string, ...args: any[]) => void;
	send: (channel: string, ...args: any[]) => void;

	// DevTools (в Tauri не поддерживается напрямую)
	openDevTools: () => Promise<void>;

	// Логирование
	sendRendererLog: (payload: { level: 'info' | 'warn' | 'error' | 'debug'; message: string; meta?: any }) => void;
	onProcessingEvent: (callback: (event: { type: string; payload: any }) => void) => any;
	removeProcessingEvent: (callback: (event: { type: string; payload: any }) => void) => void;

	onFsChanged: (callback: (changedPath: string) => void) => () => void;

	getPathForFile: (file: File) => string;
	// Логгер
	logger: {
		info: (message: string, meta?: any) => void;
		warn: (message: string, meta?: any) => void;
		error: (message: string, meta?: any) => void;
		debug: (message: string, meta?: any) => void;
	};

	// Окно логов
	logWindow: {
		open: () => Promise<boolean>;
		toggle: () => Promise<boolean>;
		close: () => Promise<boolean>;
		getStatus: () => Promise<{
			isOpen: boolean;
			isVisible: boolean;
			logCount: number;
			stats: {
				total: number;
				errors: number;
				warnings: number;
				infos: number;
				debugs: number;
			};
		}>;
		getHistory: () => Promise<{
			logs: Array<any>;
			stats: any;
		}>;
		clear: () => Promise<boolean>;
		export: (format?: 'txt' | 'json') => Promise<string | null>;
		openQuick: () => Promise<boolean>;
		openErrorsOnly: () => Promise<boolean>;
	};

	// Консоль
	interceptConsole: () => void;
	restoreConsole: () => void;

	// Утилиты
	hasErrors: () => Promise<boolean>;
	getRecentLogs: (count?: number) => Promise<Array<any>>;
	getErrors: () => Promise<Array<any>>;
}

// ==================== ГЛОБАЛЬНОЕ ОБЪЯВЛЕНИЕ ====================
declare global {
	interface Window {
		tauriAPI: ITauriAPI;
		log: typeof window.tauriAPI.logger;

		invoke: <T = unknown>(channel: string, ...args: any[]) => Promise<T>;

		// API для работы с плагинами
		plugins: {
			/** Установить плагин из .fsmplug файла */
			installPlugin(filePath: string): Promise<PluginInfo>;

			/** Удалить плагин с диска */
			deletePlugin(pluginId: string, version: string): Promise<boolean>;

			/** Получить все плагины */
			getAllPlugins(): Promise<PluginInfo[]>;

			/** Получить все UI ноды из плагинов */
			getAllUINodes(): Promise<PluginUINode[]>;

			/** Получить плагины по типу */
			getPluginsByType(type: string): Promise<PluginInfo[]>;

			/** Получить конкретный плагин */
			getPlugin(pluginId: string, version?: string): Promise<LoadedPlugin | null>;

			/** Загрузить плагин динамически */
			loadPlugin(folderName: string): Promise<boolean>;

			/** Выгрузить плагин */
			unloadPlugin(pluginId: string, version: string): Promise<boolean>;

			/** Получить UI данные конкретного плагина */
			getPluginUI(pluginId: string, version: string): Promise<PluginUINode | null>;

			/** Получить состояние плагин менеджера */
			getState(): Promise<{
				initialized: boolean;
				pluginsCount: number;
				uiPluginsCount: number;
				pluginsPath: string;
				isDev: boolean;
			}>;

			/** UI-ноды из ui.json плагинов (устаревшее, для обратной совместимости) */
			getUINodes(): Promise<PluginUINode[]>;

			/** Список всех загруженных плагинов (устаревшее, для обратной совместимости) */
			list(): Promise<PluginInfo[]>;

			/** Вызов processing-функции плагина */
			call(pluginId: string, version: string, method: string, ...args: any[]): Promise<any>;
		};

		// API для шаблонов сохранения результатов обработки (см. tauri-api.ts).
		templates: {
			/** Список встроенных шаблонов для dropdown в настройках. */
			list(): Promise<Array<{ id: string; label: string }>>;
			/** История ошибок выполнения шаблонов (пока возвращает []). */
			getErrors(): Promise<
				Array<{
					timestamp: string;
					templateLabel: string;
					error: { message: string };
				}>
			>;
		};

		// API для документации в плагин-окне (см. tauri-api.ts).
		docs: {
			list(): Promise<Array<{ name: string; files: Array<{ name: string; fileName: string }> }>>;
			read(sectionName: string, fileName: string): Promise<string>;
		};
	}

	// ==================== РАСШИРЕНИЕ ТИПОВ БРАУЗЕРА ====================
	// В Tauri файл может иметь path через invoke
	interface File {
		readonly path?: string;
	}
}

// Экспорт для использования в других файлах
export {};
