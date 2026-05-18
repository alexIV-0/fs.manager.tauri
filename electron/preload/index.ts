import { contextBridge, ipcRenderer } from 'electron';

// ====== Определяем тип окна ======
const getWindowType = (): string => {
	const pathname = window.location.pathname;
	if (pathname.includes('logWindow')) return 'logWindow';
	if (pathname.includes('nodeWin')) return 'nodeWindow';
	return 'mainWindow';
};
const windowType = getWindowType();

// ====== Обработка событий из main ======
const processingEventCallbacks = new Map<
	(event: { type: string; payload: any }) => void,
	(event: Electron.IpcRendererEvent, data: { type: string; payload: any }) => void
>();

// ====== Экспонируем API ======
contextBridge.exposeInMainWorld('electronAPI', {
	on: (...args: Parameters<typeof ipcRenderer.on>) => ipcRenderer.on(...args),
	off: (...args: Parameters<typeof ipcRenderer.off>) => ipcRenderer.off(...args),
	send: (...args: Parameters<typeof ipcRenderer.send>) => ipcRenderer.send(...args),
	invoke: (...args: Parameters<typeof ipcRenderer.invoke>) => ipcRenderer.invoke(...args),

	requestData: () => ipcRenderer.send('request-data'),
	onUpdateData: (callback: (event: Electron.IpcRendererEvent, data: any) => void) => ipcRenderer.on('update-data', callback),
	removeUpdateData: (callback: (event: Electron.IpcRendererEvent, data: any) => void) =>
		ipcRenderer.removeListener('update-data', callback),

	onDrop: (callback: (event: Electron.IpcRendererEvent, ...args: any[]) => void) => ipcRenderer.on('ondrop', callback),

	openDevTools: () => ipcRenderer.invoke('open-devtools'),

	windowInfo: { type: windowType, url: window.location.href },

	// События процесса
	onProcessingEvent: (callback: (event: { type: string; payload: any }) => void) => {
		const wrapper = (event: Electron.IpcRendererEvent, data: { type: string; payload: any }) => callback(data);
		processingEventCallbacks.set(callback, wrapper);
		return ipcRenderer.on('processing:event', wrapper);
	},
	removeProcessingEvent: (callback: (event: { type: string; payload: any }) => void) => {
		const wrapper = processingEventCallbacks.get(callback);
		if (wrapper) {
			ipcRenderer.off('processing:event', wrapper);
			processingEventCallbacks.delete(callback);
		}
	},

	getFileTypeByExtension: (extension: string) =>
		new Promise((resolve) => {
			const requestId = Math.random().toString(36).substring(2, 9);
			ipcRenderer.once(`file-type-response-${requestId}`, (_, { fileType }) => resolve(fileType));
			ipcRenderer.send('get-file-type', { extension, requestId });
		}),

	// Слежка за файловой системой (файловый менеджер)
	onFsChanged: (callback: (changedPath: string) => void) => {
		const wrapper = (_event: Electron.IpcRendererEvent, changedPath: string) => callback(changedPath);
		ipcRenderer.on('fs:changed', wrapper);
		return () => ipcRenderer.off('fs:changed', wrapper);
	},

	getPathForFile: (file: File): string => {
		const { webUtils } = require('electron');
		return webUtils.getPathForFile(file);
	},
});

// 🔥 ДОБАВЬ API ДЛЯ ПЛАГИНОВ
contextBridge.exposeInMainWorld('plugins', {
	// Основные методы
	getAllPlugins: () => ipcRenderer.invoke('plugins:get-all-plugins'),
	getAllUINodes: () => ipcRenderer.invoke('plugins:get-all-ui-nodes'),
	getPluginsByType: (type: string) => ipcRenderer.invoke('plugins:get-plugins-by-type', type),

	// Расширенные методы
	installPlugin: (filePath: string) => ipcRenderer.invoke('plugins:install', filePath),
	deletePlugin: (pluginId: string, version: string) => ipcRenderer.invoke('plugins:delete', pluginId, version),
	setPluginCost: (pluginId: string, version: string, cost: string, costUnit: string) =>
		ipcRenderer.invoke('plugins:set-cost', pluginId, version, cost, costUnit),
	getPlugin: (pluginId: string, version?: string) => ipcRenderer.invoke('plugins:get-plugin', pluginId, version),
	loadPlugin: (folderName: string) => ipcRenderer.invoke('plugins:load-plugin', folderName),
	unloadPlugin: (pluginId: string, version: string) => ipcRenderer.invoke('plugins:unload-plugin', pluginId, version),
	getPluginUI: (pluginId: string, version: string) => ipcRenderer.invoke('plugins:get-plugin-ui', pluginId, version),
	getState: () => ipcRenderer.invoke('plugins:get-state'),

	// Для обратной совместимости
	getUINodes: () => ipcRenderer.invoke('plugins:get-all-ui-nodes'),
	list: () => ipcRenderer.invoke('plugins:get-all-plugins'),
	call: (pluginId: string, version: string, method: string, ...args: any[]) =>
		ipcRenderer.invoke('plugins:call', pluginId, version, method, ...args),
});

// ====== API документации ======
contextBridge.exposeInMainWorld('docs', {
	list: () => ipcRenderer.invoke('docs:list'),
	read: (sectionName: string, fileName: string) => ipcRenderer.invoke('docs:read', sectionName, fileName),
});

// ====== API шаблонов сохранения ======
contextBridge.exposeInMainWorld('templates', {
	list: () => ipcRenderer.invoke('templates:list'),
	getErrors: () => ipcRenderer.invoke('templates:get-errors'),
});

// Перехватываем drop из OS на уровне preload где есть доступ к file.path
window.addEventListener(
	'drop',
	(e) => {
		const files = Array.from(e.dataTransfer?.files || []);
		if (files.length === 0) return;
		const paths = files.map((f: any) => ({
			name: f.name,
			path: f.path,
		}));
		window.dispatchEvent(
			new CustomEvent('os-file-drop', {
				detail: { paths, x: e.clientX, y: e.clientY },
			}),
		);
	},
	true,
);
