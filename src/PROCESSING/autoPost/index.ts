// Core-драйвер отвязанного автопостинга (см. ideasAndTest/UNIFIED_SOURCES_ENGINE.md).
//
// Каждый виток (планировщик scheduler.ts): на каждый маршрут (Finder из postSources.json) →
// гейт (день/окно/интервал из _post-лога) → листинг папки-источника → дедуп по _post-логу →
// order → ОДИН файл → строим work-item с корнем на Finder из СКОМПИЛИРОВАННОГО пайплайна →
// processItem (он гонит Finder→Poster→copyFile…, пишет log_win, удаляет исходник по deleteAfter).
//
// Исполнение — ОБЩИЙ движок processItem (не дублируем). Драйвер делает только ВЫБОР файла
// (Слой 1) + сборку item'а; постинг и downstream — настоящие ноды графа.

import { commands, unwrap } from '@/Utils/specta';
import { joinPath } from '@/Utils/joinPath';
import { basename } from '@/Utils/path';
import { typeOfFile_store, programPathPattern_store, folderPath_store, pathPattern_store } from '@/Store/MainWin/pathPattern_store';
import { localFolders_stor } from '@/Store/MainWin/localFolders_store';
import { formatNameByPattern } from '@/Utils/formatNameByPattern';
import { usePosting_store } from '@/Store/Processing/usePosting_store';
import { clearFileNameAndID } from '../utils/clearFileNameAndID';
import { processItem } from '../processItem';
import { RUN_POSTING } from '../runLanes';
import { readAllRecords, lastPublishedAt, postedFileSet, readCooldownUntil } from './postLog';
import { platformFromPipeline } from './posters';
import type { PostRoute } from './types';

const DEFAULT_VIDEO_EXTS = ['mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi'];
const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

let postRoutes: PostRoute[] = [];

export function clearPostRoutes(): void {
	postRoutes = [];
}

function logWin(level: 'info' | 'warn' | 'error', text: string): void {
	console.log(`[autoPost:${level}] ${text}`);
	try {
		void commands.sendLog(level, text).catch(() => {});
	} catch {}
}

function segFromPath(p: string, fromEnd: number): string {
	const parts = p.split(/[\\/]+/).filter(Boolean);
	return parts.length >= fromEnd ? parts[parts.length - fromEnd] : '';
}

function dirOf(p: string): string {
	const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
	return i > 0 ? p.slice(0, i) : p;
}

function isAbs(p: string): boolean {
	return /^([A-Za-z]:[\\/]|\/)/.test(p);
}

// Полный путь папки-источника: относит. субпуть join'им с проектом, абсолют (CustomFolder) — как есть.
function srcDirOf(route: PostRoute): string {
	return isAbs(route.folder) ? route.folder : joinPath(route.projectPath, route.folder);
}

/// Читает options/postSources.json проекта (скомпилированные finders) и добавляет маршруты.
/// Вызывается из планировщика для каждого активного проекта — БЕЗУСЛОВНО (наличие файла =
/// постинг включён). options.json НЕ читается — всё уже в сайдкаре.
export async function addPostRouteFromProject(projectPath: string): Promise<void> {
	try {
		const sidecar = joinPath(projectPath, 'options', 'postSources.json');
		const exists = unwrap(await commands.checkFilePath(sidecar, null));
		if (!exists) return;
		const cfg = JSON.parse(String(unwrap(await commands.readFileSync(sidecar))));
		const finders = Array.isArray(cfg?.finders) ? cfg.finders : [];
		if (finders.length === 0) return;

		const projectName = segFromPath(projectPath, 1);
		const mainFolder = segFromPath(projectPath, 2);
		const mainFolderPath = dirOf(projectPath);

		for (const f of finders) {
			postRoutes.push({
				projectPath,
				projectName,
				mainFolder,
				mainFolderPath,
				finderId: String(f.finderId),
				folder: f.folder || 'VK_post',
				searchType: f.searchType || 'video',
				order: String(f.order ?? 'by Time'),
				interval: Number(f.interval) || 0,
				daysOfWeek: Array.isArray(f.daysOfWeek) ? f.daysOfWeek : [],
				window: (Array.isArray(f.window) && f.window.length >= 2 ? [Number(f.window[0]), Number(f.window[1])] : [0, 1440]) as [number, number],
				deleteAfter: Boolean(f.deleteAfter),
				account: f.account || '',
				platform: platformFromPipeline(Array.isArray(f.pipeline) ? f.pipeline : []),
				pipeline: Array.isArray(f.pipeline) ? f.pipeline : [],
				baseDescription: cfg.baseDescription || {},
			});
		}
	} catch (e) {
		logWin('warn', `[autoPost] postSources.json не прочитался (${projectPath}): ${String(e)}`);
	}
}

