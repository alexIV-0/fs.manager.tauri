import { localFolders_stor } from '@/Store/MainWin/localFolders_store';
import { useColumnView_Store } from '@/Store/MainWin/useColumnView_store';
import { clipboardFs_store } from '@/Store/MainWin/clipboardFs_store';
import { joinPath } from '@/Utils/joinPath';
import clipboard from 'tauri-plugin-clipboard-api';
import { basename, dirname } from '@/Utils/path';
import { commands, unwrap } from '@/Utils/specta';

// ── Определяем тип инстанса по пути ────────────────────────────────────────
// Сначала пытаемся понять, в какой панели реально открыт путь — сравниваем с
// корневыми путями уже загруженных колонок (с учётом границы разделителя).
// Это надёжнее, чем угадывать по префиксу localFolder: если GD-путь («Папка
// Пользователя») случайно начинается с той же строки, что и localFolder
// (например localFolder — родитель/сосед с общим префиксом имени), наивный
// startsWith ошибочно вернул бы 'local', и обновление UI молча пропускалось бы.
function isUnderRoot(path: string, root: string): boolean {
	if (!root) return false;
	return path === root || path.startsWith(root + '/') || path.startsWith(root + '\\');
}

export function getInstanceType(path: string): 'gd' | 'local' {
	const { instances } = useColumnView_Store.getState();
	const gdRoot = instances.gd.columns[0]?.path;
	const localRoot = instances.local.columns[0]?.path;

	if (isUnderRoot(path, localRoot)) return 'local';
	if (isUnderRoot(path, gdRoot)) return 'gd';

	// Фолбэк на старую эвристику, если корни ещё не загружены.
	const lFolder = localFolders_stor.getState().localFolder;
	return lFolder && path.startsWith(lFolder) ? 'local' : 'gd';
}

// ── Удаление с обрезкой дочерних колонок ───────────────────────────────────
export async function deleteItem(path: string): Promise<void> {
	try {
		await window.electronAPI.invoke('deleteItem', path);
	} catch (err) {
		console.error('deleteItem failed:', err);
		return;
	}

	const instanceType = getInstanceType(path);
	await useColumnView_Store.getState().removeItemAndTrimColumns(instanceType, path);
}

// ── Копировать путь в буфер ─────────────────────────────────────────────────
export async function copyPath(path: string): Promise<void> {
	try {
		unwrap(await commands.copyToClipboard(path));
	} catch (err) {
		console.error('copyPath failed:', err);
	}
}

// ── Показать в Finder / Explorer ────────────────────────────────────────────
export async function showInFinder(path: string): Promise<void> {
	try {
		unwrap(await commands.showInFolder(path));
	} catch (err) {
		console.error('showInFinder failed:', err);
	}
}

// ── Открыть файл дефолтным приложением ─────────────────────────────────────
export async function openFile(path: string): Promise<void> {
	try {
		unwrap(await commands.openFileWithDefaultApp(path));
	} catch (err) {
		console.error('openFile failed:', err);
	}
}

// ── Переименовать папку с обновлением колонок ───────────────────────────────
export async function renameFolder(
	oldPath: string,
	newPath: string,
	onSuccess?: (oldName: string, newName: string) => void,
): Promise<void> {
	try {
		await window.electronAPI.invoke('renameFolder', oldPath, newPath);

		const parentPath = dirname(oldPath);
		const oldName = basename(oldPath);
		const newName = basename(newPath);

		const instanceType = getInstanceType(oldPath);
		useColumnView_Store.getState().refreshAffectedColumns(instanceType, [parentPath]);

		onSuccess?.(oldName, newName);
	} catch (err) {
		console.error('renameFolder failed:', err);
	}
}

// ── Переименовать файл с обновлением колонок ────────────────────────────────
export async function renameFile(
	oldPath: string,
	newPath: string,
	onSuccess?: (oldName: string, newName: string) => void,
): Promise<void> {
	try {
		const success = unwrap(await commands.renameFile(oldPath, newPath));
		if (!success) return;

		const parentPath = dirname(oldPath);
		const oldName = basename(oldPath);
		const newName = basename(newPath);

		const instanceType = getInstanceType(oldPath);
		useColumnView_Store.getState().refreshAffectedColumns(instanceType, [parentPath]);

		onSuccess?.(oldName, newName);
	} catch (err) {
		console.error('renameFile failed:', err);
	}
}

// ── Создать новую папку ─────────────────────────────────────────────────────
export async function createFolder(parentPath: string, folderName = 'Новая папка'): Promise<void> {
	try {
		const newFolderPath = joinPath(parentPath, folderName);
		unwrap(await commands.createFolder(newFolderPath));

		const instanceType = getInstanceType(parentPath);
		useColumnView_Store.getState().refreshAffectedColumns(instanceType, [parentPath]);
	} catch (err) {
		console.error('createFolder failed:', err);
	}
}

// ── Создать текстовый файл ──────────────────────────────────────────────────
export async function createTextFile(parentPath: string, fileName = 'Новый файл.txt'): Promise<void> {
	try {
		const newFilePath = joinPath(parentPath, fileName);
		await window.electronAPI.invoke('createTextFile', newFilePath);

		const instanceType = getInstanceType(parentPath);
		useColumnView_Store.getState().refreshAffectedColumns(instanceType, [parentPath]);
	} catch (err) {
		console.error('createTextFile failed:', err);
	}
}

