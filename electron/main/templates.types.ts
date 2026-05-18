import type { ItemRecord } from './dbExporter.types';
import type { StorageSettings } from '../../src/types/appSettings';

export enum SaveEvent {
	RegisterFound = 'registerFound',
	ItemStart = 'itemStart',
	ItemEnd = 'itemEnd',
	NodeStart = 'nodeStart',
	NodeDone = 'nodeDone',
	NodeError = 'nodeError',
}

export interface SaveContext {
	event: SaveEvent;
	record: ItemRecord;
	previousRecord?: ItemRecord;
}

export interface TemplateMetadata {
	id: string;
	label: string;
	description: string;
	isBuiltIn: boolean;
}

export interface ITemplate extends TemplateMetadata {
	/**
	 * Определяет, должен ли этот шаблон сохранять данные в данном контексте.
	 * Например, localArchive сохраняет только при itemEnd, а databaseSync — при каждом событии.
	 */
	canHandle(context: SaveContext): boolean;

	/**
	 * Трансформирует ItemRecord в формат для сохранения/отправки.
	 * Например, может фильтровать поля или переформатировать структуру.
	 */
	transform(record: ItemRecord): unknown;

	/**
	 * Получает массив конфигов для этого шаблона из settings.
	 * Например, localArchive возвращает settings.storage.localArchives (массив),
	 * а databaseSync возвращает [settings.storage.onlineDb] (обернуть в массив).
	 */
	getConfigs(storage: StorageSettings): unknown[];

	/**
	 * Сохраняет/отправляет трансформированные данные.
	 * Может быть асинхронной операцией (запись в файл, HTTP запрос в БД и т.д.).
	 */
	write(data: unknown, context: SaveContext, config: unknown): Promise<void>;
}

export interface TemplateError {
	templateId: string;
	templateLabel: string;
	event: SaveEvent;
	error: Error;
	timestamp: string;
}
