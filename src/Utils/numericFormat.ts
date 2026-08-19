/**
 * Единый формат числовых контролов (`valueRange`, `slider`).
 *
 * Один и тот же набор настроек (`format` / `step` / `range` / `decimals` /
 * `allowManualOverride`) правится в двух местах — в pluginBuilder (уровень
 * плагина) и в шестерёнке «дефолтные настройки» на ноде (per-flow override), —
 * а читается компонентами. Чтобы форматирование/парсинг не разъехались между
 * этими четырьмя точками, вся логика живёт здесь.
 *
 * Форматы:
 *   • `timecode` — показываем и вводим `HH:MM:SS`; `step` (как и у остальных
 *     форматов) задаётся в единицах хранения — секундах либо минутах;
 *   • `float`    — число с `decimals` знаками после запятой;
 *   • `integer`  — целое;
 *   • `auto`     — как есть (`String(v)`), legacy-режим слайдера без `format`.
 *
 * ЕДИНИЦЫ ХРАНЕНИЯ ТАЙМКОДА — всегда СЕКУНДЫ. В controlProps лежит ЧИСЛО (его
 * читает рантайм плагина), и это число — секунды. Прежнее поле `unit`
 * ('minutes' | 'seconds') из модели убрано: показ и ввод теперь полноценный
 * `HH:MM:SS`, минутам в хранении места нет. Старые флоу, где окно суток лежало
 * в минутах (`[0, 1440]` у finder/autoPostTG), переводит миграция при загрузке —
 * `NODE_WIN/utils/migrateTimecodeSeconds.ts`.
 */

export type NumericFormat = 'timecode' | 'float' | 'integer' | 'auto';

/** Форматы, доступные в редакторах настроек (порядок = порядок в списке). */
export const NUMERIC_FORMATS: readonly NumericFormat[] = ['timecode', 'float', 'integer', 'auto'];

export interface NumericFormatConfig {
	format: NumericFormat;
	/** Границы слайдера — в ЕДИНИЦАХ ХРАНЕНИЯ. */
	min: number;
	max: number;
	step: number;
	decimals: number;
	/** Разрешить ручному вводу выходить за границы слайдера. */
	allowManualOverride: boolean;
}

interface NumericConfigDefaults {
	/** Дефолтный формат, если в controlProps его нет. */
	format?: NumericFormat;
	min: number;
	max: number;
	step?: number;
	decimals?: number;
}

/** Число или fallback. */
function num(v: unknown, fallback: number): number {
	const n = typeof v === 'number' ? v : Number(v);
	return Number.isFinite(n) ? n : fallback;
}

/**
 * Собирает конфиг формата из controlProps. `min`/`max` резолвит вызывающий —
 * у `valueRange` они лежат в `range`, у `slider` в `minValue`/`maxValue`.
 */
export function resolveNumericConfig(controlProps: any, defaults: NumericConfigDefaults): NumericFormatConfig {
	const cp = controlProps ?? {};
	const format: NumericFormat = NUMERIC_FORMATS.includes(cp.format) ? cp.format : (defaults.format ?? 'auto');

	const min = num(defaults.min, 0);
	let max = num(defaults.max, min + 1);

	// Шаг — в тех же единицах, что значение (для таймкода это секунды).
	const rawStep = num(cp.step ?? defaults.step, 1);
	const step = rawStep > 0 ? rawStep : 1;

	// decimals осмысленны только для float; для остальных 0 — иначе целые
	// значения показывались бы как "5.00".
	const decimals = format === 'float' ? Math.min(6, Math.max(0, Math.round(num(cp.decimals ?? defaults.decimals, 2)))) : 0;

	// Вырожденный диапазон (max ≤ min) MUI Slider не переживает.
	if (max <= min) max = min + step;

	return {
		format,
		min,
		max,
		step,
		decimals,
		allowManualOverride: cp.allowManualOverride ?? true,
	};
}

/** Строка-подпись конфига — для зависимостей useEffect. */
export function numericConfigKey(cfg: NumericFormatConfig): string {
	return `${cfg.format}|${cfg.min}|${cfg.max}|${cfg.step}|${cfg.decimals}|${cfg.allowManualOverride}`;
}

/** Округление под формат: целое / до `decimals` знаков / как есть. */
export function roundForFormat(v: number, cfg: NumericFormatConfig): number {
	if (!Number.isFinite(v)) return cfg.min;
	if (cfg.format === 'float') {
		const p = Math.pow(10, cfg.decimals);
		return Math.round(v * p) / p;
	}
	// auto — «как есть», но без мусора плавающей точки (0.30000000000000004).
	if (cfg.format === 'auto') return Math.round(v * 1e6) / 1e6;
	return Math.round(v);
}

