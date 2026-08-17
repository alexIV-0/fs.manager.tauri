// Машинно-локальная часть `description` — то, что у каждой машины своё.
//
// Пять полей, и все они отвечают на вопрос «где на ЭТОМ компьютере»: где лежит
// ffmpeg и After Effects, куда сложены модели whisper, что считать локальной рабочей
// папкой, какие расширения стоят за именем типа. Список не наш каприз — он записан в
// контракте с сайтом (`innovation-hub/docs/PIPELINE.md` §5): задача от оркестратора
// этих полей НЕ несёт и нести не может, их подставляет исполнитель.
//
// Вынесено отдельно ради второго исполнителя. Локальный прогон собирает description
// сам (findFilesForSingleFolder), а режим воркера получит готовую задачу и должен
// дописать в неё ровно эти пять полей — ни больше, ни меньше. Разъедься две копии, и
// одна и та же папка обрабатывалась бы по-разному в зависимости от того, кто её
// запустил, а увидеть это можно было бы только по результату.
//
// Оговорка про `typeOfFile`: после синхронизации словарей он перестаёт быть
// машинно-локальным по смыслу (это общая конвенция, у всех машин одинаковая), и сайт
// сможет класть его в задачу сам. Пока не кладёт — подставляем здесь. Когда начнёт,
// достаточно будет не затирать уже пришедшее значение.

import { folderPath_store, pathPattern_store, programPathPattern_store, typeOfFile_store } from '@/Store/MainWin/pathPattern_store';
import { localFolders_stor } from '@/Store/MainWin/localFolders_store';
import { buildFileTypesMap } from '@/Utils/fileTypesSnapshot';
import { joinPath } from '@/Utils/joinPath';

export type MachineLocals = {
	/** `{тип: [расширения]}` — тот же сборщик, что кладёт снимок в options.json. */
	typeOfFile: Record<string, string[]>;
	/** Пути к ffmpeg / ffprobe / After Effects / Moho. */
	programmPath: Record<string, string[]>;
	/** Папки вспомогательных данных (модели whisper и т.п.). */
	folderPath: Record<string, string[]>;
	/** Пользовательские алиасы путей: `$name` внутри масок. */
	pathAliases: Record<string, string>;
	/** Корень локальной рабочей папки этой машины. */
	localFolder: string;
};

function toPathMap(elements: any[]): Record<string, string[]> {
	return Object.fromEntries((elements ?? []).map((t: any) => [t.name, t.path]));
}

export function readMachineLocals(): MachineLocals {
	// Алиасы фильтруем по имени: `$<name>` подставляется в formatNameByPattern, и имя
	// с пробелом или скобкой в маску просто не попадёт — молча не сработает.
	const pathAliases = Object.fromEntries(
		(pathPattern_store.getState().patternStore ?? [])
			.filter((t: any) => /^[A-Za-z0-9_]+$/.test(t.name))
			.map((t: any) => [t.name, joinPath(...(t.path ?? []))]),
	);

	return {
		typeOfFile: buildFileTypesMap(typeOfFile_store.getState().patternStore),
		programmPath: toPathMap(programPathPattern_store.getState().patternStore),
		folderPath: toPathMap(folderPath_store.getState().patternStore),
		pathAliases,
		localFolder: localFolders_stor.getState().localFolder,
	};
}

/** Дописать машинно-локальные поля в `description`. Мутирует переданный объект. */
export function injectMachineLocals(description: any): MachineLocals {
	const locals = readMachineLocals();
	description.typeOfFile = locals.typeOfFile;
	description.programmPath = locals.programmPath;
	description.folderPath = locals.folderPath;
	description.pathAliases = locals.pathAliases;
	description.localFolder = locals.localFolder;
	return locals;
}
