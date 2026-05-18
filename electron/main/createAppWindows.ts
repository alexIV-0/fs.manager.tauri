// createAppWindows.ts
import { BrowserWindow } from 'electron';
import { appStore as store } from './appStore';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const preload = path.join(__dirname, '../preload/index.mjs');

interface WindowState {
	width: number;
	height: number;
	x?: number;
	y?: number;
}

export function createAppWindow({
	storeKey,
	title,
	icon,
	defaultSize = { width: 800, height: 600 },
	devTools = false,
	loadFilePath, // абсолютный путь к html
	loadUrl, // URL для загрузки
	preloadPath, // опционально кастомный preload
	webSecurity = true,
}: {
	storeKey: string;
	title: string;
	icon: string;
	defaultSize?: { width: number; height: number };
	devTools?: boolean;
	loadFilePath?: string;
	loadUrl?: string;
	preloadPath?: string;
	webSecurity?: boolean;
}) {
	const winState = store.get(storeKey, {
		width: defaultSize.width,
		height: defaultSize.height,
		x: undefined,
		y: undefined,
	}) as WindowState;

	const win = new BrowserWindow({
		title,
		icon,
		width: winState.width,
		height: winState.height,
		x: winState.x,
		y: winState.y,
		webPreferences: {
			preload: preloadPath ?? preload,
			contextIsolation: true,
			nodeIntegration: false,
			webSecurity,
			// Не тротлить таймеры в фоновом окне — иначе finalyWating зависает
			// на длинных интервалах ожидания, когда окно теряет фокус или свёрнуто.
			backgroundThrottling: false,
		},
	});

	win.removeMenu();

	if (loadUrl) {
		win.loadURL(loadUrl);
	} else if (loadFilePath) {
		win.loadFile(loadFilePath);
	} else {
		throw new Error('Для создания окна нужно передать loadUrl или loadFilePath');
	}

	if (devTools) {
		win.webContents.openDevTools();
	}

	const saveBounds = () => {
		const bounds = win.getBounds();
		const prevState = store.get(storeKey, {}) as Partial<WindowState>;
		store.set(storeKey, { ...prevState, ...bounds });
	};

	win.on('resize', saveBounds);
	win.on('move', saveBounds);

	return win;
}
