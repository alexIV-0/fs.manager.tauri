export function getSourceNodeData(edge: any, allNodeInFlow: any): any {
	if (!edge) return null;
	const sourceNode = allNodeInFlow.find((n: any) => n.id === edge.source);
	return sourceNode ? sourceNode.data : null;
}
