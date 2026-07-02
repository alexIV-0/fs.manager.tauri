// Лог постинга: {project}/options/_post/$MM.$YYYY.jsonl (append-only).
// Порт plugins-dev/autoPostVK/_postLog.ts на specta commands (раннер живёт в renderer).
// Источник истины: последняя запись → время последнего поста (интервал) + дедуп по file.

import { commands, unwrap } from '@/Utils/specta';
import { joinPath } from '@/Utils/joinPath';
import type { PostRecord } from './types';

function postDir(projectPath: string): string {
	return joinPath(projectPath, 'options', '_post');
}

function pad2(n: number): string {
	return String(n).padStart(2, '0');
}

function monthFile(projectPath: string, when = new Date()): string {
	return joinPath(postDir(projectPath), `${pad2(when.getMonth() + 1)}.${when.getFullYear()}.jsonl`);
}

/** Все записи из всех месячных файлов проекта. */
export async function readAllRecords(projectPath: string): Promise<PostRecord[]> {
	const dir = postDir(projectPath);
	const out: PostRecord[] = [];
	try {
		const exists = unwrap(await commands.checkFolderPath(dir, null));
		if (!exists) return [];
		const res = unwrap(await commands.getSomeFromFolder(dir, [{ type: 'jsonl', ext: ['jsonl'] }])) as any;
		const names: string[] = Array.isArray(res?.jsonl) ? res.jsonl : [];
		for (const name of names) {
			try {
				const content = unwrap(await commands.readFileSync(joinPath(dir, name)));
				for (const line of String(content).split('\n')) {
					const t = line.trim();
					if (!t) continue;
					try {
						out.push(JSON.parse(t));
					} catch {}
				}
			} catch {}
		}
	} catch {
		/* папки нет / не прочиталась — пустой лог */
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

/** Множество уже запощенных имён файлов ДЛЯ КОНКРЕТНОЙ ПЛАТФОРМЫ (дедуп).
 *  Один файл может быть запощен в разные площадки независимо — поэтому ключ = file+platform. */
export function postedFileSet(records: PostRecord[], platform: string): Set<string> {
	return new Set(records.filter((r) => r.status === 'published' && r.platform === platform).map((r) => r.file));
}

/** Пауза аккаунта (unix sec until) после жёсткой ошибки VK (лимит/капча/флуд). 0 — паузы нет.
 *  Файл `_post/_cooldown.json` пишет нода Poster; драйвер уважает и пропускает аккаунт. */
export async function readCooldownUntil(projectPath: string, account: string): Promise<number> {
	try {
		const p = joinPath(postDir(projectPath), '_cooldown.json');
		if (!unwrap(await commands.checkFilePath(p, null))) return 0;
		const obj = JSON.parse(String(unwrap(await commands.readFileSync(p))));
		const e = obj?.[account];
		return e && typeof e.until === 'number' ? e.until : 0;
	} catch {
		return 0;
	}
}

/** Дописать запись в файл текущего месяца настоящим append'ом (O_APPEND).
 *  Файл не перезаписывается: краш посреди записи оставит максимум оборванную последнюю
 *  строку (её пропустит парсер readAllRecords), а не потеряет весь месячный файл.
 *  append_file на Rust-стороне сам создаёт файл и родительские папки. */
export async function appendRecord(projectPath: string, rec: PostRecord): Promise<void> {
	const file = monthFile(projectPath);
	unwrap(await commands.appendFile(file, JSON.stringify(rec) + '\n'));
}
