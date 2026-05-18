import fs from 'fs';
import path from 'path';
import type { ItemRecord } from '../dbExporter.types';
import type { ITemplate, SaveContext } from '../templates.types';
import { SaveEvent as SaveEventEnum } from '../templates.types';
import type { LocalArchiveEntry, StorageSettings } from '../../../src/types/appSettings';
import { collectPeriodStats, mergePeriodStats, readJsonFile, resolveStatsPath } from './analytics';

interface TotalByProjectData {
  project: string;
  contact: string[];
  description: string;
  plugins: Record<string, string>;
  pluginCost: Record<string, number>;
  files: number;
  successCount: number;
  errorCount: number;
  totalCost: number;
  duration: string;
  renderTime: string;
}

interface OptionsNode {
  type: string;
  pluginId?: string;
  data?: {
    comment?: string;
  };
}

function readPluginsFromOptions(projectPathGD: string): Record<string, string> | null {
  if (!projectPathGD) return null;
  const optionsPath = path.join(projectPathGD, 'options', 'options.json');
  const raw = readJsonFile<{ nodes?: OptionsNode[] }>(optionsPath);
  if (!raw?.nodes) return null;

  const plugins: Record<string, string> = {};
  for (const node of raw.nodes) {
    if (node.type === 'description' || node.type === 'mainSearch') continue;
    const key = node.pluginId || node.type;
    if (key && node.data?.comment) {
      plugins[key] = node.data.comment;
    }
  }
  return plugins;
}

export const TotalByProjectTemplate: ITemplate = {
  id: 'total-by-project',
  label: 'Всего по проектам',
  description: 'Агрегирует статистику по проектам с метаданными из options.json',
  isBuiltIn: true,

  canHandle(context: SaveContext): boolean {
    return context.event === SaveEventEnum.ItemEnd;
  },

  transform(record: ItemRecord): unknown {
    return record;
  },

  getConfigs(storage: StorageSettings): unknown[] {
    return storage.localArchives?.filter((a) => a.templateId === 'total-by-project') ?? [];
  },

  async write(data: unknown, _context: SaveContext, config: unknown): Promise<void> {
    const cfg = config as LocalArchiveEntry;
    if (!cfg?.enabled || !cfg.path?.length) return;

    const record = data as ItemRecord;
    const filePath = resolveStatsPath(cfg.path, record);
    if (!filePath) return;

    const existing = readJsonFile<TotalByProjectData>(filePath);
    const existingPeriod = existing
      ? {
          files: existing.files,
          project: [],
          successCount: existing.successCount,
          errorCount: existing.errorCount,
          totalCost: existing.totalCost,
          duration: existing.duration,
          renderTime: existing.renderTime,
        }
      : null;
    const stats = existingPeriod
      ? mergePeriodStats(existingPeriod, record)
      : collectPeriodStats(record);

    // contact: Set-like merge — из record (уже пришёл через registerFound из options.json)
    const mergedContacts = Array.from(new Set([...(existing?.contact ?? []), ...record.contact]));

    // plugins: всегда последняя версия из options.json
    const plugins = readPluginsFromOptions(record.projectPathGD) ?? existing?.plugins ?? {};

    // pluginCost: накапливаем финальную стоимость каждого плагина
    const pluginCost: Record<string, number> = { ...(existing?.pluginCost ?? {}) };
    for (const plugin of record.plugins) {
      const key = plugin.name;
      const cost = plugin.finalCost ?? 0;
      pluginCost[key] = parseFloat(((pluginCost[key] ?? 0) + cost).toFixed(6));
    }

    const output: TotalByProjectData = {
      project: record.projectName,
      contact: mergedContacts,
      description: record.description || existing?.description || '',
      plugins,
      pluginCost,
      files: stats.files,
      successCount: stats.successCount,
      errorCount: stats.errorCount,
      totalCost: stats.totalCost,
      duration: stats.duration,
      renderTime: stats.renderTime,
    };

    try {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify(output, null, 2), 'utf-8');
    } catch (e) {
      throw new Error(`Failed to write total by project stats: ${(e as Error).message}`);
    }
  },
};
