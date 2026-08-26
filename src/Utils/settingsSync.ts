// ── settingsSync ─────────────────────────────────────────────────────────────
// Чистое ядро синхронизации общих словарей с сайтом: нормализация значений и
// трёхстороннее слияние. Ни IPC, ни сторов, ни React — только данные, чтобы
// правила слияния можно было читать в одном месте (фронт-тестов в проекте нет,
// поэтому единственная защита здесь — простота и явность).
//
// Синхронизируются четыре словаря (план `ideasAndTest/SETTINGS_SYNC_PLAN.md` §3):
// типы файлов, типы нод, типы данных, маски путей. Пути к ffmpeg/AE и папки
// доп-материалов — НЕ синхронизируются никогда: они машинно-локальные.
//
// ── Почему ключ `name`, а не `id`
// `id` на сервер не уходит вовсе: у дефолтов он человекочитаемый (`video`), у
// пользовательских — nanoid, то есть на второй машине другой. Идентичность по
// имени — не новое ограничение, а то, что уже есть: граф ссылается на тип как
// `searchType: "video"`, `getFileTypeByExt` ключует по имени.
//
// ── Почему нормализация — часть слияния, а не оформление
// Сервер приводит значения к своему виду (`normalizeColor`/`normalizePath` в его
// `automation-settings.ts`): `#0a84feff` → `#0a84fe`, `rgb(99, 214, 81)` → hex,
// расширения в нижний регистр без точки, дубли схлопываются. База — снимок
// СЕРВЕРНОГО документа, а локальный стор держит сырой формат. Сравнивать как
// есть нельзя: тогда КАЖДАЯ запись выглядит изменённой с обеих сторон, и по
// правилу «цвет — серверный» правки пользователя начинают молча теряться.

import { nanoid } from 'nanoid';
import type { PatternElement } from '@/Store/MainWin/pathPattern_store';

export const SYNC_DOMAINS = ['fileType', 'nodeType', 'dataType', 'pathPattern'] as const;
export type SyncDomain = (typeof SYNC_DOMAINS)[number];

/** Запись словаря в серверной форме: без `id` и без `inactivePath`. */
export interface RemoteEntry {
	name: string;
	path: string[];
	color: string | null;
	isDefault: boolean;
}

export type RemoteDomains = Partial<Record<SyncDomain, RemoteEntry[]>>;

export interface SettingsDoc {
	revision: number;
	domains: RemoteDomains;
}

// ─── Нормализация (порт правил сервера) ──────────────────────────────────────

const HEX_RE = /^#([0-9a-f]{3,8})$/;
const RGB_RE = /^rgba?\(([^)]+)\)$/;

/**
 * Цвет к серверному виду: нижний регистр, hex, без полностью непрозрачной альфы.
 *
 * Непонятный формат — `null` и предупреждение, а не исключение: сервер на таком
 * значении ответит 400 и уронит запись ВСЕГО словаря, а одна кривая строка того
 * не стоит.
 */
export function normalizeColor(raw: unknown): string | null {
	if (raw == null) return null;
	const value = String(raw).trim().toLowerCase();
	if (!value) return null;

	const hex = HEX_RE.exec(value);
	if (hex) {
		const digits = hex[1];
		if (digits.length === 3) {
			const [r, g, b] = digits;
			return `#${r}${r}${g}${g}${b}${b}`;
		}
		if (digits.length === 6) return `#${digits}`;
		if (digits.length === 8) return digits.endsWith('ff') ? `#${digits.slice(0, 6)}` : `#${digits}`;
		console.warn('[settingsSync] непонятный цвет:', raw);
		return null;
	}

	const rgb = RGB_RE.exec(value);
	if (rgb) {
		const parts = rgb[1].split(',').map((p) => p.trim());
		if (parts.length !== 3 && parts.length !== 4) {
			console.warn('[settingsSync] непонятный цвет:', raw);
			return null;
		}
		const channels: string[] = [];
		for (const p of parts.slice(0, 3)) {
			const n = Number(p);
			if (!Number.isFinite(n) || n < 0 || n > 255) {
				console.warn('[settingsSync] непонятный цвет:', raw);
				return null;
			}
			channels.push(Math.round(n).toString(16).padStart(2, '0'));
		}
		const alpha = parts.length === 4 ? Number(parts[3]) : 1;
		if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1) {
			console.warn('[settingsSync] непонятный цвет:', raw);
			return null;
		}
		const alphaHex = alpha >= 1 ? '' : Math.round(alpha * 255).toString(16).padStart(2, '0');
		return `#${channels.join('')}${alphaHex}`;
	}

	console.warn('[settingsSync] непонятный цвет:', raw);
	return null;
}

/** Расширения — в нижний регистр без ведущей точки; сегменты масок — как есть. Дубли схлопываются. */
export function normalizePath(domain: SyncDomain, raw: unknown): string[] {
	if (!Array.isArray(raw)) return [];
	const items = raw
		.map((item) => String(item).trim())
		.filter(Boolean)
		.map((item) => (domain === 'fileType' ? item.toLowerCase().replace(/^\.+/, '') : item));
	return [...new Set(items)];
}

