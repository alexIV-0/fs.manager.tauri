// Генерик-отправитель файла в Telegram (плагин tgSend).
//   Метод по типу файла: видео → sendVideo|sendDocument (по sendAs), фото → sendPhoto,
//   аудио → sendAudio, прочее → sendDocument. sendAs влияет ТОЛЬКО на видео.
//   Мульти-цель: первая цель — реальная загрузка → file_id, остальные — по file_id (без загрузки).
// Все HTTP — через http.* (Rust/reqwest, без CORS). Зеркалит _publisher.ts autoPostTG.

import path from 'path';
import { http } from '../_template/tauri';

export type SendAs = 'video' | 'document';

export interface SendTarget {
	chatId: string;
	threadId?: number | null;
}

export interface SendResult {
	chatId: string;
	threadId?: number | null;
	channel?: string;
	messageId?: number;
	permalink: string;
	ok: boolean;
	error?: string;
}

const CAPTION_MAX = 1024;

function apiUrl(base: string, token: string, method: string): string {
	return `${base.replace(/\/+$/, '')}/bot${token}/${method}`;
}

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

function permalinkFor(chatId: string, result: any, messageId: number, threadId?: number | null): string {
	const thread = threadId != null ? `${threadId}/` : '';
	const username: string | undefined = result?.chat?.username || (chatId.startsWith('@') ? chatId.slice(1) : undefined);
	if (username) return `https://t.me/${username}/${thread}${messageId}`;
	const rawId = String(result?.chat?.id ?? chatId);
	const internal = rawId.replace(/^-100/, '').replace(/^-/, '');
	return `https://t.me/c/${internal}/${thread}${messageId}`;
}

type Kind = 'video' | 'photo' | 'audio' | 'document';

function kindByExt(file: string): Kind {
	const e = path.extname(file).toLowerCase().replace(/^\./, '');
	if (['mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi'].includes(e)) return 'video';
	if (['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'heic'].includes(e)) return 'photo';
	if (['mp3', 'ogg', 'oga', 'wav', 'm4a', 'aac', 'flac'].includes(e)) return 'audio';
	return 'document';
}

// Метод/поле/mime по типу файла. sendAs='document' принудительно шлёт ВИДЕО документом.
function pickMethod(file: string, sendAs: SendAs): { method: string; field: string; mime: string } {
	const kind = kindByExt(file);
	if (kind === 'video' && sendAs === 'document') return { method: 'sendDocument', field: 'document', mime: 'video/mp4' };
	switch (kind) {
		case 'video':
			return { method: 'sendVideo', field: 'video', mime: 'video/mp4' };
		case 'photo':
			return { method: 'sendPhoto', field: 'photo', mime: 'image/jpeg' };
		case 'audio':
			return { method: 'sendAudio', field: 'audio', mime: 'audio/mpeg' };
		default:
			return { method: 'sendDocument', field: 'document', mime: 'application/octet-stream' };
	}
}

function extractFileId(result: any): string | undefined {
	return (
		result?.video?.file_id ||
		result?.document?.file_id ||
		result?.audio?.file_id ||
		result?.animation?.file_id ||
		(Array.isArray(result?.photo) ? result.photo[result.photo.length - 1]?.file_id : undefined)
	);
}

/** Отправляет ОДИН файл во все цели. Грузим один раз → file_id для остальных целей. */
export async function sendFileToTargets(
	token: string,
	file: string,
	opts: { caption: string; sendAs: SendAs; targets: SendTarget[]; baseUrl: string; onStatus?: (text: string) => void },
): Promise<SendResult[]> {
	const base = opts.baseUrl || 'https://api.telegram.org';
	const { method, field, mime } = pickMethod(file, opts.sendAs);
	const caption = (opts.caption ?? '').slice(0, CAPTION_MAX);
	const results: SendResult[] = [];
	let fileId: string | undefined;

	for (let i = 0; i < opts.targets.length; i++) {
		const { chatId, threadId: rawThread } = opts.targets[i];
		// General = thread 1 ИЛИ null → постим БЕЗ message_thread_id (иначе «message thread not found»).
		const threadId = rawThread != null && rawThread !== 1 ? rawThread : null;
		try {
			let result: any;
			if (fileId) {
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
				opts.onStatus?.(`Отправка в Telegram (1/${opts.targets.length})…`);
				const fields = [{ field: 'chat_id', value: chatId }];
				if (threadId != null) fields.push({ field: 'message_thread_id', value: String(threadId) });
				if (caption) fields.push({ field: 'caption', value: caption });
				if (method === 'sendVideo') fields.push({ field: 'supports_streaming', value: 'true' });
				const res = await http.upload(apiUrl(base, token, method), {
					files: [{ field, path: file, filename: path.basename(file), mime }],
					fields,
				});
				result = parseTgBody(method, res.status, res.body);
				fileId = extractFileId(result);
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
