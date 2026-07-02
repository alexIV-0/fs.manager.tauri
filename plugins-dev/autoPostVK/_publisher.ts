// VK API публикатор (см. VK_AUTOPOST_PLAN.md — flow подтверждён vk-validate.mjs).
//   Video (Post): video.save → upload(field "video_file") → wall.post
//   Clips/Both:   shortVideo.create(file_size) → upload(field "file") → ждать → edit → publish
// Все HTTP — через http.* (Rust/reqwest, без CORS).

import path from 'path';
import { http } from '../_template/tauri';

const V = '5.199';
const V_SHORT = '5.249';

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

/** Вызов VK API (POST form-urlencoded). Бросает VkApiError при error в ответе. */
async function vkApi(method: string, params: Record<string, any>, version = V): Promise<any> {
	const all: Record<string, any> = { v: version, ...params };
	const body = Object.entries(all)
		.filter(([, v]) => v !== undefined && v !== null && v !== '')
		.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
		.join('&');

	const res = await http.fetch(`https://api.vk.com/method/${method}`, {
		method: 'POST',
		headers: [['Content-Type', 'application/x-www-form-urlencoded']],
		body,
	});

	let json: any;
	try {
		json = JSON.parse(res.body);
	} catch {
		throw new Error(`VK ${method}: не-JSON ответ (HTTP ${res.status}): ${res.body.slice(0, 200)}`);
	}
	if (json.error) {
		throw new VkApiError(method, json.error);
	}
	return json.response;
}

/** Режим Video (Post): обычное видео на стену/в сообщество. */
export async function publishVideo(
	token: string,
	file: string,
	opts: { name: string; description: string; groupId?: number; onLog?: (msg: string) => void },
): Promise<PublishResult> {
	const log = opts.onLog ?? (() => {});

	const saveParams: Record<string, any> = {
		access_token: token,
		name: opts.name,
		description: opts.description,
	};
	if (opts.groupId) saveParams.group_id = opts.groupId;

	log(`шаг 1/3 video.save (name="${opts.name}"${opts.groupId ? `, group_id=${opts.groupId}` : ''})…`);
	const save = await vkApi('video.save', saveParams);
	const ownerId = Number(save.owner_id);
	const videoId = Number(save.video_id);
	log(`шаг 1/3 ✓ owner_id=${ownerId}, video_id=${videoId}`);

	log(`шаг 2/3 upload video_file (${path.basename(file)})…`);
	const up = await http.upload(save.upload_url, {
		files: [{ field: 'video_file', path: file, filename: path.basename(file), mime: 'video/mp4' }],
	});
	if (!up.ok) throw new Error(`upload video_file: HTTP ${up.status}`);
	log(`шаг 2/3 ✓ файл залит (HTTP ${up.status})`);

	const wallParams: Record<string, any> = {
		access_token: token,
		owner_id: ownerId,
		message: opts.description,
		attachments: `video${ownerId}_${videoId}`,
	};
	if (ownerId < 0) wallParams.from_group = 1;

	log(`шаг 3/3 wall.post (owner_id=${ownerId}${ownerId < 0 ? ', from_group=1' : ''})…`);
	const post = await vkApi('wall.post', wallParams);
	const postId = Number(post.post_id);
	log(`шаг 3/3 ✓ post_id=${postId}`);
	return { ownerId, videoId, postId, permalink: `https://vk.com/wall${ownerId}_${postId}` };
}

/** Режим Clips / Both: вертикальный клип (+ дубль в ленту при wallpost=1). */
export async function publishClip(
	token: string,
	file: string,
	opts: {
		description: string;
		fileSize: number;
		groupId?: number;
		wallpost: 0 | 1;
		waitSec?: number;
		onStatus?: (text: string) => void;
	},
): Promise<PublishResult> {
	const createParams: Record<string, any> = { access_token: token, file_size: opts.fileSize };
	if (opts.groupId) createParams.group_id = opts.groupId;

	const create = await vkApi('shortVideo.create', createParams, V_SHORT);
	const ownerId = Number(create.owner_id);
	const videoId = Number(create.video_id);

	const up = await http.upload(create.upload_url, {
		files: [{ field: 'file', path: file, filename: path.basename(file), mime: 'video/mp4' }],
	});
	if (!up.ok) throw new Error(`upload clip file: HTTP ${up.status}`);

	const waitSec = opts.waitSec ?? 80;
	opts.onStatus?.(`Клип загружен, обработка ~${waitSec}с…`);
	await new Promise((r) => setTimeout(r, waitSec * 1000));

	const editParams: Record<string, any> = {
		access_token: token,
		video_id: videoId,
		owner_id: ownerId,
		description: opts.description,
		privacy_view: 'all',
		can_make_duet: 1,
	};
	if (opts.groupId) editParams.group_id = opts.groupId;
	await vkApi('shortVideo.edit', editParams, V_SHORT);

	const pubParams: Record<string, any> = {
		access_token: token,
		video_id: videoId,
		owner_id: ownerId,
		license_agree: 1,
		publish_date: 0,
		wallpost: opts.wallpost,
	};
	if (opts.groupId) pubParams.group_id = opts.groupId;
	const pub = await vkApi('shortVideo.publish', pubParams, V_SHORT);

	const postId = pub?.wall_post_id ? Number(pub.wall_post_id) : undefined;
	return { ownerId, videoId, postId, permalink: `https://vk.com/clip${ownerId}_${videoId}` };
}
