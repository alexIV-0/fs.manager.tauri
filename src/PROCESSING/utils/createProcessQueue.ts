import { getNeededPropsFromNode } from './getNeededPropsFromNode';
import { syncCostsFromManifest } from '@/NODE_WIN/utils/syncCostsFromManifest';

type AnyNode = { id: string; data?: any; parentId?: string; position?: { x: number; y: number } };
type AnyEdge = {
	source: string;
	target: string;
	sourceHandle?: string | null;
	targetHandle?: string | null;
};

type Graph = {
	nodes: AnyNode[];
	edges: AnyEdge[];
};

// Walk back through spy (reroute) chain to find the first non-spy upstream node id.
// Spy nodes never execute, so downstream imports must reference the real source.
// Возвращает null если цепочка обрывается (нет incoming edge у spy) или зациклена.
function resolveSpySource(
	sourceId: string,
	allNodes: AnyNode[],
	allEdges: AnyEdge[],
	visited: Set<string> = new Set(),
): string | null {
	if (visited.has(sourceId)) return null;
	visited.add(sourceId);
	const node = allNodes.find((n) => n.id === sourceId);
	if (!node || (node as any).type !== 'spy') return sourceId;
	const incoming = allEdges.find((e) => e.target === sourceId && e.targetHandle === 'in');
	if (!incoming) return null;
	return resolveSpySource(incoming.source, allNodes, allEdges, visited);
}

// ------------------------------------------------------------------
// Строит execution-объект для одной ноды.
// ------------------------------------------------------------------
function buildExecutionObject(id: string, nodesMap: Map<string, AnyNode>, allNodes: AnyNode[], allEdges: AnyEdge[]): any | null {
	const node = nodesMap.get(id);
	// Spy-нода не исполняется — она «сплющивается» при сборке importObj
	// у downstream-нод через resolveSpySource. В очереди её нет.
	if ((node as any)?.type === 'spy') return null;
	// Выключенная нода не исполняется. Downstream остаётся без источника
	// (это сознательно — пользователь сам решает, чем заменить).
	if ((node as any)?.data?.disabled === true) return null;
	if (!node?.data?.output) return null;

	const executionType: string | undefined = node.data.executionType;

	// importObj — ищем по allEdges (cross-boundary тоже учитываем)
	const importObj: Record<string, string> = {};
	const props: any[] = node.data?.properties ?? [];

	for (const p of props.filter((p: any) => p.isInput)) {
		const edge = allEdges.find((e) => e.target === id && e.targetHandle === p.id);
		if (!edge) continue;

		// jsonNavigator всегда использует p.id как ключ; остальные — label если editLabel
		const key = p.controlType === 'jsonNavigator'
			? p.id
			: (p?.controlProps?.editLabel === true ? p?.controlProps?.label : p.id);

		// Если источник — spy, идём по цепочке spy → ... → реальная нода.
		const resolvedSource = resolveSpySource(edge.source, allNodes, allEdges);
		if (!resolvedSource) continue; // spy без входа — пропускаем
		importObj[key] = resolvedSource;
	}

	// ----------------------------------------------------------------
	// LOOP нода
	// ----------------------------------------------------------------
	if (executionType === 'loop') {
		const childNodes = allNodes.filter((n) => n.parentId === id);
		const childIds = new Set(childNodes.map((n) => n.id));

		// Edges полностью внутри группы
		const innerEdges = allEdges.filter((e) => childIds.has(e.source) && childIds.has(e.target));

		// Стартовая нода subgraph — та, в которую идёт edge inputInLoop от loop-ноды
		const inputInLoopEdge = allEdges.find((e) => e.source === id && e.sourceHandle === 'inputInLoop');
		let resolvedStartId = inputInLoopEdge?.target;

		// Fallback: первая дочерняя без inner-входящих
		if (!resolvedStartId) {
			const innerIncoming = new Set(innerEdges.map((e) => e.target));
			resolvedStartId = childNodes.find((n) => !innerIncoming.has(n.id))?.id;
		}

		const subgraph = resolvedStartId
			? createProcessQueueFromNodes({ nodes: childNodes, edges: innerEdges }, resolvedStartId, allNodes, allEdges)
			: [];

		// loopInput: внешняя нода → loopInput handle (через spy резолвим к реальному источнику)
		const loopInputEdge = allEdges.find((e) => e.target === id && e.targetHandle === 'loopInput');
		const loopInputSource = loopInputEdge ? resolveSpySource(loopInputEdge.source, allNodes, allEdges) : null;

		// loopOutputSource: внутренняя нода → outputInLoop handle
		const loopOutputEdge = allEdges.find((e) => e.target === id && e.targetHandle === 'outputInLoop');
		const loopOutputSource = loopOutputEdge ? resolveSpySource(loopOutputEdge.source, allNodes, allEdges) : null;

		return {
			id,
			nodeType: 'loop',
			import: {
				loopInput: loopInputSource,
			},
			loopOutputSource,
			subgraph,
			output: [],
			isTerminal: false,
		};
	}

	// ----------------------------------------------------------------
	// DEFAULT нода
	// ----------------------------------------------------------------
	let neededProps = {};
	try {
		neededProps = getNeededPropsFromNode(node) ?? {};
	} catch (e) {
		console.warn(`[createProcessQueue] getNeededPropsFromNode failed for node "${id}":`, e);
	}

	const isTerminal = !allEdges.some((e) => e.source === id);

	return {
		id,
		nodeType: 'default',
		...neededProps,
		import: importObj,
		isTerminal,
	};
}

