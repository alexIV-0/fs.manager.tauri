import { app, BrowserWindow, ipcMain } from 'electron';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { createAppWindow } from './createAppWindows';
import { registerIpcHandlers, stopAllWatchers } from './handlers';
import { windowManager } from './windowManager';
import { setPluginManager } from './pluginManagerRef';
import { processItem } from './processing/processItem';
import { abortProcessing, createAbortController } from './processing/processingController';
import { updateStoreCache } from './storeCache';
import { PluginManager } from './PluginManager';
import { getLogWindowManager } from './logWindow';
import { runWithSender } from './utilits/senderLogToMainWin';
import { getDbExporter } from './dbExporter';
import type { RegisterFoundPayload } from './dbExporter.types';
import { listDocs, readDoc } from './docsManager';
import { registerSettingsIpc } from './settings/ipc';
import {
	getPreviewBoundsForType,
	savePreviewBounds,
	setCurrentPreviewType,
	getCurrentPreviewType,
	setPreviewBoundsLocked,
	setShouldCenterOnNextResize,
	normalizePreviewType,
} from './previewBounds';

let pluginManager: PluginManager | null = null;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
process.env.APP_ROOT = path.join(__dirname, '../..');
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;
process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
	? path.join(process.env.APP_ROOT, 'Public')
	: path.join(process.env.APP_ROOT, 'dist');

if (os.release().startsWith('6.1')) app.disableHardwareAcceleration();
if (process.platform === 'win32') app.setAppUserModelId(app.getName());
if (!app.requestSingleInstanceLock()) {
	app.quit();
	process.exit(0);
}

const isDev = !!VITE_DEV_SERVER_URL;
const iconName = process.platform === 'darwin' ? 'fsManager.icns' : 'fsManager.ico';
const iconPath = isDev
	? path.join(process.env.APP_ROOT, 'Public', 'icons', iconName)
	: path.join(process.env.APP_ROOT, 'dist', 'icons', iconName);

let previewWindowData: string | null = null; // JSON с { filePath, fileType }
let previewWindowFilePath: string | null = null;

// ======== Создание окон ========
async function createMainWindow() {
	const mainHtml = isDev ? VITE_DEV_SERVER_URL! : path.join(process.env.APP_ROOT, 'dist', 'index.html');

	const mainWin = createAppWindow({
		storeKey: 'mainWin',
		title: 'Главное окно',
		icon: iconPath,
		devTools: false,
		loadFilePath: mainHtml,
	});
	windowManager.setMainWin(mainWin);

	// Запрещаем стандартное поведение drag & drop файлов из OS
	// (иначе Electron открывает файл как новую страницу)
	mainWin.webContents.on('will-navigate', (event, url) => {
		if (url.startsWith('file://')) {
			event.preventDefault();
		}
	});

	try {
		if (isDev) await mainWin.loadURL(mainHtml);
		else await mainWin.loadFile(mainHtml);
	} catch (err) {
		console.error('Ошибка при создании главного окна', err);
	}

	mainWin.on('closed', () => {
		windowManager.getNodeWin()?.close();
		windowManager.getPreviewWin()?.close();
		windowManager.setMainWin(null);
		app.quit();
	});
}

async function createNodeWindow(dataToSend?: string) {
	const existing = windowManager.getNodeWin();
	if (existing) {
		existing.focus();
		if (dataToSend) existing.webContents.send('update-data', dataToSend);
		return;
	}

	const nodeHtml = isDev ? `${VITE_DEV_SERVER_URL}/nodeWin.html` : path.join(process.env.APP_ROOT, 'dist', 'nodeWin.html');

	const nodeWin = createAppWindow({
		storeKey: 'nodeWin',
		title: 'Настройки узла',
		icon: iconPath,
		devTools: false,
		loadFilePath: nodeHtml,
		webSecurity: !isDev, // dev: false (file:// из http:// иначе блокируется CORS), prod: true
	});
	windowManager.setNodeWin(nodeWin);

	try {
		if (isDev) await nodeWin.loadURL(nodeHtml);
		else await nodeWin.loadFile(nodeHtml);
	} catch (err) {
		console.error('Ошибка при создании окна узла', err);
	}

	if (dataToSend) {
		nodeWin.webContents.once('did-finish-load', () => {
			windowManager.getNodeWin()?.webContents.send('update-data', dataToSend);
		});
	}

	nodeWin.on('closed', () => windowManager.setNodeWin(null));
}

