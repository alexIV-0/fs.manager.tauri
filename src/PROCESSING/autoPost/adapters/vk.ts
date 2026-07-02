// VK-адаптер раннера автопостинга. Порт plugins-dev/autoPostVK/_publisher.ts на
// прямые Tauri-команды http_fetch/http_upload (raw invoke — в specta их нет).
//   Video (Post): video.save → upload(field "video_file") → wall.post
// HTTP идёт через Rust/reqwest (без CORS).

import { basename } from '@/Utils/path';

const V = '5.199';

interface HttpResponse {
	status: number;
	ok: boolean;
	body: string;
}

const api = () => (window as any).tauriAPI;

export interface PublishResult {
	ownerId: number;
	videoId: number;
	postId?: number;
	permalink: string;
}

/** Ошибка VK API — несёт error_code и captcha-поля (для логов/расшифровки). */
export class VkApiError extends Error {
	code: number;
	method: string;
	captchaSid?: string;
	captchaImg?: string;
	constructor(method: string, err: any) {
		super(`VK ${method}: ${err?.error_msg ?? 'неизвестная ошибка'} [code ${err?.error_code}]`);
		this.name = 'VkApiError';
		this.method = method;
		this.code = Number(err?.error_code);
		if (err?.captcha_sid) this.captchaSid = String(err.captcha_sid);
		if (err?.captcha_img) this.captchaImg = String(err.captcha_img);
	}
}

/** Человеческая расшифровка кода ошибки VK API (для log_win). '' — нет подсказки. */
export function vkErrorHint(code: number): string {
	switch (code) {
		case 5: return 'токен невалиден или протух — перелогинься / вставь свежий токен.';
		case 6: return 'слишком много запросов в секунду — увеличь Interval.';
		case 9: return 'flood control: слишком много однотипных постов подряд — увеличь Interval, не пости пачкой.';
		case 14: return 'VK требует капчу (частое для Kate Mobile при повторных заливах видео) — пости реже, подожди. Капча сейчас не обрабатывается.';
		case 15: return 'доступ запрещён — проверь права аккаунта.';
		case 17: return 'нужна валидация аккаунта (подтверждение в браузере).';
		case 200: return 'нет доступа к альбому/видео.';
		case 214: return 'постинг на стену запрещён: лимит постов, мало прав или включена премодерация сообщества.';
		case 219: return 'рекламный пост недавно добавлен — подожди.';
		default: return '';
	}
}

/** Вызов VK API (POST form-urlencoded). Бросает VkApiError при error в ответе. */
async function vkApi(method: string, params: Record<string, any>, version = V): Promise<any> {
	const all: Record<string, any> = { v: version, ...params };
	const body = Object.entries(all)
		.filter(([, v]) => v !== undefined && v !== null && v !== '')
		.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
		.join('&');

	const res: HttpResponse = await api().invoke('http_fetch', {
		url: `https://api.vk.com/method/${method}`,
		method: 'POST',
		headers: [['Content-Type', 'application/x-www-form-urlencoded']],
		body,
	});

	let json: any;
	try {
		json = JSON.parse(res.body);
	} catch {
		throw new Error(`VK ${method}: не-JSON ответ (HTTP ${res.status}): ${String(res.body).slice(0, 200)}`);
	}
	if (json.error) {
		throw new VkApiError(method, json.error);
	}
	return json.response;
}

/** id-шаги постинга — совпадают с stepId в log_win item'е. */
export type VkStepId = 'save' | 'upload' | 'post';

/** Режим Video (Post): обычное видео на стену/в сообщество. */
export async function publishVideo(
	token: string,
	file: string,
	opts: {
		name: string;
		description: string;
		groupId?: number;
		onLog?: (msg: string, stepId?: VkStepId) => void;
		onStep?: (stepId: VkStepId, status: 'running' | 'done') => void;
	},
): Promise<PublishResult> {
	const log = opts.onLog ?? (() => {});
	const step = opts.onStep ?? (() => {});

	const saveParams: Record<string, any> = {
		access_token: token,
		name: opts.name,
		description: opts.description,
	};
	if (opts.groupId) saveParams.group_id = opts.groupId;

	step('save', 'running');
	log(`шаг 1/3 video.save (name="${opts.name}"${opts.groupId ? `, group_id=${opts.groupId}` : ''})…`, 'save');
	const save = await vkApi('video.save', saveParams);
	const ownerId = Number(save.owner_id);
	const videoId = Number(save.video_id);
	log(`шаг 1/3 ✓ owner_id=${ownerId}, video_id=${videoId}`, 'save');
	step('save', 'done');

	step('upload', 'running');
	log(`шаг 2/3 upload video_file (${basename(file)})…`, 'upload');
	const up: HttpResponse = await api().invoke('http_upload', {
		url: save.upload_url,
		files: [{ field: 'video_file', path: file, filename: basename(file), mime: 'video/mp4' }],
	});
	if (!up.ok) throw new Error(`upload video_file: HTTP ${up.status}`);
	log(`шаг 2/3 ✓ файл залит (HTTP ${up.status})`, 'upload');
	step('upload', 'done');

	const wallParams: Record<string, any> = {
		access_token: token,
		owner_id: ownerId,
		message: opts.description,
		attachments: `video${ownerId}_${videoId}`,
	};
	if (ownerId < 0) wallParams.from_group = 1;

	step('post', 'running');
	log(`шаг 3/3 wall.post (owner_id=${ownerId}${ownerId < 0 ? ', from_group=1' : ''})…`, 'post');
	const post = await vkApi('wall.post', wallParams);
	const postId = Number(post.post_id);
	log(`шаг 3/3 ✓ post_id=${postId}`, 'post');
	step('post', 'done');
	return { ownerId, videoId, postId, permalink: `https://vk.com/wall${ownerId}_${postId}` };
}
