// Исполнение одной задачи из очереди: онлайн-описание → локальный элемент → processItem.
//
// Задача от сайта намеренно не содержит ни путей, ни ссылок (`PIPELINE.md` §5): presigned
// URL живёт минуты, а задача может простоять в очереди часы и переретраиться завтра. В ней
// лежит ИДЕНТИЧНОСТЬ файла (`fileId`, `s3Key`, `folderPath`, `name`) — превратить её в
// локальный путь обязана машина, и делается это здесь.
//
// ГДЕ МАТЕРИАЛИЗУЕТСЯ: в зеркале, не в отдельном scratch. Рассматривали `/tmp/job-XXXX/` и
// отказались — половина работы уже сделана: гидрация по требованию живёт в host-сервисах
// (`fs.read`/`fs.copy` сами тянут байты), заливка результата — watcher зеркала плюс демон,
// вытеснение скачанного — TTL и лимит размера. Со scratch пришлось бы писать заливку,
// чистку и вытеснение заново.
//
// Исполняет ОБЩИЙ движок `processItem` — тот же, что гоняет локальный прогон и постинг.
// Здесь только сборка элемента и отчёт наверх.

import { commands, unwrap } from '@/Utils/specta';
import { basename, dirname } from '@/Utils/path';
import { joinPath } from '@/Utils/joinPath';
import { getFormattedDateTime } from '@/Utils/getFormattedDateTime';
import { ensureLocal, flushUploads, pathInfo } from '@/Utils/storageSeam';
import { clearFileNameAndID } from '../utils/clearFileNameAndID';
import { injectMachineLocals } from '../utils/machineLocals';
import { sendFindItemToRegistrationProcessDatabase } from '../utils/sendFindItemToRegistrationProcessDatabase';
import { processItem } from '../processItem';
import { RUN_WORKER } from '../runLanes';
import { refreshMirrorLayout, showTaskInColumns } from './showTaskInColumns';

/**
 * Как часто продлеваем аренду, пока ИДЁТ ШАГ.
 *
 * Продление привязано к текущему шагу, а не к тому, что `runTask` ещё не вернулась, — и
 * это не деталь. Прежний пульс шёл по таймеру всегда: обработка кончилась в 08:30, а в
 * 08:34 уходило очередное «обработка идёт», аренда сдвигалась ещё на 15 минут, и
 * сборщик протухших аренд такую задачу не подобрал бы никогда. Пока шаг реально идёт
 * (рендер AE — это сорок минут), продлевать обязаны, иначе задачу заберёт другая машина
 * посреди работы.
 *
 * «Машина жива» через это НЕ сообщается: `ping` шлёт демон синхронизации сам, раз в
 * пульс, независимо от режима воркера (`storage/daemon.rs`).
 */
const LEASE_RENEW_MS = 5 * 60 * 1000;
/**
 * Формат метки прогона, принятый в программе: `17.08-20.42` — день.месяц-часы.минуты.
 *
 * Тот же, что у локального прогона (`findAllFilesForProcess` берёт
 * `$YYYY.$DD.$MM-$HH.$mm` и срезает год) и тот же, что стоит дефолтом у маски
 * `$findTime` в `masks.ts`. Три места должны совпадать, иначе имена результатов
 * локального и распределённого прогонов будут выглядеть по-разному.
 */
const FIND_TIME_PATTERN = '$DD.$MM-$HH.$mm';
/** Сколько ждём, пока заливка результата опустеет, прежде чем отчитаться. */
const UPLOAD_WAIT_MS = 10 * 60 * 1000;

export interface TaskOutcome {
	status: 'done' | 'error';
	outFiles: string[];
	totalCost: number;
	error?: string;
}

type SourceIdentity = {
	fileId?: string | null;
	s3Key?: string;
	name?: string;
	folderPath?: string;
	sizeBytes?: number;
};

/**
 * Корень проекта из пути файла: снимаем `folderPath` и имя.
 *
 * Считаем от известного числа сегментов, а не поиском «IN» в пути: имя папки проекта
 * тоже может быть `IN`, и поиск сработал бы не на том уровне.
 */
function projectRootFromFile(filePath: string, folderPath: string): string {
	const depth = String(folderPath ?? '')
		.split('/')
		.filter(Boolean).length;
	let root = dirname(filePath); // сняли имя файла
	for (let i = 0; i < depth; i++) root = dirname(root);
	return root;
}

