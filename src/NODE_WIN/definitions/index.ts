// buildNodeDefinitions.ts
import { mainSearch } from './mainSearch';
import { description } from './description';
import type { CollectedUINode } from '@/Utils/loadAllUINodes';

// Глобальная переменная для хранения нод
let nodeDefinitionsCache: any[] | null = null;

/**
 * Функция сборки нод из встроенных определений и плагинов
 * @param pluginNodes - UI ноды плагинов из localStorage
 */
export function buildNodeDefinitions(pluginNodes: CollectedUINode[] = []) {
	// console.log('🎨 [buildNodeDefinitions] Starting build...');

	// 1. Встроенные ноды
	const builtInNodes = [mainSearch, description];
	// console.log('[buildNodeDefinitions] Built-in nodes:', builtInNodes.length);

	// 2. Преобразуем плагинные UI ноды в формат node definitions
	const pluginNodeDefinitions = pluginNodes.map((uiNode) => {
		// console.log(`[buildNodeDefinitions] Converting plugin node:`, {
		// 	type: uiNode.type,
		// 	label: uiNode.data?.label,
		// 	colorType: uiNode.data?.colorType,
		// 	enabled: uiNode.pluginEnabled,
		// });

		// Возвращаем в том же формате, что и встроенные ноды
		return {
			id: `${uiNode.type}@${uiNode.pluginVersion}`, // 🔥 ДОБАВЛЯЕМ ID = TYPE для key
			type: uiNode.type,
			width: uiNode.width,
			height: uiNode.height,
			component: (uiNode as any).component, // ← добавить
			data: {
				...uiNode.data,
				// colorType уже подменён в loadAllUINodes
			},
			// Дополнительные метаданные плагина
			pluginId: uiNode.pluginId,
			pluginVersion: uiNode.pluginVersion,
			pluginName: uiNode.pluginName,
		};
	});

	// console.log('[buildNodeDefinitions] Plugin nodes:', pluginNodeDefinitions.length);

	// 3. Объединяем
	const allNodes = [...builtInNodes, ...pluginNodeDefinitions];

	// console.log('[buildNodeDefinitions] ✅ Final nodes:', {
	// 	total: allNodes.length,
	// 	builtIn: builtInNodes.length,
	// 	plugin: pluginNodeDefinitions.length,
	// 	nodeTypes: allNodes.map((n) => ({ type: n.type, label: n.data?.label })),
	// });

	// 4. Сохраняем в кэш
	nodeDefinitionsCache = allNodes;
	multiVersionPluginsCache = null; // сбросить при перестроении
	return allNodes;
}

// Функция для получения нод (всегда возвращает кэш)
export function getNodeDefinitions() {
	if (!nodeDefinitionsCache) {
		// console.warn('⚠️ Node definitions not initialized, returning empty array');
		return [];
	}
	return nodeDefinitionsCache;
}

// Возвращает Set pluginId, у которых загружено несколько версий
let multiVersionPluginsCache: Set<string> | null = null;

export function getMultiVersionPlugins(): Set<string> {
	if (multiVersionPluginsCache) return multiVersionPluginsCache;
	if (!nodeDefinitionsCache) return new Set();

	const versionsByPlugin = new Map<string, Set<string>>();
	for (const node of nodeDefinitionsCache) {
		const pid = (node as any).pluginId;
		const pver = (node as any).pluginVersion;
		if (!pid || !pver) continue;
		if (!versionsByPlugin.has(pid)) versionsByPlugin.set(pid, new Set());
		versionsByPlugin.get(pid)!.add(pver);
	}

	multiVersionPluginsCache = new Set<string>();
	for (const [pid, versions] of versionsByPlugin) {
		if (versions.size > 1) multiVersionPluginsCache.add(pid);
	}
	return multiVersionPluginsCache;
}

// Функция для проверки инициализации
export function isNodeDefinitionsInitialized() {
	return nodeDefinitionsCache !== null;
}
