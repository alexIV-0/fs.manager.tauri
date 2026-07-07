import { nanoid } from 'nanoid';

import { RESOLVERS } from './masks';
import type { Description, ReplacerArgs } from './masks';

// Ре-экспорт типов: плагины и createPathForFileByPattern импортируют Description отсюда.
export type { Description, ReplacerArgs };

interface FormatNameOptions {
	string: string;
	description?: Partial<Description>;
	file?: string;
}

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

	// Обрабатываем random(): $random / $random() → 10 символов, $random(N) → N символов.
	// \d* (а не \d+) — чтобы пустые скобки $random() тоже поглощались, а не оставляли "()".
	const randomRegex = /\$random(?:\((\d*)\))?/g;
	result = result.replace(randomRegex, (_, lenStr) => {
		const length = lenStr ? parseInt(lenStr, 10) : 10;
		return nanoid(length);
	});

	// Обрабатываем остальные ключи (источник — MASKS в masks.ts).
	// Длинные ключи первыми, чтобы короткий не съел начало длинного в альтернации.
	const keys = Object.keys(RESOLVERS).sort((a, b) => b.length - a.length);
	const keysPattern = new RegExp(`\\$(${keys.map(escapeRegExp).join('|')})`, 'g');

	result = result.replace(keysPattern, (_, key: string) => {
		const replacer = RESOLVERS[key];
		if (!replacer) return '';
		try {
			return String(replacer({ description, file } as ReplacerArgs) ?? '');
		} catch {
			return '';
		}
	});

	return result;
}

function escapeRegExp(string: string): string {
	return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
