// Нативный drag-out файлов из окна программы наружу (Finder/Explorer/другие приложения)
// через @crabnebula/tauri-plugin-drag. HTML5-drag в WebView не умеет вытащить локальный
// файл наружу (особенно на macOS/WKWebView) — нужен нативный drag-source, что и делает плагин.
//
// Запускаем drag по pointer-жесту (mousedown + сдвиг порога), а НЕ через HTML5 `draggable`,
// иначе WKWebView рисует свой drag-image (призрак), чей `dragend` приходит уже снаружи окна.
//
// Семантика: просто drag = MOVE, drag+Shift = COPY (mode уходит в нативный startDrag →
// курсор «+» только для copy). Drag-preview — нативная системная иконка файла (как в Finder),
// с откатом на нарисованную canvas-иконку, если нативную получить не удалось.
import type { MouseEvent as ReactMouseEvent } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { startDrag } from '@crabnebula/tauri-plugin-drag';
import { getInstanceType } from '@/PROCESSING/utils/fileSystemActions';
import { useColumnView_Store } from '@/Store/MainWin/useColumnView_store';
import { commands, unwrap } from '@/Utils/specta';
import { dirname } from '@/Utils/path';
import { ensureLocal, moveInCloud } from '@/Utils/storageSeam';

export type DragMode = 'move' | 'copy';

// 1x1 прозрачный PNG — фолбэк, если canvas недоступен (плагин требует непустую иконку).
const FALLBACK_ICON =
	'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
	ctx.beginPath();
	ctx.moveTo(x + r, y);
	ctx.arcTo(x + w, y, x + w, y + h, r);
	ctx.arcTo(x + w, y + h, x, y + h, r);
	ctx.arcTo(x, y + h, x, y, r);
	ctx.arcTo(x, y, x + w, y, r);
	ctx.closePath();
}

// Запасная нарисованная иконка «документ» (+ бейдж количества) — если нативную не достали.
function makeFallbackIcon(count: number): string {
	const size = 64;
	const canvas = document.createElement('canvas');
	canvas.width = size;
	canvas.height = size;
	const ctx = canvas.getContext('2d');
	if (!ctx) return FALLBACK_ICON;

	ctx.fillStyle = '#2b2f3a';
	roundRect(ctx, 14, 6, 36, 50, 6);
	ctx.fill();
	ctx.fillStyle = '#3a4150';
	ctx.beginPath();
	ctx.moveTo(42, 6);
	ctx.lineTo(50, 14);
	ctx.lineTo(42, 14);
	ctx.closePath();
	ctx.fill();
	ctx.fillStyle = '#5b8cff';
	ctx.fillRect(20, 20, 24, 4);
	ctx.fillStyle = '#9aa3b2';
	ctx.fillRect(20, 30, 24, 3);
	ctx.fillRect(20, 38, 24, 3);
	ctx.fillRect(20, 46, 16, 3);
	// бейдж количества не рисуем — ОС показывает его сама

	try {
		return canvas.toDataURL('image/png');
	} catch {
		return FALLBACK_ICON;
	}
}

function drawCountBadge(ctx: CanvasRenderingContext2D, count: number): void {
	ctx.fillStyle = '#007bff';
	ctx.beginPath();
	ctx.arc(49, 49, 13, 0, Math.PI * 2);
	ctx.fill();
	ctx.fillStyle = '#ffffff';
	ctx.font = 'bold 15px system-ui, -apple-system, sans-serif';
	ctx.textAlign = 'center';
	ctx.textBaseline = 'middle';
	ctx.fillText(count > 99 ? '99+' : String(count), 49, 50);
}

// Накладывает бейдж количества на готовую (нативную) иконку через canvas.
function addBadgeToIcon(dataUrl: string, count: number): Promise<string> {
	return new Promise((resolve) => {
		const img = new Image();
		img.onload = () => {
			const canvas = document.createElement('canvas');
			canvas.width = 64;
			canvas.height = 64;
			const ctx = canvas.getContext('2d');
			if (!ctx) {
				resolve(dataUrl);
				return;
			}
			ctx.drawImage(img, 2, 0, 58, 58);
			drawCountBadge(ctx, count);
			try {
				resolve(canvas.toDataURL('image/png'));
			} catch {
				resolve(dataUrl);
			}
		};
		img.onerror = () => resolve(dataUrl);
		img.src = dataUrl;
	});
}