// ------------------------------------------------------------------
// Строит очередь для subgraph (рекурсивно для loop внутри loop).
// allNodes/allEdges — весь граф для cross-boundary зависимостей.
// ------------------------------------------------------------------
function createProcessQueueFromNodes(graph: Graph, startNodeId: string, allNodes: AnyNode[], allEdges: AnyEdge[]): any[] {
	const nodes = graph.nodes ?? [];
	const edges = graph.edges ?? [];

	const nodesMap = new Map(nodes.map((n) => [n.id, n]));

	const incoming = new Map<string, string[]>();
	const outgoing = new Map<string, string[]>();

	for (const n of nodes) {
		incoming.set(n.id, []);
		outgoing.set(n.id, []);
	}

	for (const e of edges) {
		if (nodesMap.has(e.source) && nodesMap.has(e.target)) {
			incoming.get(e.target)?.push(e.source);
			outgoing.get(e.source)?.push(e.target);
		}
	}

	const startId = [...nodesMap.keys()].find((id) => id.toLowerCase() === startNodeId.toLowerCase());
	if (!startId) return [];

	// Forward
	const executionTargets = new Set<string>();
	function collectOutgoing(id: string) {
		if (executionTargets.has(id)) return;
		executionTargets.add(id);
		for (const next of outgoing.get(id) ?? []) collectOutgoing(next);
	}
	collectOutgoing(startId);

	// Backward — только внутри subgraph
	const involved = new Set<string>(executionTargets);
	function collectIncoming(id: string) {
		for (const parent of incoming.get(id) ?? []) {
			if (!involved.has(parent)) {
				involved.add(parent);
				collectIncoming(parent);
			}
		}
	}
	for (const id of executionTargets) collectIncoming(id);

	// Forward-расширение от backward-найденных нод (симметрично main-функции)
	{
		let prevSize = 0;
		while (involved.size !== prevSize) {
			prevSize = involved.size;
			for (const id of [...involved]) {
				for (const child of outgoing.get(id) ?? []) {
					if (!involved.has(child)) {
						involved.add(child);
						collectIncoming(child);
					}
				}
			}
		}
	}

	// Kahn
	const inDegree = new Map<string, number>();
	for (const id of involved) inDegree.set(id, 0);
	for (const e of edges) {
		if (involved.has(e.source) && involved.has(e.target)) {
			inDegree.set(e.target, inDegree.get(e.target)! + 1);
		}
	}

	// Сортировка по X-позиции ноды: левее = раньше.
	// Заменяет сломанный depth (depth=0 для backward-нод), отражает визуальный порядок графа.
	const queue: string[] = [];
	function pushSorted(id: string) {
		queue.push(id);
		queue.sort((a, b) => (nodesMap.get(a)?.position?.x ?? 0) - (nodesMap.get(b)?.position?.x ?? 0));
	}
	for (const [id, deg] of inDegree) {
		if (deg === 0) pushSorted(id);
	}

	const orderedIds: string[] = [];
	while (queue.length) {
		const id = queue.shift()!;
		orderedIds.push(id);
		for (const child of outgoing.get(id) ?? []) {
			if (!involved.has(child)) continue;
			inDegree.set(child, inDegree.get(child)! - 1);
			if (inDegree.get(child) === 0) pushSorted(child);
		}
	}

	return orderedIds.map((id) => buildExecutionObject(id, nodesMap, allNodes, allEdges)).filter(Boolean);
}

