// saveFlow — единая точка сохранения графа проекта.
//
// Мест было два, и они дублировали друг друга: кнопка Save и кнопка Play в TopPanel,
// четыре одинаковых вызова подряд в каждой. Любой новый шаг сохранения приходилось
// добавлять дважды, а забыв один — получаешь поведение «одной кнопкой сохраняется так,
// другой иначе», которое ничем не ловится.
//
// Порядок значим: снимок словаря ставится ДО записи (он едет внутри самого options.json),
// папки и сайдкары — после, они только читают состав графа.
//
// Никогда не глотает ошибку записи графа: это работа пользователя. А вот всё, что после
// записи, уже сделано «мягким» внутри себя (ensureProjectFolders / sync*Sidecar не бросают).

import { commands, unwrap } from '@/Utils/specta';
import { readFileTypesSnapshot } from '@/Utils/fileTypesSnapshot';
import { ensureProjectFolders } from './ensureProjectFolders';
import { syncTgSearchSidecar } from './syncTgSearchSidecar';
import { syncPostSourcesSidecar } from './syncPostSourcesSidecar';

export async function saveFlow(path: string, flow: any): Promise<void> {
	if (!path) return;

	// Снимок словаря типов — соседним ключом рядом с nodes/edges.
	//
	// Зачем: сборщик задач на сайте не видит настроек машины, и `searchType: "video"` сам
	// по себе ему бесполезен — расширения к нему лежат в typeOfFile_store. Без снимка
	// проект пропускается с причиной no-search-exts.
	//
	// Почему весь словарь, а не расширения одной ноды mainSearch: дальше по графу ноды
	// уходят в другие папки проекта за аудио, текстом, скриптами — getFileFromFolder уже
	// сегодня читает весь словарь целиком.
	//
	// Почему ключ верхнего уровня, а не свойство ноды: свойство означало бы скрытые
	// свойства в модели нод (которых нет) и новую ветку в utils/validation.ts, где
	// незнакомый controlType делает ноду невалидной навсегда. Лишний ключ редактор при
	// загрузке просто игнорирует, а structSig в SaveButton смотрит только ноды и рёбра —
	// ложного «dirty» снимок не даёт.
	let payload = flow;
	try {
		payload = { ...flow, fileTypes: await readFileTypesSnapshot() };
	} catch (e) {
		// Снимок — не повод потерять граф. Сохраняем без него: сайт откатится на свой
		// синхронизированный словарь, а следующее сохранение снимок доставит.
		console.warn('[saveFlow] не удалось собрать снимок типов файлов:', e);
	}

	unwrap(await commands.saveFlowToOptionsFolder(path, payload as any));

	await ensureProjectFolders(path, flow);
	await syncTgSearchSidecar(path, flow);
	await syncPostSourcesSidecar(path, flow);
}
