// Резолв «читаемая метка → адрес в Telegram» по каталогу бота.
//
// Зачем отдельный файл: в ноде пользователь выбирает каналы по ЧИТАЕМЫМ именам
// (title канала, имя темы форум-группы), а Bot API принимает `chat_id` и
// `message_thread_id`. Перевод одного в другое был скопирован дословно в
// `autoPostTG` и `tgSend` — включая порядок предпочтений (`@username` важнее
// числового id) и трактовку незнакомой метки как сырого chat_id. Две копии такой
// логики неизбежно разъезжаются, а расхождение здесь означает пост не в тот канал.

import type { AccountInfo } from '../PluginAPI/host';

/** Адрес доставки: канал/чат, опционально тема форум-группы. */
export interface TgTarget {
	chatId: string;
	threadId?: number | null;
}

/**
 * Переводит метки, выбранные в ноде, в адреса Bot API.
 *
 * Метка, которой нет в каталоге, возвращается как есть — это осознанно: так
 * работает ручной ввод `@username` / `-100…`, и так продолжает работать канал,
 * у которого сменился title (каталог отстал, а числовой id пользователь знает).
 */
export function resolveTgTargets(
	accountsList: AccountInfo[],
	accountName: string,
	labels: string[],
): TgTarget[] {
	const acc = (Array.isArray(accountsList) ? accountsList : []).find((a) => a?.name === accountName);
	const catalog = Array.isArray(acc?.channels) ? acc.channels : [];

	const byLabel = new Map<string, TgTarget>();
	for (const c of catalog) {
		// `@username` предпочтительнее числового id: он стабилен и читаем в логах.
		const chatId = c?.username ? `@${c.username}` : c?.id != null ? String(c.id) : '';
		if (!chatId) continue;

		const label = c?.title || (c?.username ? `@${c.username}` : String(c?.id ?? ''));
		if (label) byLabel.set(label, { chatId, threadId: null });

		// Темы форум-группы адресуются тем же chatId плюс threadId.
		for (const t of Array.isArray(c?.topics) ? c.topics : []) {
			const topicLabel = t?.name || (t?.threadId != null ? `Topic #${t.threadId}` : '');
			if (topicLabel && t?.threadId != null) {
				byLabel.set(topicLabel, { chatId, threadId: Number(t.threadId) });
			}
		}
	}

	return labels.map((label) => byLabel.get(label) ?? { chatId: label });
}
