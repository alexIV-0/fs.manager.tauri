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
import { processItem } from '../processItem';
import { RUN_PROCESSING } from '../runLanes';

/** Как часто продлеваем аренду, пока идёт обработка. */
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

/** Ждём, пока по проекту не останется неотправленного. */
async function waitUploads(signal: AbortSignal): Promise<boolean> {
	// Заливка идёт своей очередью и о завершении шага знает раннер, поэтому сначала
	// объявляем всё готовым, а потом ждём, пока демон разгребёт.
	await flushUploads();

	const until = Date.now() + UPLOAD_WAIT_MS;
	while (Date.now() < until) {
		if (signal.aborted) return false;
		const rest = unwrap(await commands.storageNotUploaded(50));
		if (!Array.isArray(rest) || rest.length === 0) return true;
		await new Promise((r) => setTimeout(r, 2000));
	}
	return false;
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
	const filePath = unwrap(await commands.storageMirrorPath(source.fileId));
	await ensureLocal(filePath);

	const projectPath = projectRootFromFile(filePath, source.folderPath ?? '');
	const projectName = basename(projectPath);
	const mainFolderPath = dirname(projectPath);
	const mainFolderName = basename(mainFolderPath);

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

	// 4. Продление аренды на всё время обработки. AE может рендерить сорок минут, а аренда
	//    живёт пятнадцать: без продления задачу перезаберёт другая машина, и один и тот же
	//    файл отрендерят дважды.
	const renew = setInterval(() => {
		void queue.progress(task.taskId, 'running', 'running', 'обработка идёт').catch((e: any) => {
			log('warn', `[worker] аренда не продлилась: ${e?.message ?? e}`);
		});
	}, LEASE_RENEW_MS);

	try {
		await queue.progress(task.taskId, 'start', 'running', `начата обработка ${curItemName}`);

		const result = await processItem(payload, signal, RUN_PROCESSING);

		if (result.status !== 'done') {
			return { status: 'error', outFiles: result.outFiles, totalCost: result.totalCost ?? 0, error: 'обработка завершилась с ошибкой' };
		}

		// 5. Отчитываться можно только после того, как результат реально уехал. Иначе сайт
		//    отметит задачу готовой раньше, чем увидит файлы, и следующий шаг конвейера
		//    пойдёт по пустой папке.
		const uploaded = await waitUploads(signal);
		if (!uploaded) log('warn', '[worker] заливка не завершилась в отведённое время — отчитываемся как есть');

		return { status: 'done', outFiles: result.outFiles, totalCost: result.totalCost ?? 0 };
	} finally {
		clearInterval(renew);
	}
}
