import type { Node, ReactFlowInstance, XYPosition } from '@xyflow/react';

type RF = ReactFlowInstance;

// Абсолютная позиция ноды (с учётом цепочки parentId) через internal-ноду ReactFlow.
// Для top-level нод совпадает с node.position; для детей Loop — складывается с позицией родителя.
export function getAbsolutePosition(rf: RF, nodeId: string): XYPosition | null {
	const internal = rf.getInternalNode?.(nodeId);
	const abs = (internal as any)?.internals?.positionAbsolute as XYPosition | undefined;
	if (abs) return { x: abs.x, y: abs.y };
	const n = rf.getNode(nodeId);
	return n ? { x: n.position.x, y: n.position.y } : null;
}

// Размер ноды: сперва measured (фактический после рендера), потом заданный width/height.
export function getNodeSize(n: Node): { w: number; h: number } {
	const w = (n as any).measured?.width ?? (n as any).width ?? 0;
	const h = (n as any).measured?.height ?? (n as any).height ?? 0;
	return { w, h };
}

// Находит Loop-ноду, в абсолютные границы которой попадает точка (flow-координаты).
// excludeIds — id, которые нельзя считать целью (например сама перетаскиваемая нода).
export function findLoopAtPoint(rf: RF, point: XYPosition, excludeIds: Set<string> = new Set()): Node | null {
	const loops = rf.getNodes().filter((n) => (n.data as any)?.executionType === 'loop' && !excludeIds.has(n.id));
	for (const loop of loops) {
		const pos = getAbsolutePosition(rf, loop.id);
		if (!pos) continue;
		const { w, h } = getNodeSize(loop);
		const lw = w || 600;
		const lh = h || 400;
		if (point.x >= pos.x && point.x <= pos.x + lw && point.y >= pos.y && point.y <= pos.y + lh) {
			return loop;
		}
	}
	return null;
}

// Loop-ноды (контейнеры) обязаны идти в массиве раньше своих детей — требование ReactFlow.
// Все parentId указывают только на Loop-ноды, поэтому достаточно вынести их вперёд.
export function sortLoopsFirst(nodes: Node[]): Node[] {
	const loops: Node[] = [];
	const rest: Node[] = [];
	for (const n of nodes) {
		if ((n.data as any)?.executionType === 'loop') loops.push(n);
		else rest.push(n);
	}
	return [...loops, ...rest];
}
