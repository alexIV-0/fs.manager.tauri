// main/handlers.ts
import { BrowserWindow, clipboard, dialog, ipcMain, IpcMainInvokeEvent, shell } from 'electron';
import { windowManager } from './windowManager';
import { getNodeObjFromFile } from './fileSistem/getNodeObjFromFile';
import { saveFlowToOptionsFolder } from './fileSistem/saveFlowToOptionsFolder';
import { testAndCreateFolder } from './fileSistem/testAndCreateFolder';
import path from 'path';
import fs from 'fs';
import { createRequire } from 'module';
import { getSomeFromFolder, getSomeFromFolderAsync, recursiveFindFiles } from './fileSistem/getSomeFromFolder';
import { renameFolder } from './fileSistem/renameFolder';
import { requestFileType } from './utilits/requestFileType';
import { Description, formatNameByPattern } from './fileSistem/formatNameByPattern';
import { copyItem, moveItem, tryToUnlinkFile } from './fileSistem/copyOrMoveItem';
import { checkFilePath } from './fileSistem/checkFilePath';
import { checkFolderPath } from './fileSistem/checkFolderPath';

import { readFileSync } from './fileSistem/operation/readFileSync';
import { getFileInfo } from './fileSistem/operation/getFileInfo';
import { isPreviewBoundsLocked, consumeShouldCenter } from './previewBounds';

// ─── Native Rust addon ───────────────────────────────────────────────────────
// Собирается командой: yarn native:build
// При разработке с watch: yarn dev:native
const _require = createRequire(import.meta.url);
let nativeFs: any = null;
const _nativePath = `../../native/index.${process.platform}.node`;
try {
    nativeFs = _require(_nativePath);
    console.log(`[native] ✅ Rust addon loaded (${process.platform})`);
} catch (e: any) {
    console.warn(`[native] ⚠️  Rust addon not found at ${_nativePath}, using Node.js fallback`);
    console.warn('[native]    Run: yarn native:build');
}
// ─────────────────────────────────────────────────────────────────────────────
import { execFFmpegCommand } from './processing/ffmpeg/execFFmpegCommand';
import { getPathToProg } from './utilits/getPathToProg';
import os from 'os';
import { spawn } from 'child_process';

import chokidar, { FSWatcher } from 'chokidar';
import { optionsFolderPath } from './fileSistem/getOptionsFolder';
import { safeCopyItem, safeMoveItem } from './fileSistem/safeNativeCopy';
// Импортируем новые функции

interface SelectFoldersOptions {
	multiSelect?: boolean;
}
interface SelectFilesOptions {
	multiSelect?: boolean;
	filters?: Electron.FileFilter[];
}

interface CopyMoveOptions {
	useHashCheck?: boolean;
	overwrite?: boolean;
}

// Храним активные watcher-ы по пути
const watchers = new Map<string, FSWatcher>();

type IpcHandler = (...args: any[]) => Promise<any> | any;