// ── Системный буфер обмена для ФАЙЛОВ (CrossCopy tauri-plugin-clipboard) ──────
// Превращаем абсолютный путь в file-URI для writeFilesURIs.
//   macOS/Linux: files:// + POSIX-путь (сегменты URL-энкодим — пробелы, кириллица).
//   Windows:     file:///  + путь с прямыми слэшами (плагин на Windows принимает оба).
// ⚠️ Формат URI — единственное место, которое стоит перепроверить вживую, если
//    вставка в Finder/Explorer не подхватывает файлы.
function pathToFileUri(p: string): string {
	const isWindows = /^[a-zA-Z]:[\\/]/.test(p) || p.includes('\\');
	if (isWindows) {
		const segments = p.replace(/\\/g, '/').split('/').map((s) => encodeURIComponent(s));
		return 'file:///' + segments.join('/');
	}
	const segments = p.split('/').map((s) => encodeURIComponent(s));
	return 'files://' + segments.join('/'); // POSIX: files:// + /abs/path → files:///abs/path
}

// Пишем пути в системный буфер, чтобы их можно было вставить в Finder/Explorer.
// Не бросаем — это «бонусный» побочный эффект к внутреннему стору.
async function writeFilesToOSClipboard(paths: string[]): Promise<void> {
	if (paths.length === 0) return;
	try {
		// writeFiles пишет пути в нативном формате списка файлов (NSFilenames / CF_HDROP),
		// который Finder/Explorer понимают для вставки. Надёжнее, чем URI-формат.
		await clipboard.writeFiles(paths);
	} catch (err) {
		console.error('clipboard.writeFilesURIs failed:', err);
	}
}

// ── Копировать элемент: внутренний стор + системный буфер ────────────────────
export function copyToClipboardFs(paths: string[]): void {
	clipboardFs_store.getState().copy(paths);
	void writeFilesToOSClipboard(paths);
}

// ── Вырезать элемент: внутренний стор (хранит cut) + системный буфер ──────────
// В системном буфере «вырезание файла» непортируемо, поэтому для внешних приложений
// (Finder/Explorer) это будет выглядеть как копирование. Семантика cut (перемещение)
// сохраняется ВНУТРИ программы через внутренний стор.
export function cutToClipboardFs(paths: string[]): void {
	clipboardFs_store.getState().cut(paths);
	void writeFilesToOSClipboard(paths);
}

// ── Вставить из буфера в папку ───────────────────────────────────────────────
// Источник: если в системном буфере есть файлы, которых НЕТ в нашем внутреннем
// сторе (значит положены из Finder/Explorer) — копируем их. Иначе используем
// внутренний стор (сохраняя семантику copy/cut для операций внутри программы).
export async function pasteFromClipboardFs(destFolderPath: string): Promise<void> {
	const internal = clipboardFs_store.getState();

	let osFiles: string[] = [];
	try {
		if (!(internal.type && internal.paths.length > 0) && (await clipboard.hasFiles())) {
			osFiles = await clipboard.readFiles();
		}
	} catch (err) {
		console.error('clipboard.readFiles failed:', err);
	}

	const norm = (s: string) => s.replace(/[\\/]+$/, '');
	const internalSet = new Set(internal.paths.map(norm));
	const sameAsInternal =
		osFiles.length > 0 &&
		osFiles.length === internal.paths.length &&
		osFiles.every((p) => internalSet.has(norm(p)));

	let type: 'copy' | 'cut';
	let paths: string[];
	if (osFiles.length > 0 && !(internal.type && internal.paths.length > 0)) {
		// Файлы из внешнего приложения (Finder/Explorer) → копируем.
		type = 'copy';
		paths = osFiles;
	} else if (internal.type && internal.paths.length > 0) {
		// Внутренний буфер — сохраняем cut/copy.
		type = internal.type;
		paths = internal.paths;
	} else {
		return; // нечего вставлять
	}

	const instanceType = getInstanceType(destFolderPath); console.log('[pasteFs] type:', type, 'count:', paths.length, 'dest:', destFolderPath);

	for (const srcPath of paths) {
		const name = basename(srcPath);
		const destPath = joinPath(destFolderPath, name);

		try {
			if (type === 'copy') {
				await window.electronAPI.invoke('copyItem', srcPath, destPath, { overwrite: false });
			} else {
				await window.electronAPI.invoke('moveItem', srcPath, destPath, { overwrite: false });
				// После перемещения убираем из исходной колонки
				const srcInstanceType = getInstanceType(srcPath);
				await useColumnView_Store.getState().removeItemAndTrimColumns(srcInstanceType, srcPath);
			}
		} catch (err) {
			console.error('pasteFromClipboardFs failed for', srcPath, err);
		}
	}

	if (type === 'cut') clipboardFs_store.getState().clear();

	useColumnView_Store.getState().refreshAffectedColumns(instanceType, [destFolderPath]);
}
