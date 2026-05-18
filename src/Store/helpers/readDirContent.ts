import { joinPath } from '../../Utils/joinPath';

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

export function getCachedDir(folderPath: string): FileItem[] | null {
	const entry = dirCache.get(folderPath);
	if (entry && Date.now() - entry.ts < CACHE_TTL) return entry.items;
	return null;
}

export function invalidateDirCache(folderPath: string): void {
	dirCache.delete(folderPath);
}

export function prefetchDir(folderPath: string): void {
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
			? await window.electronAPI.invoke('ensureAndReadDir', folderPath)
			: await window.electronAPI.invoke('getSomeFromFolder', folderPath, [
					{ type: 'files', ext: [] },
					{ type: 'folders', ext: [] },
				]);

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
export const COLUMN_DEFAULT_WIDTH = 220;
