/**
 * Tauri API adapter - заменяет window.electronAPI
 * Все вызовы к IPC идут через @tauri-apps/api invoke/listen
 */

import { invoke } from '@tauri-apps/api/core';
import { UnlistenFn } from '@tauri-apps/api/event';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { installGlobalPolyfills } from '@/PluginAPI/globals';
import { commands, unwrap } from '@/Utils/specta';

// Слушаем события только текущего webview-окна. `listen()` из `@tauri-apps/api/event`
// по умолчанию использует target { kind: 'Any' } и принимает события emit_to(),
// направленные ДРУГИМ окнам — из-за этого nodeWin получал данные preview, что приводило
// к созданию мусорных папок в src-tauri/. Window-scoped listen фильтрует по label
// нашего окна, при этом broadcast-эмиты (emit без target) тоже доходят.
const currentWebviewWindow = getCurrentWebviewWindow();

// Совместимость типов
interface IpcRendererEvent {
	type: string;
	payload: any;
}

type Listener = (event: any, ...args: any[]) => void;

// Хранилище слушателей
const eventListeners = new Map<string, Set<Listener>>();
const unlistenFns = new Map<string, UnlistenFn[]>();

// Глобальный пул pending listen() промисов.
// `listen()` из @tauri-apps/api/event возвращает Promise<UnlistenFn>, который резолвится
// ПОСЛЕ того, как нативный обработчик подписан на канал. Если invoke() уходит в Rust
// и Rust сразу эмитит событие — listener может ещё не быть активен, и эмит теряется.
// Поэтому invoke/send ждут, пока все pending listens зарегистрируются.
const pendingListens: Set<Promise<unknown>> = new Set();

async function waitForPendingListens(): Promise<void> {
	if (pendingListens.size === 0) return;
	await Promise.allSettled(Array.from(pendingListens));
}

/**
 * Маппинг аргументов (позиционные → именованные для Tauri)
 */
