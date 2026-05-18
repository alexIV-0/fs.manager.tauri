/**
 * Автоматическое сохранение позиции и размера окна при перемещении/изменении размера
 */
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { LogicalPosition, LogicalSize } from '@tauri-apps/api/dpi';
import { invoke } from '@tauri-apps/api/core';

interface WindowState {
	width: number;
	height: number;
	x: number;
	y: number;
	is_maximized: boolean;
}

let saveTimeout: ReturnType<typeof setTimeout> | null = null;

function debounceSaveState(window: ReturnType<typeof getCurrentWebviewWindow>) {
	if (saveTimeout) {
		clearTimeout(saveTimeout);
	}
	saveTimeout = setTimeout(() => saveCurrentWindowState(window), 300); // Сохраняем с debounce 300ms
}

async function saveCurrentWindowState(window: ReturnType<typeof getCurrentWebviewWindow>) {
	try {
		const [position, size, isMaximized] = await Promise.all([
			window.innerPosition(),
			window.innerSize(),
			window.isMaximized(),
		]);

		await invoke('saveWindowState', {
			label: window.label,
			state: {
				width: size.width,
				height: size.height,
				x: position.x,
				y: position.y,
				is_maximized: isMaximized,
			},
		});
		console.log('[WindowState] Saved:', { width: size.width, height: size.height, x: position.x, y: position.y });
	} catch (error) {
		console.error('[WindowState] Failed to save state:', error);
	}
}

export async function setupWindowAutoSave() {
	// Восстановление и сохранением теперь полностью на стороне Rust
	// Frontend не должен вмешиваться в это
	return {
		cleanup: () => {},
	};
}
