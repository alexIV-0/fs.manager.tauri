// autoPostTG — нода «TG aPosting Video» (App-timer, Telegram Bot API).
//
// За вызов: гейт (день/окно/интервал из _post-лога) → выбор файла (order + дедуп) →
// _videoCheck (≤50МБ) → пост во ВСЕ выбранные каналы (1 загрузка → file_id для остальных)
// → запись по строке на канал в _post/$MM.$YYYY.jsonl → ВОЗВРАТ запощенного файла.
//
// «Аккаунт» = бот @BotFather; каналы — chat_id (@username/числовой id) из поля channels.
// Расписание/дедуп — те же принципы, что в autoPostVK (позже общий _template/posting/).

import path from 'path';
import { fs, sendToMW } from '../_template/tauri';
import { videoCheck } from './_videoCheck';
import { publishToChannels, SendAs } from './_publisher';
import { readAllRecords, lastPublishedAt, postedFileSet, appendRecord, PostRecord } from './_postLog';

export { onLoad } from '../_template/tauri';

const api = () => (window as any).tauriAPI;
const PLATFORM = 'telegram';

// getDay(): 0=Sun..6=Sat
const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function dayAllowed(now: Date, days: any): boolean {
	const list: string[] = Array.isArray(days) ? days : [];
	if (list.length === 0) return true; // пусто = все дни
	return list.includes(DAY_LABELS[now.getDay()]);
}

function windowAllowed(now: Date, win: any): boolean {
	if (!Array.isArray(win) || win.length < 2) return true;
	const start = Number(win[0]);
	const end = Number(win[1]);
	if (!(end > start)) return true; // вырожденное окно = весь день
	const cur = now.getHours() * 60 + now.getMinutes();
	return cur >= start && cur < end;
}

async function sortByOrder(files: string[], order: string): Promise<string[]> {
	const arr = [...files];
	if (order === 'by Name') {
		return arr.sort((a, b) => path.basename(a).toLowerCase().localeCompare(path.basename(b).toLowerCase()));
	}
	if (order === 'Random') {
		for (let i = arr.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[arr[i], arr[j]] = [arr[j], arr[i]];
		}
		return arr;
	}
	// by Time (default): сначала самые старые (mtime)
	const m = await Promise.all(arr.map(async (f) => {
		try {
			return (await fs.stat(f)).mtimeMs;
		} catch {
			return 0;
		}
	}));
	return arr.map((f, i) => ({ f, m: m[i] })).sort((a, b) => a.m - b.m).map((x) => x.f);
}

function toArr(v: any): string[] {
	if (Array.isArray(v)) return v.filter(Boolean).map(String);
	return v ? [String(v)] : [];
}

