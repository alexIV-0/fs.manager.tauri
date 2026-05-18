import { BrowserWindow } from 'electron';

// Единственный источник истины для ссылок на окна приложения
class WindowManager {
	private mainWin: BrowserWindow | null = null;
	private nodeWin: BrowserWindow | null = null;
	private previewWin: BrowserWindow | null = null;

	getMainWin() { return this.mainWin; }
	getNodeWin() { return this.nodeWin; }
	getPreviewWin() { return this.previewWin; }

	setMainWin(win: BrowserWindow | null) { this.mainWin = win; }
	setNodeWin(win: BrowserWindow | null) { this.nodeWin = win; }
	setPreviewWin(win: BrowserWindow | null) { this.previewWin = win; }
}

export const windowManager = new WindowManager();
