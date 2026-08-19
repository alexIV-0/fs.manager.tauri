import { nanoid } from 'nanoid';

import { RESOLVERS } from './masks';
import type { Description, ReplacerArgs } from './masks';

// Ре-экспорт типов: плагины и createPathForFileByPattern импортируют Description отсюда.
export type { Description, ReplacerArgs };

interface FormatNameOptions {
	string: string;
	description?: Partial<Description>;
	file?: string;
	/**
	 * Бросать на нераскрытом токене вместо предупреждения.
	 *
	 * Включается там, где строка становится ПУТЁМ (`createPathForFileByPattern`):
	 * там нераскрытый токен превращается в настоящую папку с именем `$footage`.
	 * Для остальных строк (имена, аргументы) остаётся предупреждение — через эту
	 * функцию проходят и строки, пришедшие от плагинов и из имён файлов.
	 */
	strict?: boolean;
}

// Токен вида `$name`. Набор символов тот же, по которому фильтруются имена алиасов
// (`readMachineLocals`) и строятся ключи RESOLVERS.
const TOKEN_RE = /\$([A-Za-z0-9_]+)/g;

// `$random` живёт отдельным проходом и в RESOLVERS его нет — иначе он выглядел бы
// незнакомым токеном.
const SPECIAL_KEYS = ['random'];

/**
 * Токены `$name`, которые в этой строке подставить НЕЧЕМ.
 *
 * Зачем: незнакомый токен доезжает до файловой системы буквально. Оба прохода
 * подстановки строят regex из ИЗВЕСТНЫХ ключей, поэтому `$footage` на машине, где
 * такого алиаса нет, просто остаётся в строке — и дальше создаётся папка с именем
 * `$footage`, куда молча уезжает результат витка. Особенно легко получить на воркере:
 * имя алиаса зашито в граф, а значение живёт в настройках каждой машины отдельно.
 *
 * Проверяется ВХОДНАЯ строка, а не результат: в результате уже стоят подставленные
 * значения, и файл с именем `promo$bc` выглядел бы как нераскрытый токен.
 *
 * Совпадение по ПРЕФИКСУ — так работает сама подстановка: альтернация с длинными
 * ключами впереди берёт `$YYYY` из `$YYYYMM` и оставляет `MM` текстом. Значит токен,
 * начинающийся с известного ключа, раскроется хотя бы частично и ошибкой не является.
 */
export function findUnknownTokens(string: string, aliases?: Record<string, string>): string[] {
	const known = [...Object.keys(RESOLVERS), ...SPECIAL_KEYS, ...Object.keys(aliases ?? {})];
	const unknown = new Set<string>();
	for (const match of string.matchAll(TOKEN_RE)) {
		const key = match[1];
		if (known.some((k) => key.startsWith(k))) continue;
		unknown.add(key);
	}
	return [...unknown];
}

export function formatNameByPattern({ string, description = {}, file, strict }: FormatNameOptions): string {
	// Проверяем ДО подстановки: после неё в строке стоят значения, а не токены.
	const unknown = findUnknownTokens(string, description?.pathAliases);
	if (unknown.length > 0) {
		const list = unknown.map((k) => `$${k}`).join(', ');
		const where = `нераскрытые маски ${list} в "${string}"`;
		if (strict) {
			throw new Error(
				`[formatNameByPattern] ${where}. ` +
				`Так путь превратился бы в папку с этим именем. Если это алиас — определи его ` +
				`в настройках путей НА ЭТОЙ машине (Settings → Paths), иначе убери токен из шаблона.`,
			);
		}
		console.warn(`[formatNameByPattern] ${where}`);
	}

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
