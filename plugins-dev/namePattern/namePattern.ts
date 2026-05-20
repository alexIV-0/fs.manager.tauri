// System plugin: centralized source of truth for $-pattern variables and formatNameByPattern.
// Processing plugins can import this at runtime via loadPlugin('namePattern', '1.0.0').
//
// Usage in processing plugin:
//   const { formatNameByPattern } = await loadPlugin('namePattern', '1.0.0')
//   const result = formatNameByPattern({ string: '$fileName_$DD', file: '/path/to/file.mp4', description })

import path from 'path';
import { onLoad } from '../_template/tauri';

export { onLoad };

// ─── Pattern variable definitions ────────────────────────────────────────────
// Single source of truth: add new $-variables here and they appear everywhere
// (dropdowns via #pathPattern, and in the function below).

export interface PatternVarDef {
	key: string;
	label: string;
	description: string;
	example: string;
}

export const PATTERN_VARS: PatternVarDef[] = [
	{ key: '$fileName',      label: '$fileName',      description: 'Current filename without extension (as-is)', example: 'MyVideo' },
	{ key: '$clearFileName', label: '$clearFileName',  description: 'Clean filename without special chars', example: 'MyVideo' },
	{ key: '$clearName',     label: '$clearName',      description: 'Clean item name (no emoji, no brackets)', example: 'Project Name' },
	{ key: '$curItemName',   label: '$curItemName',    description: 'Current item name in folder IN', example: 'Scene 01' },
	{ key: '$id',            label: '$id',             description: 'Unique ID from item name', example: 'A001' },
	{ key: '$index',         label: '$index',          description: 'Element index when multiple files', example: '1' },
	{ key: '$projectName',   label: '$projectName',    description: 'Project folder name', example: 'MyProject' },
	{ key: '$projectPathGD', label: '$projectPathGD',  description: 'Full path to project folder', example: '/Users/.../MyProject' },
	{ key: '$mainFolderName',label: '$mainFolderName', description: 'Parent folder name', example: 'WorkFolder' },
	{ key: '$mainFolderPath',label: '$mainFolderPath', description: 'Parent folder path', example: '/Users/.../WorkFolder' },
	{ key: '$localFolder',   label: '$localFolder',    description: 'Working folder on local disk', example: '/Users/.../Local' },
	{ key: '$findTime',      label: '$findTime',       description: 'When item was found (DD.MM-HH.mm)', example: '05.11-14.30' },
	{ key: '$curMonthStr',   label: '$curMonthStr',    description: 'Current month as string', example: 'January' },
	{ key: '$YYYY',          label: '$YYYY',           description: 'Year (4 digits)', example: '2025' },
	{ key: '$MM',            label: '$MM',             description: 'Month (2 digits)', example: '05' },
	{ key: '$DD',            label: '$DD',             description: 'Day (2 digits)', example: '20' },
	{ key: '$HH',            label: '$HH',             description: 'Hours (2 digits)', example: '14' },
	{ key: '$mm',            label: '$mm',             description: 'Minutes (2 digits)', example: '30' },
	{ key: '$ss',            label: '$ss',             description: 'Seconds (2 digits)', example: '00' },
	{ key: '$random(',       label: '$random(N)',       description: 'Random string of N characters (e.g. $random(8))', example: 'xK3p9qRt' },
];

// ─── formatNameByPattern ──────────────────────────────────────────────────────

export interface Description {
	id?: string | number;
	findTime?: string;
	clearName?: string;
	finalFile?: string[];
	curItem?: string;
	projectName?: string;
	projectPathGD?: string;
	mainFolderName?: string;
	mainFolderPath?: string;
	workFolder?: string;
	localFolder?: string;
	pathAliases?: Record<string, string>;
}

export interface FormatNameOptions {
	string: string;
	description?: Partial<Description>;
	file?: string;
}

