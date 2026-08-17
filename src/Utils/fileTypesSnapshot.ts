// Словарь типов файлов в виде `{тип: [расширения]}` — одна форма на двух потребителей.
//
// Потребителя два, и разъезжаться им нельзя:
//   • ИСПОЛНЕНИЕ — `description.typeOfFile`, из него плагины берут расширения
//     (getFileFromFolder: `_description.typeOfFile?.[searchType]`);
//   • СНИМОК в `options/options.json` — по нему сборщик задач на сайте решает, подходит
//     ли файл под обработку (см. `ideasAndTest/SETTINGS_SYNC_PLAN.md` §6).
//
// Раньше объект собирался инлайном в findFilesForSingleFolder. Вторая копия сборки в
// редакторе нод означала бы, что проект отбирается на сайте по одному словарю, а
// исполняется по другому, — расхождение, которого не видно ниоткуда.
//
// `normalize` — только для снимка. Сервер приводит расширения к нижнему регистру без
// ведущей точки и схлопывает дубли (`normalizeColor`/`normalizePath` в его
// automation-settings), и снимок должен ехать туда уже в этом виде: иначе трёхстороннее
// слияние будет видеть разницу там, где её нет. Для исполнения расширения идут как есть —
// их сравнением занимаются плагины и Rust-поиск, и смена регистра задним числом должна
// быть отдельным решением, а не побочным эффектом выноса функции.

import { commands, unwrap } from '@/Utils/specta';
import type { PatternElement } from '@/Store/MainWin/pathPattern_store';

export type FileTypesMap = Record<string, string[]>;

function normalizeExts(raw: unknown[]): string[] {
	const out = new Set<string>();
	for (const item of raw) {
		const ext = String(item).trim().toLowerCase().replace(/^\.+/, '');
		if (ext) out.add(ext);
	}
	return [...out];
}

export function buildFileTypesMap(elements: PatternElement[], opts?: { normalize?: boolean }): FileTypesMap {
	const map: FileTypesMap = {};
	for (const el of elements ?? []) {
		const name = String(el?.name ?? '').trim();
		if (!name) continue;
		const path = Array.isArray(el?.path) ? el.path : [];
		map[name] = opts?.normalize ? normalizeExts(path) : (path as string[]);
	}
	return map;
}

/**
 * Снимок словаря для записи в `options.json`.
 *
 * Читает файл-SSOT через IPC, а НЕ стор: зовётся это из NODE_WIN, а окна — разные
 * JS-realm'ы, и `loadFromTauri` у `typeOfFile_store` вызывается из AppMain в MAIN_WIN.
 * Через файл снимок получается одинаковым независимо от того, какие окна открыты.
 */
export async function readFileTypesSnapshot(): Promise<FileTypesMap> {
	const elements = unwrap(await commands.fileTypesGet()) as PatternElement[];
	return buildFileTypesMap(elements, { normalize: true });
}
