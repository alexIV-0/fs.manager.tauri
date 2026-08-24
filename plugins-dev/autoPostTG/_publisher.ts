// Telegram-публикатор (см. TELEGRAM_AUTOPOST_PLAN.md).
//   sendVideo / sendDocument через Bot API.
//   Мультиканал: ПЕРВЫЙ канал — реальная multipart-загрузка (http.upload) → берём file_id
//   из ответа → ОСТАЛЬНЫЕ каналы постим по file_id (http.fetch, без повторной загрузки).
// Все HTTP — через http.* (Rust/reqwest, без CORS).

import path from 'path';
import type { PluginContext } from '../../src/PluginAPI/host';

// Сервисы приходят параметром из ctx точки входа через границу модуля —
// у файла не остаётся собственного состояния, плагин кэшируется.

export type SendAs = 'video' | 'document';

// Цель постинга: чат + опц. тема форум-группы (message_thread_id).
export interface PostTarget {
	chatId: string;
	threadId?: number | null;
}

export interface ChannelResult {
	chatId: string;
	threadId?: number | null;
	channel?: string; // @username или title для лога
	messageId?: number;
	permalink: string;
	ok: boolean;
	error?: string;
}

const CAPTION_MAX = 1024;

function apiUrl(base: string, token: string, method: string): string {
	return `${base.replace(/\/+$/, '')}/bot${token}/${method}`;
}

/** Разбирает тело ответа Bot API. Бросает при ok:false / не-JSON. */
function parseTgBody(method: string, status: number, body: string): any {
	let json: any;
	try {
		json = JSON.parse(body);
	} catch {
		throw new Error(`TG ${method}: не-JSON ответ (HTTP ${status}): ${body.slice(0, 200)}`);
	}
	if (!json.ok) {
		throw new Error(`TG ${method}: ${json.description ?? 'unknown error'} [HTTP ${status}]`);
	}
	return json.result;
}

/** Постоянная ссылка на пост: публичный → t.me/<username>/[<thread>/]<id>,
 *  приватный → t.me/c/<internal>/[<thread>/]<id>. В теме форума путь включает threadId. */
function permalinkFor(chatId: string, result: any, messageId: number, threadId?: number | null): string {
	const thread = threadId != null ? `${threadId}/` : '';
	const username: string | undefined = result?.chat?.username || (chatId.startsWith('@') ? chatId.slice(1) : undefined);
	if (username) return `https://t.me/${username}/${thread}${messageId}`;
	// приватный канал/группа: внутренний id = chat.id без префикса -100
	const rawId = String(result?.chat?.id ?? chatId);
	const internal = rawId.replace(/^-100/, '').replace(/^-/, '');
	return `https://t.me/c/${internal}/${thread}${messageId}`;
}

/**
 * Публикует видео во все каналы. Файл грузится ОДИН раз (первый канал),
 * остальные — по полученному file_id. Возвращает результат по каждому каналу
 * (частичный провал не роняет остальные).
 */
export async function publishToChannels(
	token: string,
	file: string,
	opts: { caption: string; targets: PostTarget[]; sendAs: SendAs; baseUrl: string; onStatus?: (text: string) => void },
	http: PluginContext['http'],
): Promise<ChannelResult[]> {
	const base = opts.baseUrl || 'https://api.telegram.org';
	const method = opts.sendAs === 'document' ? 'sendDocument' : 'sendVideo';
	const field = opts.sendAs === 'document' ? 'document' : 'video';
	const caption = (opts.caption ?? '').slice(0, CAPTION_MAX);
	const results: ChannelResult[] = [];

	let fileId: string | undefined;

	for (let i = 0; i < opts.targets.length; i++) {
		const { chatId, threadId: rawThread } = opts.targets[i];
		// General = thread 1 ИЛИ null → постим БЕЗ message_thread_id (иначе «message thread not found»).
		const threadId = rawThread != null && rawThread !== 1 ? rawThread : null;
		try {
			let result: any;
			if (fileId) {
				// последующие цели — по file_id, без загрузки
				const params: Record<string, string> = { chat_id: chatId, [field]: fileId };
				if (threadId != null) params.message_thread_id = String(threadId);
				if (caption) params.caption = caption;
				if (method === 'sendVideo') params.supports_streaming = 'true';
				const body = Object.entries(params)
					.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
					.join('&');
				const res = await http.fetch(apiUrl(base, token, method), {
					method: 'POST',
					headers: [['Content-Type', 'application/x-www-form-urlencoded']],
					body,
				});
				result = parseTgBody(method, res.status, res.body);
			} else {
				// первая цель — реальная multipart-загрузка
				opts.onStatus?.(`Загрузка видео в Telegram (1/${opts.targets.length})…`);
				const fields = [{ field: 'chat_id', value: chatId }];
				if (threadId != null) fields.push({ field: 'message_thread_id', value: String(threadId) });
				if (caption) fields.push({ field: 'caption', value: caption });
				if (method === 'sendVideo') fields.push({ field: 'supports_streaming', value: 'true' });
				const res = await http.upload(apiUrl(base, token, method), {
					files: [{ field, path: file, filename: path.basename(file), mime: 'video/mp4' }],
					fields,
				});
				result = parseTgBody(method, res.status, res.body);
				// извлекаем file_id для остальных целей
				fileId = result?.video?.file_id || result?.document?.file_id || result?.animation?.file_id;
			}

			const messageId = Number(result?.message_id);
			results.push({
				chatId,
				threadId,
				channel: result?.chat?.username ? `@${result.chat.username}` : result?.chat?.title ?? chatId,
				messageId,
				permalink: permalinkFor(chatId, result, messageId, threadId),
				ok: true,
			});
		} catch (e) {
			results.push({ chatId, threadId, channel: chatId, permalink: '', ok: false, error: String(e) });
		}
	}

	return results;
}
