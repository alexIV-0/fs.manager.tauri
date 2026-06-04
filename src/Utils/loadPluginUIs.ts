// utils/loadPluginUIs.ts
import { plugin_Store } from '@/Store/MainWin/plugin_store';
import { PluginUINode } from '@/types/global';

export async function loadPluginUINodes(): Promise<PluginUINode[]> {
	const state = plugin_Store.getState();
	const pluginNodes: PluginUINode[] = [];

	for (const plugin of state.plugins) {
		// Пропускаем отключенные плагины и те, у которых нет nodeui
		if (!plugin.enabled || !plugin.type?.includes('nodeui')) continue;

		// Проверяем, есть ли UI файл
		if (!plugin.hasUI) {
			console.log(`Plugin ${plugin.name} has no UI file`);
			continue;
		}

		try {
			// Загружаем UI данные через IPC
			const uiData = await window.tauriAPI.invoke('plugins:get-plugin-ui', plugin.id, plugin.version);

			if (uiData) {
				// Добавляем метаданные плагина
				const nodeWithMeta: any = {
					...uiData,
					pluginId: plugin.id,
					pluginVersion: plugin.version,
					pluginName: plugin.name,
					pluginPath: plugin.path,
				};

				pluginNodes.push(nodeWithMeta);
				console.log(`✅ Loaded UI node from plugin: ${plugin.name}`);
			}
		} catch (error) {
			console.error(`❌ Failed to load UI from plugin ${plugin.name}:`, error);
		}
	}

	console.log(`📦 Total plugin nodes loaded: ${pluginNodes.length}`);
	return pluginNodes;
}