const argMappers: Record<string, (...args: any[]) => any> = {
	// Path: pathJoin/Basename/Dirname/Extname/Parse/Relative мигрированы на tauri-specta
	// (commands.path* + unwrap из @/Utils/specta) — мапперы не нужны.
	// Files
	getFileInfo: (path) => ({ path }),
	getFileTypeByExtname: (path) => {
		// Извлекаем расширение из пути
		const ext = path.split('.').pop() || '';
		return { ext };
	},
	testAndCreateFolder: (path) => ({ path }),
	testAndCreateFolders: (paths) => ({ paths }),
	renameFolder: (oldPath, newPath) => ({ oldPath, newPath }),
	setPathMtime: (path, mtimeMs) => ({ path, mtimeMs }),
	copyItem: (sourcePath, destinationPath, options?) => ({ sourcePath, destinationPath, ...(options ? { options } : {}) }),
	moveItem: (sourcePath, destinationPath, options?) => ({ sourcePath, destinationPath, ...(options ? { options } : {}) }),
	deleteItem: (itemPath) => ({ itemPath }),
	// moveToErrors мигрирован на commands.moveToErrors — маппер не нужен.
	// IO
	readFileSync: (filePath) => ({ filePath }),
	readMediaPreview: (filePath) => ({ filePath }),
	read_media_preview: (filePath) => ({ filePath }),
	writeFile: (filePath, content) => ({ filePath, content }),
	write_binary_file: (filePath: string, dataB64: string) => ({ filePath, dataB64 }),
	getSomeFromFolder: (path, search?) => ({ path, ...(search ? { search } : {}) }),
	listSubfolders: (paths) => ({ paths }),
	recursiveFindFiles: (path, search?) => ({ path, ...(search ? { search } : {}) }),
	// Check
	checkFilePath: (path, name?) => ({ path, ...(name ? { name } : {}) }),
	checkFolderPath: (path, name?) => ({ path, ...(name ? { name } : {}) }),
	// Plugins dev path (for PluginBuilderWin)
	getPluginsDevPath: () => ({}),
	// Fonts
	fontsGetList: () => ({}),
	fontsLoadOne: (fontPath) => ({ fontPath }),
	// Shell
	shellOpenPath: (folderPath) => ({ folderPath }),
	// Watch: fsWatchStart/fsWatchStop мигрированы на tauri-specta (commands.*) — маппер не нужен.
	// Preview
	// preview:* мигрированы на tauri-specta (commands.preview* + unwrap) — мапперы не нужны.
	// Window
	openNodeWindow: (data) => ({ data }),
	// Processing
	killAllExecProcesses: () => ({}),
	setStatusBar: (text) => ({ text }),
	sendLog: (level, text) => ({ level, text }),
	// abortProcessing/processItem/sendNode*/sendProcessComplete мигрированы на commands.* — мапперы не нужны.
	// (setStatusBar/sendLog оставлены — плагинные.)
	// Dialog: selectFolders/selectFiles/copyToClipboard/showInFolder/openFileWithDefaultApp/
	// createFolder/renameFile/getNodeObjFromFile/saveFlowToOptionsFolder/getPathsFromFiles
	// мигрированы на tauri-specta (commands.* + unwrap) — мапперы не нужны.
	requestDataPreview: () => ({}),
	openDevTools: () => ({}),
	openUrl: (url) => ({ url }),
	// Window state
	// saveWindowState/loadWindowState мигрированы на tauri-specta (commands.*) — мапперы не нужны.
	// FFmpeg
	ffmpeg_get_path: () => ({}),
	ffprobe_get_path: () => ({}),
	ffprobe_get_info: (filePath: string) => ({ filePath }),
	ffmpeg_get_video_thumbnail: (filePath: string, timestampSec?: number) => ({ filePath, timestampSec }),
	ffmpeg_exec_with_progress: (args: any) => args,
	read_media_preview_with_ffmpeg: (filePath: string) => ({ filePath }),
	// After Effects
	run_script_in_ae: (args: any) => args,
	launch_ae_with_script: (aePath: string, scriptPath: string) => ({ aePath, scriptPath }),
	// Plugins
	plugin_manager_init: () => ({}),
	plugin_manager_load_plugin: (folderName) => ({ folderName }),
	plugin_manager_unload_plugin: (pluginId, version) => ({ pluginId, version }),
	plugin_manager_get_all_plugins: () => ({}),
	plugin_manager_get_plugins_by_type: (type) => ({ type }),
	plugin_manager_get_plugin: (pluginId, version?) => ({ pluginId, ...(version ? { version } : {}) }),
	plugin_manager_get_plugin_ui: (pluginId, version) => ({ pluginId, version }),
	plugin_manager_get_all_ui_nodes: () => ({}),
	plugin_manager_get_ui_nodes: () => ({}),
	plugin_manager_list: () => ({}),
	plugin_manager_get_state: () => ({}),
	plugin_manager_call: (pluginId, version, method, ...methodArgs) => ({ pluginId, version, method, args: methodArgs }),
	plugin_manager_install: (filePath) => ({ filePath }),
	plugin_manager_delete: (pluginId, version) => ({ pluginId, version }),
	plugin_manager_destroy: () => ({}),
	// App settings / Color types / File types / Program paths — мигрированы на tauri-specta
	// (commands.* + unwrap из @/Utils/specta). Мапперы не нужны.
	// Docs
	// docs_list/docs_read мигрированы на tauri-specta (commands.docsList/docsRead) — мапперы не нужны.
	// Log window: log_window_* мигрированы на tauri-specta (commands.logWindow*) — мапперы не нужны.
	// (мёртвые toggle/get_status/open_quick/open_errors_only/emit_item_start/console остаются snake-командами.)
	// log_archive_* мигрированы на tauri-specta (commands.logArchive*) — мапперы не нужны.
	diag_log_write: (msg: string) => ({ msg }),
	diag_log_path: () => ({}),
	diag_log_clear: () => ({}),
	createTextFile: (path: string) => ({ path }),
	ensure_and_read_dir: (path: string) => ({ path }),
	get_stat: (path: string) => ({ path }),
	path_exists: (path: string) => ({ path }),
	os_tmpdir: () => ({}),
	hash_file: (path: string, algo?: string) => ({ path, algo }),
	// cleanup_auto_delete/db_register_found мигрированы на commands.* — мапперы не нужны.
	// HTTP via Rust (no CORS)
	// Tauri сопоставляет аргументы по имени параметра Rust-функции.
	// Все три команды объявлены как fn http_xxx(args: ...) → оборачиваем в { args }.
	http_fetch: (args: any) => ({ args }),
	http_upload: (args: any) => ({ args }),
	http_download: (args: any) => ({ args }),
	// fn exec_command(args: ExecCommandArgs) — тоже единственный параметр `args`.
	exec_command: (args: any) => ({ args }),
};

