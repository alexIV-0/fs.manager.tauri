// Валидация видео под режим VK (ffprobe). НЕ конвертируем — только гейт.
//   video  → мягко (есть видеопоток, ≤2 GB)
//   clip/both → 9:16 (±допуск), ≤3 мин, ≤100 MB

import { ffmpeg, fs } from '../_template/tauri';

export type PostMode = 'video' | 'clip' | 'both';

export interface CheckResult {
	ok: boolean;
	reason?: string;
}

const MB = 1024 * 1024;
const GB = 1024 * MB;

export async function videoCheck(file: string, mode: PostMode): Promise<CheckResult> {
	let size = 0;
	try {
		size = (await fs.stat(file)).size;
	} catch {}

	let info: Awaited<ReturnType<typeof ffmpeg.getInfo>>;
	try {
		info = await ffmpeg.getInfo(file);
	} catch (e) {
		return { ok: false, reason: 'ffprobe не смог прочитать файл: ' + String(e) };
	}

	if (!info.hasVideo) return { ok: false, reason: 'нет видеопотока' };

	if (mode === 'video') {
		if (size > 2 * GB) return { ok: false, reason: `видео > 2 ГБ (${Math.round(size / MB)} МБ)` };
		return { ok: true };
	}

	// clip / both
	if (size > 100 * MB) return { ok: false, reason: `клип > 100 МБ (${Math.round(size / MB)} МБ)` };
	if (info.durationInSeconds > 180) return { ok: false, reason: `клип > 3 мин (${Math.round(info.durationInSeconds)} с)` };
	if (!info.width || !info.height) return { ok: false, reason: 'не определились размеры кадра' };
	const ratio = info.width / info.height;
	const target = 9 / 16;
	if (Math.abs(ratio - target) > 0.03) {
		return { ok: false, reason: `клип не 9:16 (${info.width}×${info.height})` };
	}
	return { ok: true };
}
