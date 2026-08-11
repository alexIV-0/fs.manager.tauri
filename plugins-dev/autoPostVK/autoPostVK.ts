// autoPostVK — нода Poster (постинг видео в VK). Настоящий плагин, исполняется через processItem.
//
// Вход: inputFile (видео) — от ноды-источника Finder по графу.
// Вход: description (textedit+isInput) — текст поста; СВЯЗЬ главнее напечатанного поля.
// Конфиг: account (VK-аккаунт), target (Profile | сообщество #vkGroups).
// Выход: inputFile (запощенный файл) → дальше в copyFile/любую ноду.
//
// Выбор файла/папка/интервал/расписание/deleteAfter — НЕ здесь, а в ноде Finder + драйвере
// постинга. Здесь только публикация одного полученного файла.

import path from 'path';
import type { PluginContext } from '../../src/PluginAPI/host';
import { videoCheck } from './_videoCheck';
import { publishVideo, VkApiError } from './_publisher';
import { appendRecord, writeCooldown } from '../../src/PROCESSING/autoPost/postLog';
import type { PostRecord } from '../../src/PROCESSING/autoPost/types';


const PLATFORM = 'vk';

function toArr(v: any): string[] {
	if (Array.isArray(v)) return v.filter(Boolean).map(String);
	return v ? [String(v)] : [];
}

function clearName(filename: string): string {
	return filename.replace(/\.[^.]+$/, '');
}

function vkErrorHint(code: number): string {
	switch (code) {
		case 5: return 'токен невалиден/протух — перелогинься / вставь свежий токен.';
		case 6: return 'слишком много запросов в секунду — увеличь интервал на Finder.';
		case 9: return 'flood control — слишком много однотипных постов подряд, увеличь интервал.';
		case 14: return 'VK требует капчу (частое для Kate Mobile при повторных заливах) — пости реже.';
		case 15: return 'доступ запрещён — проверь права аккаунта/scope.';
		case 17: return 'нужна валидация аккаунта (подтверждение в браузере).';
		case 29: return 'достигнут суточный лимит метода (rate limit reached) — пауза до завтра.';
		case 100: return 'неверный параметр запроса (invalid parameter).';
		case 200: return 'нет доступа к альбому/видео.';
		case 214: return 'постинг на стену запрещён: суточный лимит (50/сут), права или премодерация сообщества.';
		case 219: return 'рекламный пост недавно добавлен — подожди.';
		default: return '';
	}
}

// Пауза аккаунта (сек) после жёсткой ошибки VK — чтобы не долбить API и не поймать бан токена.
// 0 = ошибка транзиентная/логическая, паузу не ставим.
function cooldownSecForCode(code: number): number {
	switch (code) {
		case 5: return 12 * 3600; // токен невалиден — до ручного перелогина
		case 6: return 5 * 60; // too many/s
		case 9: return 60 * 60; // flood control
		case 14: return 60 * 60; // captcha
		case 29: return 6 * 3600; // суточный лимит метода
		case 214: return 6 * 3600; // суточный лимит постов (50/сут)
		default: return 0;
	}
}

