import type { ITemplate, TemplateMetadata } from '../templates.types';
import { LocalArchiveTemplate } from './localArchive';
import { DatabaseSyncTemplate } from './databaseSync';
import { TotalByProjectTemplate } from './totalByProject';
import { ByYearTemplate } from './byYear';
import { ByMonthTemplate } from './byMonth';
import { ByWeekTemplate } from './byWeek';
import { ByDayTemplate } from './byDay';

export const ALL_TEMPLATES: ITemplate[] = [
  LocalArchiveTemplate,
  DatabaseSyncTemplate,
  TotalByProjectTemplate,
  ByYearTemplate,
  ByMonthTemplate,
  ByWeekTemplate,
  ByDayTemplate,
];

export function getTemplate(id: string): ITemplate | null {
	return ALL_TEMPLATES.find((t) => t.id === id) ?? null;
}

export function getTemplateMetadata(): TemplateMetadata[] {
	return ALL_TEMPLATES.map(({ id, label, description, isBuiltIn }) => ({
		id,
		label,
		description,
		isBuiltIn,
	}));
}

export function getTemplateList(): Array<{ id: string; label: string }> {
	return ALL_TEMPLATES.map(({ id, label }) => ({ id, label }));
}
