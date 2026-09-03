// usePluginNodeTypes.ts
//
// Тип ноды (colorType) для каждого установленного плагина — та же раскладка,
// по которой ноды разложены по группам в боковой панели нодового редактора.
//
// Источники, в порядке приоритета:
//   1. typeOfNodes_store — ручное переопределение из настроек (Nodes): плагин
//      записан по имени `Name (version)` в path (включён) или inactivePath
//      (выключен/пропал с диска);
//   2. ui.json плагина — `data.colorType`, приезжает из Rust вместе со списком
//      ui-нод (`ui_type`);
//   3. запасной вариант для плагинов без ui.json (updater, remoteWorker).
//
// Ровно эту цепочку строит `Utils/loadAllUINodes.ts` для NODE_WIN — разница
// только в том, что здесь показываем и выключенные плагины, поэтому смотрим
// и в inactivePath.

import { useEffect, useMemo, useState } from 'react';
import { commands, unwrap } from '@/Utils/specta';
import { typeOfNodes_store } from '@/Store/MainWin/pathPattern_store';
import type { PluginItem } from '@/Store/MainWin/plugin_store';

/** Группа для плагинов без интерфейса и без ручного переопределения. */
export const SYSTEM_GROUP = 'system';
export const UNTYPED_GROUP = 'other';

/** Ключ плагина в возвращаемой карте. */
export const pluginKey = (plugin: Pick<PluginItem, 'id' | 'version'>) => `${plugin.id}@${plugin.version}`;

export function usePluginNodeTypes(plugins: PluginItem[]): Map<string, string> {
	const patterns = typeOfNodes_store((s) => s.patternStore);
	const [uiTypes, setUiTypes] = useState<Map<string, string>>(() => new Map());

	// Перечитываем ui-ноды при смене состава плагинов (установка/удаление),
	// а не на каждый ререндер массива.
	const pluginsKey = useMemo(() => plugins.map(pluginKey).join('|'), [plugins]);

	useEffect(() => {
		let cancelled = false;

		(async () => {
			try {
				const nodes = unwrap(await commands.pluginManagerGetAllUiNodes()) ?? [];
				if (cancelled) return;

				const map = new Map<string, string>();
				for (const node of nodes) {
					const key = `${node.plugin_id ?? ''}@${node.plugin_version ?? ''}`;
					const colorType = node.ui_type || (node.data as { colorType?: string } | null)?.colorType;
					if (colorType) map.set(key, colorType);
				}
				setUiTypes(map);
			} catch (err) {
				console.warn('[usePluginNodeTypes] не удалось прочитать ui-ноды плагинов:', err);
			}
		})();

		return () => {
			cancelled = true;
		};
	}, [pluginsKey]);

	// Переопределения из настроек: `Name (version)` → имя группы.
	const overrides = useMemo(() => {
		const map = new Map<string, string>();
		for (const pattern of patterns) {
			for (const name of [...(pattern.path ?? []), ...(pattern.inactivePath ?? [])]) {
				map.set(name, pattern.name);
			}
		}
		return map;
	}, [patterns]);

	return useMemo(() => {
		const result = new Map<string, string>();

		for (const plugin of plugins) {
			const fallback = plugin.type.includes('nodeui') ? UNTYPED_GROUP : SYSTEM_GROUP;
			const nodeType =
				overrides.get(`${plugin.name} (${plugin.version})`) ?? uiTypes.get(pluginKey(plugin)) ?? fallback;

			result.set(pluginKey(plugin), nodeType);
		}

		return result;
	}, [plugins, overrides, uiTypes]);
}
