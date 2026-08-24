// syncTgSearchSidecar — синк options/tgSearch.json при сохранении флоу с нодой autoTGcollect.
//
// tgSearch.json = выжимка из ноды (источник истины — граф в options.json). Наличие файла =
// «проект под наблюдением» (триггер для core-раннера сбора). Логика:
//   - есть нода autoTGcollect И она включена (!data.disabled) → пишем tgSearch.json;
//   - ноды нет ИЛИ она выключена → удаляем tgSearch.json (нода в графе остаётся).
// (chatId, threadId) резолвятся из каталога бота (telegram.json — общий с постингом) по
// выбранному имени target: сначала ищем среди ТЕМ форум-групп (→ chatId группы + threadId),
// затем среди каналов/чатов (→ chatId, threadId=null). raw `target` пишем как fallback.
//
// Вызывается из SaveButton/TopPanel сразу после commands.saveFlowToOptionsFolder. Никогда не
// бросает — ошибки только логируются, чтобы не ломать сохранение флоу.

import { commands, unwrap } from '@/Utils/specta';
import { joinPath } from '@/Utils/joinPath';

const PLATFORM = 'telegram';
const COLLECT_NODE_TYPE = 'autoTGcollect';

function mainFolderFromPath(path: string): string {
	const parts = path.split(/[\\/]+/).filter(Boolean);
	return parts.length >= 2 ? parts[parts.length - 2] : '';
}

function propValue(node: any, id: string): any {
	const props = node?.data?.properties ?? [];
	return props.find((p: any) => p?.id === id)?.controlProps?.value;
}

export async function syncTgSearchSidecar(path: string, flow: any): Promise<void> {
	try {
		if (!path) return;
		const sidecarPath = joinPath(path, 'options', 'tgSearch.json');
		const nodes: any[] = Array.isArray(flow?.nodes) ? flow.nodes : [];
		const node = nodes.find((n) => n?.type === COLLECT_NODE_TYPE);

		// Нет ноды или выключена → удалить файл (если есть) и выйти.
		if (!node || node?.data?.disabled === true) {
			const exists = unwrap(await commands.checkFilePath(sidecarPath, null));
			if (exists) await commands.deleteItem(sidecarPath);
			return;
		}

		const account = (propValue(node, 'account') ?? '') as string;
		const target = (propValue(node, 'target') ?? '') as string;
		const collect = propValue(node, 'collect') ?? { type: 'video' };
		const deleteAfterDownload = Boolean(propValue(node, 'deleteAfterDownload'));

		// Резолв (chatId, threadId) из каталога бота по читаемому имени target.
		// Приоритет — ТЕМА (имя темы / «Topic #id») → chatId группы + threadId; иначе чат/канал.
		let chatId: number | null = null;
		let threadId: number | null = null;
		try {
			const mainFolderName = mainFolderFromPath(path);
			if (mainFolderName && account) {
				const list = unwrap(await commands.accountList(mainFolderName, PLATFORM)) as any[];
				const acc = Array.isArray(list) ? list.find((a) => a?.name === account) : null;
				const sources: any[] = Array.isArray(acc?.channels) ? acc.channels : [];

				// 1) тема форум-группы — матчим И по имени, И по «Topic #N» (стабильно после
				// того как имя подтянется через discover; значение в ноде могло быть «Topic #N»)
				outer: for (const c of sources) {
					for (const t of Array.isArray(c?.topics) ? c.topics : []) {
						const named = t?.name ? String(t.name) : '';
						const byId = t?.threadId != null ? `Topic #${t.threadId}` : '';
						if ((named && named === target) || (byId && byId === target)) {
							chatId = c?.id != null ? Number(c.id) : null;
							threadId = t?.threadId != null ? Number(t.threadId) : null;
							break outer;
						}
					}
				}
				// 2) канал / простой чат (threadId остаётся null = весь чат / General)
				if (chatId == null) {
					const match = sources.find(
						(c) => c?.title === target || (c?.username && `@${c.username}` === target) || String(c?.id) === target,
					);
					if (match?.id != null) chatId = Number(match.id);
					else if (/^-?\d+$/.test(String(target).trim())) chatId = Number(String(target).trim());
				}
			}
		} catch (e) {
			console.warn('[syncTgSearchSidecar] не удалось резолвить chatId/threadId:', e);
		}

		const sidecar = {
			account,
			target, // читаемое имя — fallback
			chatId,
			threadId,
			collect,
			deleteAfterDownload,
		};

		await commands.writeFileAtomic(sidecarPath, JSON.stringify(sidecar, null, 2));
	} catch (e) {
		console.error('[syncTgSearchSidecar] ошибка синка tgSearch.json:', e);
	}
}
