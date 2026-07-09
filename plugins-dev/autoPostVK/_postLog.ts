// Лог постинга: {project}/options/_post/$MM.$YYYY.jsonl (append-only, см. VK_AUTOPOST_PLAN.md).
// Источник истины: последняя запись → время последнего поста (для интервала) + дедуп по file.

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
	ownerId?: number;
	videoId?: number;
	postId?: number;
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

/** Все записи из всех месячных файлов проекта. */
export async function readAllRecords(projectPathGD: string): Promise<PostRecord[]> {
	const dir = postDir(projectPathGD);
	if (!(await fs.existsFolder(dir))) return [];
	const files = await fs.filesByExt(dir, ['jsonl']);
	const out: PostRecord[] = [];
	for (const name of files) {
		try {
			const content = await fs.read(path.join(dir, name));
			for (const line of content.split('\n')) {
				const t = line.trim();
				if (!t) continue;
				try {
					out.push(JSON.parse(t));
				} catch {}
			}
		} catch {}
	}
	return out;
}

/** Время (unix sec) последнего успешного поста для платформы+аккаунта. 0 — не было. */
export function lastPublishedAt(records: PostRecord[], platform: string, account: string): number {
	let max = 0;
	for (const r of records) {
		if (r.platform === platform && r.account === account && r.status === 'published') {
			const at = r.publishedAt || r.ts || 0;
			if (at > max) max = at;
		}
	}
	return max;
}

/** Множество уже запощенных имён файлов (дедуп). */
export function postedFileSet(records: PostRecord[]): Set<string> {
	return new Set(records.filter((r) => r.status === 'published').map((r) => r.file));
}

function cooldownFile(projectPathGD: string): string {
	return path.join(postDir(projectPathGD), '_cooldown.json');
}

/** Пауза аккаунта после жёсткой ошибки VK (лимит/капча/флуд/rate). Драйвер постинга читает
 *  этот файл и не постит с аккаунта до `until`. Ключ = имя аккаунта. */
export async function writeCooldown(projectPathGD: string, account: string, until: number, code: number, msg: string): Promise<void> {
	const dir = postDir(projectPathGD);
	await fs.mkdir(dir);
	const file = cooldownFile(projectPathGD);
	let obj: Record<string, any> = {};
	if (await fs.existsFile(file)) {
		try {
			obj = JSON.parse(await fs.read(file)) || {};
		} catch {}
	}
	obj[account] = { until, code, msg };
	await fs.write(file, JSON.stringify(obj, null, 2));
}

/** Дописать запись в файл текущего месяца настоящим append'ом (O_APPEND).
 *  Файл не перезаписывается: краш посреди записи оставит максимум оборванную последнюю
 *  строку (парсер её пропустит), а не потеряет весь месячный файл. append_file на
 *  Rust-стороне сам создаёт файл и родительские папки. */
export async function appendRecord(projectPathGD: string, rec: PostRecord): Promise<void> {
	const file = monthFile(projectPathGD);
	await fs.append(file, JSON.stringify(rec) + '\n');
}
