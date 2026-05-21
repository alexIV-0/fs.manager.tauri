import type { ItemRecord } from '../dbExporter.types';
import type { ITemplate, SaveContext } from '../templates.types';
import { SaveEvent as SaveEventEnum } from '../templates.types';
import type { OnlineDbSettings, StorageSettings } from '../../../src/types/appSettings';

function createPayload(record: ItemRecord, event: string): unknown {
	return {
		event,
		timestamp: new Date().toISOString(),
		record,
	};
}

export const DatabaseSyncTemplate: ITemplate = {
	id: 'database-sync',
	label: 'Синхронизация с БД',
	description: 'Отправляет данные на онлайн-БД при регистрации и завершении (или при каждом событии)',
	isBuiltIn: true,

	canHandle(context: SaveContext): boolean {
		// TODO: проверять конфиг из settings
		// Пока просто отправляем при RegisterFound и ItemEnd
		return (
			context.event === SaveEventEnum.RegisterFound || context.event === SaveEventEnum.ItemEnd
		);
	},

	transform(record: ItemRecord): unknown {
		return record;
	},

	getConfigs(storage: StorageSettings): unknown[] {
		return storage.onlineDb?.enabled ? [storage.onlineDb] : [];
	},

	async write(data: unknown, context: SaveContext, config: unknown): Promise<void> {
		const dbConfig = config as OnlineDbSettings;
		if (!dbConfig?.enabled || !dbConfig.url) return;

		const payload = createPayload(context.record, context.event);

		try {
			const headers: Record<string, string> = {
				'Content-Type': 'application/json',
			};

			const response = await fetch(dbConfig.url, {
				method: 'POST',
				headers,
				body: JSON.stringify(payload),
			});

			if (!response.ok) {
				throw new Error(`HTTP ${response.status}: ${response.statusText}`);
			}
		} catch (e) {
			throw new Error(`Failed to sync to database: ${(e as Error).message}`);
		}
	},
};
