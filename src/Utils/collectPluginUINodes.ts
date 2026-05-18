// collectPluginUINodes.ts (ОБНОВЛЕННАЯ ВЕРСИЯ)
import { plugin_Store } from '@/Store/MainWin/plugin_store';
import { typeOfNodes_store } from '@/Store/MainWin/pathPattern_store';
import { PluginUINode } from '@/types/electron';

export interface CollectedUINode extends PluginUINode {
	pluginEnabled: boolean;
	pluginExists: boolean;
	pluginName: string;
	pluginVersion: string;
}

/**
 * Собирает все UI ноды из плагинов типа "nodeui"
 * Читает ui.json файлы напрямую из папок плагинов
 * Обновляет colorType на основе typeOfNodes_store
 */
export async function collectPluginUINodes(): Promise<CollectedUINode[]> {
	// console.log('[collectPluginUINodes] 🔍 Starting collection...');

	const state = plugin_Store.getState();
	const nodeTypesState = typeOfNodes_store.getState();
	const allUINodes: CollectedUINode[] = [];

	// Фильтруем только nodeui плагины
	const nodeuiPlugins = state.plugins.filter((plugin) => plugin.type.includes('nodeui'));

	// console.log(`[collectPluginUINodes] Found ${nodeuiPlugins.length} nodeui plugins`);

	for (const plugin of nodeuiPlugins) {
		// console.log(`[collectPluginUINodes] Processing plugin: ${plugin.name}@${plugin.version}`, {
		// 	enabled: plugin.enabled,
		// 	exists: plugin.exists,
		// 	path: plugin.path,
		// });

		// Если плагин не существует на диске - пропускаем
		if (!plugin.exists) {
			// console.log(`[collectPluginUINodes] ⚠️ Plugin ${plugin.name} doesn't exist on disk, skipping`);
			continue;
		}

		// Если плагин выключен - пропускаем
		if (!plugin.enabled) {
			// console.log(`[collectPluginUINodes] ⚠️ Plugin ${plugin.name} is disabled, skipping`);
			continue;
		}

		try {
			// Формируем путь к ui.json
			const uiJsonPath = await window.electronAPI.invoke('pathJoin', plugin.path, 'ui.json');
			// console.log(`[collectPluginUINodes] 📄 Checking UI file: ${uiJsonPath}`);

			// Проверяем существование файла через checkFilePath
			const checkedPath = await window.electronAPI.invoke('checkFilePath', uiJsonPath);

			if (!checkedPath) {
				// console.log(`[collectPluginUINodes] ⚠️ ui.json not found for ${plugin.name}`);
				continue;
			}

			// Читаем содержимое файла
			const uiContent: any = await window.electronAPI.invoke('readFileSync', checkedPath);

			if (!uiContent) {
				// console.log(`[collectPluginUINodes] ⚠️ ui.json is empty for ${plugin.name}`);
				continue;
			}

			// console.log(`[collectPluginUINodes] 📖 UI content length:`, uiContent.length);

			// Парсим JSON
			const uiData = JSON.parse(uiContent);
			// console.log(`[collectPluginUINodes] ✅ Parsed UI data for ${plugin.name}:`, uiData);

			// 🔥 ИЩЕМ СООТВЕТСТВИЕ В typeOfNodes_store
			const pluginFullName = `${plugin.name} (${plugin.version})`;
			// console.log(`[collectPluginUINodes] 🔍 Looking for "${pluginFullName}" in typeOfNodes_store...`);

			let actualColorType = uiData.data?.colorType; // По умолчанию из плагина

			// Проходим по всем паттернам в typeOfNodes_store
			for (const pattern of nodeTypesState.patternStore) {
				if (pattern.path.includes(pluginFullName)) {
					actualColorType = pattern.name; // Используем имя паттерна как colorType
					// console.log(`[collectPluginUINodes] ✅ Found in pattern "${pattern.name}", using color: ${pattern.color}`);
					break;
				}
			}

			// Если не нашли в активных, проверяем inactivePath
			if (actualColorType === uiData.data?.colorType) {
				for (const pattern of nodeTypesState.patternStore) {
					if (pattern.inactivePath?.includes(pluginFullName)) {
						// console.log(
						// `[collectPluginUINodes] ⚠️ Found in inactivePath of "${pattern.name}", but plugin is enabled - this shouldn't happen`,
						// );
						break;
					}
				}
			}

			// console.log(`[collectPluginUINodes] 🎨 ColorType: ${uiData.data?.colorType} → ${actualColorType}`);

			// 🔥 Создаем ноду с обновленным colorType И добавляем pluginId/pluginVersion в data
			const collectedNode: CollectedUINode = {
				...uiData,
				data: {
					...uiData.data,
					colorType: actualColorType, // 🔥 Обновленный colorType
					pluginId: plugin.id, // 🔥 ДОБАВЛЕНО: ID плагина
					pluginVersion: plugin.version, // 🔥 ДОБАВЛЕНО: Версия плагина
				},
				pluginId: plugin.id,
				pluginVersion: plugin.version,
				pluginEnabled: plugin.enabled,
				pluginExists: plugin.exists,
				pluginName: plugin.name,
			};

			allUINodes.push(collectedNode);
			// console.log(`[collectPluginUINodes] ➕ Added node: ${collectedNode.data?.label} (colorType: ${actualColorType})`);
		} catch (err) {
			console.error(`[collectPluginUINodes] ❌ Error loading UI for ${plugin.name}:`, err);
		}
	}

	// console.log(`[collectPluginUINodes] 🎉 Collected ${allUINodes.length} total UI nodes`, {
	// enabled: allUINodes.filter((n) => n.pluginEnabled).length,
	// disabled: allUINodes.filter((n) => !n.pluginEnabled).length,
	// nodes: allUINodes.map((n) => ({
	// 	label: n.data?.label,
	// 	type: n.type,
	// 	colorType: n.data?.colorType,
	// 	enabled: n.pluginEnabled,
	// })),
	// });

	return allUINodes;
}
