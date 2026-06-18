// autoPostVK — нода «VK aPosting Video» (App-timer, Kate Mobile → только Video на стену).
//
// За вызов: гейт (день/окно/интервал из _post-лога) → выбор файла (order + дедуп) →
// _videoCheck → пост на стену (профиль или сообщество из поля target) → запись ссылки
// в _post/$MM.$YYYY.jsonl → ВОЗВРАТ запощенного файла (выход ноды).
//
// target: 'Profile' → своя стена; иначе имя сообщества (#vkGroups) → groups.get → id.
// ⚠️ Пока пофайловая модель: для теста класть в IN ОДИН файл (батч-item — следующий шаг).

import path from 'path';
import { fs, sendToMW } from '../_template/tauri';
import { videoCheck } from './_videoCheck';
import { publishVideo } from './_publisher';
import { readAllRecords, lastPublishedAt, postedFileSet, appendRecord, PostRecord } from './_postLog';

export { onLoad } from '../_template/tauri';

const api = () => (window as any).tauriAPI;
const PLATFORM = 'vk';

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

function clearName(filename: string): string {
	return filename.replace(/\.[^.]+$/, '');
}

function toArr(v: any): string[] {
	if (Array.isArray(v)) return v.filter(Boolean).map(String);
	return v ? [String(v)] : [];
}

export async function autoPostVKFunc(_item: any, _description: any): Promise<string[]> {
	const inputs = toArr(_item?.import?.inputFile);
	if (inputs.length === 0) return [];

	const accountName: string = _item.account;
	const projectPathGD: string = _description.projectPathGD;
	const mainFolderName: string = _description.mainFolderName;
	const descText = (toArr(_item?.import?.description)[0] ?? '').trim();
	const target = String(_item.target ?? 'Profile').trim();

	if (!accountName) {
		sendToMW('log', { level: 'error', text: '[autoPostVK] не выбран аккаунт' });
		return [];
	}

	let token: string;
	try {
		token = await api().invoke('account_get_token', { mainFolderName, platform: PLATFORM, name: accountName });
	} catch (e) {
		sendToMW('log', { level: 'error', text: '[autoPostVK] токен: ' + String(e) });
		return [];
	}

	// target → groupId (Profile = своя стена)
	let groupId: number | undefined;
	if (target && target !== 'Profile' && target !== '') {
		try {
			const groups = await api().invoke('vk_groups_get', { token });
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

	// ── Гейт расписания ──────────────────────────────────────────────────────
	const records = await readAllRecords(projectPathGD);
	const now = new Date();
	if (!dayAllowed(now, _item.daysOfWeek)) {
		sendToMW('log', { level: 'info', text: '[autoPostVK] сегодня не постим (день недели)' });
		return [];
	}
	if (!windowAllowed(now, _item.window)) {
		sendToMW('log', { level: 'info', text: '[autoPostVK] сейчас вне окна постинга' });
		return [];
	}
	const intervalSec = Number(_item.interval) || 0;
	const last = lastPublishedAt(records, PLATFORM, accountName);
	if (last && Date.now() / 1000 - last < intervalSec) {
		sendToMW('log', { level: 'info', text: '[autoPostVK] интервал ещё не истёк — пропускаю' });
		return [];
	}

	// ── Выбор кандидата: дедуп + order ───────────────────────────────────────
	const posted = postedFileSet(records);
	let candidates = inputs.filter((f) => !posted.has(path.basename(f)));
	candidates = await sortByOrder(candidates, String(_item.order ?? 'by Time'));
	if (candidates.length === 0) {
		sendToMW('log', { level: 'info', text: '[autoPostVK] все файлы уже запощены' });
		return [];
	}

	// ── Итерация до первого валидного → пост ─────────────────────────────────
	for (const file of candidates) {
		const check = await videoCheck(file, 'video');
		if (!check.ok) {
			sendToMW('log', { level: 'warn', text: `[autoPostVK] ${path.basename(file)} не подходит: ${check.reason} — пропускаю` });
			continue;
		}

		try {
			sendToMW('statusbar', { text: `Постинг в VK: ${path.basename(file)}…` });
			const name = clearName(path.basename(file));
			const res = await publishVideo(token, file, { name, description: descText, groupId });

			const ts = Math.floor(Date.now() / 1000);
			const rec: PostRecord = {
				ts,
				publishedAt: ts,
				project: _description.projectName,
				platform: PLATFORM,
				account: accountName,
				file: path.basename(file),
				mode: 'video',
				ownerId: res.ownerId,
				videoId: res.videoId,
				postId: res.postId,
				permalink: res.permalink,
				status: 'published',
			};
			await appendRecord(projectPathGD, rec);

			sendToMW('log', { level: 'info', text: `[autoPostVK] ✅ опубликовано: ${res.permalink}` });
			return [file]; // один файл за слот → на выход
		} catch (e) {
			sendToMW('log', { level: 'error', text: `[autoPostVK] постинг ${path.basename(file)} упал: ${String(e)}` });
			return [];
		}
	}

	sendToMW('log', { level: 'info', text: '[autoPostVK] нет подходящих файлов для постинга' });
	return [];
}
