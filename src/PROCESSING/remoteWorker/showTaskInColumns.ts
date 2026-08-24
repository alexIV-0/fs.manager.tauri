// Проект взятой задачи — в колонках программы.
//
// ── Зачем ───────────────────────────────────────────────────────────────────
// Воркер берёт задачи из очереди сайта, и в интерфейсе они не появлялись вовсе:
// обработка шла, файлы качались и заливались, а первая колонка оставалась такой,
// какой её оставил человек. Что машина молотит сейчас и что намолотила за ночь,
// видно было только в логе, а пройтись по локальным файлам результата нельзя было
// вообще — для этого папку пользователя надо было добавить руками через «Добавить
// папку из облака».
//
// ── Что регистрируем ────────────────────────────────────────────────────────
// Ровно то, что даёт задача: ВЛАДЕЛЬЦА (первый уровень зеркала — пользователь, см.
// `storage/layout.rs`) и его проекты. Проект по одному в список не дописываем:
// у облачной папки список проектов знает каталог, и `reloadFolders` отдаёт его
// целиком — вместе с архивностью и снятыми на сайте галочками. Остальные проекты
// того же пользователя всё равно приедут следующими задачами, поэтому «добавить
// все» здесь и дешевле, и честнее, чем клеить список по одному имени.
//
// ── Галочка снята намеренно ─────────────────────────────────────────────────
// Обработке она не нужна: локальный прогон зеркальные папки пропускает сам
// (`findAllFilesForProcess`, проверка `isInMirror`) — иначе облачный проект
// молотили бы разом и очередь, и локальное расписание. А вот РАННЕР ПОСТИНГА
// перечисляет все активные главные папки без такой проверки
// (`autoPost/scheduler.ts`, `collectPostRoutes`), и папка с галочкой попала бы в
// его обход. Тогда каждая машина парка, взявшая задачу этого пользователя, начала
// бы постить его видео сама — один ролик уехал бы столько раз, сколько машин его
// обрабатывало. Поэтому авто-добавленная папка приходит только «на посмотреть», а
// включить её в постинг — решение человека, одним кликом по чекбоксу.
//
// Выбор в колонках не крадём: воркер работает часами, а человек в это время может
// ходить по своим папкам, и прыгающая под курсором колонка — худшее, что может
// сделать фоновый режим. Исключение одно: выбрано ничего (свежая машина парка) —
// тогда показать хоть что-то полезнее пустых колонок.

import { mainFolders_stor } from '@/Store/MainWin/mainFolders_store';
import { setActiveFolders_store } from '@/Store/MainWin/activeFolder_store';
import { storage_store } from '@/Store/MainWin/storage_store';
import { basename } from '@/Utils/path';
import { reloadFolders } from '../reloadFolders';

type Log = (level: 'info' | 'warn' | 'error', text: string) => void;

/** Сравнение путей как в сторе: без хвостового слэша и без регистра (macOS). */
const norm = (p: string) => p.replace(/\/+$/, '').toLowerCase();

/**
 * Пересобрать раскладку зеркала `<владелец>/<проект>`.
 *
 * Карта строится из ответа `/projects`, а обновляет её демон раз в пару минут. У
 * проекта, появившегося только что, локальной раскладки ещё нет — и путь в зеркале
 * по нему не построить: `mirror_path_for` отвечает «проект не найден в раскладке».
 * Для воркера это означало бы провал первой задачи по каждому новому проекту.
 */
export async function refreshMirrorLayout(): Promise<void> {
	await storage_store.getState().refreshProjects();
}

/**
 * Показать пользователя и его проекты в колонках.
 *
 * `clientPath` — папка владельца в зеркале (первая колонка), `projectName` — имя
 * проекта задачи (вторая). Ошибки не пробрасываем: это удобство, а не часть работы,
 * и обработка не должна падать из-за того, что список колонок не собрался.
 */
export async function showTaskInColumns(clientPath: string, projectName: string, log: Log): Promise<void> {
	try {
		const find = () => mainFolders_stor.getState().mainFolderArr.find((f) => norm(f.path) === norm(clientPath));

		let entry = find();
		const added = !entry;
		if (!entry) {
			mainFolders_stor.getState().ensureOnlineFolder(clientPath, { active: false });
			entry = find();
			if (!entry) return;
			log('info', `[worker] пользователь «${basename(clientPath)}» добавлен в первую колонку (галочка снята — см. showTaskInColumns.ts)`);
		}

		// Перечитываем список только когда есть что менять: `reloadFolders` для
		// облачной папки читает каталог и сайдкары состояния всех проектов, а задача
		// приходит каждые несколько минут — гонять это на каждой впустую незачем.
		// Архивность и галочки с сайта и без нас догоняет `storage-projects-changed`.
		const known = Array.isArray(entry.projectFolders) ? entry.projectFolders : [];
		if (added || !known.includes(projectName)) {
			const projectFolders = await reloadFolders(entry);
			mainFolders_stor.getState().updateParameters({ id: entry.id, projectFolders });
			log('info', `[worker] проекты «${basename(clientPath)}» в колонке: ${projectFolders.length}`);
		}

		// Выбрано ничего — выбираем добавленного, иначе колонки останутся пустыми и
		// смотреть результат будет негде.
		const active = setActiveFolders_store.getState().activeMainFolder;
		const activeExists = Boolean(active) && mainFolders_stor.getState().mainFolderArr.some((f) => f.id === active);
		if (!activeExists) setActiveFolders_store.getState().setMainFolderId(entry.id);
	} catch (e: any) {
		log('warn', `[worker] не удалось показать проект в колонках: ${e?.message ?? e}`);
	}
}
