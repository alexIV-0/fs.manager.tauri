// Core-раннер сбора из Telegram (плагин autoTGcollect — только конфиг-нода).
//
// Поток: routing map (из options/tgSearch.json активных проектов) → группируем по боту →
// getUpdates(offset) → маршрут по (chat_id, thread_id) → скачиваем в staging внутри папки
// проекта → атомарный move в IN → подтверждаем offset на сервере → onCollected (✅ / delete).
//
// Дедуп — серверный offset getUpdates (подтверждаем после обработки батча, поэтому переживает
// рестарт). Имена файлов стабильны → повторное скачивание (если что) перезапишет, не задвоит.
// MVP: облачный Bot API (≤20 МБ), один тип на ноду, stream (без сессий/альбомов — фаза 2).

import { commands, unwrap } from '@/Utils/specta';
import { joinPath } from '@/Utils/joinPath';
import { ensureDir } from '@/Utils/storageSeam';

const PLATFORM = 'telegram';
// Реакция-«забрано». ✅ не входит в стандартный набор реакций Telegram → используем 👍.
const COLLECTED_REACTION = '👍';

interface TgRoute {
	projectPath: string;
	mainFolder: string;
	account: string;
	chatId: number | null;
	threadId: number | null;
	collectType: string;
	deleteAfterDownload: boolean;
}

let tgRoutes: TgRoute[] = [];
// offset per bot (key = mainFolder::account) — переживает витки в рамках сессии обработки.
const offsetByKey: Map<string, number> = new Map();

export function clearTgRoutes(): void {
	tgRoutes = [];
}

function mainFolderFromProjectPath(projectPath: string): string {
	const parts = projectPath.split(/[\\/]+/).filter(Boolean);
	return parts.length >= 2 ? parts[parts.length - 2] : '';
}

/// Читает options/tgSearch.json проекта и добавляет маршрут (если файл есть).
/// Вызывается из findAllFilesForProcess для каждого активного проекта — БЕЗУСЛОВНО,
/// до IN-гейта (наличие файла = поиск включён).
export async function addTgRouteFromProject(projectPath: string): Promise<void> {
	try {
		const sidecar = joinPath(projectPath, 'options', 'tgSearch.json');
		const exists = unwrap(await commands.checkFilePath(sidecar, null));
		if (!exists) return;
		const cfg = JSON.parse(unwrap(await commands.readFileSync(sidecar)));
		if (!cfg) return;
		tgRoutes.push({
			projectPath,
			mainFolder: mainFolderFromProjectPath(projectPath),
			account: cfg.account ?? '',
			chatId: cfg.chatId ?? null,
			threadId: cfg.threadId ?? null,
			collectType: cfg.collect?.type ?? 'video',
			deleteAfterDownload: Boolean(cfg.deleteAfterDownload),
		});
	} catch (e) {
		console.warn('[tgCollect] addTgRouteFromProject:', projectPath, e);
	}
}

// Достаёт медиа из сообщения по типу маршрута. null = в этом сообщении нет нужного типа.
function pickMedia(collectType: string, msg: any, chatId: number, msgId: number): { fileId: string; name: string } | null {
	switch (collectType) {
		case 'video': {
			const m = msg.video;
			return m?.file_id ? { fileId: m.file_id, name: m.file_name || `video_${chatId}_${msgId}.mp4` } : null;
		}
		case 'photo': {
			const arr = msg.photo;
			if (!Array.isArray(arr) || arr.length === 0) return null;
			const m = arr[arr.length - 1]; // самый крупный размер
			return m?.file_id ? { fileId: m.file_id, name: `photo_${chatId}_${msgId}.jpg` } : null;
		}
		case 'audio': {
			const m = msg.audio || msg.voice;
			if (!m?.file_id) return null;
			const ext = msg.voice ? 'ogg' : 'mp3';
			return { fileId: m.file_id, name: m.file_name || `audio_${chatId}_${msgId}.${ext}` };
		}
		case 'document': {
			const m = msg.document;
			return m?.file_id ? { fileId: m.file_id, name: m.file_name || `document_${chatId}_${msgId}` } : null;
		}
		default:
			return null; // text — отдельно
	}
}

// Имя в IN сохраняем оригинальное; при коллизии добавляем суффикс « (1)», « (2)»…
async function resolveCollisionName(inDir: string, name: string): Promise<string> {
	const taken = async (n: string) => unwrap(await commands.checkFilePath(joinPath(inDir, n), null));
	if (!(await taken(name))) return name;
	const dot = name.lastIndexOf('.');
	const base = dot > 0 ? name.slice(0, dot) : name;
	const ext = dot > 0 ? name.slice(dot) : '';
	for (let i = 1; ; i++) {
		const candidate = `${base} (${i})${ext}`;
		if (!(await taken(candidate))) return candidate;
	}
}