async function createPreviewWindow(dataToSend: string) {
	const previewHtml = isDev
		? `${VITE_DEV_SERVER_URL}/previewWin.html`
		: path.join(process.env.APP_ROOT!, 'dist', 'previewWin.html');

	const preloadPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '../preload/index.mjs');
	const currentType = getCurrentPreviewType();
	const { bounds: initialBounds, hasSaved } = getPreviewBoundsForType(currentType);

	// Если уже есть сохранённые бунды для этого типа — блокируем preview:resize,
	// чтобы handler не центрировал окно и не сбрасывал размер.
	setPreviewBoundsLocked(hasSaved);
	// При первом создании окна без сохранённых бунд центрируем после fit-to-content.
	setShouldCenterOnNextResize(!hasSaved);

	const previewWin = new BrowserWindow({
		title: 'Preview',
		icon: iconPath,
		width: initialBounds.width,
		height: initialBounds.height,
		x: initialBounds.x,
		y: initialBounds.y,
		frame: false,
		backgroundColor: '#000',
		webPreferences: {
			preload: preloadPath,
			contextIsolation: true,
			nodeIntegration: false,
			// dev: false — file:// из http:// (Vite) иначе блокируется CORS
			// prod: true — renderer сам на file://, cross-origin не нужен
			webSecurity: !isDev,
		},
	});

	previewWin.removeMenu();

	windowManager.setPreviewWin(previewWin);

	// Сохраняем позицию/размер при изменении — под ключ текущего типа файла.
	// После первого пользовательского ресайза/мува считаем бунды зафиксированными
	// (preview:resize больше не должен центрировать или сбрасывать размер).
	const saveBounds = () => {
		const bounds = previewWin.getBounds();
		savePreviewBounds(getCurrentPreviewType(), bounds);
		setPreviewBoundsLocked(true);
	};
	previewWin.on('resize', saveBounds);
	previewWin.on('move', saveBounds);

	try {
		if (isDev) await previewWin.loadURL(previewHtml);
		else await previewWin.loadFile(previewHtml);
	} catch (err) {
		console.error('Ошибка при создании окна превью', err);
	}

	previewWin.webContents.once('did-finish-load', () => {
		previewWin.webContents.send('update-data', dataToSend);
	});

	previewWin.on('closed', () => {
		previewWindowFilePath = null;
		previewWindowData = null;
		setCurrentPreviewType('default');
		setPreviewBoundsLocked(false);
		windowManager.setPreviewWin(null);
	});
}

// ======== IPC ========
ipcMain.handle('db:registerFound', async (_event, payload: RegisterFoundPayload): Promise<string> => {
	return getDbExporter().registerFound(payload);
});

ipcMain.handle('process-item', async (event, item) => {
	const controller = createAbortController();
	const signal = controller.signal;
	const logMgr = getLogWindowManager();

	const send = (type: string, payload: any) => {
		if (!event.sender.isDestroyed()) {
			event.sender.send('processing:event', { type, payload });
		}
		const nodeWin = windowManager.getNodeWin();
		if (nodeWin && !nodeWin.isDestroyed() && nodeWin.webContents !== event.sender) {
			nodeWin.webContents.send('processing:event', { type, payload });
		}

		if (type === 'item:start') {
			logMgr.itemStart(payload.itemId, payload.itemName, payload.mainFolderName ?? '', payload.projectName ?? '', payload.steps ?? [], payload.dbItemId);
		} else if (type === 'item:end') {
			logMgr.itemEnd(payload.itemId, payload.status);
		} else if (type === 'node:start') {
			logMgr.nodeStart(payload.itemId, payload.nodeId);
		} else if (type === 'node:done') {
			logMgr.nodeDone(payload.itemId, payload.nodeId, payload.output);
		} else if (type === 'node:siteCost') {
			logMgr.nodeSiteCost(payload.itemId, payload.nodeId, payload.cost);
		} else if (type === 'node:error') {
			logMgr.nodeError(payload.itemId, payload.nodeId, payload.message);
		} else if (type === 'log') {
			logMgr.addItemLog(payload.level ?? 'info', payload.text ?? '', payload.meta, 'main', payload.itemId, payload.stepId);
		} else if (type === 'error') {
			logMgr.addItemLog('error', payload.message ?? String(payload), undefined, 'main', payload.itemId, payload.stepId);
		}
	};

	// Определяем itemId заранее для AsyncLocalStorage — плагины смогут вызвать sendToMW
	// и их логи автоматически привяжутся к этому item-у.
	// Ключ должен совпадать с тем, что отправил renderer в log-window:item-queued
	// (см. findFilesForSingleFolder.ts): dbItemId → pathForDelete:findTime → pathForDelete → id.
	const _desc = item?.description ?? {};
	const itemIdForCtx: string =
		_desc.dbItemId ??
		(_desc.pathForDelete && _desc.findTime ? `${_desc.pathForDelete}:${_desc.findTime}` : undefined) ??
		_desc.pathForDelete ??
		_desc.id ??
		String(Date.now());

	return await runWithSender({ send, itemId: itemIdForCtx }, () => processItem({ item, signal, send }));
});