function nanoid(len = 10): string {
	const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	let result = '';
	const arr = new Uint8Array(len);
	crypto.getRandomValues(arr);
	for (const n of arr) result += chars[n % chars.length];
	return result;
}

function escapeRegExp(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getFormattedDateTime(pattern: string): string {
	const now = new Date();
	return pattern
		.replace('$YYYY', String(now.getFullYear()))
		.replace('$MM', String(now.getMonth() + 1).padStart(2, '0'))
		.replace('$DD', String(now.getDate()).padStart(2, '0'))
		.replace('$HH', String(now.getHours()).padStart(2, '0'))
		.replace('$mm', String(now.getMinutes()).padStart(2, '0'))
		.replace('$ss', String(now.getSeconds()).padStart(2, '0'));
}

type ReplacerFn = (args: { description?: Partial<Description>; file?: string }) => any;

const replacers: Record<string, ReplacerFn> = {
	id:            ({ description }) => description?.id ?? nanoid(10),
	findTime:      ({ description }) => description?.findTime ?? getFormattedDateTime('$DD.$MM-$HH.$mm'),
	clearName:     ({ description }) => description?.clearName?.trim() ?? nanoid(10),
	index:         ({ description, file }) => file && description?.finalFile ? description.finalFile.indexOf(file) + 1 : 1,
	fileName:      ({ file }) => file ? path.basename(file, path.extname(file)) : nanoid(10),
	clearFileName: ({ file }) => {
		if (!file) return nanoid(10);
		const name = path.basename(file, path.extname(file));
		return name.replace(/[()[\]"'«»„""'']/g, '').replace(/\s+/g, ' ').trim() || nanoid(10);
	},
	curItemName:   ({ description }) => description?.curItem ? path.basename(description.curItem, path.extname(description.curItem)) : nanoid(10),
	projectName:   ({ description }) => description?.projectName ?? 'default',
	projectPathGD: ({ description }) => description?.projectPathGD ?? '',
	mainFolderName:({ description }) => description?.mainFolderName ?? '',
	mainFolderPath:({ description }) => description?.mainFolderPath ?? '',
	localFolder:   ({ description }) => description?.localFolder ?? '',
	curMonthStr: () => {
		const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
		return months[new Date().getMonth()];
	},
	YYYY: () => getFormattedDateTime('$YYYY'),
	MM:   () => getFormattedDateTime('$MM'),
	DD:   () => getFormattedDateTime('$DD'),
	HH:   () => getFormattedDateTime('$HH'),
	mm:   () => getFormattedDateTime('$mm'),
	ss:   () => getFormattedDateTime('$ss'),
};

export function formatNameByPattern({ string, description = {}, file }: FormatNameOptions): string {
	let result = string;

	// First pass: user-defined aliases (e.g. $footage → /path/to/footage).
	// Done first so alias values can themselves contain built-in $-tokens.
	const aliases = description?.pathAliases;
	if (aliases) {
		const aliasNames = Object.keys(aliases).filter((n) => /^[A-Za-z0-9_]+$/.test(n));
		if (aliasNames.length > 0) {
			aliasNames.sort((a, b) => b.length - a.length);
			const aliasPattern = new RegExp(`\\$(${aliasNames.map(escapeRegExp).join('|')})`, 'g');
			result = result.replace(aliasPattern, (_, key: string) => aliases[key] ?? '');
		}
	}

	// Second pass: $random(N) or $random
	result = result.replace(/\$random(?:\((\d+)\))?/g, (_, lenStr) => {
		return nanoid(lenStr ? parseInt(lenStr, 10) : 10);
	});

	// Third pass: all built-in keys
	const keys = Object.keys(replacers);
	const keysPattern = new RegExp(`\\$(${keys.map(escapeRegExp).join('|')})`, 'g');
	result = result.replace(keysPattern, (_, key: string) => {
		const replacer = replacers[key];
		if (!replacer) return '';
		try {
			return String(replacer({ description, file }) ?? '');
		} catch {
			return '';
		}
	});

	return result;
}
