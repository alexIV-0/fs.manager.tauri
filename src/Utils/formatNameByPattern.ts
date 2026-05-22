import path from 'path';
import { nanoid } from 'nanoid';

import { getFormattedDateTime } from './getFormattedDateTime';
import { getIDandNameFile } from './getIDandNameFile';
import { PatternKeys } from '../types/searchType';

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
	localFolder: string;
	pathAliases?: Record<string, string>;
}

interface FormatNameOptions {
	string: string;
	description?: Partial<Description>;
	file?: string;
}

// Ленивая карта функций-генераторов
type ReplacerArgs = {
	description?: Partial<Description>;
	file?: string;
};

const replacers: Record<PatternKeys, (args: ReplacerArgs) => any> = {
	[PatternKeys.id]: ({ description }) => description?.id ?? nanoid(10),
	[PatternKeys.findTime]: ({ description }) => description?.findTime ?? getFormattedDateTime('$DD.$MM-$HH.$mm'),
	[PatternKeys.clearName]: ({ description }) => description?.clearName?.trim() ?? nanoid(10),
	[PatternKeys.index]: ({ description, file }) =>
		file && description?.finalFile ? description.finalFile.indexOf(file) + 1 : 1,
	[PatternKeys.fileName]: ({ file }) => (file ? path.basename(file, path.extname(file)) : nanoid(10)),
	[PatternKeys.clearFileName]: ({ file }) => (file ? getIDandNameFile(path.basename(file)).clearName : nanoid(10)),
	[PatternKeys.curItemName]: ({ description }) =>
		description?.curItem ? path.basename(description.curItem, path.extname(description.curItem)) : nanoid(10),
	[PatternKeys.projectName]: ({ description }) => description?.projectName ?? 'default',
	[PatternKeys.projectPathGD]: ({ description }) => description?.projectPathGD ?? '',
	[PatternKeys.mainFolderName]: ({ description }) => description?.mainFolderName ?? '',
	[PatternKeys.mainFolderPath]: ({ description }) => description?.mainFolderPath ?? '',
	[PatternKeys.localFolder]: ({ description }) => description?.localFolder ?? '',
	[PatternKeys.curMonthStr]: () => {
		const months = [
			'January',
			'February',
			'March',
			'April',
			'May',
			'June',
			'July',
			'August',
			'September',
			'October',
			'November',
			'December',
		];
		return months[new Date().getMonth()];
	},

	[PatternKeys.YYYY]: () => getFormattedDateTime('$YYYY'),
	[PatternKeys.MM]: () => getFormattedDateTime('$MM'),
	[PatternKeys.DD]: () => getFormattedDateTime('$DD'),
	[PatternKeys.HH]: () => getFormattedDateTime('$HH'),
	[PatternKeys.mm]: () => getFormattedDateTime('$mm'),
	[PatternKeys.ss]: () => getFormattedDateTime('$ss'),
};

export function formatNameByPattern({ string, description = {}, file }: FormatNameOptions): string {
	let result = string;

	// Пользовательские алиасы из pathPattern_store (например, $footage → /path/to/footage).
	// Делается ПЕРВЫМ проходом, чтобы значение алиаса могло само содержать встроенные
	// $-токены ($localFolder, $projectName и т.п.) — они раскроются на основном проходе ниже.
	const aliases = description?.pathAliases;
	if (aliases) {
		const aliasNames = Object.keys(aliases).filter((n) => /^[A-Za-z0-9_]+$/.test(n));
		if (aliasNames.length > 0) {
			// длинные имена первыми, иначе $foo съест начало $foobar в regex-альтернации
			aliasNames.sort((a, b) => b.length - a.length);
			const aliasPattern = new RegExp(`\\$(${aliasNames.map(escapeRegExp).join('|')})`, 'g');
			result = result.replace(aliasPattern, (_, key: string) => aliases[key] ?? '');
		}
	}

	// Обрабатываем random()
	const randomRegex = /\$random(?:\((\d+)\))?/g;
	result = result.replace(randomRegex, (_, lenStr) => {
		const length = lenStr ? parseInt(lenStr, 10) : 10;
		return nanoid(length);
	});

	// Обрабатываем остальные ключи
	const keys = Object.keys(replacers) as (keyof typeof replacers)[];
	const keysPattern = new RegExp(`\\$(${keys.map(escapeRegExp).join('|')})`, 'g');

	result = result.replace(keysPattern, (_, key: PatternKeys) => {
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

function escapeRegExp(string: string): string {
	return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