// Алиасы: фронтенд имена → Rust имена
const commandAliases: Record<string, string> = {
	'plugins:get-all-plugins': 'plugin_manager_get_all_plugins',
	'plugins:get-all-ui-nodes': 'plugin_manager_get_all_ui_nodes',
	'plugins:get-plugins-by-type': 'plugin_manager_get_plugins_by_type',
	'plugins:get-plugin': 'plugin_manager_get_plugin',
	'plugins:load-plugin': 'plugin_manager_load_plugin',
	'plugins:unload-plugin': 'plugin_manager_unload_plugin',
	'plugins:get-state': 'plugin_manager_get_state',
	'plugins:get-plugin-ui': 'plugin_manager_get_plugin_ui',
	'plugins:call': 'plugin_manager_call',
	'plugins:get-ui-nodes': 'plugin_manager_get_ui_nodes',
	'plugins:list': 'plugin_manager_list',
	'plugins:install': 'plugin_manager_install',
	'plugins:delete': 'plugin_manager_delete',
	getUserDataPath: 'getOptionsFolder',
	'shell:openPath': 'shellOpenPath',
	'request-data': 'request_data',
	requestData: 'request_data',
	openDevTools: 'open_devtools',
	open_dev_tools: 'openDevTools',
	'open-node-window': 'openNodeWindow',
	// 'abort-processing'/'process-item' мигрированы на commands.* (abortProcessing).
	'exec-command': 'exec_command',
	'kill-all-exec-processes': 'killAllExecProcesses',
	// 'fs-watch:start'/'fs-watch:stop' мигрированы на tauri-specta (commands.fsWatchStart/Stop).
	// preview:* мигрированы на tauri-specta (commands.preview*).
	'read-media-preview': 'read_media_preview',
	// Fonts
	'fonts:get-list': 'fontsGetList',
	'fonts:load-one': 'fontsLoadOne',
	// App settings / Color types / File types / Program paths — мигрированы на tauri-specta (commands.*).
	// Docs
	// 'docs:list'/'docs:read' мигрированы на tauri-specta (commands.docsList/docsRead).
	// Log window: 'log-window:*' мигрированы на tauri-specta (commands.logWindow*).
	// 'logs:*' мигрированы на tauri-specta (commands.logArchive*).
	// Диагностический лог для отладки зависания LogApp (см. src-tauri/src/commands/diag_log.rs).
	'diag:log': 'diag_log_write',
	'diag:log-path': 'diag_log_path',
	'diag:log-clear': 'diag_log_clear',
	// Misc PROCESSING channels
	createTextFile: 'createTextFile',
	// moveToErrors мигрирован на commands.moveToErrors.
	ensureAndReadDir: 'ensure_and_read_dir',
	get_stat: 'get_stat',
	os_tmpdir: 'os_tmpdir',
	hash_file: 'hash_file',
	// 'cleanup:auto-delete'/'db:registerFound' мигрированы на commands.* (cleanupAutoDelete/dbRegisterFound).
};

/**
 * Универсальный invoke. Перед вызовом ждём регистрации всех ожидающих listen()'ов,
 * чтобы Rust-эмит на канал, на который сейчас подписывается React, не потерялся.
 */
async function tauriInvoke<T = unknown>(channel: string, ...args: any[]): Promise<T> {
	console.log(`[Tauri Invoke] ${channel}`, args);
	try {
		await waitForPendingListens();
		// Разрешаем алиас
		const actualChannel = commandAliases[channel] || channel;

		// Используем маппер если есть
		const mapper = argMappers[actualChannel] || argMappers[channel];
		const payload = mapper ? mapper(...args) : args.length === 1 ? args[0] : { args };

		console.log(`[Tauri Payload] ${actualChannel}`, JSON.stringify(payload));
		const result = await invoke<T>(actualChannel, payload);
		return result;
	} catch (error) {
		console.error(`[Tauri Invoke Error] ${channel}`, error);
		throw error;
	}
}

/**
 * Подписка на событие. Промис от `listen()` регистрируется в `pendingListens` —
 * `tauriInvoke`/`tauriSend` ждут его перед своими вызовами в Rust.
 */
