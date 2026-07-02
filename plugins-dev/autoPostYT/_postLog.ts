// Лог постинга YouTube: {project}/options/_post/$MM.$YYYY.jsonl (append-only, настоящий append).
// Пишет эта нода (Poster); читает драйвер (src/PROCESSING/autoPost). Формат общий для всех площадок
// (платформа — в поле record.platform), поэтому дедуп/интервал драйвера работают единообразно.

import path from 'path';
import { fs } from '../_template/tauri';

export interface PostRecord {
	ts: number;
	publishedAt: number;
	project?: string;
	platform: string;
	account: string;
	file: string;
	mode: string;
	videoId?: string; // YouTube video id — строка (в отличие от числового VK)
	permalink: string;
	status: string;
}

function postDir(projectPathGD: string): string {
	return path.join(projectPathGD, 'options', '_post');
}

function pad2(n: number): string {
	return String(n).padStart(2, '0');
}

function monthFile(projectPathGD: string, when = new Date()): string {
	return path.join(postDir(projectPathGD), `${pad2(when.getMonth() + 1)}.${when.getFullYear()}.jsonl`);
}

/** Дописать запись настоящим append'ом (O_APPEND) — файл не перезаписывается. */
export async function appendRecord(projectPathGD: string, rec: PostRecord): Promise<void> {
	await fs.append(monthFile(projectPathGD), JSON.stringify(rec) + '\n');
}

/** Пауза канала после жёсткой ошибки (quota/rate) — драйвер уважает и не постит до `until`.
 *  Ключ = имя аккаунта (канала). Формат общий с VK (`_post/_cooldown.json`). */
export async function writeCooldown(
	projectPathGD: string,
	account: string,
	until: number,
	code: number,
	msg: string,
): Promise<void> {
	const dir = postDir(projectPathGD);
	await fs.mkdir(dir);
	const file = path.join(dir, '_cooldown.json');
	let obj: Record<string, any> = {};
	if (await fs.existsFile(file)) {
		try {
			obj = JSON.parse(await fs.read(file)) || {};
		} catch {}
	}
	obj[account] = { until, code, msg };
	await fs.write(file, JSON.stringify(obj, null, 2));
}