const ipcHandlers: Record<string, IpcHandler> = {
	// Существующие обработчики...
	getNodeObjFromFile,
	saveFlowToOptionsFolder,
	testAndCreateFolder: async (_path: string) => {
		if (nativeFs?.testAndCreateFolder) {
			await nativeFs.testAndCreateFolder(_path);
			return _path;
		}
		return testAndCreateFolder(_path);
	},
	// Параллельное создание N папок одним IPC.
	testAndCreateFolders: async (paths: string[]) => {
		const arr = paths ?? [];
		if (nativeFs?.testAndCreateFolders) {
			await nativeFs.testAndCreateFolders(arr);
			return arr;
		}
		await Promise.all(arr.map((p) => Promise.resolve(testAndCreateFolder(p))));
		return arr;
	},
	getFileTypeByExtname: (filePath: string) => requestFileType(path.extname(filePath)),
	getFileInfo,

	formatNameByPattern: async (args: { string: string; description?: Partial<Description>; file?: string }) => {
		// description — не обязательное поле
		const { description, file, string } = args;

		// формируем объект item
		const item: Partial<Description> = description ?? {};

		// вызываем функцию с нужными параметрами
		return formatNameByPattern({ string, description, file });
	},
	selectFolders: async (options: SelectFoldersOptions = {}) => {
		const { multiSelect = false } = options;

		const result = await dialog.showOpenDialog(windowManager.getMainWin()!, {
			properties: [
				'openDirectory',
				...(multiSelect ? (['multiSelections'] as const) : []),
			] as Electron.OpenDialogOptions['properties'],
			title: 'Выберите папки',
		});

		return result.filePaths;
	},
	selectFiles: async (options: SelectFilesOptions = {}) => {
		const { multiSelect = false, filters } = options;

		const win = BrowserWindow.getFocusedWindow() ?? windowManager.getMainWin()!;
		const result = await dialog.showOpenDialog(win, {
			properties: [
				'openFile',
				...(multiSelect ? (['multiSelections'] as const) : []),
			] as Electron.OpenDialogOptions['properties'],
			title: 'Выберите файлы',
			filters: filters ?? [{ name: 'All Files', extensions: ['*'] }],
		});

		return result.filePaths;
	},
	getSomeFromFolder: async (_path: string, _search: any) => {
		const search = _search ?? [];
		if (nativeFs?.getSomeFromFolder) {
			const flat = search.map((s: any) => [s.type, ...((s.ext ?? []) as string[])]);
			return await nativeFs.getSomeFromFolder(_path, flat);
		}
		try {
			return await getSomeFromFolderAsync(_path, search);
		} catch (e: any) {
			if (e.code === 'ENOENT') {
				const result: Record<string, string[]> = {};
				for (const s of search) result[s.type] = [];
				return result;
			}
			throw e;
		}
	},
	// Параллельное чтение нескольких папок одним IPC-вызовом.
	// Возвращает Record<dirPath, Record<type, string[]>>.
	getSomeFromFolders: async (_paths: string[], _search: any) => {
		const search = _search ?? [];
		const paths = _paths ?? [];
		if (nativeFs?.getSomeFromFolders) {
			const flat = search.map((s: any) => [s.type, ...((s.ext ?? []) as string[])]);
			return await nativeFs.getSomeFromFolders(paths, flat);
		}
		const out: Record<string, Record<string, string[]>> = {};
		await Promise.all(
			paths.map(async (p: string) => {
				try {
					out[p] = await getSomeFromFolderAsync(p, search);
				} catch (e: any) {
					if (e?.code === 'ENOENT') {
						const r: Record<string, string[]> = {};
						for (const s of search) r[s.type] = [];
						out[p] = r;
					} else {
						throw e;
					}
				}
			}),
		);
		return out;
	},
	ensureAndReadDir: async (_path: string) => {
		if (nativeFs) return nativeFs.ensureAndReadDir(_path);
		// Node.js fallback: create dir then read
		await fs.promises.mkdir(_path, { recursive: true });
		return getSomeFromFolderAsync(_path, [{ type: 'files', ext: [] }, { type: 'folders', ext: [] }]);
	},
	recursiveFindFiles: async (_path: string, _search: any) => {
		if (nativeFs) {
			const exts: string[] = (_search ?? [])
				.filter((s: any) => s.type !== 'folders')
				.flatMap((s: any) => s.ext ?? []);
			return nativeFs.recursiveFindFiles(_path, exts);
		}
		return recursiveFindFiles(_path, _search);
	},

	renameFolder: async (oldPath: string, newPath: string) => {
		if (nativeFs) return nativeFs.renameFolder(oldPath, newPath);
		return await renameFolder(oldPath, newPath);
	},

	// НОВЫЕ ОБРАБОТЧИКИ ДЛЯ КОПИРОВАНИЯ И ПЕРЕМЕЩЕНИЯ
	// Файлы проверяются sample-hash'ом (первый/средний/последний MB) с retry×3.
	// Папки и same-disk rename не верифицируются (rename не двигает данные).
	copyItem: async (sourcePath: string, destinationPath: string, options: CopyMoveOptions = {}) => {
		if (nativeFs) return safeCopyItem(nativeFs, sourcePath, destinationPath, options);
		return copyItem(sourcePath, destinationPath, { ...options, useHashCheck: true });
	},

	moveItem: async (sourcePath: string, destinationPath: string, options: CopyMoveOptions = {}) => {
		if (nativeFs) return safeMoveItem(nativeFs, sourcePath, destinationPath, options);
		return moveItem(sourcePath, destinationPath, { ...options, useHashCheck: true });
	},

	deleteItem: async (itemPath: string) => {
		if (nativeFs) return nativeFs.deleteItem(itemPath);
		return tryToUnlinkFile(itemPath) === 'success';
	},

	// Методы path:
	pathJoin: async (...segments: string[]) => {
		if (nativeFs) return nativeFs.pathJoin(segments);
		return path.join(...segments);
	},
	pathBasename: async (filePath: string, ext?: string) => {
		if (nativeFs) {
			const base = nativeFs.pathBasename(filePath) as string;
			return ext && base.endsWith(ext) ? base.slice(0, -ext.length) : base;
		}
		return path.basename(filePath, ext);
	},
	pathDirname: async (filePath: string) => {
		if (nativeFs) return nativeFs.pathDirname(filePath);
		return path.dirname(filePath);
	},
	pathExtname: async (filePath: string) => {
		return path.extname(filePath);
	},
	pathParse: async (filePath: string) => {
		return path.parse(filePath);
	},
	pathRelative: async (from: string, to: string) => {
		return path.relative(from, to);
	},
	checkFilePath: async (_path: string, _name?: string) => {
		return checkFilePath(_path, _name);
	},
	checkFolderPath: async (_path: string, _name?: string) => {
		return checkFolderPath(_path, _name);
	},
	readFileSync: async (path: string) => {
		return readFileSync(path);
	},

	// Быстрая проверка наличия альфа-канала через ffprobe
	'preview:detect-alpha': async (filePath: string): Promise<boolean> => {
		if (!filePath || !fs.existsSync(filePath)) return false;
		const ffprobeBin = await Promise.race([
			getPathToProg('ffprobe'),
			new Promise<string>((resolve) => setTimeout(() => resolve(''), 4000)),
		]);
		if (!ffprobeBin) return false;

		try {
			const { stdout } = await execFFmpegCommand(
				`"${ffprobeBin}" -v error -select_streams v:0 -show_entries stream=pix_fmt -of csv=p=0 "${filePath}"`,
			);
			const pixFmt = stdout.trim();
			console.log(`[preview:detect-alpha] ${path.basename(filePath)} pix_fmt=${pixFmt}`);
			return /^(yuva|rgba|gbra|argb|abgr|bgra|ya8|ya16)/.test(pixFmt);
		} catch (e: any) {
			console.error('[preview:detect-alpha] ffprobe error:', e?.stderr || e?.error?.message || e);
			return false;
		}
	},

	// Конвертация видео с альфа-каналом в WebM VP9 (Chromium рендерит альфу только в VP9/VP8 + yuva420p)
	'preview:make-alpha-webm': async (filePath: string): Promise<string> => {
		if (!filePath || !fs.existsSync(filePath)) return '';
		const ffmpegBin = await Promise.race([
			getPathToProg('ffmpeg'),
			new Promise<string>((resolve) => setTimeout(() => resolve(''), 4000)),
		]);
		if (!ffmpegBin) return '';

		const tmpFile = path.join(os.tmpdir(), `alpha_prev_${Date.now()}.webm`);

		const args = [
			'-y',
			'-loglevel', 'error',
			'-i', filePath,
			'-vf', 'setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709,format=yuva420p',
			'-c:v', 'libvpx-vp9',
			'-auto-alt-ref', '0',
			'-deadline', 'realtime',
			'-cpu-used', '8',
			'-b:v', '2M',
			'-c:a', 'libopus',
			tmpFile,
		];

		console.log(`[preview:make-alpha-webm] starting ffmpeg ${args.map(a => a.includes(' ') ? `"${a}"` : a).join(' ')}`);

		const result = await new Promise<{ ok: boolean; stderr: string }>((resolve) => {
			const proc = spawn(ffmpegBin, args);
			let stderr = '';
			proc.stderr.on('data', (chunk: Buffer) => {
				stderr += chunk.toString();
			});
			proc.on('error', (err: any) => {
				console.error('[preview:make-alpha-webm] spawn error:', err);
				resolve({ ok: false, stderr: String(err?.message || err) });
			});
			proc.on('close', (code: number) => {
				resolve({ ok: code === 0, stderr });
			});
		});

		if (!result.ok || !fs.existsSync(tmpFile)) {
			console.error(`[preview:make-alpha-webm] failed:\n${result.stderr.split('\n').slice(-15).join('\n')}`);
			if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
			return '';
		}

		console.log(`[preview:make-alpha-webm] ok → ${tmpFile}`);
		return tmpFile;
	},

	// Транскод неподдерживаемых Chromium форматов (ProRes и т.д.) в WebM VP9 для воспроизведения в <video> (с сохранением альфа-канала если есть)
	'preview:transcode-webm': async (filePath: string): Promise<string> => {
		if (!filePath || !fs.existsSync(filePath)) return '';
		const ffmpegBin = await Promise.race([
			getPathToProg('ffmpeg'),
			new Promise<string>((resolve) => setTimeout(() => resolve(''), 4000)),
		]);
		if (!ffmpegBin) return '';

		const tmpFile = path.join(os.tmpdir(), `preview_vp9_${Date.now()}.webm`);

		const args = [
			'-y',
			'-loglevel', 'error',
			'-i', filePath,
			'-vf', 'setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709,format=yuva420p',
			'-c:v', 'libvpx-vp9',
			'-auto-alt-ref', '0',
			'-deadline', 'realtime',
			'-cpu-used', '8',
			'-b:v', '2M',
			'-c:a', 'libopus',
			tmpFile,
		];

		console.log(`[preview:transcode-webm] using ffmpeg: ${ffmpegBin}`);
		console.log(`[preview:transcode-webm] args: ${args.map(a => a.includes(' ') ? `"${a}"` : a).join(' ')}`);

		const result = await new Promise<{ ok: boolean; stderr: string }>((resolve) => {
			const proc = spawn(ffmpegBin, args);
			let stderr = '';
			proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
			proc.on('error', (err: any) => resolve({ ok: false, stderr: String(err?.message || err) }));
			proc.on('close', (code: number) => resolve({ ok: code === 0, stderr }));
		});

		if (!result.ok || !fs.existsSync(tmpFile)) {
			console.error(`[preview:transcode-webm] failed:\n${result.stderr.split('\n').slice(-15).join('\n')}`);
			if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
			return '';
		}

		console.log(`[preview:transcode-webm] ok → ${tmpFile}`);
		return tmpFile;
	},

	'preview:delete-temp': async (filePath: string): Promise<void> => {
		try {
			if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
		} catch {}
	},

	// Чтение медиафайла как base64 data URL (для превью в canvas без CORS-ограничений)
	'read-media-preview': async (filePath: string): Promise<string> => {
		if (!filePath || !fs.existsSync(filePath)) return '';

		const ext = path.extname(filePath).toLowerCase().slice(1);
		const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tif', 'tiff']);
		const VIDEO_EXTS = new Set(['mp4', 'mov', 'avi', 'mkv', 'webm', 'mts', 'mxf', 'm4v']);

		if (IMAGE_EXTS.has(ext)) {
			const buffer = fs.readFileSync(filePath);
			const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
				: ext === 'png' ? 'image/png'
				: ext === 'gif' ? 'image/gif'
				: ext === 'webp' ? 'image/webp'
				: 'image/bmp';
			return `data:${mime};base64,${buffer.toString('base64')}`;
		}

		if (VIDEO_EXTS.has(ext)) {
			const ffmpegBin = await getPathToProg('ffmpeg');
			if (!ffmpegBin) return '';
			const tmpFile = path.join(os.tmpdir(), `overlay_preview_${Date.now()}.png`);
			try {
				const cmd = `"${ffmpegBin}" -y -i "${filePath}" -ss 0 -vframes 1 -pix_fmt rgba "${tmpFile}"`;
				await execFFmpegCommand(cmd);
				if (fs.existsSync(tmpFile)) {
					const buffer = fs.readFileSync(tmpFile);
					fs.unlinkSync(tmpFile);
					return `data:image/png;base64,${buffer.toString('base64')}`;
				}
			} catch {
				if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
			}
			return '';
		}

		return '';
	},

	// Keying preview: применяет ffmpeg-фильтры кеинга к одному кадру, возвращает base64 PNG
	'keying-preview': async (args: {
		filePath: string;
		timecode: number;       // секунды
		filterString: string;   // уже собранная строка -vf фильтров
	}): Promise<string> => {
		const { filePath, timecode, filterString } = args;
		if (!filePath || !fs.existsSync(filePath)) return '';

		const ffmpegBin = await getPathToProg('ffmpeg');
		if (!ffmpegBin) return '';

		const tmpFile = path.join(os.tmpdir(), `keying_preview_${Date.now()}.png`);
		try {
			const tc = Math.max(0, timecode).toFixed(3);
			const vf = filterString || 'null';
			const cmd = `"${ffmpegBin}" -y -ss ${tc} -i "${filePath}" -vframes 1 -vf "${vf}" -pix_fmt rgba "${tmpFile}"`;
			await execFFmpegCommand(cmd);
			if (fs.existsSync(tmpFile)) {
				const buffer = fs.readFileSync(tmpFile);
				fs.unlinkSync(tmpFile);
				return `data:image/png;base64,${buffer.toString('base64')}`;
			}
		} catch {
			if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
		}
		return '';
	},

	// Convert preview: applies video/image ffmpeg filters to a single frame, returns base64 PNG
	'convert-preview': async (args: {
		filePath: string;
		timecode: number;       // seconds (ignored for static images)
		filterString: string;   // already-assembled -vf filter chain (or 'null')
	}): Promise<string> => {
		const { filePath, timecode, filterString } = args;
		if (!filePath || !fs.existsSync(filePath)) return '';

		const ffmpegBin = await getPathToProg('ffmpeg');
		if (!ffmpegBin) return '';

		const tmpFile = path.join(os.tmpdir(), `convert_preview_${Date.now()}.png`);
		const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff', '.tif', '.tga', '.dpx']);
		const isImage    = IMAGE_EXTS.has(path.extname(filePath).toLowerCase());

		try {
			const vf  = filterString && filterString !== 'null' ? filterString : 'null';
			let cmd: string;
			if (isImage) {
				// Static image: no timecode seek needed
				cmd = `"${ffmpegBin}" -y -i "${filePath}" -vframes 1 -vf "${vf}" -pix_fmt rgb24 "${tmpFile}"`;
			} else {
				const tc = Math.max(0, timecode).toFixed(3);
				cmd = `"${ffmpegBin}" -y -ss ${tc} -i "${filePath}" -vframes 1 -vf "${vf}" -pix_fmt rgba "${tmpFile}"`;
			}
			await execFFmpegCommand(cmd);
			if (fs.existsSync(tmpFile)) {
				const buffer = fs.readFileSync(tmpFile);
				fs.unlinkSync(tmpFile);
				return `data:image/png;base64,${buffer.toString('base64')}`;
			}
		} catch {
			if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
		}
		return '';
	},

	// Keying eyedropper: получает цвет пикселя из кадра видео/картинки
	'keying-pick-color': async (args: {
		filePath: string;
		timecode: number;
		x: number;              // нормализованные координаты 0.0–1.0
		y: number;
	}): Promise<string> => {
		const { filePath, timecode, x, y } = args;
		if (!filePath || !fs.existsSync(filePath)) return '#000000';

		const ffprobeBin = await getPathToProg('ffprobe');
		const ffmpegBin = await getPathToProg('ffmpeg');
		if (!ffmpegBin || !ffprobeBin) return '#000000';

		try {
			// Определяем размер кадра через ffprobe
			const probeCmd = `"${ffprobeBin}" -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0:s=x "${filePath}"`;
			const probeResult = await execFFmpegCommand(probeCmd);
			const [wStr, hStr] = probeResult.stdout.trim().split('x');
			const frameW = parseInt(wStr);
			const frameH = parseInt(hStr);
			if (!frameW || !frameH) return '#000000';

			const px = Math.round(x * frameW);
			const py = Math.round(y * frameH);

			// Извлекаем один пиксель через crop + вывод в rawvideo
			const tc = Math.max(0, timecode).toFixed(3);
			const tmpFile = path.join(os.tmpdir(), `keying_pixel_${Date.now()}.raw`);
			const cmd = `"${ffmpegBin}" -y -ss ${tc} -i "${filePath}" -vframes 1 -vf "crop=1:1:${px}:${py}" -f rawvideo -pix_fmt rgb24 "${tmpFile}"`;
			await execFFmpegCommand(cmd);

			if (fs.existsSync(tmpFile)) {
				const buf = fs.readFileSync(tmpFile);
				fs.unlinkSync(tmpFile);
				if (buf.length >= 3) {
					const r = buf[0].toString(16).padStart(2, '0');
					const g = buf[1].toString(16).padStart(2, '0');
					const b = buf[2].toString(16).padStart(2, '0');
					return `#${r}${g}${b}`;
				}
			}
		} catch {}
		return '#000000';
	},

	// Получить путь к userData
	getUserDataPath: async () => {
		return optionsFolderPath;
	},

	// Записать файл (создаёт папки если нужно)
	writeFile: async (filePath: string, content: string) => {
		const dir = path.dirname(filePath);
		if (!fs.existsSync(dir)) {
			fs.mkdirSync(dir, { recursive: true });
		}
		fs.writeFileSync(filePath, content, 'utf-8');
		return { success: true };
	},

	// Открытие второго окна
	openNodeWindow: async () => {
		const nodeWin = windowManager.getNodeWin();
		if (nodeWin) {
			nodeWin.focus();
			return;
		}
		const win = new BrowserWindow({
			webPreferences: {
				preload: path.join(__dirname, 'preload.js'),
			},
		});
		win.removeMenu();
		windowManager.setNodeWin(win);
		win.loadFile(path.join(process.env.APP_ROOT!, 'node.html'));
		win.on('closed', () => {
			windowManager.setNodeWin(null);
		});
	},

	// Запрос на данные из второго окна
	requestDataFromMainWindow: async () => {
		const mainWin = windowManager.getMainWin();
		if (mainWin) {
			mainWin.webContents.send('give-data');
		}
	},

	// Отправка данных во второе окно
	sendDataToNodeWindow: async (data: any) => {
		const nodeWin = windowManager.getNodeWin();
		if (nodeWin) {
			nodeWin.webContents.send('update-data', data);
		}
	},

	// Новый обработчик
	getPathsFromFiles: async (files: FileList): Promise<string[]> => {
		return Array.from(files).map((file) => (file as any).path as string);
	},

	'shell:openPath': async (folderPath: string) => {
		await shell.openPath(folderPath);
	},

	openFileWithDefaultApp: async (filePath: string) => {
		const result = await shell.openPath(filePath);
		if (result) throw new Error(result); // shell.openPath returns '' on success, error string on failure
	},

	showInFolder: async (itemPath: string) => {
		shell.showItemInFolder(itemPath);
	},

	copyToClipboard: async (text: string) => {
		clipboard.writeText(text);
	},

	renameFile: async (oldPath: string, newPath: string) => {
		await fs.promises.rename(oldPath, newPath);
		return true;
	},

	createFolder: async (folderPath: string) => {
		fs.mkdirSync(folderPath, { recursive: true });
		return true;
	},

	// ── Plugin Builder (dev-only) ──────────────────────────────────────────────
	getPluginsDevPath: async () => {
		return path.join(process.cwd(), 'plugins-dev');
	},

	'plugin:build': async (pluginFolderName: string) => {
		const { exec } = await import('child_process');
		const { promisify } = await import('util');
		const execAsync = promisify(exec);
		const root = process.cwd();
		try {
			const { stdout, stderr } = await execAsync(
				`node plugins-dev/_packScripts/build-plugin.js "${pluginFolderName}"`,
				{ cwd: root },
			);
			return { success: true, stdout, stderr };
		} catch (err: any) {
			return { success: false, error: err.message, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
		}
	},

	'app:getVersion': async () => {
		const { app } = await import('electron');
		return app.getVersion();
	},

	createTextFile: async (filePath: string) => {
		const dir = path.dirname(filePath);
		if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
		fs.writeFileSync(filePath, '', 'utf-8');
		return true;
	},

	// Изменение размера окна превью под контент (видео/фото/аудио).
	// Если для текущего типа файла уже есть сохранённые бунды — пропускаем
	// setContentSize/center, чтобы не сбросить восстановленные размер и позицию.
	// setAspectRatio оставляем всегда — это констрейнт для последующих ресайзов пользователем.
	'preview:resize': async (opts: {
		width: number;
		height: number;
		aspectRatio?: number;
		extraHeight?: number;
	}) => {
		const previewWin = windowManager.getPreviewWin();
		if (!previewWin || previewWin.isDestroyed()) return;
		const { width, height, aspectRatio, extraHeight } = opts;
		const locked = isPreviewBoundsLocked();
		if (!locked) {
			previewWin.setContentSize(Math.round(width), Math.round(height));
		}
		if (aspectRatio && aspectRatio > 0) {
			previewWin.setAspectRatio(aspectRatio, { width: 0, height: extraHeight || 0 });
		} else {
			previewWin.setAspectRatio(0);
		}
		if (!locked && consumeShouldCenter()) {
			previewWin.center();
		}
	},

	'fs-watch:start': async (folderPath: string) => {
		const mainWin = windowManager.getMainWin();
		if (!mainWin) return;
		startWatch(folderPath, mainWin);
	},

	'fs-watch:stop': async (folderPath: string) => {
		stopWatch(folderPath);
	},

	// ── Добавить в объект ipcHandlers в electron/main/handlers.ts ───────────────

	// 1. Список шрифтов — быстро, без чтения файлов
	'fonts:get-list': async () => {
		const os = (await import('os')).default;
		const fs = (await import('fs')).default;
		const nodePath = (await import('path')).default;

		const platform = process.platform;
		const fontDirs: string[] = [];

		if (platform === 'darwin') {
			fontDirs.push('/System/Library/Fonts', '/Library/Fonts', nodePath.join(os.homedir(), 'Library', 'Fonts'));
		} else if (platform === 'win32') {
			fontDirs.push('C:\\Windows\\Fonts', nodePath.join(os.homedir(), 'AppData', 'Local', 'Microsoft', 'Windows', 'Fonts'));
		} else {
			fontDirs.push(
				'/usr/share/fonts',
				'/usr/local/share/fonts',
				nodePath.join(os.homedir(), '.fonts'),
				nodePath.join(os.homedir(), '.local', 'share', 'fonts'),
			);
		}

		const LOADABLE_EXT = new Set(['.ttf', '.otf', '.woff', '.woff2']);
		const ALL_EXT = new Set(['.ttf', '.otf', '.woff', '.woff2', '.ttc']);

		const seen = new Set<string>();
		const results: Array<{ name: string; path: string; loadable: boolean }> = [];

		const walk = (dir: string) => {
			if (!fs.existsSync(dir)) return;
			try {
				const entries = fs.readdirSync(dir, { withFileTypes: true });
				for (const entry of entries) {
					const full = nodePath.join(dir, entry.name);
					if (entry.isDirectory()) {
						walk(full);
						continue;
					}
					const ext = nodePath.extname(entry.name).toLowerCase();
					if (!ALL_EXT.has(ext)) continue;
					const name = nodePath.basename(entry.name, ext);
					if (seen.has(name)) continue;
					seen.add(name);
					results.push({ name, path: full, loadable: LOADABLE_EXT.has(ext) });
				}
			} catch {
				/* нет доступа */
			}
		};

		for (const dir of fontDirs) walk(dir);
		return results.sort((a, b) => a.name.localeCompare(b.name));
	},

	// 2. Читает один файл → data: URL с предварительной валидацией OS/2 таблицы
	'fonts:load-one': async (fontPath: string) => {
		const fs = (await import('fs')).default;
		const nodePath = (await import('path')).default;

		try {
			if (!fs.existsSync(fontPath)) return null;

			const ext = nodePath.extname(fontPath).toLowerCase();
			if (ext === '.ttc') return null; // коллекции не поддерживаются FontFace

			const buffer = fs.readFileSync(fontPath);

			// ── Валидация: проверяем наличие таблицы OS/2 в TTF/OTF ─────────────
			// Хромиум требует OS/2 для рендеринга — без неё отклоняет шрифт
			if (ext === '.ttf' || ext === '.otf') {
				if (!hasOS2Table(buffer)) return null;
			}

			const mime =
				ext === '.woff2' ? 'font/woff2' : ext === '.woff' ? 'font/woff' : ext === '.otf' ? 'font/otf' : 'font/truetype';

			return `data:${mime};base64,${buffer.toString('base64')}`;
		} catch {
			return null;
		}
	},
};

// Проверяет наличие таблицы OS/2 в TTF/OTF файле
// Хромиум отклоняет шрифты без этой таблицы с ошибкой "OTS parsing error: OS/2: missing required table"

function hasOS2Table(buffer: Buffer): boolean {
	try {
		// Структура TTF/OTF:
		// Offset 0: sfVersion (4 bytes)
		// Offset 4: numTables (2 bytes)
		// Offset 6: searchRange, entrySelector, rangeShift (6 bytes total)
		// Offset 12: table records, каждый по 16 байт:
		//   tag (4 bytes) + checkSum (4 bytes) + offset (4 bytes) + length (4 bytes)

		if (buffer.length < 12) return false;

		const numTables = buffer.readUInt16BE(4);
		const tableStart = 12;

		for (let i = 0; i < numTables; i++) {
			const recordOffset = tableStart + i * 16;
			if (recordOffset + 4 > buffer.length) break;

			// Читаем tag как 4-символьную ASCII строку
			const tag = buffer.toString('ascii', recordOffset, recordOffset + 4);
			if (tag === 'OS/2') return true;
		}

		return false;
	} catch {
		return false;
	}
}
/**
 * Запускаем слежку за папкой.
 * При любом изменении шлём в renderer событие 'fs:changed' с путём изменившейся папки.
 */
export function startWatch(folderPath: string, win: BrowserWindow) {
	// Если уже следим — не дублируем
	if (watchers.has(folderPath)) return;

	const watcher = chokidar.watch(folderPath, {
		ignored: /node_modules/,
		ignoreInitial: true,
		depth: 2, // смотрим на 2 уровня вглубь — папки проекта + их содержимое
		// awaitWriteFinish: {
		// 	stabilityThreshold: 300,
		// 	pollInterval: 100,
		// },
	});

	watcher.on('all', (_event, changedPath) => {
		if (win.isDestroyed()) return;

		// Отправляем путь изменившегося файла/папки — renderer сам поймёт какую колонку обновить
		win.webContents.send('fs:changed', changedPath);
	});

	watchers.set(folderPath, watcher);
}

/**
 * Останавливаем слежку за конкретной папкой
 */
export function stopWatch(folderPath: string) {
	const watcher = watchers.get(folderPath);
	if (watcher) {
		watcher.close();
		watchers.delete(folderPath);
	}
}

/**
 * Останавливаем все watcher-ы (при закрытии приложения)
 */
export function stopAllWatchers() {
	watchers.forEach((w) => w.close());
	watchers.clear();
}

function registerIpcHandlers() {
	Object.entries(ipcHandlers).forEach(([channel, handler]) => {
		ipcMain.handle(channel, async (event, ...args: Parameters<typeof handler>) => {
			try {
				return await handler(...args);
			} catch (error) {
				console.error(`Error in ${channel}:`, error);
				return { error: error instanceof Error ? error.message : String(error) };
			}
		});
	});
}

export { registerIpcHandlers };
// ipcMain.handle('invoke-function', async (event, fnName: string, ...args: any[]) => {
// 	const handler = ipcHandlers[fnName];
// 	if (!handler) {
// 		const errMsg = `Handler ${fnName} not found`;
// 		console.error(errMsg);
// 		throw new Error(errMsg);
// 	}

// 	try {
// 		return await handler(...args);
// 	} catch (error) {
// 		console.error(`Error in ${fnName}:`, error);
// 		// возвращаем объект ошибки, как у тебя было раньше
// 		return { error: error instanceof Error ? error.message : String(error) };
// 	}
// });