function tauriOn(channel: string, listener: Listener): void {
	if (!eventListeners.has(channel)) {
		eventListeners.set(channel, new Set());
	}
	eventListeners.get(channel)!.add(listener);

	// Резервируем слот СИНХРОННО — иначе второй tauriOn (например, при StrictMode
	// mount→cleanup→remount) успеет проскочить проверку `!has(channel)` пока первый
	// listen() ещё в полёте, и зарегистрируется ДВА Tauri-подписчика на один канал.
	// Результат — все события приходят дважды.
	if (!unlistenFns.has(channel)) {
		unlistenFns.set(channel, []);
		const p = currentWebviewWindow.listen(channel, (event) => {
			const listeners = eventListeners.get(channel);
			if (listeners) {
				listeners.forEach((cb) => cb(event, event.payload));
			}
		});
		pendingListens.add(p);
		p.then((unlisten) => {
			pendingListens.delete(p);
			unlistenFns.get(channel)!.push(unlisten);
		}).catch((err) => {
			pendingListens.delete(p);
			// Subscribe не получился — освобождаем слот, чтобы следующий tauriOn мог попробовать заново.
			if (unlistenFns.get(channel)?.length === 0) {
				unlistenFns.delete(channel);
			}
			console.error(`[Tauri listen] failed to subscribe to '${channel}':`, err);
		});
	}
}

/**
 * Отписка от события
 */
function tauriOff(channel: string, listener?: Listener): void {
	if (listener) {
		const listeners = eventListeners.get(channel);
		if (listeners) {
			listeners.delete(listener);
		}
	} else {
		eventListeners.delete(channel);
	}
}

/**
 * Отправка события (без ожидания ответа).
 * Ждёт pending listen()'ы перед invoke — чтобы Rust-эмиты не терялись.
 */
function tauriSend(channel: string, ...args: any[]): void {
	const actualChannel = commandAliases[channel] || channel;
	const mapper = argMappers[actualChannel] || argMappers[channel];
	const payload = mapper ? mapper(...args) : args.length === 1 ? args[0] : { args };

	waitForPendingListens().then(() =>
		invoke(actualChannel, payload).catch((err) => {
			console.error(`[Tauri Send Error] ${channel}`, err);
		}),
	);
}

/**
 * Logger объект
 */
const tauriLogger = {
	info: (message: string, meta?: any) => {
		console.log(`[INFO] ${message}`, meta);
		tauriSend('log-message', { level: 'info', message, meta });
	},
	warn: (message: string, meta?: any) => {
		console.warn(`[WARN] ${message}`, meta);
		tauriSend('log-message', { level: 'warn', message, meta });
	},
	error: (message: string, meta?: any) => {
		console.error(`[ERROR] ${message}`, meta);
		tauriSend('log-message', { level: 'error', message, meta });
	},
	debug: (message: string, meta?: any) => {
		console.debug(`[DEBUG] ${message}`, meta);
		tauriSend('log-message', { level: 'debug', message, meta });
	},
};

/**
 * Plugins API объект
 */
const tauriPlugins = {
	installPlugin: (filePath: string) => tauriInvoke<any>('plugin_manager_install', filePath),
	deletePlugin: (pluginId: string, version: string) => tauriInvoke<boolean>('plugin_manager_delete', pluginId, version),
	getAllPlugins: () => tauriInvoke<any[]>('plugin_manager_get_all_plugins'),
	getAllUINodes: () => tauriInvoke<any[]>('plugin_manager_get_all_ui_nodes'),
	getPluginsByType: (type: string) => tauriInvoke<any[]>('plugin_manager_get_plugins_by_type', type),
	getPlugin: (pluginId: string, version?: string) => tauriInvoke<any | null>('plugin_manager_get_plugin', pluginId, version),
	loadPlugin: (folderName: string) => tauriInvoke<boolean>('plugin_manager_load_plugin', folderName),
	unloadPlugin: (pluginId: string, version: string) => tauriInvoke<boolean>('plugin_manager_unload_plugin', pluginId, version),
	getPluginUI: (pluginId: string, version: string) =>
		tauriInvoke<any | null>('plugin_manager_get_plugin_ui', pluginId, version),
	getState: () =>
		tauriInvoke<{
			initialized: boolean;
			pluginsCount: number;
			uiPluginsCount: number;
			pluginsPath: string;
			isDev: boolean;
		}>('plugin_manager_get_state'),
	getUINodes: () => tauriInvoke<any[]>('plugin_manager_get_ui_nodes'),
	list: () => tauriInvoke<any[]>('plugin_manager_list'),
	call: (pluginId: string, version: string, method: string, ...args: any[]) =>
		tauriInvoke<any>('plugin_manager_call', pluginId, version, method, args),
	init: () => tauriInvoke<boolean>('plugin_manager_init'),
	destroy: () => tauriInvoke<void>('plugin_manager_destroy'),
};

