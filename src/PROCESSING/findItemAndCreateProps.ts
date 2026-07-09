import { executeFunction } from './executeFunction';
import { getNeededPropsFromNode } from './utils/getNeededPropsFromNode';

export type PrefetchedInItems = { files: string[]; folders: string[] };

export async function findItemAndCreateProps(_node: any, prefetched?: PrefetchedInItems) {
	const mainSearchNode = _node.nodes.find((node: any) => node.id.toLowerCase() === 'mainsearch');
	// Выключенный mainSearch (Power-тумблер) = пауза обработки этого проекта: источника нет → нет item'ов.
	if (!mainSearchNode || mainSearchNode?.data?.disabled === true) return;
	const getNeededProp = getNeededPropsFromNode(mainSearchNode);
	const searchNode: any = await executeFunction[getNeededProp.functionName](getNeededProp, prefetched);
	if (!searchNode || !searchNode.output || searchNode.output.length == 0) return;

	return searchNode;
}
