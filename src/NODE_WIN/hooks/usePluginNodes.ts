// hooks/usePluginNodes.ts
import { plugin_Store } from '@/Store/MainWin/plugin_store';
import { PluginUINode } from '@/types/electron';
import { useStore } from 'zustand';
import { useEffect, useState } from 'react';
import { description } from '../definitions/description';
import { mainSearch } from '../definitions/mainSearch';

export function usePluginNodes_zzzz() {
	// Реактивно подписываемся на изменения в сторе плагинов
	const plugins = useStore(plugin_Store, (state) => state.plugins);
	const [allNodes, setAllNodes] = useState<any[]>([]);

	useEffect(() => {
		console.log('[usePluginNodes] Rebuilding nodes, plugins count:', plugins.length);

		// Встроенные ноды
		const builtInNodes = [mainSearch, description];

		// Ноды из плагинов
		const pluginNodes: any[] = [];

		plugins.forEach((plugin) => {
			// Только включенные nodeui плагины с uiData
			if (plugin.enabled && plugin.exists && plugin.type.includes('nodeui') && plugin.uiData) {
				const uiNodes = plugin.uiData as PluginUINode[];

				uiNodes.forEach((uiNode) => {
					pluginNodes.push({
						id: uiNode.id || `plugin-${plugin.id}-${plugin.version}`,
						type: uiNode.type || 'pluginNode',
						position: uiNode.position || { x: 0, y: 0 },
						width: uiNode.width || 200,
						height: uiNode.height || 100,
						data: {
							...uiNode.data,
							label: uiNode.data?.label || plugin.name,
							pluginId: plugin.id,
							pluginVersion: plugin.version,
							pluginName: plugin.name,
						},
						deletable: uiNode.deletable !== false,
					});
				});
			}
		});

		setAllNodes([...builtInNodes, ...pluginNodes]);
	}, [plugins]); // Перестраиваем при изменении списка плагинов

	return allNodes;
}
