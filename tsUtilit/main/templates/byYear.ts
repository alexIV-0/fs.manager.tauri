import fs from 'fs';
import path from 'path';
import type { ItemRecord } from '../dbExporter.types';
import type { ITemplate, SaveContext } from '../templates.types';
import { SaveEvent as SaveEventEnum } from '../templates.types';
import type { LocalArchiveEntry, StorageSettings } from '../../../src/types/appSettings';
import type { PeriodStats } from './analytics';
import { collectPeriodStats, mergePeriodStats, readJsonFile, getDateParts, resolveStatsPath } from './analytics';

export const ByYearTemplate: ITemplate = {
  id: 'by-year',
  label: 'По годам',
  description: 'Группирует статистику по годам и проектам',
  isBuiltIn: true,

  canHandle(context: SaveContext): boolean {
    return context.event === SaveEventEnum.ItemEnd;
  },

  transform(record: ItemRecord): unknown {
    return record;
  },

  getConfigs(storage: StorageSettings): unknown[] {
    return storage.localArchives?.filter((a) => a.templateId === 'by-year') ?? [];
  },

  async write(data: unknown, _context: SaveContext, config: unknown): Promise<void> {
    const cfg = config as LocalArchiveEntry;
    if (!cfg?.enabled || !cfg.path?.length) return;

    const record = data as ItemRecord;
    const filePath = resolveStatsPath(cfg.path, record);
    if (!filePath) return;

    const existing = readJsonFile<Record<string, PeriodStats>>(filePath) ?? {};
    const { year } = getDateParts(record.startedAt || record.registeredAt);

    existing[year] = existing[year]
      ? mergePeriodStats(existing[year]!, record)
      : collectPeriodStats(record);

    try {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify(existing, null, 2), 'utf-8');
    } catch (e) {
      throw new Error(`Failed to write by year stats: ${(e as Error).message}`);
    }
  },
};
