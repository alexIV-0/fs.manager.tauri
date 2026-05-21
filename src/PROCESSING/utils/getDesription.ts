export function getDescription(_node: any): { [key: string]: any } {
	const discriptionNode = _node.nodes.find((node: any) => node.id.toLowerCase() === 'description');

	const contact = discriptionNode.data.properties.find((p: any) => p.id.toLowerCase() === 'contact')?.controlProps?.value;

	const EXCLUDED_COLOR_TYPES = new Set(['main', 'helpers']);
	const automationType = [
		...new Set(
			(_node.nodes as any[])
				.filter((n: any) => !EXCLUDED_COLOR_TYPES.has(n.data?.colorType))
				.map((n: any) => n.data?.pluginId)
				.filter(Boolean),
		),
	];

	const getNeededProp = {
		contact,
		automationType,
		discription: discriptionNode.data.comment,
	};
	return getNeededProp;
}
