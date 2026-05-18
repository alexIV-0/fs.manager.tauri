import { convertFileSrc } from '@tauri-apps/api/core';

/**
 * Конвертирует локальный путь в URL, который работает в Tauri WebView
 * В Electron: file:///path/to/file
 * В Tauri: asset://localhost/path/to/file
 */
export function toAssetUrl(filePath: string): string {
	return convertFileSrc(filePath);
}