async function moveToIn(projectPath: string, name: string, stagingPath: string): Promise<void> {
	const inDir = joinPath(projectPath, 'IN');
	// Через шов: в зеркале папка обязана появиться в каталоге, иначе для облака и
	// сайта её не существует (нет `file_id`, нет значка, нельзя переименовать).
	await ensureDir(inDir);
	const finalName = await resolveCollisionName(inDir, name);
	const dest = joinPath(inDir, finalName);
	unwrap(await commands.moveItem(stagingPath, dest, null));
}

// ── Очередь повторов скачивания ──────────────────────────────────────────────
// Если файл найден, но не скачался (напр. >20МБ на облачном Bot API), апдейт всё равно
// «съедается» offset'ом и сообщение больше не придёт. Но file_id у Telegram ДОЛГОЖИВУЩИЙ —
// его можно докачать позже (getFile по file_id не зависит от буфера апдейтов). Поэтому пишем
// такие файлы в options/_collect_pending.json и повторяем в начале каждого витка. Когда
// поднимем локальный Bot API server (снимает лимит) — недокачанное заберётся само.
const MAX_RETRY_TRIES = 200; // защита от «вечного» файла (реально неподъёмного) ~ дни попыток

function pendingPath(projectPath: string): string {
	return joinPath(projectPath, 'options', '_collect_pending.json');
}

async function readPending(projectPath: string): Promise<any[]> {
	try {
		const p = pendingPath(projectPath);
		if (!unwrap(await commands.checkFilePath(p, null))) return [];
		const arr = JSON.parse(unwrap(await commands.readFileSync(p)) || '[]');
		return Array.isArray(arr) ? arr : [];
	} catch {
		return [];
	}
}

async function writePending(projectPath: string, arr: any[]): Promise<void> {
	const p = pendingPath(projectPath);
	if (arr.length === 0) {
		await commands.deleteItem(p).catch(() => {});
		return;
	}
	// pending.json — состояние сбора, пишем атомарно (обрыв не должен оставить огрызок)
	unwrap(await commands.writeFileAtomic(p, JSON.stringify(arr, null, 2)));
}

async function addPending(
	route: TgRoute,
	item: { fileId: string; name: string; chatId: number; messageId: number; error: string },
): Promise<void> {
	try {
		const arr = await readPending(route.projectPath);
		if (arr.some((x) => x.fileId === item.fileId)) return; // уже в очереди
		arr.push({ ...item, threadId: route.threadId, deleteAfterDownload: route.deleteAfterDownload, tries: 0 });
		await writePending(route.projectPath, arr);
	} catch (e) {
		console.warn('[tgCollect] addPending:', e);
	}
}

/// Повтор недокачанного по file_id. Успех → move в IN + onCollected + убрать из очереди.
async function retryPending(token: string, projectPath: string, signal?: AbortSignal): Promise<void> {
	const arr = await readPending(projectPath);
	if (arr.length === 0) return;
	console.log(`[tgCollect] повтор недокачанных: ${arr.length} (${projectPath})`);
	const remaining: any[] = [];
	for (const item of arr) {
		if (signal?.aborted) {
			remaining.push(item);
			continue;
		}
		try {
			const staging = joinPath(projectPath, `.tg_${item.name}`);
			unwrap(await commands.tgFetchFile(token, item.fileId, staging));
			await moveToIn(projectPath, item.name, staging);
			console.log(`[tgCollect]   ✓ повтор собрано → ${projectPath}/IN (${item.name})`);
			if (item.deleteAfterDownload) await commands.tgDeleteMessage(token, item.chatId, item.messageId).catch(() => {});
			else await commands.tgSetReaction(token, item.chatId, item.messageId, COLLECTED_REACTION).catch(() => {});
		} catch (e) {
			const tries = (item.tries ?? 0) + 1;
			if (tries >= MAX_RETRY_TRIES) {
				console.warn(`[tgCollect] отказ от файла после ${tries} попыток: ${item.name} — ${String(e)}`);
			} else {
				remaining.push({ ...item, tries });
			}
		}
	}
	await writePending(projectPath, remaining);
}

async function handleMessage(token: string, route: TgRoute, msg: any): Promise<boolean> {
	const chatId = msg.chat?.id;
	const msgId = msg.message_id;
	if (chatId == null || msgId == null) return false;

	// text → пишем в .txt
	if (route.collectType === 'text') {
		const text: string = msg.text ?? msg.caption ?? '';
		if (!text) return false;
		const name = `text_${chatId}_${msgId}.txt`;
		const staging = joinPath(route.projectPath, `.tg_${name}`);
		unwrap(await commands.writeFile(staging, text));
		await moveToIn(route.projectPath, name, staging);
		return true;
	}

	const media = pickMedia(route.collectType, msg, chatId, msgId);
	if (!media) return false;

	const staging = joinPath(route.projectPath, `.tg_${media.name}`);
	try {
		unwrap(await commands.tgFetchFile(token, media.fileId, staging)); // staging внутри папки проекта
	} catch (e) {
		// Скачивание упало (напр. >20МБ на облачном Bot API) → в очередь повторов по file_id.
		// НЕ помечаем ✅ и не удаляем исходник — заберём, когда поднимется локальный сервер.
		await addPending(route, { fileId: media.fileId, name: media.name, chatId, messageId: msgId, error: String(e) });
		console.warn(`[tgCollect] скачивание не удалось → в очередь повторов: ${media.name} — ${String(e)}`);
		return false;
	}
	await moveToIn(route.projectPath, media.name, staging); // атомарный move → IN
	return true;
}