// ------------------------------------------------------------------
// Публичная функция — точка входа
// ------------------------------------------------------------------
export function createProcessQueue(graph: Graph, startNodeId = 'mainSearch'): any[] {
	// Перезаписываем cost/costUnit актуальными значениями из plugin.json,
	// чтобы изменения цены в Settings → Plugins применялись без перезагрузки флоу.
	const nodes = syncCostsFromManifest((graph.nodes ?? []) as any);
	// Отфильтровываем inactive edges (от выключенных нод) — для очереди исполнения
	// существуют только активные коннекторы. data.active отсутствует = active (legacy).
	const edges = (graph.edges ?? []).filter((e: any) => e?.data?.active !== false);
	const allNodesMap = new Map(nodes.map((n) => [n.id, n]));

	// Top-level ноды — без parentId
	const topLevelNodes = nodes.filter((n) => !n.parentId);
	const topLevelIds = new Set(topLevelNodes.map((n) => n.id));

	// Граф только по top-level нодам
	const incoming = new Map<string, string[]>();
	const outgoing = new Map<string, string[]>();
	for (const n of topLevelNodes) {
		incoming.set(n.id, []);
		outgoing.set(n.id, []);
	}
	for (const e of edges) {
		if (topLevelIds.has(e.source) && topLevelIds.has(e.target)) {
			incoming.get(e.target)?.push(e.source);
			outgoing.get(e.source)?.push(e.target);
		}
	}

	// 1. Стартовая нода
	const startId = [...topLevelIds].find((id) => id.toLowerCase() === startNodeId.toLowerCase());
	if (!startId) return [];

	// 2. Forward от startId
	const executionTargets = new Set<string>();
	function collectOutgoing(id: string) {
		if (executionTargets.has(id)) return;
		executionTargets.add(id);
		for (const next of outgoing.get(id) ?? []) collectOutgoing(next);
	}
	collectOutgoing(startId);

	// 3. Backward — top-level зависимости
	const involved = new Set<string>(executionTargets);
	function collectIncomingTopLevel(id: string) {
		for (const parent of incoming.get(id) ?? []) {
			if (!involved.has(parent)) {
				involved.add(parent);
				collectIncomingTopLevel(parent);
			}
		}
	}
	for (const id of executionTargets) collectIncomingTopLevel(id);

	// 3b. Cross-boundary: для loop-нод подтягиваем внешние ноды,
	//     которые подключены к их дочерним (например nQcde → J8bNY внутри loop)
	for (const id of executionTargets) {
		const node = allNodesMap.get(id);
		if (node?.data?.executionType !== 'loop') continue;

		const childIds = new Set(nodes.filter((n) => n.parentId === id).map((n) => n.id));

		for (const e of edges) {
			if (topLevelIds.has(e.source) && childIds.has(e.target)) {
				if (!involved.has(e.source)) {
					involved.add(e.source);
					collectIncomingTopLevel(e.source);
				}
			}
		}
	}

	// 3c. Forward-расширение от backward-найденных нод до стабилизации.
	//     Если нода попала в involved (как backward-зависимость), все её
	//     outgoing-соседи тоже должны быть включены — и так далее по цепочке.
	//     Пример: xiw-W найдена как dep Kn985, но у xiw-W есть ещё outgoing
	//     к -D1xN, которую тоже нужно выполнить.
	{
		let prevSize = 0;
		while (involved.size !== prevSize) {
			prevSize = involved.size;
			for (const id of [...involved]) {
				for (const child of outgoing.get(id) ?? []) {
					if (!involved.has(child)) {
						involved.add(child);
						collectIncomingTopLevel(child);
					}
				}
			}
		}
	}

	// 4. Kahn + X-sort
	const inDegree = new Map<string, number>();
	for (const id of involved) inDegree.set(id, 0);
	for (const e of edges) {
		if (involved.has(e.source) && involved.has(e.target) && topLevelIds.has(e.source) && topLevelIds.has(e.target)) {
			inDegree.set(e.target, inDegree.get(e.target)! + 1);
		}
	}

	// Сортировка по X-позиции: левее = раньше.
	// Заменяет depth (depth=0 для backward-нод → некорректен), отражает визуальный порядок.
	const queue: string[] = [];
	function pushSorted(id: string) {
		queue.push(id);
		queue.sort((a, b) => (allNodesMap.get(a)?.position?.x ?? 0) - (allNodesMap.get(b)?.position?.x ?? 0));
	}
	for (const [id, deg] of inDegree) {
		if (deg === 0) pushSorted(id);
	}

	const orderedIds: string[] = [];
	while (queue.length) {
		const id = queue.shift()!;
		orderedIds.push(id);
		for (const child of outgoing.get(id) ?? []) {
			if (!involved.has(child)) continue;
			inDegree.set(child, inDegree.get(child)! - 1);
			if (inDegree.get(child) === 0) pushSorted(child);
		}
	}

	// 6. Формируем execution-объекты
	const involvedNodesMap = new Map<string, AnyNode>();
	for (const id of involved) {
		const node = allNodesMap.get(id);
		if (node) involvedNodesMap.set(id, node);
	}

	return orderedIds.map((id) => buildExecutionObject(id, involvedNodesMap, nodes, edges)).filter(Boolean);
}
