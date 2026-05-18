import fs from 'fs';
import path from 'path';
import type { ItemRecord } from '../dbExporter.types';
import { formatNameByPattern } from '../fileSistem/formatNameByPattern';

export interface PeriodStats {
  files: number;
  project: string[];
  successCount: number;
  errorCount: number;
  totalCost: number;
  duration: string;    // HH:MM:SS — total media duration of final output files (video/audio)
  renderTime: string;  // HH:MM:SS — sum of all plugin durations
}

export function secsToTimecode(totalSecs: number): string {
  const s = Math.max(0, Math.floor(totalSecs));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

export function timecodeToSecs(tc: string): number {
  const parts = tc.split(':').map(Number);
  if (parts.length === 3) return (parts[0] ?? 0) * 3600 + (parts[1] ?? 0) * 60 + (parts[2] ?? 0);
  if (parts.length === 2) return (parts[0] ?? 0) * 60 + (parts[1] ?? 0);
  return 0;
}

function pluginDurationSec(record: ItemRecord): number {
  return record.plugins.reduce((sum, p) => sum + (p.durationSec ?? 0), 0);
}

function finalMediaDurationSec(record: ItemRecord): number {
  return record.finalItems.reduce((sum, fi) => sum + (fi.mediaDurationSec ?? 0), 0);
}

function roundCost(v: number): number {
  return parseFloat(v.toFixed(6));
}

export function collectPeriodStats(record: ItemRecord): PeriodStats {
  return {
    files: 1,
    project: [record.projectName],
    successCount: record.status === 'done' ? 1 : 0,
    errorCount: record.status === 'error' ? 1 : 0,
    totalCost: roundCost(record.totalCost),
    duration: secsToTimecode(finalMediaDurationSec(record)),
    renderTime: secsToTimecode(pluginDurationSec(record)),
  };
}

export function mergePeriodStats(existing: PeriodStats, record: ItemRecord): PeriodStats {
  const projKey = record.projectName;
  const existingProjects = existing.project ?? [];
  const mergedProjects = existingProjects.includes(projKey)
    ? existingProjects
    : [...existingProjects, projKey];
  return {
    files: existing.files + 1,
    project: mergedProjects,
    successCount: existing.successCount + (record.status === 'done' ? 1 : 0),
    errorCount: existing.errorCount + (record.status === 'error' ? 1 : 0),
    totalCost: roundCost(existing.totalCost + record.totalCost),
    duration: secsToTimecode(timecodeToSecs(existing.duration) + finalMediaDurationSec(record)),
    renderTime: secsToTimecode(timecodeToSecs(existing.renderTime) + pluginDurationSec(record)),
  };
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function getDateParts(isoString: string): {
  year: string;
  month: string;
  monthName: string;
  monthKey: string;  // "01 January"
  dayKey: string;    // "01 (15 January)"
  date: string;      // "YYYY-MM-DD"
} {
  const d = new Date(isoString);
  const year = d.getUTCFullYear().toString();
  const monthNum = d.getUTCMonth();
  const month = String(monthNum + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  const monthName = MONTH_NAMES[monthNum] ?? '';
  const date = d.toISOString().split('T')[0] ?? '';
  return { year, month, monthName, monthKey: `${month} ${monthName}`, dayKey: `${month} (${day} ${monthName})`, date };
}

export function getWeekBounds(isoString: string): {
  weekStart: string;  // "YYYY-MM-DD"
  weekEnd: string;    // "YYYY-MM-DD"
  weekKey: string;    // "DD.MM-DD.MM"
} {
  const d = new Date(isoString);
  const dayOfWeek = d.getUTCDay();
  const diff = d.getUTCDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
  const weekStart = new Date(d);
  weekStart.setUTCDate(diff);
  const weekEnd = new Date(weekStart);
  weekEnd.setUTCDate(weekStart.getUTCDate() + 6);

  const fmt = (dt: Date) => {
    const dd = String(dt.getUTCDate()).padStart(2, '0');
    const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
    return `${dd}.${mm}`;
  };

  return {
    weekStart: weekStart.toISOString().split('T')[0] ?? '',
    weekEnd: weekEnd.toISOString().split('T')[0] ?? '',
    weekKey: `${fmt(weekStart)}-${fmt(weekEnd)}`,
  };
}

export function readJsonFile<T>(filePath: string): T | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const data = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(data) as T;
  } catch {
    return null;
  }
}

export function resolveStatsPath(pathSegments: string[], record: ItemRecord): string | null {
  const clean = pathSegments.filter((s) => typeof s === 'string' && s.length > 0);
  if (!clean.length) return null;
  try {
    const joined = path.join(...clean);
    const itemName = record.originalItem?.name ?? '';
    const resolved = formatNameByPattern({
      string: joined,
      description: {
        projectName: record.projectName,
        mainFolderName: record.mainFolderName,
        projectPathGD: record.projectPathGD,
        curItem: itemName,
        clearName: itemName.replace(/\.[^./]+$/, ''),
        findTime: record.findTime,
        localFolder: '',
      },
    });
    if (!resolved) return null;
    return /\.json$/i.test(resolved) ? resolved : resolved + '.json';
  } catch {
    return null;
  }
}