/** Локальная запись стора → серверная форма. */
export function toRemoteEntry(domain: SyncDomain, el: PatternElement): RemoteEntry {
	return {
		name: String(el.name ?? '').trim(),
		// `path` у nodeType — имена УСТАНОВЛЕННЫХ плагинов, у каждой машины свои:
		// синхронизируется только цвет (план §3).
		path: domain === 'nodeType' || domain === 'dataType' ? [] : normalizePath(domain, el.path),
		color: normalizeColor(el.color),
		isDefault: el.isDefault === true,
	};
}

export function toRemoteDomain(domain: SyncDomain, elements: PatternElement[]): RemoteEntry[] {
	return (elements ?? []).filter((el) => String(el?.name ?? '').trim()).map((el) => toRemoteEntry(domain, el));
}

/** Серверная запись к тому же виду — сервер уже нормализует, но приходить может и старое. */
export function fromServerEntry(domain: SyncDomain, raw: any): RemoteEntry {
	return {
		name: String(raw?.name ?? '').trim(),
		path: domain === 'nodeType' || domain === 'dataType' ? [] : normalizePath(domain, raw?.path),
		color: normalizeColor(raw?.color),
		isDefault: raw?.isDefault === true,
	};
}

// ─── Сравнение ───────────────────────────────────────────────────────────────

const samePath = (a: string[], b: string[]): boolean => a.length === b.length && a.every((v, i) => v === b[i]);

export function sameEntry(a: RemoteEntry | undefined, b: RemoteEntry | undefined): boolean {
	if (!a || !b) return a === b;
	return a.name === b.name && a.color === b.color && samePath(a.path, b.path);
}

/** Сколько записей домена расходится с базой — это и есть «локальных правок N». */
export function diffCount(base: RemoteEntry[] | null, local: RemoteEntry[]): number {
	if (!base) return 0; // базы нет — сравнивать не с чем, «правок» ещё не существует
	const byName = new Map(base.map((e) => [e.name, e]));
	let n = 0;
	for (const e of local) {
		const b = byName.get(e.name);
		if (!b || !sameEntry(b, e)) n += 1;
	}
	for (const b of base) if (!local.some((e) => e.name === b.name)) n += 1;
	return n;
}

// ─── Трёхстороннее слияние ───────────────────────────────────────────────────

export interface MergeResult {
	merged: RemoteEntry[];
	/** Что решено неочевидно — уходит в лог, чтобы «куда делась правка» не было загадкой. */
	notes: string[];
}

const union = (a: string[], b: string[]): string[] => [...new Set([...a, ...b])];

/**
 * Слияние одного домена по правилам плана §5.3.
 *
 * | ситуация | результат |
 * |---|---|
 * | локально == база | берём серверное |
 * | на сервере == база | берём локальное |
 * | разошлись, `path` | объединение множеств |
 * | разошлись, `color` | серверное |
 * | добавлено с одной стороны | добавляем |
 * | удалено с одной, с другой не менялось | удаляем |
 * | удалено с одной, изменено с другой | оставляем + запись в лог |
 *
 * Объединение `path` честно потому, что реальная операция пользователя —
 * «добавить расширение в тип»: добавление в множество коммутативно и
 * идемпотентно. Неоднозначны только удаления, и их прикрывает `isDefault` —
 * дефолтный тип удалить нельзя.
 */
export function mergeDomain(
	base: RemoteEntry[] | null,
	local: RemoteEntry[],
	remote: RemoteEntry[],
): MergeResult {
	const notes: string[] = [];
	const baseMap = new Map((base ?? []).map((e) => [e.name, e]));
	const localMap = new Map(local.map((e) => [e.name, e]));
	const remoteMap = new Map(remote.map((e) => [e.name, e]));

	// ── Порядок. Он значим: `getFileTypeByExt` возвращает ПЕРВОЕ совпадение,
	// поэтому расширение, попавшее в два типа, достаётся верхнему. Правило то же,
	// что и для полей: чья сторона двигала — та и решает.
	const baseOrder = (base ?? []).map((e) => e.name);
	const localOrder = local.map((e) => e.name);
	const remoteOrder = remote.map((e) => e.name);
	const localMoved = base ? !samePath(baseOrder, localOrder) : true;
	const remoteMoved = base ? !samePath(baseOrder, remoteOrder) : false;
	const primary = localMoved && !remoteMoved ? localOrder : remoteOrder;
	const secondary = primary === localOrder ? remoteOrder : localOrder;
	const names = [...new Set([...primary, ...secondary])];

	const merged: RemoteEntry[] = [];

	for (const name of names) {
		const b = baseMap.get(name);
		const l = localMap.get(name);
		const r = remoteMap.get(name);

		// Есть только у одной стороны — либо добавили, либо удалили.
		if (l && !r) {
			if (b && sameEntry(b, l)) {
				notes.push(`${name}: удалено на сервере`);
				continue;
			}
			if (b) notes.push(`${name}: удалено на сервере, но правилось локально — оставляем`);
			merged.push(l);
			continue;
		}
		if (r && !l) {
			if (b && sameEntry(b, r)) {
				notes.push(`${name}: удалено локально`);
				continue;
			}
			if (b) notes.push(`${name}: удалено локально, но правилось на сервере — оставляем`);
			merged.push(r);
			continue;
		}
		if (!l || !r) continue;

		// Есть у обеих. База неизвестна (первая синхронизация) — считаем, что
		// запись добавили с двух сторон: пути объединяем, цвет берём серверный.
		if (!b) {
			merged.push({
				name,
				path: union(l.path, r.path),
				color: r.color ?? l.color,
				isDefault: l.isDefault || r.isDefault,
			});
			continue;
		}

		const localSame = sameEntry(b, l);
		const remoteSame = sameEntry(b, r);
		if (localSame) {
			merged.push({ ...r, isDefault: l.isDefault || r.isDefault });
			continue;
		}
		if (remoteSame) {
			merged.push({ ...l, isDefault: l.isDefault || r.isDefault });
			continue;
		}

		// Разошлись обе стороны — поле за полем.
		const path = samePath(l.path, b.path) ? r.path : samePath(r.path, b.path) ? l.path : union(l.path, r.path);
		const color = l.color === b.color ? r.color : r.color === b.color ? l.color : r.color;
		if (l.color !== b.color && r.color !== b.color && l.color !== r.color) {
			notes.push(`${name}: цвет менялся с двух сторон — берём серверный`);
		}
		merged.push({ name, path, color, isDefault: l.isDefault || r.isDefault });
	}

	return { merged, notes };
}

