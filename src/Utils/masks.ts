import path from 'path';
import { nanoid } from 'nanoid';

import { getFormattedDateTime } from './getFormattedDateTime';
import { getIDandNameFile } from './getIDandNameFile';

/**
 * ЕДИНЫЙ ИСТОЧНИК ПРАВДЫ по маскам имён ($-переменным).
 *
 * Отсюда ВЫВОДИТСЯ всё остальное — добавил маску здесь → она появилась везде,
 * убрал → пропала везде:
 *   • резолверы подстановки           → RESOLVERS  (formatNameByPattern.ts)
 *   • список автокомплита (глобальный) → GLOBAL_MASK_TOKENS  (searchTypes.filePathNamePattern)
 *   • список автокомплита (всё)        → MASK_TOKENS  (PluginBuilder PATTERN_OPTIONS)
 *   • список для pathPattern/filePattern нод → pathPatternTokens()  (useResolveOptions)
 *   • HTML-тултип по умолчанию         → buildMasksTooltipHtml()  (PluginBuilder)
 *   • таблица в plugins-dev/_template/ui.md → `npm run masks:docs`  (scripts/gen-masks-doc.mjs)
 *
 * Rust-подстановка (src-tauri/.../db_analytics.rs → apply_vars) — отдельный язык,
 * синхронится вручную; `npm run masks:docs` предупредит о расхождении.
 */

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
	loopIndex?: number; // выставляется в executeLoop на каждую итерацию (через spread, чтобы не мутировать родительский ctx).
}

export type ReplacerArgs = {
	description?: Partial<Description>;
	file?: string;
};

export interface MaskDef {
	/** ключ без ведущего `$` (токен = `$` + key). Для спец-масок — просто метка. */
	key: string;
	/** человекочитаемое описание (RU) — для тултипа и ui.md. */
	desc: string;
	/**
	 * резолвер для основного прохода подстановки.
	 * НЕ указывать для спец-масок (напр. `$random`), у которых своя логика в formatNameByPattern.
	 */
	resolve?: (args: ReplacerArgs) => unknown;
	/** токены для АВТОКОМПЛИТА (то, что реально вставляется); по умолчанию `['$' + key]`. */
	tokens?: string[];
	/** токены для доков/тултипа (человекочитаемая форма); по умолчанию = `tokens`. */
	docTokens?: string[];
	/**
	 * показывать в статичном глобальном списке (TabPaths/TabMain, `filePathNamePattern`).
	 * По умолчанию true. `loopIndex` — false (значим только внутри Loop-ноды).
	 */
	globalList?: boolean;
}