/**
 * Ждём, пока не останется неотправленного **по этому проекту**.
 *
 * Фильтр по проекту обязателен: `storageNotUploaded` отдаёт весь список зеркала, а в нём
 * может годами лежать чужой файл, который не заливается вовсе (заливку остановили
 * руками, имя не принимает хранилище). Без фильтра каждая задача упиралась бы в чужой
 * мусор и висела все десять минут вместо того, чтобы отчитаться, — ровно это и
 * выглядело как «задача навсегда в работе».
 *
 * Файлы с `reason: 'stopped'` не ждём: остановленная вручную заливка сама не
 * возобновится, ждать её — значит гарантированно проесть весь таймаут. Пишем их в лог,
 * чтобы «отчитались, а файла в облаке нет» не было загадкой.
 */
async function waitUploads(
	projectPath: string,
	signal: AbortSignal,
	log: (level: 'info' | 'warn' | 'error', text: string) => void,
): Promise<boolean> {
	// Заливка идёт своей очередью и о завершении шага знает раннер, поэтому сначала
	// объявляем всё готовым, а потом ждём, пока демон разгребёт.
	await flushUploads();

	const mine = (rows: any[]) => rows.filter((r) => typeof r?.path === 'string' && r.path.startsWith(projectPath));

	const until = Date.now() + UPLOAD_WAIT_MS;
	let told = false;
	while (Date.now() < until) {
		if (signal.aborted) return false;
		const all = unwrap(await commands.storageNotUploaded(500));
		const rest = mine(Array.isArray(all) ? all : []);
		const stopped = rest.filter((r) => r.reason === 'stopped');
		if (rest.length === stopped.length) {
			if (stopped.length > 0) {
				log('warn', `[worker] заливка остановлена вручную, эти файлы в облако не уехали: ${stopped.map((r) => r.name).join(', ')}`);
			}
			return true;
		}
		// Сказать, ЧЕГО ждём, — один раз и не сразу (пара секунд ожидания это норма).
		// Без этой строки затянувшееся ожидание выглядит как «задача зависла на сайте», и
		// искать причину приходится в отчётности, хотя дело в конкретном файле.
		if (!told && Date.now() - (until - UPLOAD_WAIT_MS) > 10_000) {
			told = true;
			log('info', `[worker] ждём заливки: ${rest.map((r) => `${r.name} (${r.reason})`).join(', ')}`);
		}
		await new Promise((r) => setTimeout(r, 2000));
	}
	log('warn', '[worker] ждать заливку больше не будем — таймаут. Отчитываемся, но в облаке может быть не всё');
	return false;
}

/**
 * Мост «шаги пайплайна → отчёты в очередь».
 *
 * ── Почему через шину событий ─────────────────────────────────────────────────
 * `processItem` уже рассылает `node:start` / `node:done` / `node:error` в локальную шину
 * `processing:event` (её слушает и окно логов, и граф в NODE_WIN). Отдельный колбэк в
 * движок означал бы второй, параллельный способ узнать одно и то же — и обязанность
 * поддерживать их согласованными. Воркер живёт в том же realm'е, что `processItem`,
 * поэтому шина ему доступна как есть.
 *
 * ── Почему `graphNodeId` ──────────────────────────────────────────────────────
 * Сайт сопоставляет отчёты со шагами по тем id, которые сам положил в
 * `payload.processingQueue` (`mainSearch`, `MQx1_`, `W4eDu`, …). Мы раньше слали
 * синтетические `start`/`running` — они не совпадали ни с чем, сайт принимал их молча, и
 * все шаги оставались `queued` при работающей обработке. У саб-шагов `loop` `nodeId`
 * суффиксирован (`X#3`), а `graphNodeId` — исходный id ноды; в очередь идёт он.
 *
 * ── Фильтр по элементу ────────────────────────────────────────────────────────
 * Шина глобальная, поэтому берём только события своего элемента: `itemId` у элемента
 * воркера равен `taskId` (`description.dbItemId`, см. `processItem`). Это же и
 * разделяет два одновременных раннера: события локальной обработки идут по той же
 * шине, но с чужими `itemId`, и в очередь сайта не попадают.
 *
 * ── `node:wait` = шаг уже наш ─────────────────────────────────────────────────
 * Семафоры пулов общие с локальным прогоном, поэтому шаг воркера может ждать слот
 * (`local: 1` — один After Effects на машину) сколько угодно долго. Ожидание — это
 * работа над задачей, и аренду в это время держать обязаны: без отметки «шаг идёт»
 * она протухнет через пятнадцать минут, и ту же задачу возьмёт другая машина, пока
 * эта стоит в очереди за слотом. Поэтому `current` ставится на `node:wait`, а не на
 * `node:start`; наружу до реального старта уходит `running` с пояснением, чего ждём.
 */
