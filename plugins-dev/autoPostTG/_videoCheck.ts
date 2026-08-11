// Валидация видео под Telegram Bot API (ffprobe). НЕ конвертируем — только гейт.
//   • размер ≤ 50 МБ (жёсткий потолок загрузки Bot API)
//   • есть видеопоток
// 2 ГБ возможны только через self-hosted telegram-bot-api — отложено (см. план).

import type { PluginContext } from '../../src/PluginAPI/host';

// Сервисы приходят параметром из ctx точки входа через границу модуля —
// у файла не остаётся собственного состояния, плагин кэшируется.

export interface CheckResult {
	ok: boolean;
	reason?: string;
}

const MB = 1024 * 1024;
export const TG_MAX_BYTES = 50 * MB;

export async function videoCheck(file: string, ctx: PluginContext): Promise<CheckResult> {
	const { ffmpeg, fs } = ctx;
	let size = 0;
	try {
		size = (await fs.stat(file)).size;
	} catch {}

	if (size > TG_MAX_BYTES) {
		return { ok: false, reason: `файл > 50 МБ (${Math.round(size / MB)} МБ) — лимит Bot API` };
	}

	try {
		const info = await ffmpeg.getInfo(file);
		if (!info.hasVideo) return { ok: false, reason: 'нет видеопотока' };
	} catch (e) {
		return { ok: false, reason: 'ffprobe не смог прочитать файл: ' + String(e) };
	}

	return { ok: true };
}