export async function autoPostVKFunc(_item: any, _description: any, ctx: PluginContext): Promise<string[]> {
	const { fs, http, sendToMW, accounts, invoke } = ctx;
	const file = toArr(_item?.import?.inputFile)[0];
	if (!file) {
		sendToMW('log', { level: 'error', text: '[autoPostVK] нет входного файла (inputFile)' });
		return [];
	}

	// Описание: связь (import.description) главнее напечатанного поля (_item.description).
	const linked = toArr(_item?.import?.description)[0];
	const descText = ((linked ?? '').trim() || String(_item?.description ?? '').trim());

	const account: string = String(_item?.account ?? '').trim();
	const target: string = String(_item?.target ?? 'Profile').trim();
	const mainFolderName: string = _description?.mainFolderName;
	const projectPathGD: string = _description?.projectPathGD;

	if (!account) {
		sendToMW('log', { level: 'error', text: '[autoPostVK] не выбран аккаунт' });
		return [];
	}

	// Проверка пригодности (мягкая для video: есть видеопоток, ≤2 ГБ).
	const check = await videoCheck(file, 'video', ctx);
	if (!check.ok) {
		sendToMW('log', { level: 'error', text: `[autoPostVK] ${path.basename(file)} не подходит: ${check.reason}` });
		return [];
	}

	let token: string;
	try {
		token = await accounts.getToken(mainFolderName, PLATFORM, account);
	} catch (e) {
		sendToMW('log', { level: 'error', text: '[autoPostVK] токен: ' + String(e) });
		return [];
	}

	// target → groupId (Profile = своя стена).
	let groupId: number | undefined;
	if (target && target !== 'Profile') {
		try {
			const groups = await invoke('vk_groups_get', { token });
			const g = (Array.isArray(groups) ? groups : []).find((x: any) => String(x.name) === target);
			if (!g) {
				sendToMW('log', { level: 'error', text: `[autoPostVK] сообщество "${target}" не найдено среди админ-групп` });
				return [];
			}
			groupId = Number(g.id);
		} catch (e) {
			sendToMW('log', { level: 'error', text: '[autoPostVK] groups.get: ' + String(e) });
			return [];
		}
	}

	try {
		sendToMW('statusbar', { text: `Постинг в VK: ${path.basename(file)}…` });
		const res = await publishVideo(token, file, {
			name: clearName(path.basename(file)),
			description: descText,
			groupId,
			onLog: (msg) => sendToMW('log', { level: 'info', text: `[autoPostVK] ${msg}` }),
		}, http);

		// Запись в _post-лог (дедуп + тайминг интервала драйвера).
		const ts = Math.floor(Date.now() / 1000);
		const rec: PostRecord = {
			ts,
			publishedAt: ts,
			project: _description?.projectName,
			platform: PLATFORM,
			account,
			file: path.basename(file),
			mode: 'video',
			ownerId: res.ownerId,
			videoId: res.videoId,
			postId: res.postId,
			permalink: res.permalink,
			status: 'published',
		};
		if (projectPathGD) await appendRecord(projectPathGD, rec);

		sendToMW('log', { level: 'info', text: `[autoPostVK] ✅ опубликовано: ${res.permalink}` });
		return [file]; // запощенный файл — на выход (дальше copyFile/любая нода)
	} catch (e) {
		const err = e as any;
		const step = err instanceof VkApiError ? ` на шаге ${err.method}` : '';
		sendToMW('log', { level: 'error', text: `[autoPostVK] ❌ постинг${step}: ${String(err?.message ?? err)}` });
		if (err instanceof VkApiError) {
			const hint = vkErrorHint(err.code);
			if (hint) sendToMW('log', { level: 'warn', text: `[autoPostVK] ↳ code ${err.code}: ${hint}` });
			if (err.captchaSid) sendToMW('log', { level: 'warn', text: `[autoPostVK] ↳ captcha_sid=${err.captchaSid}` });

			// Жёсткий лимит/капча/флуд → ставим паузу аккаунта (драйвер её уважает), чтобы не
			// долбить VK и не поймать бан токена. Транзиентные ошибки cooldown не ставят.
			const cd = cooldownSecForCode(err.code);
			if (cd > 0 && account && projectPathGD) {
				const until = Math.floor(Date.now() / 1000) + cd;
				await writeCooldown(projectPathGD, account, until, err.code, err.message).catch(() => {});
				sendToMW('log', {
					level: 'warn',
					text: `[autoPostVK] ⏳ пауза аккаунта «${account}» до ${new Date(until * 1000).toLocaleString()} (VK code ${err.code})`,
				});
			}
		}
		throw err; // пробрасываем → processItem пометит шаг как error, исходник не удалится
	}
}