// ── Гейты расписания ─────────────────────────────────────────────────────────
function dayAllowed(now: Date, days: string[]): boolean {
	if (!Array.isArray(days) || days.length === 0) return true;
	return days.includes(DAY_LABELS[now.getDay()]);
}

function windowAllowed(now: Date, win: [number, number]): boolean {
	const start = Number(win[0]);
	const end = Number(win[1]);
	if (!(end > start)) return true;
	const cur = now.getHours() * 60 + now.getMinutes();
	return cur >= start && cur < end;
}

// ── Листинг + сортировка кандидатов ──────────────────────────────────────────
function extsForType(type: string): string[] {
	try {
		const el = typeOfFile_store.getState().patternStore.find((e) => e.name === type);
		const exts = (el?.path as string[] | undefined)?.map((x) => String(x).toLowerCase());
		if (exts && exts.length) return exts;
	} catch {}
	return DEFAULT_VIDEO_EXTS;
}

async function listByType(folderPath: string, type: string): Promise<string[]> {
	try {
		const ex = unwrap(await commands.checkFolderPath(folderPath, null));
		if (!ex) return [];
		const res = unwrap(await commands.getSomeFromFolder(folderPath, [{ type, ext: extsForType(type) }])) as any;
		const names: string[] = Array.isArray(res?.[type]) ? res[type] : [];
		return names.map((n) => joinPath(folderPath, n));
	} catch (e) {
		console.warn('[autoPost] listByType:', folderPath, e);
		return [];
	}
}

async function sortByOrder(files: string[], order: string): Promise<string[]> {
	const arr = [...files];
	if (order === 'by Name') {
		return arr.sort((a, b) => basename(a).toLowerCase().localeCompare(basename(b).toLowerCase()));
	}
	if (order === 'Random') {
		for (let i = arr.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[arr[i], arr[j]] = [arr[j], arr[i]];
		}
		return arr;
	}
	// by Time: считаем mtime, сортируем по возрастанию (старые первыми).
	const m = await Promise.all(
		arr.map(async (f) => {
			try {
				return unwrap(await commands.getStat(f)).mtimeMs;
			} catch {
				return 0;
			}
		}),
	);
	const asc = arr.map((f, i) => ({ f, m: m[i] })).sort((a, b) => a.m - b.m).map((x) => x.f);
	// 'by Time (yanger)' = новые первыми (реверс). 'by Time (older)'/legacy 'by Time' = старые первыми.
	return order === 'by Time (yanger)' ? asc.reverse() : asc;
}

// ── Оценка маршрута (Слой 1: выбор файла + статус) ───────────────────────────
interface RouteEval {
	candidates: string[];
	queued: number;
	dueIn: number | null;
	due: boolean;
}

async function evaluateRoute(route: PostRoute): Promise<RouteEval> {
	const now = new Date();
	const records = await readAllRecords(route.projectPath);
	const posted = postedFileSet(records, route.platform);
	const srcDir = srcDirOf(route);
	const all = await listByType(srcDir, route.searchType);
	const candidates = await sortByOrder(all.filter((f) => !posted.has(basename(f))), route.order);
	const queued = candidates.length;

	// Пауза аккаунта после жёсткой ошибки VK (лимит/капча/флуд) — ставит нода Poster, уважаем.
	const nowSec = Math.floor(Date.now() / 1000);
	const cdUntil = await readCooldownUntil(route.projectPath, route.account);
	const inCooldown = cdUntil > nowSec;

	// ДИАГНОСТИКА (в devtools-консоль): почему queued может быть 0 / почему не постим.
	logWin('info', `[autoPost] ${route.projectName}: dir="${srcDir}" тип=${route.searchType} найдено=${all.length} к_постингу=${queued} запощено=${posted.size} folder="${route.folder}"${inCooldown ? ` · ⏳ пауза до ${new Date(cdUntil * 1000).toLocaleTimeString()}` : ''}`);

	const scheduleOk = dayAllowed(now, route.daysOfWeek) && windowAllowed(now, route.window);
	const last = lastPublishedAt(records, route.platform, route.account);
	const intervalLeft = last ? Math.max(0, route.interval - Math.floor(Date.now() / 1000 - last)) : 0;

	const dueIn = queued > 0 && scheduleOk && !inCooldown ? intervalLeft : null;
	const due = queued > 0 && scheduleOk && intervalLeft === 0 && !inCooldown;
	return { candidates, queued, dueIn, due };
}

