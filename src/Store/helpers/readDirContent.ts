import { joinPath } from '../../Utils/joinPath';
import { commands, unwrap } from '@/Utils/specta';

/* ===========================================================
 * 🧩 TYPES
 * =========================================================== */

export interface FileItem {
	name: string;
	path: string;
	isDir: boolean;
}

export interface Column {
	path: string;
	items: FileItem[];
	selected?: string;
	width?: number; // 👈 добавили поддержку ширины
}

export interface ColumnViewState {
	columns: Column[];
	loading: boolean;
	error?: string;

	openRoot: (rootPath: string) => Promise<void>;
	selectItem: (colIndex: number, item: FileItem) => Promise<void>;
	refreshColumn: (colIndex: number) => Promise<void>;
	setColumnWidth: (index: number, width: number) => void; // 👈 новый метод
	reset: () => void;
}

/* ===========================================================
 * 🗄 DIRECTORY CACHE
 * =========================================================== */

const dirCache = new Map<string, { items: FileItem[]; ts: number }>();
const CACHE_TTL = 30_000;

// 🔻 Главный рубильник prefetch-кеша.
// false  → кеш полностью отключён: папки всегда читаются с диска заново,
//          никаких «призрачных» файлов после перемещения/удаления.
// true   → prefetch при наведении + кеш на CACHE_TTL мс (быстрее открытие).
// Чтобы вернуть кеш — поставить true (и при желании снизить CACHE_TTL до 3000).
const CACHE_ENABLED = false;

export function getCachedDir(folderPath: string): FileItem[] | null {
	if (!CACHE_ENABLED) return null;
	const entry = dirCache.get(folderPath);
	if (entry && Date.now() - entry.ts < CACHE_TTL) return entry.items;
	return null;
}

export function invalidateDirCache(folderPath: string): void {
	dirCache.delete(folderPath);
}

export function prefetchDir(folderPath: string): void {
	if (!CACHE_ENABLED) return;
	if (!getCachedDir(folderPath)) {
		readDirContent(folderPath); // fire and forget
	}
}

/* ===========================================================
 * 🛠 HELPERS
 * =========================================================== */

// Формат из Node.js fallback: { folders: string[], files: string[] }
type LegacyDirResult = { folders?: string[]; files?: string[] };

export async function readDirContent(folderPath: string, ensureDir = false): Promise<FileItem[]> {
	const cached = getCachedDir(folderPath);
	if (cached) {
		console.log(`[perf] readDir CACHE: ${folderPath.split('/').pop()}`);
		return cached;
	}

	const t0 = performance.now();
	try {
		const raw = ensureDir
			? unwrap(await commands.ensureAndReadDir(folderPath))
			: unwrap(await commands.getSomeFromFolder(folderPath, [
					{ type: 'files', ext: [] },
					{ type: 'folders', ext: [] },
				]));

		let result: FileItem[];

		if (Array.isArray(raw)) {
			// Rust native addon — napi-rs конвертирует snake_case → camelCase,
			// поэтому is_dir приходит как isDir
			result = (raw as any[])
				.filter((f) => f.name && !HIDDEN_FILES.includes(f.name))
				.map((f) => ({ name: f.name, path: f.path, isDir: f.isDir ?? f.is_dir ?? false }));
		} else {
			// Rust getSomeFromFolder / Node.js fallback — возвращают { folders: string[], files: string[] }.
			// Раньше тут был N+1 IPC: pathJoin на каждый item. Теперь — pure JS join.
			const ffArr = raw as LegacyDirResult;
			const folders = (ffArr?.folders ?? []).map((name: string) => ({
				name,
				path: joinPath(folderPath, name),
				isDir: true,
			}));
			const files = (ffArr?.files ?? []).map((name: string) => ({
				name,
				path: joinPath(folderPath, name),
				isDir: false,
			}));
			result = [...folders, ...files].filter((f) => f.name && !HIDDEN_FILES.includes(f.name));
		}

		result.sort((a, b) => {
			if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
			return a.name.localeCompare(b.name, 'ru', { sensitivity: 'base' });
		});

		dirCache.set(folderPath, { items: result, ts: Date.now() });
		const src = Array.isArray(raw) ? 'rust' : 'node';
		// console.log(`[perf] readDir IPC(${src}): ${(performance.now() - t0).toFixed(1)}ms — ${folderPath.split('/').pop()} (${result.length} items)`);
		return result;
	} catch (err: any) {
		console.error('Ошибка при чтении папки:', err);
		throw new Error(err.message || 'Не удалось прочитать директорию');
	}
}

/* ===========================================================
 * ⚙️ CONSTANTS
 * =========================================================== */

export const HIDDEN_FILES = ['.DS_Store', 'Thumbs.db'];
export const COLUMN_MIN_WIDTH = 150;
export const COLUMN_MAX_WIDTH = 600;
export const COLUMN_DEFAULT_WIDTH = 220;

let _measureCanvas: HTMLCanvasElement | null = null;
let _measureCtx: CanvasRenderingContext2D | null = null;

/** Calculates optimal column width to fit the longest filename, clamped to [COLUMN_MIN_WIDTH, COLUMN_MAX_WIDTH]. */
export function calcColumnWidth(items: { name: string }[]): number {
	if (items.length === 0) return COLUMN_DEFAULT_WIDTH;

	if (!_measureCanvas) {
		_measureCanvas = document.createElement('canvas');
		_measureCtx = _measureCanvas.getContext('2d');
	}
	const ctx = _measureCtx;
	if (!ctx) return COLUMN_DEFAULT_WIDTH;

	// Match the font used in CurentFolderItem / CurentFileItem:
	// ListItemText sx={{ fontSize: '1.2rem' }} → 1.2 * 16px = ~19px; selected items are bold (600)
	ctx.font = '600 19px -apple-system, system-ui, "Segoe UI", sans-serif';

	let maxW = 0;
	for (const item of items) {
		const w = ctx.measureText(item.name).width;
		if (w > maxW) maxW = w;
	}

	// icon(24) + gap(8) + left-pad(16) + right-pad(16) + safety(12) = 76
	const total = Math.ceil(maxW) + 76;
	return Math.max(COLUMN_MIN_WIDTH, Math.min(COLUMN_MAX_WIDTH, total));
}