ipcMain.handle('abort-processing', () => {
	abortProcessing();
});

ipcMain.handle('log-window:open', () => {
	getLogWindowManager().open();
});

let mainWindowData: string | null = null;

ipcMain.handle('open-node-window', async (_, data) => {
	mainWindowData = data;
	await createNodeWindow(data);
	return true;
});

ipcMain.handle('open-devtools', (event) => {
	const window = BrowserWindow.fromWebContents(event.sender);
	if (window) {
		window.webContents.openDevTools();
		return true;
	}
	return false;
});

ipcMain.on('request-data', (event) => {
	// Если запрос от окна превью — отдаём previewWindowData
	const previewWin = windowManager.getPreviewWin();
	if (previewWin && !previewWin.isDestroyed() && event.sender === previewWin.webContents) {
		if (previewWindowData) {
			event.sender.send('update-data', previewWindowData);
		}
		return;
	}
	// Иначе — данные для nodeWin
	if (mainWindowData) {
		event.sender.send('update-data', mainWindowData);
	}
});

// Открытие превью по нажатию Space — кастомное окно на всех платформах
ipcMain.handle('preview:open', async (_, data: string) => {
	const parsed = JSON.parse(data) as { filePath: string; fileType: string };
	const { filePath } = parsed;
	const nextType = normalizePreviewType(parsed.fileType);

	const previewWin = windowManager.getPreviewWin();
	if (previewWin && !previewWin.isDestroyed()) {
		if (previewWindowFilePath === filePath) {
			// Тот же файл — переключаем закрытие/открытие (как Space в Finder)
			previewWin.close();
			return;
		}
		// Другой файл — обновляем контент. Положение окна сохраняем в любом случае.
		// Размер: если тип не меняется — оставляем текущий; если меняется —
		// либо восстанавливаем сохранённый размер для нового типа, либо разрешаем
		// preview:resize подогнать окно под контент (по intrinsic-размерам).
		previewWindowData = data;
		previewWindowFilePath = filePath;
		const prevType = getCurrentPreviewType();
		setCurrentPreviewType(nextType);

		if (nextType === prevType) {
			// Тот же тип — фиксируем текущие размер и положение.
			setPreviewBoundsLocked(true);
			setShouldCenterOnNextResize(false);
		} else {
			const { bounds: nextBounds, hasSaved } = getPreviewBoundsForType(nextType);
			const [curX, curY] = previewWin.getPosition();
			if (hasSaved) {
				// Применяем сохранённый размер нового типа, оставляя текущее положение.
				previewWin.setBounds({ x: curX, y: curY, width: nextBounds.width, height: nextBounds.height });
				setPreviewBoundsLocked(true);
				setShouldCenterOnNextResize(false);
			} else {
				// Сохранённых бунд для нового типа нет — пусть preview:resize
				// подгонит размер под контент. Положение не трогаем (без center).
				setPreviewBoundsLocked(false);
				setShouldCenterOnNextResize(false);
			}
		}

		previewWin.webContents.send('update-data', data);
		previewWin.focus();
		return;
	}

	// Создаём окно — бунды и lock-флаг устанавливаются внутри createPreviewWindow
	previewWindowData = data;
	previewWindowFilePath = filePath;
	setCurrentPreviewType(nextType);
	await createPreviewWindow(data);
});

ipcMain.on('store-sync', (_, { name, state }) => {
	updateStoreCache(name, state);
});

// ======== Запуск приложения ========
app.whenReady().then(async () => {
	const isDev = !!process.env.VITE_DEV_SERVER_URL;

	// 🔥 ИЗМЕНЕНО: Инициализация как global
	pluginManager = new PluginManager(isDev);
	await pluginManager.initialize();
	setPluginManager(pluginManager);
	console.log('[App] Plugin Manager initialized');

	await createMainWindow();
	registerIpcHandlers();
	registerSettingsIpc();
	getLogWindowManager(); // register IPC handlers, but don't open window

	// Первичное сканирование colorType из плагинов (не блокирует старт)
	import('./settings/colorTypes').then(({ readColorTypes, rescanColorTypes }) => {
		const current = readColorTypes();
		if (current.types.length === 0 || !current.lastScannedAt) {
			rescanColorTypes().catch((e) => console.warn('[settings] initial colorTypes scan failed:', e));
		}
	});
});

