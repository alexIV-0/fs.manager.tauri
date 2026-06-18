import { useState, useCallback } from 'react';
import { commands, unwrap } from '@/Utils/specta';
import { joinPath } from '@/Utils/joinPath';

export interface PluginInfo {
	id: string;
	name: string;
	colorType: string;
}

export interface ProjectPluginsData {
	plugins: PluginInfo[];
	mainFolder: string;
	projectName: string;
}

export const useProjectPlugins = () => {
	const getPluginsForProject = useCallback(
		async (mainFolderPath: string, projectName: string): Promise<PluginInfo[]> => {
			try {
				const optionsPath = joinPath(mainFolderPath, projectName, 'options', 'options.json');
				const fileContent = unwrap(await commands.readFileSync(optionsPath));
				const options = JSON.parse(fileContent);

				if (!options.nodes || !Array.isArray(options.nodes)) {
					return [];
				}

				// Собираем уникальные плагины с их colorType
				const pluginsMap = new Map<string, PluginInfo>();

				options.nodes.forEach((node: any) => {
					if (node.data?.pluginId) {
						const pluginId = node.data.pluginId;
						const colorType = node.data.colorType || 'unknown';

						// Пропускаем 'empty' плагины
						if (colorType === 'empty') {
							return;
						}

						if (!pluginsMap.has(pluginId)) {
							pluginsMap.set(pluginId, {
								id: pluginId,
								name: pluginId,
								colorType: colorType,
							});
						}
					}
				});

				return Array.from(pluginsMap.values());
			} catch (err) {
				console.error(`Failed to load plugins for ${mainFolderPath}/${projectName}:`, err);
				return [];
			}
		},
		[],
	);

	const getPluginsForMultipleProjects = useCallback(
		async (
			mainFolderPath: string,
			projectNames: string[],
		): Promise<Map<string, PluginInfo[]>> => {
			const result = new Map<string, PluginInfo[]>();

			for (const projectName of projectNames) {
				const plugins = await getPluginsForProject(mainFolderPath, projectName);
				result.set(projectName, plugins);
			}

			return result;
		},
		[getPluginsForProject],
	);

	return {
		getPluginsForProject,
		getPluginsForMultipleProjects,
	};
};
