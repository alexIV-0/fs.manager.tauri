// autoPostYT — нода Poster (постинг видео на YouTube-канал). Модель B (BYO credentials):
// клиент-креды и refresh-токен канала лежат в accounts/<mainFolder>/youtube.json.
//
// Вход: inputFile (видео) — от ноды-источника Finder по графу.
// Вход/поля: title / description / tags — с паттернами ($clearName и т.п.), связь главнее поля.
// Конфиг: account (канал), categoryId, madeForKids. privacyStatus всегда 'public' (Google залочит
// в private до аудита проекта пользователя — см. ideasAndTest/YOUTUBE_AUTOPOST_PLAN.md).
// Выход: inputFile (запощенный файл) → дальше в copyFile/любую ноду.
//
// Токен: youtube_get_access_token сам обновляет access_token по refresh_token (refresh-aware),
// в отличие от VK, где токен долгоживущий.

import path from 'path';
import { sendToMW } from '../_template/tauri';
import { formatNameByPattern } from '../../src/Utils/formatNameByPattern';
import { appendRecord, writeCooldown, PostRecord } from './_postLog';

export { onLoad } from '../_template/tauri';

const api = () => (window as any).tauriAPI;
const PLATFORM = 'youtube';

function toArr(v: any): string[] {
	if (Array.isArray(v)) return v.filter(Boolean).map(String);
	return v ? [String(v)] : [];
}

function clearName(filename: string): string {
	return filename.replace(/\.[^.]+$/, '');
}

// Значение ddm категории — «22 — People & Blogs»; берём ведущее число как categoryId.
function parseCategoryId(v: any): string {
	const m = String(v ?? '').match(/^\s*(\d+)/);
	return m ? m[1] : '22';
}

// Текст из поля с паттернами, связь (import) главнее напечатанного поля.
function resolveText(linked: any, field: any, description: any, file: string): string {
	const raw = ((toArr(linked)[0] ?? '').trim() || String(field ?? '').trim());
	if (!raw) return '';
	return String(formatNameByPattern({ string: raw, description, file }));
}

export async function autoPostYTFunc(_item: any, _description: any): Promise<string[]> {
	const file = toArr(_item?.import?.inputFile)[0];
	if (!file) {
		sendToMW('log', { level: 'error', text: '[autoPostYT] нет входного файла (inputFile)' });
		return [];
	}

	const account: string = String(_item?.account ?? '').trim();
	const mainFolderName: string = _description?.mainFolderName;
	const projectPathGD: string = _description?.projectPathGD;
	if (!account) {
		sendToMW('log', { level: 'error', text: '[autoPostYT] не выбран канал (account)' });
		return [];
	}

	// title: паттерны + связь главнее; пусто → имя файла. YouTube: ≤100 символов.
	let title = resolveText(_item?.import?.title, _item?.title, _description, file) || clearName(path.basename(file));
	title = title.slice(0, 100);

	// description: паттерны + связь главнее. ≤5000.
	const description = resolveText(_item?.import?.description, _item?.description, _description, file).slice(0, 5000);

	// tags: паттерны + связь главнее; строка через запятую → массив.
	const tagsStr = resolveText(_item?.import?.tags, _item?.tags, _description, file);
	const tags = tagsStr ? tagsStr.split(',').map((t) => t.trim()).filter(Boolean) : [];

	const categoryId = parseCategoryId(_item?.categoryId);
	const madeForKids = Boolean(_item?.madeForKids);

	// Свежий access_token (refresh-aware: читает аккаунт, обновляет по refresh_token, persist'ит).
	let accessToken: string;
	try {
		accessToken = await api().invoke('youtube_get_access_token', { mainFolderName, name: account });
	} catch (e) {
		sendToMW('log', { level: 'error', text: '[autoPostYT] токен: ' + String(e) });
		return [];
	}

	try {
		sendToMW('statusbar', { text: `Постинг на YouTube: ${path.basename(file)}…` });
		const res: any = await api().invoke('youtube_upload_video', {
			accessToken,
			filePath: file,
			meta: { title, description, tags, categoryId, privacyStatus: 'public', madeForKids },
		});

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
			videoId: res?.videoId,
			permalink: res?.url ?? '',
			status: 'published',
		};
		if (projectPathGD) await appendRecord(projectPathGD, rec);

		sendToMW('log', { level: 'info', text: `[autoPostYT] ✅ опубликовано: ${res?.url}` });
		return [file]; // запощенный файл — на выход (дальше copyFile/любая нода)
	} catch (e) {
		const msg = String((e as any)?.message ?? e);
		sendToMW('log', { level: 'error', text: `[autoPostYT] ❌ постинг: ${msg}` });

		// quota/rate limit → пауза канала (драйвер уважает), чтобы не долбить API.
		if (/quota|exceeded|rate|429|403/i.test(msg) && account && projectPathGD) {
			const until = Math.floor(Date.now() / 1000) + 6 * 3600;
			await writeCooldown(projectPathGD, account, until, 429, msg).catch(() => {});
			sendToMW('log', {
				level: 'warn',
				text: `[autoPostYT] ⏳ пауза канала «${account}» до ${new Date(until * 1000).toLocaleString()} (лимит API)`,
			});
		}
		throw e; // пробрасываем → processItem пометит шаг error, исходник не удалится
	}
}