/**
 * Основной Tauri API объект
 */
export const tauriAPI = {
	// Обработчики событий
	onUpdateData: (callback: (event: IpcRendererEvent, data: any) => void) => {
		tauriOn('update-data', callback);
	},
	requestData: () => tauriSend('request-data'),
	removeUpdateData: (callback: (event: IpcRendererEvent, data: any) => void) => {
		tauriOff('update-data', callback);
	},
	requestNodeWindowData: () => tauriInvoke('requestNodeWindowData'),
	openNodeWindow: (arg: string) => tauriInvoke('open-node-window', arg),

	// Универсальные IPC методы
	invoke: tauriInvoke,
	on: tauriOn,
	off: tauriOff,
	send: tauriSend,

	// Dialog & Shell: мигрированы на tauri-specta (commands.* + unwrap из @/Utils/specta).
	// openDevTools оставлен — это window_commands.open_devtools (отдельная команда, не dialog).
	openDevTools: () => tauriInvoke<void>('open_devtools'),

	// Логирование
	sendRendererLog: (payload: { level: 'info' | 'warn' | 'error' | 'debug'; message: string; meta?: any }) => {
		tauriSend('renderer-log', payload);
	},
	onProcessingEvent: (callback: (event: { type: string; payload: any }) => void) => {
		// tauriOn вызывает cb(tauriEvent, tauriEvent.payload).
		// Rust-структура ProcessingEvent сериализуется как { type, payload }
		// (поле event_type переименовано через #[serde(rename = "type")]).
		// rawPayload уже имеет нужную форму — передаём напрямую.
		const wrapped = (_rawEvent: any, rawPayload: any) => {
			if (rawPayload?.type) callback(rawPayload);
		};
		(callback as any).__tauriWrapped = wrapped;
		tauriOn('processing-event', wrapped);
		return {} as any;
	},
	removeProcessingEvent: (callback: (event: { type: string; payload: any }) => void) => {
		const wrapped = (callback as any).__tauriWrapped;
		tauriOff('processing-event', wrapped ?? callback);
	},

	onFsChanged: (callback: (changedPath: string) => void) => {
		tauriOn('fs-changed', (_event: any, path: string) => callback(path));
		return () => tauriOff('fs-changed');
	},

	getPathForFile: (file: File) => {
		return (file as any).path || '';
	},

	// Логгер
	logger: tauriLogger,

	// Окно логов: log_window_* мигрированы на tauri-specta (commands.logWindow*) —
	// мёртвый объект logWindow удалён.

	// Консоль
	interceptConsole: () => {
		console.log('[Tauri] interceptConsole is not needed');
	},
	restoreConsole: () => {
		console.log('[Tauri] restoreConsole is not needed');
	},

	// FFmpeg
	ffmpegGetPath: () => tauriInvoke<string>('ffmpeg_get_path'),
	ffprobeGetPath: () => tauriInvoke<string>('ffprobe_get_path'),
	ffprobeGetInfo: (filePath: string) => tauriInvoke<string>('ffprobe_get_info', filePath),
	ffmpegGetVideoThumbnail: (filePath: string, timestampSec?: number) =>
		tauriInvoke<string>('ffmpeg_get_video_thumbnail', filePath, timestampSec),
	ffmpegExecWithProgress: (args: { args: string[]; durationSec?: number; nodeId?: string; statusText?: string }) =>
		tauriInvoke<any>('ffmpeg_exec_with_progress', args),
	readMediaPreviewWithFfmpeg: (filePath: string) => tauriInvoke<string>('read_media_preview_with_ffmpeg', filePath),

	// After Effects
	runScriptInAE: (args: {
		aePath: string;
		scriptPath: string;
		inObj: Record<string, any>;
		tempDir?: string;
		keepTempFiles?: boolean;
		timeoutSec?: number;
	}) => tauriInvoke<{ success: boolean; data?: any; error?: string }>('run_script_in_ae', args),
	launchAEWithScript: (aePath: string, scriptPath: string) => tauriInvoke<void>('launch_ae_with_script', aePath, scriptPath),

	// Процессинг
	abortProcessing: () => tauriInvoke<void>('abortProcessing'),
	killAllExecProcesses: () => tauriInvoke<void>('kill-all-exec-processes'),
	execCommand: (args: { cmd: string; args: string[]; cwd?: string; nodeId?: string; env?: [string, string][] }) =>
		tauriInvoke<any>('exec-command', args),
	isProcessingAborted: () => tauriInvoke<boolean>('isProcessingAborted'),
	resetProcessingSignal: () => tauriInvoke<void>('resetProcessingSignal'),
	setProcessingProgress: (currentStep: string, total: number, completed: number) =>
		tauriInvoke<void>('setProcessingProgress', currentStep, total, completed),
	getProcessingProgress: () => tauriInvoke<any>('getProcessingProgress'),
	addProcessingError: (error: string) => tauriInvoke<void>('addProcessingError', error),
	moveToErrors: (itemPath: string, projectPath: string) => tauriInvoke<any>('moveToErrors', itemPath, projectPath),
	processingDeleteItem: (itemPath: string) => tauriInvoke<boolean>('processingDeleteItem', itemPath),
	pathExists: (path: string) => tauriInvoke<boolean>('pathExists', path),
	getItemInfo: (path: string) => tauriInvoke<any>('getItemInfo', path),
	processItem: (item: any) => tauriInvoke<any>('processItem', item),
	setStatusBar: (text: string) => tauriInvoke<void>('setStatusBar', text),
	sendLog: (level: string, text: string) => tauriInvoke<void>('sendLog', level, text),
	sendNodeStart: (nodeId: string) => tauriInvoke<void>('sendNodeStart', nodeId),
	sendNodeDone: (nodeId: string, output: any) => tauriInvoke<void>('sendNodeDone', nodeId, output),
	sendNodeError: (nodeId: string, message: string) => tauriInvoke<void>('sendNodeError', nodeId, message),
	sendProcessComplete: () => tauriInvoke<void>('sendProcessComplete'),

	// Window state: мигрирован на tauri-specta (commands.saveWindowState/loadWindowState).
	// Сохранение зовётся напрямую из windowAutoSave.ts; загрузка — в Rust на старте.

	// hasErrors/getRecentLogs/getErrors удалены (мёртвые; log_window_* мигрированы на commands.*).
};