// Drag-preview: нативная системная иконка первого файла; при мультивыделении — с бейджем.
// Откат на нарисованную иконку, если нативную получить не удалось.
async function buildDragIcon(paths: string[]): Promise<string> {
	const count = paths.length;
	let nativeIcon: string | null = null;
	try {
		nativeIcon = (await invoke('get_file_icon', { path: paths[0], size: 64 })) as string;
	} catch (err) {
		console.error('get_file_icon failed:', err);
	}
	if (!nativeIcon) return makeFallbackIcon(count);
	// Фиксированный размер, БЕЗ своего бейджа: macOS сама показывает «+» и количество
	// файлов рядом с курсором — свой бейдж это дублировал.
	return nativeIcon;
}

// Режим текущей drag-сессии, запущенной самой программой: 'move' | 'copy' | null.
// null = drag НЕ наш (например, файл тащат из Finder) → внутренний дроп тогда = copy.
let _activeDragMode: DragMode | null = null;

export function getActiveDragMode(): DragMode | null {
	return _activeDragMode;
}

// ⛔ ОТКЛЮЧЕНО (не удалять): подавление входящего drag-UI на время drag-наружу.
// Сейчас всегда false — нативный drag должен работать и ВНУТРИ программы.
export function isDraggingOut(): boolean {
	return false;
}

// Применяет дроп в эксплорере: move (перемещение + удаление из исходной колонки) либо copy.
export async function applyExplorerDrop(srcPath: string, destPath: string, mode: DragMode): Promise<void> {
	if (mode === 'move') {
		// Перенос внутри облака — через каталог (`/rename` со сменой папки, 0 байт).
		// Вне облака: гидрация источника, потом обычный перенос на диске.
		// `destPath` — итоговый путь файла, а переносу нужна папка-приёмник.
		if (!(await moveInCloud(srcPath, dirname(destPath)))) {
			unwrap(await commands.moveItem(await ensureLocal(srcPath), destPath, { overwrite: false }));
		}
		await useColumnView_Store.getState().removeItemAndTrimColumns(getInstanceType(srcPath), srcPath);
	} else {
		unwrap(await commands.copyItem(await ensureLocal(srcPath), destPath, { overwrite: false }));
	}
}

// Запускает нативную drag-сессию с файлами. Пути должны быть абсолютными.
export async function startNativeFileDrag(paths: string[], mode: DragMode): Promise<void> {
	const items = paths.filter(Boolean);
	if (items.length === 0) return;
	_activeDragMode = mode;
	try {
		const icon = await buildDragIcon(items);
		await startDrag({ item: items, icon, mode }, () => {
			// Снимаем режим с задержкой — чтобы обработчик внутреннего tauri://drag-drop
			// 'drop' (срабатывает примерно одновременно) ещё успел прочитать getActiveDragMode().
			window.setTimeout(() => {
				_activeDragMode = null;
			}, 400);
		});
	} catch (err) {
		_activeDragMode = null;
		console.error('startNativeFileDrag failed:', err);
	}
}

const DRAG_THRESHOLD_PX = 5;

// Навешивается на onMouseDown строки файла/папки. Запускает нативный drag, когда курсор
// сдвинулся дальше порога с зажатой ЛКМ. Shift в этот момент → copy, иначе → move.
// Клик (без сдвига) ничего не запускает — выделение работает как прежде. getPaths
// вызывается в момент старта drag, поэтому подхватывает актуальное выделение.
export function handleDragOutMouseDown(e: ReactMouseEvent, getPaths: () => string[]): void {
	if (e.button !== 0) return; // только левая кнопка
	const startX = e.clientX;
	const startY = e.clientY;
	let started = false;

	const cleanup = () => {
		window.removeEventListener('mousemove', onMove, true);
		window.removeEventListener('mouseup', onUp, true);
	};
	const onMove = (ev: MouseEvent) => {
		if (started) return;
		if (Math.abs(ev.clientX - startX) > DRAG_THRESHOLD_PX || Math.abs(ev.clientY - startY) > DRAG_THRESHOLD_PX) {
			started = true;
			cleanup();
			const mode: DragMode = ev.shiftKey ? 'copy' : 'move';
			void startNativeFileDrag(getPaths(), mode);
		}
	};
	const onUp = () => cleanup();

	window.addEventListener('mousemove', onMove, true);
	window.addEventListener('mouseup', onUp, true);
}