/** Округление под формат + зажим в границы слайдера. */
export function clampForFormat(v: number, cfg: NumericFormatConfig): number {
	// Сначала округляем, потом зажимаем: иначе округление вверх вылезает за max.
	const r = roundForFormat(v, cfg);
	return Math.min(cfg.max, Math.max(cfg.min, r));
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Секунды → `HH:MM:SS` (часы могут быть больше 24). */
export function secondsToTimecode(totalSeconds: number): string {
	const sign = totalSeconds < 0 ? '-' : '';
	const t = Math.abs(Math.round(Number.isFinite(totalSeconds) ? totalSeconds : 0));
	return `${sign}${pad(Math.floor(t / 3600))}:${pad(Math.floor((t % 3600) / 60))}:${pad(t % 60)}`;
}

/** `HH:MM:SS` / `MM:SS` → секунды. `null` — если разобрать не удалось. */
export function timecodeToSeconds(text: string): number | null {
	const t = String(text).trim();
	if (t === '') return null;
	const neg = t.startsWith('-');
	const parts = (neg ? t.slice(1) : t).split(':');
	if (parts.length < 2 || parts.length > 3) return null;

	const nums = parts.map((p) => (p.trim() === '' ? 0 : Number(p.trim().replace(',', '.'))));
	if (nums.some((n) => !Number.isFinite(n))) return null;

	const sec = nums.length === 3 ? nums[0] * 3600 + nums[1] * 60 + nums[2] : nums[0] * 60 + nums[1];
	return neg ? -sec : sec;
}

/** Значение (в единицах хранения) → текст для поля/подписи. */
export function formatNumeric(v: number, cfg: NumericFormatConfig): string {
	const n = Number.isFinite(v) ? v : cfg.min;
	if (cfg.format === 'timecode') return secondsToTimecode(n);
	if (cfg.format === 'float') return n.toFixed(cfg.decimals);
	if (cfg.format === 'integer') return String(Math.round(n));
	return String(n);
}

/**
 * Текст из поля → значение в единицах хранения. `null` — мусор на входе
 * (вызывающий возвращает прежнее значение, а не прыгает в min).
 *
 * Для таймкода одиночное число без `:` трактуется как секунды, а не как часы.
 */
export function parseNumeric(text: string, cfg: NumericFormatConfig, allowOverride = false): number | null {
	const t = String(text).trim();
	if (t === '') return null;

	let parsed: number;
	if (cfg.format === 'timecode' && t.includes(':')) {
		const sec = timecodeToSeconds(t);
		if (sec === null) return null;
		parsed = sec;
	} else {
		const n = Number(t.replace(',', '.'));
		if (!Number.isFinite(n)) return null;
		parsed = n;
	}

	const rounded = roundForFormat(parsed, cfg);
	return allowOverride ? rounded : Math.min(cfg.max, Math.max(cfg.min, rounded));
}

/** Нормализация значения, пришедшего извне (props/слайдер). */
export function normalizeNumeric(v: number, cfg: NumericFormatConfig): number {
	return cfg.allowManualOverride ? roundForFormat(v, cfg) : clampForFormat(v, cfg);
}

const MAX_SECONDS = 86400; // 24 часа в секундах
const LEGACY_MAX = 1440; // дефолт границ у старых нетаймкодовых valueRange

/**
 * Конфиг формата для `valueRange`: границы лежат в `range`. Без явного `range`
 * таймкод получает сутки в секундах; у остальных форматов дефолт исторический.
 */
export function valueRangeConfig(controlProps: any): NumericFormatConfig {
	const format = controlProps?.format ?? 'timecode';
	const defMax = format === 'timecode' ? MAX_SECONDS : LEGACY_MAX;
	const range = Array.isArray(controlProps?.range) ? (controlProps.range as [number, number]) : [0, defMax];

	return resolveNumericConfig(controlProps, {
		format: 'timecode',
		min: range[0],
		max: range[1],
		step: 5,
	});
}

/**
 * Конфиг формата для `slider`: границы лежат в `minValue`/`maxValue` (`range`
 * у слайдера не используется). Формат по умолчанию — `auto`: у старых
 * слайдеров `format` не задан, и показывать «50» как «50.00» нельзя.
 */
export function sliderConfig(controlProps: any): NumericFormatConfig {
	return resolveNumericConfig(controlProps, {
		format: 'auto',
		min: controlProps?.minValue ?? 0,
		max: controlProps?.maxValue ?? 100,
		step: 1,
	});
}

/** Конфиг по controlType — для общих редакторов настроек (шестерёнка, pluginBuilder). */
export function numericConfigFor(controlType: string, controlProps: any): NumericFormatConfig {
	return controlType === 'slider' ? sliderConfig(controlProps) : valueRangeConfig(controlProps);
}
