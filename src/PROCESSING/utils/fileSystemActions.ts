import { localFolders_stor } from '@/Store/MainWin/localFolders_store';
import { useColumnView_Store } from '@/Store/MainWin/useColumnView_store';
import { invalidateDirCache } from '@/Store/helpers/readDirContent';
import { clipboardFs_store } from '@/Store/MainWin/clipboardFs_store';
import { joinPath } from '@/Utils/joinPath';
import clipboard from 'tauri-plugin-clipboard-api';
import { basename, dirname } from '@/Utils/path';
import { commands, unwrap } from '@/Utils/specta';
import { ensureLocal, ensureMirrorDir, renameInCloud, mkdirInCloud, deleteInCloud, moveInCloud } from '@/Utils/storageSeam';
import { hydrateForCopy } from '@/Utils/hydrateForCopy';

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
		// В зеркале удаление ДВУХСТУПЕНЧАТОЕ: первое нажатие убирает локальную копию
		// (файл остаётся в облаке), второе — удаляет в облаке. Пока у бэкенда нет
		// корзины, вторая ступень необратима, поэтому спрашиваем подтверждение.
		const stage = await deleteInCloud(path);
		if (stage === null) {
			// Не зеркало — обычное локальное удаление.
			unwrap(await commands.deleteItem(path));
		} else if (stage === 'needsConfirm') {
			const name = basename(path);
			const ok = window.confirm(
				`Локальной копии нет — «${name}» будет удалён В ОБЛАКЕ.\n\n` +
					`Восстановить будет нельзя: корзины на стороне сайта пока нет.`,
			);
			if (!ok) return;
			await deleteInCloud(path, true);
		} else if (stage === 'localCopy') {
			// Файл остался в облаке — из колонки он не исчезает, меняется значок.
			// Обрезать дочерние колонки в этом случае нельзя: путь всё ещё живой.
			//
			// Обновляем ОБЕ панели, а не ту, которую вернёт `getInstanceType`: одну и
			// ту же папку зеркала можно открыть слева и справа одновременно, и тогда
			// вторая осталась бы со старым значком. Лишняя работа тут — одно чтение
			// папки, которого всё равно не видно.
			const cols = useColumnView_Store.getState();
			cols.refreshAffectedColumns('gd', [dirname(path)]);
			cols.refreshAffectedColumns('local', [dirname(path)]);
			return;
		}
	} catch (err) {
		console.error('deleteItem failed:', err);
		return;
	}

	const instanceType = getInstanceType(path);
	await useColumnView_Store.getState().removeItemAndTrimColumns(instanceType, path);
}

/**
 * Удалить несколько строк разом — с ОДНИМ подтверждением на всё выделение.
 *
 * Прогнать выделение через `deleteItem` по одному значило бы показать по `confirm`
 * на каждый файл, у которого нет локальной копии: десять окон подряд перестают
 * читать после второго, а вопрос там про необратимое удаление в облаке. Поэтому
 * первая ступень проходит по всем, а вторая спрашивается списком.
 */