/**
 * Docs API объект (window.docs)
 */
const tauriDocs = {
	list: () => commands.docsList().then(unwrap),
	read: (sectionName: string, fileName: string) => commands.docsRead(sectionName, fileName).then(unwrap),
};

/**
 * Templates API объект (window.templates) — статичный список встроенных шаблонов
 * сохранения результатов обработки (локальный архив, синхронизация с БД, агрегаты).
 *
 * В Electron-эре это был IPC-вызов в `electron/main/templates/registry.ts`. В
 * Tauri-порте сама логика записи шаблонов ещё не портирована, но dropdown в
 * настройках должен показывать имена. Этот список синхронизирован с
 * `electron/main/templates/registry.ts` (id/label оттуда же).
 */
const BUILTIN_TEMPLATES: Array<{ id: string; label: string }> = [
	{ id: 'local-archive', label: 'Локальный архив (JSONL)' },
	{ id: 'database-sync', label: 'Синхронизация с БД' },
	{ id: 'total-by-project', label: 'Всего по проектам' },
	{ id: 'by-year', label: 'По годам' },
	{ id: 'by-month', label: 'По месяцам' },
	{ id: 'by-week', label: 'По неделям' },
	{ id: 'by-day', label: 'По дням' },
];

const tauriTemplates = {
	list: async () => BUILTIN_TEMPLATES.slice(),
	getErrors: async () =>
		[] as Array<{
			timestamp: string;
			templateLabel: string;
			error: { message: string };
		}>,
};

/**
 * Инициализация
 */
export async function initTauriAPI() {
	if (typeof window !== 'undefined') {
		// Глобальные полифилы (`process`, `Buffer`, `global`) — должны быть установлены
		// ДО загрузки любого плагина через plugin:// протокол.
		installGlobalPolyfills();

		(window as any).electronAPI = tauriAPI;
		(window as any).log = tauriAPI.logger;
		(window as any).invoke = tauriAPI.invoke;
		(window as any).plugins = tauriPlugins;
		(window as any).docs = tauriDocs;
		(window as any).templates = tauriTemplates;
		console.log('[Tauri API] Initialized');

		// Плагины грузятся один раз в Tauri setup() на старте процесса,
		// до открытия любого окна. Поэтому здесь plugin_manager_init не дёргаем —
		// иначе бы получили N перезагрузок (по числу renderer-окон).
	}
}

export type TauriAPI = typeof tauriAPI;