// ── Сборка description для work-item'а (по образцу findFilesForSingleFolder) ──
async function buildPostDescription(route: PostRoute, file: string): Promise<Record<string, any>> {
	const localFolder = localFolders_stor.getState().localFolder;
	const dateTime = formatNameByPattern({ string: '$YYYY.$DD.$MM-$HH.$mm' });
	const year = dateTime.slice(0, 4);
	const findDateName = dateTime.slice(5);

	const typeOfFile = Object.fromEntries(typeOfFile_store.getState().patternStore.map((t: any) => [t.name, t.path]));
	const programmPath = Object.fromEntries(programPathPattern_store.getState().patternStore.map((t: any) => [t.name, t.path]));
	const folderPath = Object.fromEntries(folderPath_store.getState().patternStore.map((t: any) => [t.name, t.path]));
	const pathAliases = Object.fromEntries(
		pathPattern_store.getState().patternStore.filter((t: any) => /^[A-Za-z0-9_]+$/.test(t.name)).map((t: any) => [t.name, joinPath(...(t.path ?? []))]),
	);

	let isFolder = false;
	let size = 0;
	try {
		const fi: any = unwrap(await commands.getFileInfo(file));
		isFolder = Boolean(fi?.is_dir);
		size = fi?.is_file ? fi.size : 0;
	} catch {}

	const curItemName = basename(file);
	const { id, clearName } = clearFileNameAndID(curItemName);

	return {
		...route.baseDescription,
		year,
		findTime: findDateName,
		projectName: route.projectName,
		projectPathGD: route.projectPath,
		mainFolderName: route.mainFolder,
		mainFolderPath: route.mainFolderPath,
		localFolder,
		infoText: `${route.mainFolder}/${route.projectName}`,
		typeOfFile,
		programmPath,
		folderPath,
		pathAliases,
		mainWorkFolder: joinPath(localFolder, route.mainFolder, route.projectName),
		isFolder,
		curItem: curItemName,
		id,
		clearName,
		pathForDelete: file,
		size,
	};
}

// ── Исполнение пайплайна через общий движок processItem (Слой 2) ─────────────
async function runPipeline(route: PostRoute, file: string, signal: AbortSignal): Promise<void> {
	const finderObj = route.pipeline.find((o) => o?.id === route.finderId);
	if (!finderObj) {
		logWin('error', `[autoPost] ${route.projectName}: пайплайн без Finder (${route.finderId})`);
		return;
	}

	// queue[0] = Finder (источник, output ставим тут); остальные — в топо-порядке от compile.
	const rest = route.pipeline.filter((o) => o?.id !== route.finderId);
	const item: any = { processingQueue: [route.finderId, ...rest.map((o) => o.id)] };
	for (const o of route.pipeline) item[o.id] = structuredClone(o);
	item[route.finderId].output = [file];
	item[route.finderId].deleteAfter = route.deleteAfter;
	item.description = await buildPostDescription(route, file);

	const status = await processItem(item, signal, RUN_POSTING);

	if (status === 'done') {
		try {
			const records = await readAllRecords(route.projectPath);
			const last = records
				.filter((r) => r.status === 'published')
				.sort((a, b) => (b.publishedAt || b.ts || 0) - (a.publishedAt || a.ts || 0))[0];
			usePosting_store.getState().setStatus({ lastPermalink: last?.permalink ?? null, lastError: null, lastAt: Math.floor(Date.now() / 1000) });
		} catch {}
	} else if (status === 'error') {
		usePosting_store.getState().setStatus({ lastError: 'постинг не прошёл (см. log_win)', lastAt: Math.floor(Date.now() / 1000) });
	}
}

/// Главная точка драйвера: оценивает маршруты (для статуса) и исполняет созревшие.
export async function runAutoPost(signal?: AbortSignal): Promise<void> {
	const sig = signal ?? new AbortController().signal;
	const { setStatus } = usePosting_store.getState();
	if (postRoutes.length === 0) {
		setStatus({ routesCount: 0, queuedCount: 0, nextDueAt: null });
		return;
	}

	let totalQueued = 0;
	let minDueIn: number | null = null;
	for (const route of postRoutes) {
		if (sig.aborted) return;
		try {
			const ev = await evaluateRoute(route);
			totalQueued += ev.queued;
			if (ev.dueIn != null) minDueIn = minDueIn == null ? ev.dueIn : Math.min(minDueIn, ev.dueIn);
			if (ev.due) await runPipeline(route, ev.candidates[0], sig);
		} catch (e) {
			console.warn('[autoPost] route failed:', route.projectName, e);
		}
	}
	const nextDueAt = minDueIn == null ? null : Math.floor(Date.now() / 1000) + minDueIn;
	setStatus({ routesCount: postRoutes.length, queuedCount: totalQueued, nextDueAt });
}