export async function deleteItems(paths: string[]): Promise<void> {
	if (paths.length === 0) return;
	if (paths.length === 1) {
		await deleteItem(paths[0]);
		return;
	}

	const store = useColumnView_Store.getState();
	const нужноПодтвердить: string[] = [];

	for (const path of paths) {
		try {
			const stage = await deleteInCloud(path);
			if (stage === 'needsConfirm') {
				// Вторая ступень — общим списком ниже.
				нужноПодтвердить.push(path);
				continue;
			}
			if (stage === null) {
				// Не зеркало — обычное локальное удаление.
				unwrap(await commands.deleteItem(path));
			} else if (stage === 'localCopy') {
				// Файл остался в облаке: путь живой, меняется только значок.
				// Обрезать колонки в этом случае нельзя (см. `deleteItem`).
				store.refreshAffectedColumns('gd', [dirname(path)]);
				store.refreshAffectedColumns('local', [dirname(path)]);
				continue;
			}
			await store.removeItemAndTrimColumns(getInstanceType(path), path);
		} catch (err) {
			console.error('deleteItems failed:', path, err);
		}
	}

	if (нужноПодтвердить.length > 0) {
		const имена = нужноПодтвердить.slice(0, 10).map((p) => basename(p)).join('\n');
		const ok = window.confirm(
			`Локальных копий нет — эти ${нужноПодтвердить.length} будут удалены В ОБЛАКЕ:\n\n` +
				имена +
				(нужноПодтвердить.length > 10 ? `\n…и ещё ${нужноПодтвердить.length - 10}` : '') +
				`\n\nВосстановить будет нельзя: корзины на стороне сайта пока нет.`,
		);
		if (ok) {
			for (const path of нужноПодтвердить) {
				try {
					await deleteInCloud(path, true);
					await store.removeItemAndTrimColumns(getInstanceType(path), path);
				} catch (err) {
					console.error('deleteItems (облако) failed:', path, err);
				}
			}
		}
	}

	// Выделение относилось к строкам, которых уже нет: оставить его — значит дать
	// следующему действию сработать по призракам.
	store.clearMultiSelection('gd');
	store.clearMultiSelection('local');
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
		// Файл из облачного зеркала может быть ещё не скачан. Открытие — это ровно
		// тот момент, когда он нужен целиком: тянем и только потом отдаём системе.
		// Вне зеркала `ensureLocal` не делает ничего.
		await ensureLocal(path);
		unwrap(await commands.openFileWithDefaultApp(path));
	} catch (err) {
		console.error('openFile failed:', err);
	}
}

// ── Превью файла (пробел / Quick Look) ──────────────────────────────────────
// Отдельная функция, а не вызов `previewOpen` из компонента: превью — это чтение
// БАЙТОВ, значит облачный файл сначала надо скачать. Раньше пробел звал команду
// напрямую и для нескачанного файла показывал пустоту, хотя пункт «Открыть» в меню
// того же файла работал правильно. Одинаковое по смыслу действие обязано вести себя
// одинаково, откуда бы его ни позвали.
export async function openPreview(path: string): Promise<void> {
	try {
		// Вне зеркала `ensureLocal` не делает ничего.
		const ready = await ensureLocal(path);
		const fileType = await commands.getFileTypeByExtname(ready.split('.').pop() || '');
		unwrap(await commands.previewOpen(JSON.stringify({ filePath: ready, fileType })));
	} catch (err) {
		console.error('openPreview failed:', err);
	}
}

// ── Переименовать папку с обновлением колонок ───────────────────────────────
export async function renameFolder(
	oldPath: string,
	newPath: string,
	onSuccess?: (oldName: string, newName: string) => void,
): Promise<void> {
	try {
		// В зеркале имя живёт в каталоге бэкенда, и переименовать надо ЕГО: иначе
		// путь перестанет разбираться, значки синхронизации исчезнут, а в облаке
		// папка останется под прежним именем. Вне зеркала — обычное переименование.
		if (!(await renameInCloud(oldPath, basename(newPath)))) {
			unwrap(await commands.renameFolder(oldPath, newPath));
		}

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
		// См. `renameFolder`: для зеркала переименование идёт через каталог.
		if (!(await renameInCloud(oldPath, basename(newPath)))) {
			const success = unwrap(await commands.renameFile(oldPath, newPath));
			if (!success) return;
		}

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
		// В зеркале папка заводится в каталоге — тогда у неё есть `file_id`, её можно
		// переименовать и удалить, и у неё появляется значок синхронизации. Папка,
		// созданная только на диске, для облака не существует.
		if (!(await mkdirInCloud(newFolderPath))) {
			unwrap(await commands.createFolder(newFolderPath));
		}

		const instanceType = getInstanceType(parentPath);
		const store = useColumnView_Store.getState();
		// Делаем новую папку выбранной + активируем панель: её сразу можно переименовать
		// по Enter, а в другой панели выделение снимется (см. clearInstanceSelection).
		store.addAndSelectItemByPath(instanceType, parentPath, { name: folderName, path: newFolderPath, isDir: true });
		// Кэш папки сбросить ОБЯЗАТЕЛЬНО: без этого перечитывание отдаёт прежний
		// список, синтетическая строка остаётся без данных каталога — и новая папка
		// висит без значка синхронизации, хотя в каталоге она уже есть. Значок
		// появлялся только после следующего действия, которое кэш сбрасывало.
		invalidateDirCache(parentPath);
		store.refreshAffectedColumns(instanceType, [parentPath]);
	} catch (err) {
		console.error('createFolder failed:', err);
	}
}

