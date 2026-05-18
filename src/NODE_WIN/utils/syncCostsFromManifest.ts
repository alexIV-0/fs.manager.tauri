import type { Node } from '@xyflow/react';
import { getNodeDefinitions } from '../definitions';

// Переписывает node.data.cost / node.data.costUnit актуальными значениями из
// plugin.json (через nodeDefinitionsCache). Используется при открытии флоу,
// чтобы старые ноды подхватили централизованную цену.
export function syncCostsFromManifest<T extends Node>(nodes: T[]): T[] {
	const defs = getNodeDefinitions();
	if (defs.length === 0) return nodes;

	const byKey = new Map<string, { cost?: string; costUnit?: string }>();
	for (const d of defs) {
		const pid = (d as any).pluginId;
		const pver = (d as any).pluginVersion;
		if (!pid) continue;
		const cost = (d as any).data?.cost;
		const costUnit = (d as any).data?.costUnit;
		byKey.set(`${pid}@${pver ?? ''}`, { cost, costUnit });
		byKey.set(pid, { cost, costUnit }); // fallback по pluginId, если version в ноде не сохранена
	}

	return nodes.map((n) => {
		const data: any = n.data;
		if (!data?.pluginId) return n;
		const match = byKey.get(`${data.pluginId}@${data.pluginVersion ?? ''}`) ?? byKey.get(data.pluginId);
		if (!match) return n;
		if (match.cost === undefined && match.costUnit === undefined) return n;
		return {
			...n,
			data: {
				...data,
				...(match.cost !== undefined ? { cost: match.cost } : {}),
				...(match.costUnit !== undefined ? { costUnit: match.costUnit } : {}),
			},
		};
	});
}
