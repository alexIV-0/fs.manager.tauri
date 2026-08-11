// tgSend — нода «TG Send»: мгновенно отправляет входной файл в выбранные каналы/темы/чаты.
// Без расписания / дедупа / order — терминальная доставка «сразу после обработки».
// Метод отправки по типу файла; для видео — поле sendAs (Video/Document). Бот общий (#tgAccounts).

import path from 'path';
import type { PluginContext } from '../../src/PluginAPI/host';
import { sendFileToTargets, SendAs, SendTarget } from './_send';
import { resolveTgTargets } from '../../src/Utils/telegramTargets';


const PLATFORM = 'telegram';

function toArr(v: any): string[] {
	if (Array.isArray(v)) return v.filter(Boolean).map(String);
	return v ? [String(v)] : [];
}

export async function tgSendFunc(_item: any, _description: any, ctx: PluginContext): Promise<string[]> {
	const { http, sendToMW, accounts, telegram } = ctx;
	const inputs = toArr(_item?.import?.inputFile);
	if (inputs.length === 0) return [];

	const accountName: string = _item.account;
	const mainFolderName: string = _description.mainFolderName;
	const captionText = (toArr(_item?.import?.caption)[0] ?? '').trim();
	const sendAs: SendAs = String(_item.sendAs ?? 'Video') === 'Document' ? 'document' : 'video';
	const channels = toArr(_item.channels);

	if (!accountName) {
		sendToMW('log', { level: 'error', text: '[tgSend] не выбран бот' });
		return [];
	}
	if (channels.length === 0) {
		sendToMW('log', { level: 'error', text: '[tgSend] не выбран канал/чат/тема' });
		return [];
	}

	let token: string;
	try {
		token = await accounts.getToken(mainFolderName, PLATFORM, accountName);
	} catch (e) {
		sendToMW('log', { level: 'error', text: '[tgSend] токен: ' + String(e) });
		return [];
	}

	// Резолв метки → цель {chatId, threadId} из каталога бота (канал/тема/чат).
	let targets: SendTarget[] = channels.map((c) => ({ chatId: c }));
	try {
		targets = resolveTgTargets(await accounts.list(mainFolderName, PLATFORM), accountName, channels);
	} catch (e) {
		sendToMW('log', { level: 'warn', text: '[tgSend] каталог: ' + String(e) });
	}

	// Отправляем КАЖДЫЙ входной файл (без дедупа — это терминальная доставка по запросу).
	const out: string[] = [];
	for (const file of inputs) {
		sendToMW('statusbar', { text: `Отправка в Telegram: ${path.basename(file)}…` });
		const baseUrl = await telegram.baseUrl();
		const results = await sendFileToTargets(token, file, {
			caption: captionText,
			sendAs,
			targets,
			baseUrl,
			onStatus: (text) => sendToMW('statusbar', { text }),
		}, http);

		const ok = results.filter((r) => r.ok).length;
		for (const f of results.filter((r) => !r.ok)) {
			sendToMW('log', { level: 'error', text: `[tgSend] цель ${f.chatId} упала: ${f.error}` });
		}
		if (ok > 0) {
			const links = results.filter((r) => r.ok).map((r) => r.permalink).join(', ');
			sendToMW('log', { level: 'info', text: `[tgSend] ✅ ${path.basename(file)} → ${ok}/${results.length}: ${links}` });
			out.push(file);
		} else {
			sendToMW('log', { level: 'error', text: `[tgSend] не отправлено: ${path.basename(file)}` });
		}
	}

	return out;
}
