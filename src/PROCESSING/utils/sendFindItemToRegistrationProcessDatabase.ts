export async function sendFindItemToRegistrationProcessDatabase(_item: any): Promise<void> {
	try {
		const d = _item.description ?? {};
		const queue: string[] = _item.processingQueue ?? [];

		const plugins = queue
			.filter((stepId) => stepId !== 'mainSearch')
			.map((stepId) => {
				const s = _item[stepId] ?? {};
				return {
					stepId,
					pluginId: s.pluginId,
					pluginVersion: s.pluginVersion,
					cost: s.cost,
					costUnit: s.costUnit,
					isTerminal: Boolean(s.isTerminal),
				};
			});

		const payload = {
			description: {
				curItem: d.curItem ?? '',
				isFolder: Boolean(d.isFolder),
				size: Number(d.size ?? 0),
				projectName: d.projectName ?? '',
				mainFolderName: d.mainFolderName ?? '',
				projectPathGD: String(d.projectPathGD ?? ''),
				contact: Array.isArray(d.contact) ? d.contact : [],
				description: String(d.discription ?? ''),
				tags: Array.isArray(d.automationType) ? d.automationType : [],
				year: String(d.year ?? ''),
				findTime: String(d.findTime ?? ''),
			},
			plugins,
		};

		const itemId: string = await window.electronAPI.invoke('db:registerFound', payload);
		_item.description.dbItemId = itemId;
	} catch (e) {
		console.warn('[registerFound] failed:', e);
	}
}
