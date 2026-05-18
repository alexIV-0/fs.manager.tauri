import { convertFileSrc } from '@tauri-apps/api/core';

/**
 * Конвертирует локальный путь в URL, пригодный для загрузки в WebView.
 * В Tauri используется `convertFileSrc` (asset://localhost/...).
 * Имя `toFileUrl` сохранено для совместимости с компонентами, перенесёнными из Electron-версии.
 */
export function toFileUrl(p: string): string {
	return convertFileSrc(p);
}

/**
 * Форматирует секунды в строку M:SS.
 * Пример: 90 → "1:30"
 */
export function formatTime(s: number): string {
	const m = Math.floor(s / 60);
	const sec = Math.floor(s % 60);
	return `${m}:${sec.toString().padStart(2, '0')}`;
}