async function collectForBot(key: string, routes: TgRoute[], signal?: AbortSignal): Promise<void> {
	const [mainFolder, account] = key.split('::');
	const token = unwrap(await commands.accountGetToken(mainFolder, PLATFORM, account));

	// 0) Сначала повторяем ранее не скачанное (file_id durable) — даже если новых апдейтов нет.
	const projects = Array.from(new Set(routes.map((r) => r.projectPath)));
	for (const p of projects) {
		if (signal?.aborted) return;
		await retryPending(token, p, signal).catch((e) => console.warn('[tgCollect] retryPending:', e));
	}

	const offset = offsetByKey.get(key);
	const updates = unwrap(await commands.tgGetUpdates(token, offset ?? null)) as any[];
	const count = Array.isArray(updates) ? updates.length : 0;
	console.log(
		`[tgCollect] бот "${account}": апдейтов ${count}; маршруты:`,
		routes.map((r) => `chat=${r.chatId} thread=${r.threadId} type=${r.collectType}`),
	);
	if (count === 0) return;

	let maxId = offset ? offset - 1 : -1;
	for (const u of updates) {
		if (signal?.aborted) return;
		if (typeof u.update_id === 'number' && u.update_id > maxId) maxId = u.update_id;

		const msg = u.message ?? u.channel_post;
		if (!msg) continue;
		const chatId = msg.chat?.id;
		const threadId = msg.message_thread_id ?? null;

		console.log(
			`[tgCollect] msg chat=${chatId} thread=${threadId} from_bot=${!!msg.from?.is_bot} ` +
				`video=${!!msg.video} photo=${!!msg.photo} audio=${!!(msg.audio || msg.voice)} doc=${!!msg.document}`,
		);

		// Не собираем сообщения ботов (в т.ч. результаты собственного автопостинга в эту же тему).
		if (msg.from?.is_bot) continue;

		// маршрут: по chatId + теме. Нюанс Telegram: General = thread 1 ИЛИ отсутствует,
		// причём входящие в General приходят БЕЗ thread_id → нормализуем 1≡null. Именованные
		// темы (id≥2) сравниваем точно, чтобы не таскать чужие темы группы.
		const isGeneral = (t: number | null) => t == null || t === 1;
		const route = routes.find(
			(r) =>
				r.chatId != null &&
				r.chatId === chatId &&
				(isGeneral(r.threadId) ? isGeneral(threadId) : r.threadId === threadId),
		);
		if (!route) {
			console.log(`[tgCollect]   → нет маршрута (ожидается chat=${routes[0]?.chatId} thread=${routes.map((r) => r.threadId).join('/')})`);
			continue;
		}

		try {
			const ok = await handleMessage(token, route, msg);
			if (!ok) continue;
			console.log(`[tgCollect]   ✓ собрано → ${route.projectPath}/IN`);
			// onCollected (best-effort): удалить исходник или пометить реакцией.
			if (route.deleteAfterDownload) {
				await commands.tgDeleteMessage(token, chatId, msg.message_id).catch(() => {});
			} else {
				await commands.tgSetReaction(token, chatId, msg.message_id, COLLECTED_REACTION).catch(() => {});
			}
		} catch (e) {
			console.warn('[tgCollect] handleMessage failed:', e);
		}
	}

	// Подтверждаем offset на сервере → апдейты <= maxId больше не вернутся (переживает рестарт).
	if (maxId >= 0) {
		offsetByKey.set(key, maxId + 1);
		try {
			await commands.tgGetUpdates(token, maxId + 1);
		} catch {
			/* подтверждение best-effort */
		}
	}
}

/// Главная точка раннера. Группирует маршруты по боту и сливает апдейты каждого.
/// Вызывается из runProcessing в начале витка (параллельно обработке и ожиданию).
export async function runTgCollect(signal?: AbortSignal): Promise<void> {
	if (tgRoutes.length === 0) return;

	const groups = new Map<string, TgRoute[]>();
	for (const r of tgRoutes) {
		if (!r.account || r.chatId == null) continue;
		const key = `${r.mainFolder}::${r.account}`;
		const list = groups.get(key) ?? [];
		list.push(r);
		groups.set(key, list);
	}

	for (const [key, routes] of groups) {
		if (signal?.aborted) return;
		try {
			await collectForBot(key, routes, signal);
		} catch (e) {
			console.warn('[tgCollect] bot group failed:', key, e);
		}
	}
}