function reportSteps(
	taskId: string,
	queue: { progress: (t: string, s: string, st: any, m?: string) => Promise<void> },
	log: (level: 'info' | 'warn' | 'error', text: string) => void,
) {
	let current: { id: string; since: number; waiting: boolean } | null = null;

	// Отчёт не должен ронять обработку: сайт может лежать, а работа уже сделана и её
	// надо довести. Поэтому fire-and-forget с записью в лог.
	const report = (stepId: string, status: 'running' | 'done' | 'error', message?: string) => {
		void queue.progress(taskId, stepId, status, message).catch((e: any) => {
			log('warn', `[worker] отчёт о шаге ${stepId} не ушёл: ${e?.message ?? e}`);
		});
	};

	const onEvent = (ev: Event) => {
		const detail = (ev as CustomEvent).detail ?? {};
		const { type, payload } = detail;
		if (!payload || payload.itemId !== taskId) return;

		const stepId: string | undefined = payload.graphNodeId ?? payload.nodeId;
		if (!stepId) return;

		if (type === 'node:wait') {
			// Только отмечаем, за какой шаг держимся: отчёт отсюда НЕ шлём. Слот почти
			// всегда свободен, и лишний `running` на каждый шаг удвоил бы разговор с
			// сайтом ни за чем. Если ожидание затянется — его подхватит пульс аренды
			// (`LEASE_RENEW_MS`), а он и есть единственное, ради чего эта отметка нужна.
			current = { id: stepId, since: Date.now(), waiting: true };
		} else if (type === 'node:start') {
			current = { id: stepId, since: Date.now(), waiting: false };
			report(stepId, 'running');
		} else if (type === 'node:done') {
			if (current?.id === stepId) current = null;
			report(stepId, 'done');
		} else if (type === 'node:error') {
			if (current?.id === stepId) current = null;
			report(stepId, 'error', payload.message ?? 'шаг упал');
		}
	};

	window.addEventListener('processing:event', onEvent);

	return {
		report,
		/** Какой шаг идёт прямо сейчас — по нему продлевается аренда. */
		current: () => current,
		stop: () => window.removeEventListener('processing:event', onEvent),
	};
}

/**
 * Локальные пути результата → логические, относительно корня проекта.
 *
 * В `taskDone` нельзя слать `/Users/имя/Desktop/r2cloud/…` — это машинно-локальное, а
 * контракт очереди про него ничего не знает (`PIPELINE.md` §5: ни путей, ни ссылок).
 * Сайт кладёт присланное в `tasks.payload`, и с абсолютным путём чужой машины он не
 * сделает ничего: сопоставить с каталогом можно только по `folder_path` + `name`.
 * Поэтому отдаём `OUT/08 August/18.08-01.30_123.mp4`.
 *
 * Файлы вне папки проекта не отдаём вовсе: их нет в облаке (например, промежуточное в
 * локальной рабочей папке), и ссылаться на них сайту не на что. Молчать об этом нельзя —
 * пишем в лог, иначе «результат есть, а в отчёте пусто» превращается в загадку.
 */
function logicalOutFiles(
	outFiles: string[],
	projectPath: string,
	log: (level: 'info' | 'warn' | 'error', text: string) => void,
): string[] {
	const prefix = projectPath.endsWith('/') ? projectPath : `${projectPath}/`;
	const inside: string[] = [];
	const outside: string[] = [];

	for (const p of outFiles) {
		if (typeof p !== 'string' || !p) continue;
		if (p.startsWith(prefix)) inside.push(p.slice(prefix.length));
		else outside.push(p);
	}

	if (outside.length > 0) {
		log('warn', `[worker] в отчёт не попали файлы вне папки проекта (их нет в облаке): ${outside.join(', ')}`);
	}
	return inside;
}

