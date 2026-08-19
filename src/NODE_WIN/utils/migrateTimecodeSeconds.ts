import type { Node } from '@xyflow/react';

/**
 * Разовая миграция сохранённых флоу: таймкод-`valueRange` теперь ВСЕГДА хранит
 * секунды, поле `unit` из модели убрано (см. `Utils/numericFormat.ts`).
 *
 * Что переводим:
 *   1. `unit === 'minutes'` — явный legacy-маркер: значение и границы ×60,
 *      `unit` удаляем. Идемпотентно: маркера больше нет.
 *   2. «Окно суток» finder/autoPostTG (`window`) — оно хранило МИНУТЫ вообще без
 *      маркера, `[0, 1440]` = сутки. Переводим по адресу (плагин + id свойства),
 *      а не по эвристике, иначе под нож попали бы новые секундные свойства
 *      (динамический TimeRange с диапазоном `[0, 600]` — те же «≤ 1440»).
 *      Идемпотентность даёт сам результат: миграция выставляет `range`
 *      `[0, 86400]`, а `range[1] > 1440` считается «уже секунды».
 *   3. `unit === 'seconds'` — просто чистим мёртвое поле.
 *
 * Единственный неохваченный случай: если у окна суток руками выставили границу
 * больше 1440 МИНУТ (сутки длиннее 24 часов) — такое не переводится. Реального
 * смысла у такой настройки нет.
 *
 * Вызывается при загрузке флоу (`onInit`) и при применении пресета — то есть
 * читается всегда исходный файл, так что до первого сохранения миграция просто
 * повторяется с тем же результатом.
 */

/** Свойства-«окно суток», исторически хранившие минуты без маркера `unit`. */
const DAY_WINDOWS: Record<string, readonly string[]> = {
	finder: ['window'],
	autoPostTG: ['window'],
};

const DAY_SECONDS = 86400;
const DAY_MINUTES = 1440;

const x60 = (v: unknown): number => {
	const n = Number(v);
	return Number.isFinite(n) ? Math.round(n * 60) : 0;
};

/** Уже в секундах, если границы явно шире суток-в-минутах. */
function looksLikeSeconds(cp: any): boolean {
	return Array.isArray(cp?.range) && Number(cp.range[1]) > DAY_MINUTES;
}

function migrateProperty(nodeKeys: string[], p: any): any | null {
	if (p?.controlType !== 'valueRange') return null;
	const cp = p.controlProps ?? {};
	const isTimecode = (cp.format ?? 'timecode') === 'timecode';

	// 1/3. Явный маркер unit — переводим (minutes) либо просто убираем (seconds).
	if (cp.unit !== undefined) {
		const next: any = { ...cp };
		delete next.unit;
		if (cp.unit === 'minutes' && isTimecode) {
			if (Array.isArray(cp.value)) next.value = cp.value.map(x60);
			if (Array.isArray(cp.range)) next.range = cp.range.map(x60);
			if (Number.isFinite(Number(cp.step))) next.step = x60(cp.step);
		}
		return { ...p, controlProps: next };
	}

	// 2. Окно суток без маркера — переводим по адресу.
	const isDayWindow = nodeKeys.some((k) => DAY_WINDOWS[k]?.includes(p.id));
	if (!isDayWindow || !isTimecode || looksLikeSeconds(cp)) return null;

	const next: any = { ...cp, range: [0, DAY_SECONDS] };
	if (Array.isArray(cp.value)) next.value = cp.value.map(x60);
	if (Number.isFinite(Number(cp.step))) next.step = x60(cp.step);
	return { ...p, controlProps: next };
}

export function migrateTimecodeSeconds<T extends Node>(nodes: T[]): T[] {
	let migrated = 0;

	const out = nodes.map((n) => {
		const data: any = n.data;
		if (!Array.isArray(data?.properties)) return n;

		// Плагин ноды опознаём и по type, и по pluginId — в старых флоу может не быть одного из них.
		const nodeKeys = [n.type, data.pluginId].filter(Boolean) as string[];

		let changed = false;
		const properties = data.properties.map((p: any) => {
			const fixed = migrateProperty(nodeKeys, p);
			if (!fixed) return p;
			changed = true;
			migrated++;
			return fixed;
		});

		return changed ? ({ ...n, data: { ...data, properties } } as T) : n;
	});

	if (migrated > 0) {
		console.log(`[migrateTimecodeSeconds] таймкод-свойств переведено в секунды: ${migrated}`);
		return out;
	}
	return nodes;
}