app.on('window-all-closed', () => app.quit());

app.on('second-instance', () => windowManager.getMainWin()?.focus());

app.on('activate', () => {
	if (!windowManager.getMainWin()) createMainWindow();
});

// 🔥 ИЗМЕНЕНО: Cleanup через global
app.on('before-quit', async () => {
	stopAllWatchers();
	if (pluginManager) {
		await pluginManager.destroy();
		console.log('[App] Plugin Manager destroyed');
	}
});

// ======== IPC HANDLERS ДЛЯ ПЛАГИНОВ ========

// 🔥 ИЗМЕНЕНО: Все handlers используют pluginManager
ipcMain.handle('plugins:get-ui-nodes', async () => {
	if (!pluginManager) return [];
	return await pluginManager.getUINodes();
});

ipcMain.handle('plugins:list', async () => {
	if (!pluginManager) return [];
	return pluginManager.listPlugins();
});

ipcMain.handle('plugins:call', async (_event, pluginId: string, version: string, method: string, ...args: any[]) => {
	if (!pluginManager) {
		throw new Error('Plugin manager not initialized');
	}
	return await pluginManager.call(pluginId, version, method, ...args);
});

ipcMain.handle('plugins:get-all-plugins', async () => {
	if (!pluginManager) return [];
	return pluginManager.getAllPluginsInfo();
});

ipcMain.handle('plugins:get-all-ui-nodes', async () => {
	if (!pluginManager) return [];
	return await pluginManager.getAllUINodes();
});

ipcMain.handle('plugins:get-plugins-by-type', async (_, type: string) => {
	if (!pluginManager) return [];
	return pluginManager.getPluginsByType(type);
});

ipcMain.handle('plugins:get-plugin', async (_, pluginId: string, version?: string) => {
	if (!pluginManager) return null;
	return pluginManager.getPlugin(pluginId, version);
});

ipcMain.handle('plugins:load-plugin', async (_, folderName: string) => {
	if (!pluginManager) throw new Error('Plugin manager not initialized');
	await pluginManager.loadPlugin(folderName);
	return true;
});

ipcMain.handle('plugins:unload-plugin', async (_, pluginId: string, version: string) => {
	if (!pluginManager) throw new Error('Plugin manager not initialized');
	await pluginManager.unloadPlugin(pluginId, version);
	return true;
});

ipcMain.handle('plugins:get-state', async () => {
	if (!pluginManager) return { initialized: false };

	const plugins = pluginManager.getAllPluginsInfo();
	return {
		initialized: true,
		pluginsCount: plugins.length,
		uiPluginsCount: plugins.filter((p) => p.hasUI).length,
		pluginsPath: pluginManager['pluginsPath'],
		isDev: pluginManager['isDev'],
	};
});

ipcMain.handle('plugins:get-plugin-ui', async (_, pluginId: string, version: string) => {
	if (!pluginManager) return null;
	return await pluginManager.getPluginUIData(pluginId, version);
});

ipcMain.handle('plugins:install', async (_, filePath: string) => {
	if (!pluginManager) throw new Error('Plugin manager not initialized');
	return await pluginManager.installPlugin(filePath);
});

ipcMain.handle('plugins:delete', async (_, pluginId: string, version: string) => {
	if (!pluginManager) throw new Error('Plugin manager not initialized');
	await pluginManager.deletePlugin(pluginId, version);
	return true;
});

ipcMain.handle('plugins:set-cost', async (_, pluginId: string, version: string, cost: string, costUnit: string) => {
	if (!pluginManager) throw new Error('Plugin manager not initialized');
	return await pluginManager.setPluginCost(pluginId, version, cost, costUnit);
});

ipcMain.handle('docs:list', async () => {
	return await listDocs();
});

ipcMain.handle('docs:read', async (_, sectionName: string, fileName: string) => {
	return await readDoc(sectionName, fileName);
});

ipcMain.handle('templates:list', async () => {
	const { getTemplateList } = await import('./templates/registry');
	return getTemplateList();
});

ipcMain.handle('templates:get-errors', async () => {
	return getDbExporter().getTemplateErrors();
});