export interface MergeDocResult {
	domains: RemoteDomains;
	notes: string[];
	/** Слияние отличается от серверного документа — значит надо писать наверх. */
	changedVsRemote: boolean;
}

/** Слить документ целиком: только те домены, что есть локально. */
export function mergeDocument(
	base: SettingsDoc | null,
	local: RemoteDomains,
	remote: SettingsDoc,
): MergeDocResult {
	const domains: RemoteDomains = {};
	const notes: string[] = [];
	let changedVsRemote = false;

	for (const domain of SYNC_DOMAINS) {
		const localEntries = local[domain];
		if (!localEntries) continue;
		const remoteEntries = remote.domains?.[domain] ?? [];
		let baseEntries = base?.domains?.[domain] ?? null;

		// ── Защита от «сбросился localStorage» ──────────────────────────────────
		// Три словаря из четырёх пока живут только в localStorage (план §5.2), а он
		// у webview чистится вместе с кэшем. После чистки стор поднимается из
		// ДЕФОЛТОВ — и для слияния это выглядит как «человек удалил всё своё»:
		// правило «удалено локально» вынесло бы пользовательские записи и с сервера,
		// то есть один сброс кэша уничтожил бы словарь на всех машинах.
		//
		// Признак сброса: локально остались ТОЛЬКО дефолтные записи, а база помнит
		// пользовательские. Тогда база на этот проход считается неизвестной —
		// слияние переходит в режим «добавлено с двух сторон» и не удаляет ничего.
		if (baseEntries && localEntries.length > 0) {
			const localAllDefault = localEntries.every((e) => e.isDefault);
			const baseHadCustom = baseEntries.some((e) => !e.isDefault);
			if (localAllDefault && baseHadCustom) {
				notes.push(`${domain}: локально только дефолты, а база помнит пользовательские — базу игнорируем, ничего не удаляем`);
				baseEntries = null;
			}
		}

		const { merged, notes: domainNotes } = mergeDomain(baseEntries, localEntries, remoteEntries);
		domains[domain] = merged;
		notes.push(...domainNotes.map((n) => `${domain}: ${n}`));

		if (merged.length !== remoteEntries.length || merged.some((e, i) => !sameEntry(e, remoteEntries[i]))) {
			changedVsRemote = true;
		}
	}

	return { domains, notes, changedVsRemote };
}

// ─── Обратно в стор ──────────────────────────────────────────────────────────

/**
 * Слитые записи → элементы стора.
 *
 * Локальный `id` у существующих записей СОХРАНЯЕТСЯ (иначе переедут React-ключи
 * и dnd-порядок), новым генерится `nanoid`. `inactivePath` — чисто локальное
 * поле (выключенные плагины), тоже сохраняется как было.
 */
export function toStoreElements(
	domain: SyncDomain,
	entries: RemoteEntry[],
	localElements: PatternElement[],
): PatternElement[] {
	const byName = new Map(localElements.map((el) => [el.name, el]));
	// У `nodeType`/`dataType` список `path` не синхронизируется вовсе (у первого это
	// имена установленных плагинов, у второго он пуст). Значит серверный `path`
	// у них всегда `[]`, и брать его — значит стирать локальный список плагинов.
	const syncsPath = domain === 'fileType' || domain === 'pathPattern';

	return entries.map((e) => {
		const old = byName.get(e.name);
		return {
			id: old?.id ?? nanoid(5),
			name: e.name,
			path: syncsPath ? e.path : (old?.path ?? []),
			color: e.color,
			inactivePath: old?.inactivePath ?? [],
			isDefault: e.isDefault || old?.isDefault === true,
		} satisfies PatternElement;
	});
}
