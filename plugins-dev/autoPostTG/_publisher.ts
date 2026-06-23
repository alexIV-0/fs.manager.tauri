// Telegram-публикатор (см. TELEGRAM_AUTOPOST_PLAN.md).
//   sendVideo / sendDocument через Bot API.
//   Мультиканал: ПЕРВЫЙ канал — реальная multipart-загрузка (http.upload) → берём file_id
//   из ответа → ОСТАЛЬНЫЕ каналы постим по file_id (http.fetch, без повторной загрузки).
// Все HTTP — через http.* (Rust/reqwest, без CORS).

import path from 'path';
import { http } from '../_template/tauri';

export type SendAs = 'video' | 'document';

export interface ChannelResult {
	chatId: string;
	channel?: string; // @username или title для лога
	messageId?: number;
	permalink: string;
	ok: boolean;
	error?: string;
}

const CAPTION_MAX = 1024;

function apiUrl(token: string, method: string): string {
	return `https://api.telegram.org/bot${token}/${method}`;
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

/** Постоянная ссылка на пост: публичный канал → t.me/<username>/<id>, приватный → t.me/c/<internal>/<id>. */
function permalinkFor(chatId: string, result: any, messageId: number): string {
	const username: string | undefined = result?.chat?.username || (chatId.startsWith('@') ? chatId.slice(1) : undefined);
	if (username) return `https://t.me/${username}/${messageId}`;
	// приватный канал: внутренний id = chat.id без префикса -100
	const rawId = String(result?.chat?.id ?? chatId);
	const internal = rawId.replace(/^-100/, '').replace(/^-/, '');
	return `https://t.me/c/${internal}/${messageId}`;
}

/**
 * Публикует видео во все каналы. Файл грузится ОДИН раз (первый канал),
 * остальные — по полученному file_id. Возвращает результат по каждому каналу
 * (частичный провал не роняет остальные).
 */
export async function publishToChannels(
	token: string,
	file: string,
	opts: { caption: string; channels: string[]; sendAs: SendAs; onStatus?: (text: string) => void },
): Promise<ChannelResult[]> {
	const method = opts.sendAs === 'document' ? 'sendDocument' : 'sendVideo';
	const field = opts.sendAs === 'document' ? 'document' : 'video';
	const caption = (opts.caption ?? '').slice(0, CAPTION_MAX);
	const results: ChannelResult[] = [];

	let fileId: string | undefined;

	for (let i = 0; i < opts.channels.length; i++) {
		const chatId = opts.channels[i];
		try {
			let result: any;
			if (fileId) {
				// последующие каналы — по file_id, без загрузки
				const params: Record<string, string> = { chat_id: chatId, [field]: fileId };
				if (caption) params.caption = caption;
				if (method === 'sendVideo') params.supports_streaming = 'true';
				const body = Object.entries(params)
					.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
					.join('&');
				const res = await http.fetch(apiUrl(token, method), {
					method: 'POST',
					headers: [['Content-Type', 'application/x-www-form-urlencoded']],
					body,
				});
				result = parseTgBody(method, res.status, res.body);
			} else {
				// первый канал — реальная multipart-загрузка
				opts.onStatus?.(`Загрузка видео в Telegram (1/${opts.channels.length})…`);
				const fields = [{ field: 'chat_id', value: chatId }];
				if (caption) fields.push({ field: 'caption', value: caption });
				if (method === 'sendVideo') fields.push({ field: 'supports_streaming', value: 'true' });
				const res = await http.upload(apiUrl(token, method), {
					files: [{ field, path: file, filename: path.basename(file), mime: 'video/mp4' }],
					fields,
				});
				result = parseTgBody(method, res.status, res.body);
				// извлекаем file_id для остальных каналов
				fileId = result?.video?.file_id || result?.document?.file_id || result?.animation?.file_id;
			}

			const messageId = Number(result?.message_id);
			results.push({
				chatId,
				channel: result?.chat?.username ? `@${result.chat.username}` : result?.chat?.title ?? chatId,
				messageId,
				permalink: permalinkFor(chatId, result, messageId),
				ok: true,
			});
		} catch (e) {
			results.push({ chatId, channel: chatId, permalink: '', ok: false, error: String(e) });
		}
	}

	return results;
}
