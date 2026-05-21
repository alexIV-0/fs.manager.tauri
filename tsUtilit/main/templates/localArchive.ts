import fs from 'fs';
import path from 'path';
import type { ItemRecord } from '../dbExporter.types';
import type { ITemplate, SaveContext } from '../templates.types';
import { SaveEvent as SaveEventEnum } from '../templates.types';
import { formatNameByPattern } from '../fileSistem/formatNameByPattern';
import type { LocalArchiveEntry, StorageSettings } from '../../../src/types/appSettings';

function descriptionFromRecord(r: ItemRecord) {
	const itemName = r.originalItem?.name ?? '';
	const clearName = itemName.replace(/\.[^./]+$/, '');
	return {
		projectName: r.projectName,
		mainFolderName: r.mainFolderName,
		curItem: itemName,
		clearName,
		findTime: r.findTime,
		localFolder: '',
	};
}

function resolveArchivePath(r: ItemRecord, pathSegments: string[]): string | null {
	const clean = pathSegments.filter((s) => typeof s === 'string' && s.length > 0);
	if (!clean.length) return null;

	let joined: string;
	try {
		joined = path.join(...clean);
	} catch {
		return null;
	}

	let resolved = formatNameByPattern({
		string: joined,
		description: descriptionFromRecord(r),
	});
	if (!resolved) return null;

	if (!/\.jsonl$/i.test(resolved)) resolved += '.jsonl';
	return resolved;
}

export const LocalArchiveTemplate: ITemplate = {
	id: 'local-archive',
	label: 'Локальный архив (JSONL)',
	description: 'Сохраняет только финальный снимок процесса в локальный JSONL файл',
	isBuiltIn: true,

	canHandle(context: SaveContext): boolean {
		return context.event === SaveEventEnum.ItemEnd;
	},

	transform(record: ItemRecord): unknown {
		return record;
	},

	getConfigs(storage: StorageSettings): unknown[] {
		return storage.localArchives?.filter((a) => a.templateId === 'local-archive') ?? [];
	},

	async write(data: unknown, context: SaveContext, config: unknown): Promise<void> {
		const archiveConfig = config as LocalArchiveEntry;
		if (!archiveConfig?.enabled || !archiveConfig.path?.length) return;

		const filePath = resolveArchivePath(context.record, archiveConfig.path);
		if (!filePath) return;

		try {
			const dir = path.dirname(filePath);
			if (!fs.existsSync(dir)) {
				fs.mkdirSync(dir, { recursive: true });
			}
			fs.appendFileSync(filePath, JSON.stringify(data) + '\n', 'utf-8');
		} catch (e) {
			throw new Error(`Failed to write to ${filePath}: ${(e as Error).message}`);
		}
	},
};
