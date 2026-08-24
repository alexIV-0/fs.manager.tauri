import { commands, unwrap } from '@/Utils/specta';

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
				// id, назначенный сайтом (задача из очереди). Пусто — Rust посчитает свой,
				// как и раньше. Без этого поля регистрация задачи легла бы в DbState под
				// локальным ключом, а item:end пришёл бы с taskId — и статистика не
				// нашла бы свою запись (`SITE_STATS_LINK_PLAN.md`).
				dbItemId: String(d.dbItemId ?? ''),
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

		const itemId = unwrap(await commands.dbRegisterFound(payload as any));
		_item.description.dbItemId = itemId;
	} catch (e) {
		console.warn('[registerFound] failed:', e);
	}
}
