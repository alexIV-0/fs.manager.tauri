// nodeGroupOrder.ts
//
// Порядок групп (типов нод) — один на две панели: боковую панель нодового
// редактора (`SidebarAccordion`) и список плагинов в настройках
// (`PluginSortableList`). Группы, чьё имя перечислено здесь, идут в этом
// порядке; все остальные — после них, алфавитом.
// Регистр учитывается (afterEffect — camelCase, как в typeOfNodes_store).

export const NODE_GROUP_ORDER = ['main', 'ai', 'helpers', 'ffmpeg', 'afterEffect', 'moho'];

export function nodeGroupOrderIndex(name: string): number {
	const idx = NODE_GROUP_ORDER.indexOf(name);
	return idx === -1 ? Number.MAX_SAFE_INTEGER : idx;
}

/** Сравнение имён групп: сначала кастомный порядок, потом алфавит. */
export function compareNodeGroups(a: string, b: string): number {
	const ai = nodeGroupOrderIndex(a);
	const bi = nodeGroupOrderIndex(b);
	if (ai !== bi) return ai - bi;
	return a.localeCompare(b);
}
