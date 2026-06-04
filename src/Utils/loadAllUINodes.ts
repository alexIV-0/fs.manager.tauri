// loadAllUINodes.ts
//
// Единая утилита для получения списка UI-нод плагинов в актуальном виде.
// Заменяет предыдущий механизм со снапшотом в localStorage['pluginUINodes'].
//
// Источники правды:
//   - Rust plugin manager (`plugin_manager_get_all_ui_nodes`) — сканирует диск,
//     возвращает ui.json содержимое для всех загруженных плагинов
//   - localStorage['plugins-data'] — состояния enabled/disabled пользователя
//   - localStorage['typeOfNodes'] — переопределение colorType (раскладка по группам)
//
// Используется в NODE_WIN (на старте окна) и в MainTopPanel (Docs модалка).

import { loadFromLocalStorage } from './loadSaveToLS';
import type { PluginUINode } from '@/types/global';

export interface CollectedUINode extends PluginUINode {
	pluginEnabled: boolean;
	pluginExists: boolean;
	pluginName: string;
	pluginVersion: string;
}

// Сырой ответ из Rust: snake_case + type вместо node_type (#[serde(rename)])
interface RustUINode {
	id: string;
	type: string;
	position: { x: number; y: number };
	width: number;
	height: number;
	plugin_id?: string;
	plugin_version?: string;
	plugin_path?: string;
	plugin_name?: string;
	ui_type?: string | null;
	data: any;
}

interface PluginsDataStorage {
	states: Record<string, { enabled: boolean; exists?: boolean; type?: string[]; name?: string }>;
}

interface PatternElement {
	name: string;
	path?: string[];
	inactivePath?: string[];
}

function readEnabledMap(): Map<string, boolean> {
	const map = new Map<string, boolean>();
	try {
		const data = loadFromLocalStorage('plugins-data') as PluginsDataStorage | null;
		if (data?.states) {
			for (const [key, state] of Object.entries(data.states)) {
				map.set(key, state.enabled !== false);
			}
		}
	} catch {}
	return map;
}

function readColorOverrides(): Map<string, string> {
	const overrides = new Map<string, string>();
	try {
		const patterns = loadFromLocalStorage('typeOfNodes') as PatternElement[] | null;
		if (Array.isArray(patterns)) {
			for (const pattern of patterns) {
				for (const entry of pattern.path ?? []) {
					overrides.set(entry, pattern.name);
				}
			}
		}
	} catch {}
	return overrides;
}

export async function loadAllUINodes(): Promise<CollectedUINode[]> {
	const rust = (await window.tauriAPI.invoke<RustUINode[]>('plugins:get-all-ui-nodes')) ?? [];
	const enabledMap = readEnabledMap();
	const colorOverrides = readColorOverrides();

	const result: CollectedUINode[] = [];

	for (const node of rust) {
		const pluginId = node.plugin_id ?? '';
		const pluginVersion = node.plugin_version ?? '';
		const pluginName = node.plugin_name ?? pluginId;
		const key = `${pluginId}@${pluginVersion}`;

		// enabled по умолчанию true — если плагин ни разу не открывали в UI настроек
		if (enabledMap.get(key) === false) continue;

		const fullName = `${pluginName} (${pluginVersion})`;
		const colorType = colorOverrides.get(fullName) ?? node.data?.colorType;

		result.push({
			id: node.id,
			type: node.type,
			position: node.position,
			width: node.width,
			height: node.height,
			pluginId,
			pluginVersion,
			pluginPath: node.plugin_path,
			pluginName,
			uiType: node.ui_type ?? null,
			data: {
				...node.data,
				colorType,
				pluginId,
				pluginVersion,
			},
			pluginEnabled: true,
			pluginExists: true,
		});
	}

	return result;
}
