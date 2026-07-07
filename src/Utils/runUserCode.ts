// Общее ядро исполнения пользовательского JS для ноды jsCode.
// Импортируется И фронтендом (кнопка ▶ Run в редакторе кода), И рантаймом плагина
// (plugins-dev/jsCode/jsCode.ts) — один и тот же код на «тест в ноде» и на боевой прогон,
// чтобы результат теста совпадал с результатом пайплайна.
//
// Модель исполнения: `new Function(...именаВходов, 'inputs','helpers','console','log', body)`,
// где body = `"use strict"; return (async () => { <userCode> })()`. Так пользователю
// доступен ВЕСЬ стандартный JS (Array/String/Object/Math/JSON/RegExp/Date/…), а каждый
// добавленный вход виден по своему имени-лейблу как обычная переменная (плюс дублируется
// в объекте `inputs` — на случай имён, не являющихся валидными JS-идентификаторами).
//
// ВАЖНО: исполнение синхронно-блокирующее в текущем WebView. Бесконечный цикл в коде
// подвесит окно (для теста) или воркер обработки (для рантайма) — сэндбокса/таймаута нет.

import { getRandomInt } from './getRandomInt';
// Кастомный полифил node:path (чистый JS, без nodejs/IPC) — работает и во фронте, и в бандле плагина.
import { join, basename, dirname, extname, parse, format, resolve, relative, isAbsolute, normalize } from '../PluginAPI/path';

export interface RunUserCodeResult {
	ok: boolean;
	/** Значение, которое вернул пользовательский код через `return`. */
	result?: unknown;
	/** Текст ошибки (синтаксис / рантайм), если ok === false. */
	error?: string;
	/** Строки, собранные из console.log/warn/error/info и log(). */
	logs: string[];
	/** Длительность исполнения, мс. */
	durationMs: number;
}

// ── Мини-хелперы (чистый JS, без зависимостей) ───────────────────────────────
// Доступны в коде как `helpers.<name>`. Покрывают частые операции:
// парсинг строк, случайная выборка, дедуп, группировка.
// getRandomInt переиспользуется из src/Utils/getRandomInt.ts (импорт выше).

function shuffle<T>(arr: readonly T[]): T[] {
	const a = arr.slice();
	for (let i = a.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[a[i], a[j]] = [a[j], a[i]];
	}
	return a;
}

/** n случайных УНИКАЛЬНЫХ элементов массива (без повторов). Если n >= длины — весь перемешанный массив. */
function sample<T>(arr: readonly T[], n = 1): T[] {
	if (!Array.isArray(arr)) return [];
	return shuffle(arr).slice(0, Math.max(0, Math.floor(n)));
}

function uniq<T>(arr: readonly T[]): T[] {
	return Array.from(new Set(arr));
}

/** range(3) => [0,1,2]; range(2,5) => [2,3,4] */
function range(a: number, b?: number): number[] {
	const start = typeof b === 'undefined' ? 0 : a;
	const end = typeof b === 'undefined' ? a : b;
	const out: number[] = [];
	for (let i = start; i < end; i++) out.push(i);
	return out;
}

function chunk<T>(arr: readonly T[], size: number): T[][] {
	const out: T[][] = [];
	const s = Math.max(1, Math.floor(size));
	for (let i = 0; i < arr.length; i += s) out.push(arr.slice(i, i + s));
	return out;
}

/** Разбить строку по запятым/переносам/точкам с запятой, обрезать пробелы, выкинуть пустые. */
function splitList(str: unknown): string[] {
	return String(str ?? '')
		.split(/[\n,;]+/)
		.map((s) => s.trim())
		.filter(Boolean);
}

function clamp(x: number, min: number, max: number): number {
	return Math.min(Math.max(x, min), max);
}

export const jsCodeHelpers = {
	getRandomInt,
	shuffle,
	sample,
	uniq,
	range,
	chunk,
	splitList,
	clamp,
	// path — плоско: helpers.join / helpers.basename / helpers.dirname / …
	join,
	basename,
	dirname,
	extname,
	parse,
	format,
	resolve,
	relative,
	isAbsolute,
	normalize,
} as const;

// ── Утилиты ──────────────────────────────────────────────────────────────────

/** Валидный ли ключ как JS-идентификатор (чтобы прокинуть вход как переменную). */
function isValidIdentifier(name: string): boolean {
	return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) && !RESERVED.has(name);
}

const RESERVED = new Set([
	'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete', 'do',
	'else', 'export', 'extends', 'finally', 'for', 'function', 'if', 'import', 'in', 'instanceof',
	'new', 'return', 'super', 'switch', 'this', 'throw', 'try', 'typeof', 'var', 'void', 'while',
	'with', 'yield', 'let', 'static', 'enum', 'await', 'null', 'true', 'false',
	// зарезервированные нами имена в scope
	'inputs', 'helpers', 'console', 'log',
]);

function stringifyLogArg(a: unknown): string {
	if (typeof a === 'string') return a;
	try {
		return JSON.stringify(a);
	} catch {
		return String(a);
	}
}

// ── Исполнитель ────────────────────────────────────────────────────────────────

/**
 * Выполнить пользовательский код `code`, прокинув `scope` (входы по именам).
 * Никогда не бросает — ошибки возвращаются в поле `error`.
 */
export async function runUserCode(code: string, scope: Record<string, unknown>): Promise<RunUserCodeResult> {
	const logs: string[] = [];
	const started = Date.now();

	const log = (...args: unknown[]) => {
		logs.push(args.map(stringifyLogArg).join(' '));
	};
	const consoleProxy = { log, warn: log, error: log, info: log, debug: log };

	// Только валидные идентификаторы прокидываем как отдельные переменные.
	const varNames = Object.keys(scope).filter(isValidIdentifier);
	const varValues = varNames.map((n) => scope[n]);

	const finish = (partial: Omit<RunUserCodeResult, 'logs' | 'durationMs'>): RunUserCodeResult => ({
		...partial,
		logs,
		durationMs: Date.now() - started,
	});

	let fn: (...args: unknown[]) => Promise<unknown>;
	try {
		// eslint-disable-next-line no-new-func
		fn = new Function(
			...varNames,
			'inputs',
			'helpers',
			'console',
			'log',
			`"use strict";\nreturn (async () => {\n${code}\n})();`,
		) as (...args: unknown[]) => Promise<unknown>;
	} catch (e: any) {
		return finish({ ok: false, error: `SyntaxError: ${e?.message ?? String(e)}` });
	}

	try {
		const result = await fn(...varValues, scope, jsCodeHelpers, consoleProxy, log);
		return finish({ ok: true, result });
	} catch (e: any) {
		const name = e?.name ?? 'Error';
		return finish({ ok: false, error: `${name}: ${e?.message ?? String(e)}` });
	}
}