const MONTHS = [
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

// ─────────────────────────────────────────────────────────────────────────────
// ЕДИНЫЙ СПИСОК МАСОК. Добавляешь запись здесь — обновляется всё (см. шапку файла).
// ─────────────────────────────────────────────────────────────────────────────
export const MASKS: MaskDef[] = [
	{
		key: 'clearName',
		desc: 'Чистое имя найденного элемента в папке IN (без эмодзи, скобок и кавычек)',
		resolve: ({ description }) => description?.clearName?.trim() ?? nanoid(10),
	},
	{
		key: 'findTime',
		desc: 'Время обнаружения элемента в папке IN',
		resolve: ({ description }) => description?.findTime ?? getFormattedDateTime('$DD.$MM-$HH.$mm'),
	},
	{
		key: 'curItemName',
		desc: 'Текущее имя элемента как есть (с эмодзи, без расширения)',
		resolve: ({ description }) =>
			description?.curItem ? path.basename(description.curItem, path.extname(description.curItem)) : nanoid(10),
	},
	{
		key: 'id',
		desc: 'Уникальный id элемента, если он есть в имени',
		resolve: ({ description }) => description?.id ?? nanoid(10),
	},
	{
		key: 'projectName',
		desc: 'Название папки проекта (папка, в которой лежит папка IN)',
		resolve: ({ description }) => description?.projectName ?? 'default',
	},
	{
		key: 'projectPathGD',
		desc: 'Полный путь до папки проекта на Google Drive',
		resolve: ({ description }) => description?.projectPathGD ?? '',
	},
	{
		key: 'mainFolderName',
		desc: 'Название главной папки (верхний уровень)',
		resolve: ({ description }) => description?.mainFolderName ?? '',
	},
	{
		key: 'mainFolderPath',
		desc: 'Полный путь до главной папки',
		resolve: ({ description }) => description?.mainFolderPath ?? '',
	},
	{
		key: 'index',
		desc: 'Порядковый индекс элемента, если файлов несколько',
		resolve: ({ description, file }) =>
			file && description?.finalFile ? description.finalFile.indexOf(file) + 1 : 1,
	},
	{
		key: 'loopIndex',
		desc: 'Номер текущей итерации ближайшего Loop (1-based); доступен только внутри Loop-ноды',
		resolve: ({ description }) => description?.loopIndex ?? '',
		globalList: false,
	},
	{
		key: 'fileName',
		desc: 'Имя текущего файла без расширения как есть',
		resolve: ({ file }) => (file ? path.basename(file, path.extname(file)) : nanoid(10)),
	},
	{
		key: 'clearFileName',
		desc: 'Чистое имя файла без расширения, скобок и эмодзи',
		resolve: ({ file }) => (file ? getIDandNameFile(path.basename(file)).clearName : nanoid(10)),
	},
	{
		key: 'curMonthStr',
		desc: 'Текущий месяц строкой (January, February, ...)',
		resolve: () => MONTHS[new Date().getMonth()],
	},
	{
		key: 'localFolder',
		desc: 'Рабочая локальная папка (из настроек)',
		resolve: ({ description }) => description?.localFolder ?? '',
	},
	{ key: 'YYYY', desc: 'Год (4 цифры)', resolve: () => getFormattedDateTime('$YYYY') },
	{ key: 'MM', desc: 'Месяц (2 цифры)', resolve: () => getFormattedDateTime('$MM') },
	{ key: 'DD', desc: 'День (2 цифры)', resolve: () => getFormattedDateTime('$DD') },
	{ key: 'HH', desc: 'Часы (2 цифры)', resolve: () => getFormattedDateTime('$HH') },
	{ key: 'mm', desc: 'Минуты (2 цифры)', resolve: () => getFormattedDateTime('$mm') },
	{ key: 'ss', desc: 'Секунды (2 цифры)', resolve: () => getFormattedDateTime('$ss') },
	{
		key: 'random',
		desc: 'Случайная строка: `$random()` = 10 символов, `$random(N)` = N символов',
		// В автокомплит вставляется НЕЗАКРЫТЫМ ('$random('), чтобы сразу дописать число и скобку.
		tokens: ['$random('],
		docTokens: ['$random()', '$random(N)'],
		// resolve НЕ указан: $random обрабатывается отдельным regex-проходом в formatNameByPattern.
	},
];

/** Токены маски для автокомплита (учитывает `tokens`-override). */
const tokensOf = (m: MaskDef): string[] => m.tokens ?? [`$${m.key}`];

/** Токены маски для доков/тултипа — читаемая форма (docTokens ?? tokens). */
export const docTokensOf = (m: MaskDef): string[] => m.docTokens ?? tokensOf(m);

/** Резолверы для основного прохода подстановки (только маски с `resolve`). */
export const RESOLVERS: Record<string, (args: ReplacerArgs) => unknown> = Object.fromEntries(
	MASKS.filter((m) => m.resolve).map((m) => [m.key, m.resolve!]),
);

/** Все токены для автокомплита. */
export const MASK_TOKENS: string[] = MASKS.flatMap(tokensOf);

/** Токены для статичного глобального списка (TabPaths/TabMain) — без loopIndex и т.п. */
export const GLOBAL_MASK_TOKENS: string[] = MASKS.filter((m) => m.globalList !== false).flatMap(tokensOf);

/**
 * Токены для автокомплита в свойствах pathPattern/filePattern нод.
 * `$loopIndex` показываем только внутри Loop; `$random` — как триггер `$random(`.
 */
export function pathPatternTokens(insideLoop: boolean): string[] {
	return MASKS.filter((m) => m.key !== 'loopIndex' || insideLoop).flatMap(tokensOf);
}

/** HTML-тултип со всеми масками (дефолт для autocomplete-свойств в PluginBuilder). */
export function buildMasksTooltipHtml(): string {
	const rows = MASKS.map((m) => {
		const tok = docTokensOf(m).join(' / ');
		// desc может содержать `код` в обратных кавычках — оставляем как есть, тултип рендерится как HTML.
		return `<div><font color="#ffff00">${tok}</font> — ${m.desc}</div>`;
	}).join('');
	return `Папка для сохранения. Указывается в виде маски. Все маски начинаются с $.<br>${rows}`;
}