// ── Создать текстовый файл ──────────────────────────────────────────────────
export async function createTextFile(parentPath: string, fileName = 'Новый файл.txt'): Promise<void> {
	try {
		const newFilePath = joinPath(parentPath, fileName);
		unwrap(await commands.createTextFile(newFilePath));

		const instanceType = getInstanceType(parentPath);
		const store = useColumnView_Store.getState();
		// Новый файл — сразу выбранный и активный (Enter → переименование).
		store.addAndSelectItemByPath(instanceType, parentPath, { name: fileName, path: newFilePath, isDir: false });
		invalidateDirCache(parentPath);
		store.refreshAffectedColumns(instanceType, [parentPath]);
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

	// Папка облачного проекта может существовать только в каталоге — создаём её
	// перед вставкой. Вне зеркала вызов ничего не делает.
	await ensureMirrorDir(destFolderPath);

	// ── Шаг 1: то, что переезжает ВНУТРИ облака ─────────────────────────────
	// Это `/rename` со сменой папки: байты не двигаются вообще, качать нечего.
	// Двинуть только на диске значило бы сломать связь с каталогом — путь перестал
	// бы разбираться, и значки исчезли бы (ровно то, что уже случалось с
	// переименованием). Поэтому такие пути уходят из работы первыми, до гидрации:
	// иначе перенос папки на 50 ГБ внутри облака сначала скачал бы её целиком.
	const черезДиск: string[] = [];
	for (const srcPath of paths) {
		try {
			if (type === 'cut' && (await moveInCloud(srcPath, destFolderPath))) {
				const srcInstanceType = getInstanceType(srcPath);
				await useColumnView_Store.getState().removeItemAndTrimColumns(srcInstanceType, srcPath);
				continue;
			}
		} catch (err) {
			// Бэкенд отказал (например, перенос между проектами он не умеет).
			// Через диск такой перенос делать нельзя — связь с каталогом порвётся.
			console.error('moveInCloud failed for', srcPath, err);
			continue;
		}
		черезДиск.push(srcPath);
	}

	// ── Шаг 2: байты ────────────────────────────────────────────────────────
	// Всё, что поедет через диск, должно на этом диске быть. Для облачной папки это
	// не мелочь: `copyItem` копирует ДИСК, а в каталоге папка может быть целиком
	// онлайн — копировалась бы пустая структура, и выглядело бы это как удача.
	// Операция ждёт скачивания, показывая прогресс (`HydrateGateOverlay`); отказ
	// («Отменить» или недокачали) отменяет вставку целиком.
	if (черезДиск.length > 0) {
		const готово = await hydrateForCopy(черезДиск, type === 'copy' ? 'Копирование' : 'Перемещение');
		if (!готово) {
			useColumnView_Store.getState().refreshAffectedColumns(instanceType, [destFolderPath]);
			return;
		}
	}

	// ── Шаг 3: обычная файловая операция ────────────────────────────────────
	for (const srcPath of черезДиск) {
		const name = basename(srcPath);
		const destPath = joinPath(destFolderPath, name);

		try {
			// `ensureLocal` здесь остаётся ради одиночного файла вне плана гидрации
			// (например, путь из системного буфера): для уже скачанного это no-op.
			const readySrc = await ensureLocal(srcPath);
			if (type === 'copy') {
				unwrap(await commands.copyItem(readySrc, destPath, { overwrite: false }));
			} else {
				unwrap(await commands.moveItem(readySrc, destPath, { overwrite: false }));
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