export async function autoPostTGFunc(_item: any, _description: any): Promise<string[]> {
	const inputs = toArr(_item?.import?.inputFile);
	if (inputs.length === 0) return [];

	const accountName: string = _item.account;
	const projectPathGD: string = _description.projectPathGD;
	const mainFolderName: string = _description.mainFolderName;
	const captionText = (toArr(_item?.import?.caption)[0] ?? '').trim();
	const sendAs: SendAs = String(_item.sendAs ?? 'Video') === 'Document' ? 'document' : 'video';
	const channels = toArr(_item.channels);

	if (!accountName) {
		sendToMW('log', { level: 'error', text: '[autoPostTG] не выбран бот' });
		return [];
	}
	if (channels.length === 0) {
		sendToMW('log', { level: 'error', text: '[autoPostTG] не выбран ни один канал' });
		return [];
	}

	let token: string;
	try {
		token = await api().invoke('account_get_token', { mainFolderName, platform: PLATFORM, name: accountName });
	} catch (e) {
		sendToMW('log', { level: 'error', text: '[autoPostTG] токен: ' + String(e) });
		return [];
	}

	// ── Гейт расписания ──────────────────────────────────────────────────────
	const records = await readAllRecords(projectPathGD);
	const now = new Date();
	if (!dayAllowed(now, _item.daysOfWeek)) {
		sendToMW('log', { level: 'info', text: '[autoPostTG] сегодня не постим (день недели)' });
		return [];
	}
	if (!windowAllowed(now, _item.window)) {
		sendToMW('log', { level: 'info', text: '[autoPostTG] сейчас вне окна постинга' });
		return [];
	}
	const intervalSec = Number(_item.interval) || 0;
	const last = lastPublishedAt(records, PLATFORM, accountName);
	if (last && Date.now() / 1000 - last < intervalSec) {
		sendToMW('log', { level: 'info', text: '[autoPostTG] интервал ещё не истёк — пропускаю' });
		return [];
	}

	// ── Выбор кандидата: дедуп + order ───────────────────────────────────────
	const posted = postedFileSet(records);
	let candidates = inputs.filter((f) => !posted.has(path.basename(f)));
	candidates = await sortByOrder(candidates, String(_item.order ?? 'by Time'));
	if (candidates.length === 0) {
		sendToMW('log', { level: 'info', text: '[autoPostTG] все файлы уже запощены' });
		return [];
	}

	// ── Резолв «читаемое имя → chat_id» из каталога бота ─────────────────────
	// В ноде хранятся ЧИТАЕМЫЕ имена каналов (title). Постить надо по chat_id
	// (@username/числовой id) — берём из каталога account_list. Незнакомое имя
	// трактуем как сырой chat_id (ручной ввод @username/-100… или сменившийся title).
	let chatIds: string[] = channels;
	try {
		const accs = await api().invoke('account_list', { mainFolderName, platform: PLATFORM });
		const acc = (Array.isArray(accs) ? accs : []).find((a: any) => a?.name === accountName);
		const catalog: any[] = Array.isArray(acc?.channels) ? acc.channels : [];
		const labelToChat = new Map<string, string>();
		for (const c of catalog) {
			const label = c?.title || (c?.username ? `@${c.username}` : c?.id != null ? String(c.id) : '');
			const chatId = c?.username ? `@${c.username}` : c?.id != null ? String(c.id) : '';
			if (label && chatId) labelToChat.set(label, chatId);
		}
		chatIds = channels.map((lbl) => labelToChat.get(lbl) ?? lbl).filter(Boolean);
	} catch (e) {
		sendToMW('log', { level: 'warn', text: '[autoPostTG] не удалось прочитать каталог каналов: ' + String(e) });
	}

	// ── Итерация до первого валидного → пост во все каналы ───────────────────
	for (const file of candidates) {
		const check = await videoCheck(file);
		if (!check.ok) {
			sendToMW('log', { level: 'warn', text: `[autoPostTG] ${path.basename(file)} не подходит: ${check.reason} — пропускаю` });
			continue;
		}

		sendToMW('statusbar', { text: `Постинг в Telegram: ${path.basename(file)}…` });
		const results = await publishToChannels(token, file, {
			caption: captionText,
			channels: chatIds,
			sendAs,
			onStatus: (text) => sendToMW('statusbar', { text }),
		});

		// запись по строке на канал
		const ts = Math.floor(Date.now() / 1000);
		for (const r of results) {
			const rec: PostRecord = {
				ts,
				publishedAt: ts,
				project: _description.projectName,
				platform: PLATFORM,
				account: accountName,
				file: path.basename(file),
				mode: sendAs,
				chatId: r.chatId,
				channel: r.channel,
				messageId: r.messageId,
				permalink: r.permalink,
				status: r.ok ? 'published' : 'failed',
				error: r.error,
			};
			await appendRecord(projectPathGD, rec);
		}

		const okCount = results.filter((r) => r.ok).length;
		const failed = results.filter((r) => !r.ok);
		for (const f of failed) {
			sendToMW('log', { level: 'error', text: `[autoPostTG] канал ${f.chatId} упал: ${f.error}` });
		}

		if (okCount === 0) {
			sendToMW('log', { level: 'error', text: `[autoPostTG] ни один канал не принял ${path.basename(file)}` });
			return [];
		}

		const links = results.filter((r) => r.ok).map((r) => r.permalink).join(', ');
		sendToMW('log', { level: 'info', text: `[autoPostTG] ✅ опубликовано в ${okCount}/${results.length} каналов: ${links}` });
		return [file]; // один файл за слот → на выход
	}

	sendToMW('log', { level: 'info', text: '[autoPostTG] нет подходящих файлов для постинга' });
	return [];
}