export async function runTask(
	task: { taskId: string; projectId: string; payload: any },
	queue: { progress: (t: string, s: string, st: any, m?: string) => Promise<void> },
	signal: AbortSignal,
	log: (level: 'info' | 'warn' | 'error', text: string) => void,
): Promise<TaskOutcome> {
	const payload = structuredClone(task.payload ?? {});
	const source: SourceIdentity = payload?.mainSearch?.output?.[0] ?? {};

	if (!source.fileId) {
		// Без `fileId` путь в зеркале не построить. Это ошибка сборки задачи на сайте,
		// а не сбой машины, — поэтому сообщаем внятно, а не падаем внутри processItem.
		return { status: 'error', outFiles: [], totalCost: 0, error: 'в задаче нет fileId источника' };
	}

	// 1. Каталог проекта в локальном индексе. Без этого `mirror_path_for` не знает, где
	//    лежит файл: проект мог вообще ни разу не открываться на этой машине.
	await commands.storageCatchUp(task.projectId).catch((e: any) => {
		throw new Error(`каталог проекта не обновился: ${e?.message ?? e}`);
	});

	// 2. Идентичность → путь в зеркале → байты на диске.
	//
	// Раскладку `<владелец>/<проект>` строит карта из ответа `/projects`, а обновляет её
	// демон раз в пару минут. Проект, созданный на сайте только что, в локальной карте
	// ещё не значится — и первая задача по нему падала бы на «проект не найден в
	// раскладке зеркала», хотя всё остальное на месте. Поэтому один раз пересобираем
	// карту и пробуем снова.
	let filePath: string;
	try {
		filePath = unwrap(await commands.storageMirrorPath(source.fileId));
	} catch (e: any) {
		log('info', `[worker] проекта нет в раскладке зеркала (${e?.message ?? e}) — обновляем список проектов`);
		await refreshMirrorLayout();
		filePath = unwrap(await commands.storageMirrorPath(source.fileId));
	}
	await ensureLocal(filePath);

	const projectPath = projectRootFromFile(filePath, source.folderPath ?? '');
	const projectName = basename(projectPath);
	const mainFolderPath = dirname(projectPath);
	const mainFolderName = basename(mainFolderPath);

	// 2.1. Пользователь и его проекты — в колонки. Не ждём конца обработки: смотреть,
	//      что машина делает прямо сейчас, надо во время работы, а не после.
	await showTaskInColumns(mainFolderPath, projectName, log);

	// 3. Описание: то, что прислал сайт, плюс машинно-локальное и координаты элемента.
	const description = { ...(payload.description ?? {}) };

	// ── Метку прогона ставит МАШИНА, в момент взятия задачи ───────────────────
	//
	// `findTime` — не время события, а **компонент имени**: маска `$findTime` идёт в
	// имена файлов и папок результата. Все остальные даты-маски (`$YYYY`, `$MM`,
	// `$DD`, `$HH`, `$mm`, `$ss`) считаются от `new Date()` прямо при раскрытии, то
	// есть от времени работы машины, — и `findTime` обязана быть с ними в одном
	// времени, иначе имя файла и папка, в которую он лёг, разъедутся.
	//
	// Сайт присылал в этом поле `collectedAt` — момент, когда его обход нашёл файл.
	// Задача может простоять в очереди часы, поэтому это ЧУЖОЕ время и оно не годится
	// даже после конвертации. Плюс приезжало оно сырой ISO-строкой, и результат
	// назывался `2026-08-17T20:42:18.165Z_…` — двоеточия хранилище отвергает.
	//
	// Ставим один раз здесь, а не даём маске упасть на свой дефолт: у неё тот же
	// формат, но резолвится она на каждое обращение, и два имени в одном элементе
	// разошлись бы на минуте.
	description.collectedAt = description.findTime; // сырое время обхода — для сверки с очередью
	description.findTime = getFormattedDateTime(FIND_TIME_PATTERN);
	description.projectName = description.projectName || projectName;
	description.projectPathGD = projectPath;
	description.mainFolderPath = mainFolderPath;
	description.mainFolderName = mainFolderName;
	description.infoText = `${mainFolderName}/${projectName}`;

	// Пути к программам, папки данных, алиасы, словарь типов, локальный корень.
	const locals = injectMachineLocals(description);

	// ЛОГИЧЕСКОЕ имя — из пути в зеркале, а не из задачи.
	//
	// Путь построен каталогом (`folder_path` + `name`), поэтому его последний сегмент —
	// то самое имя, которое человек видит в папке. А `source.name` в задаче сейчас
	// ФИЗИЧЕСКОЕ: сайт выводит его из ключа R2 (`resolveInEntry` в `lib/pipeline/scan.ts`
	// режет `s3Key`), и в него входит uuid, которым бэкенд разводит объекты. Технические
	// имена не должны доходить до имён результатов вообще: `$curItemName` и `$clearName`
	// идут прямо в файл на диске.
	//
	// `source.name` оставлен фолбэком на случай, когда путь построить не удалось.
	const curItemName = basename(filePath) || source.name || '';
	const cloud = await pathInfo(filePath);
	const isFolder = Boolean(cloud?.isFolder);
	const { id, clearName } = clearFileNameAndID(curItemName);

	description.curItem = curItemName;
	description.isFolder = isFolder;
	description.id = id;
	description.clearName = clearName;
	description.pathForDelete = filePath;
	description.size = isFolder ? 0 : (cloud?.size ?? source.sizeBytes ?? 0);
	description.mainWorkFolder = joinPath(locals.localFolder, mainFolderName, projectName);

	// Сквозной идентификатор: запись в архиве статистики должна ссылаться на ЗАДАЧУ, а не
	// на локальный путь, — иначе связать её с очередью можно только гаданием по совпадению
	// «проект + имя файла + время» (см. SITE_STATS_LINK_PLAN.md).
	description.dbItemId = task.taskId;

	payload.description = description;
	payload.mainSearch = { ...(payload.mainSearch ?? {}), output: [filePath] };

	// 3.1. Регистрация элемента — без неё нет статистики.
	//
	// Локальный прогон делает это в `findFilesForSingleFolder`, а воркер собирает элемент
	// сам и мимо той ветки проходил целиком: `write_analytics` на финише искал запись по
	// `itemId` в `DbState`, не находил и выходил первой же строкой. Наружу это выглядело
	// так, будто настройка архива не работает, — а работа просто не регистрировалась.
	//
	// Ключом ложится `dbItemId`, то есть `taskId`: именно с ним придёт `item:end`, и
	// именно он должен оказаться в `_stats`, чтобы строка сшивалась с задачей на сайте.
	await sendFindItemToRegistrationProcessDatabase(payload);

	// 4. Отчёты о шагах. Подписываемся ДО запуска обработки, иначе первый шаг успеет
	//    начаться молча.
	const steps = reportSteps(task.taskId, queue, log);

	// Шаг-источник закрываем сами: `processItem` идёт по очереди с ВТОРОГО элемента
	// (первый — `mainSearch`, его выход подставляется до входа в движок). Без этого отчёта
	// шаг остался бы `queued` навсегда, и полоса прогресса на сайте не дошла бы до конца
	// даже у полностью успешной задачи. Отчёт правдив: идентичность разобрана, байты на
	// диске — это и есть вся работа `mainSearch` здесь.
	const mainSearchId = Array.isArray(payload.processingQueue) ? payload.processingQueue[0] : null;
	if (typeof mainSearchId === 'string' && mainSearchId) {
		steps.report(mainSearchId, 'done', `источник получен: ${curItemName}`);
	}

	// 5. Продление аренды — только пока реально идёт шаг (см. `LEASE_RENEW_MS`).
	const renew = setInterval(() => {
		const cur = steps.current();
		if (!cur) return; // между шагами и на ожидании заливки аренду не двигаем
		const mins = Math.round((Date.now() - cur.since) / 60000);
		steps.report(cur.id, 'running', cur.waiting ? `ждёт свободный слот ${mins} мин` : `шаг идёт ${mins} мин`);
	}, LEASE_RENEW_MS);

	try {
		const result = await processItem(payload, signal, RUN_WORKER);

		if (result.status !== 'done') {
			return {
				status: 'error',
				outFiles: logicalOutFiles(result.outFiles, projectPath, log),
				totalCost: result.totalCost ?? 0,
				error: 'обработка завершилась с ошибкой',
			};
		}

		// 6. Отчитываться можно только после того, как результат реально уехал. Иначе сайт
		//    отметит задачу готовой раньше, чем увидит файлы, и следующий шаг конвейера
		//    пойдёт по пустой папке.
		const uploaded = await waitUploads(projectPath, signal, log);
		if (!uploaded) log('warn', '[worker] заливка не завершилась в отведённое время — отчитываемся как есть');

		return {
			status: 'done',
			outFiles: logicalOutFiles(result.outFiles, projectPath, log),
			totalCost: result.totalCost ?? 0,
		};
	} finally {
		clearInterval(renew);
		steps.stop();
	}
}
