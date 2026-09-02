import { isScanningStore } from '@/Store/MainWin/isScaning_store';
import { localFolders_stor } from '@/Store/MainWin/localFolders_store';
import { mainFolders_stor } from '@/Store/MainWin/mainFolders_store';
import { useWorkProject_Store } from '@/Store/Processing/useWorkProject_Store';
import { findItemAndCreateProps } from './findItemAndCreateProps';
import { clearFileNameAndID } from './utils/clearFileNameAndID';
import { createProcessQueue } from './utils/createProcessQueue';
import { getDescription } from './utils/getDesription';
import { getSignal } from './utils/processingAbort';
import { sendFindItemToRegistrationProcessDatabase } from './utils/sendFindItemToRegistrationProcessDatabase';
import { joinPath } from '@/Utils/joinPath';
import { basename } from '@/Utils/path';
import { commands, unwrap } from '@/Utils/specta';
import { injectMachineLocals } from './utils/machineLocals';
import { ensureLocal, pathInfo } from '@/Utils/storageSeam';
import { checkVendorAccounts, describeProblem } from './utils/vendorAccountsGate';

export async function findFilesForSingleFolder(projectPathOnGD: string, mainFolderPath: string, year: string, findDateName: string) {
	const { localFolder } = localFolders_stor.getState();
	const signal = getSignal();

	const projectName = basename(projectPathOnGD);
	const mainFolderName = basename(mainFolderPath);

	// ── выставляем mainFolderIndex и curentFolderIndex ──────────────────
	// collectFilesFromFolderFunc читает их из isScanningStore напрямую,
	// поэтому должны быть выставлены до вызова findItemAndCreateProps
	const { mainFolderArr } = mainFolders_stor.getState();
	const { setMainFolderIndex, setCurentFolderIndex } = isScanningStore.getState();

	const mainFolderIdx = mainFolderArr.findIndex((f) => f.path === mainFolderPath);
	if (mainFolderIdx === -1) {
		console.warn('findFilesForSingleFolder: mainFolder not found in store for path:', mainFolderPath);
		return;
	}

	const curMainFolder = mainFolderArr[mainFolderIdx];
	const folderIdx = curMainFolder.projectFolders.findIndex((f) => f === projectName);

	setMainFolderIndex(mainFolderIdx);
	setCurentFolderIndex(folderIdx !== -1 ? folderIdx : 0);
	// ───────────────────────────────────────────────────────────────────

	// ====== быстрая проверка IN: есть ли там вообще что-нибудь ======
	// Сначала смотрим IN top-level (без рекурсии). Если пусто или только "-" папки —
	// нет смысла читать options.json и идти дальше.
	const inPath = joinPath(projectPathOnGD, 'IN');
	let inItems: { files: string[]; folders: string[] } | null = null;
	try {
		inItems = unwrap(await commands.getSomeFromFolder(inPath, [
			{ type: 'files', ext: [] },
			{ type: 'folders', ext: [] },
		])) as unknown as { files: string[]; folders: string[] };
	} catch {
		// IN не существует — нечего обрабатывать
		return;
	}

	const validFolders = (inItems?.folders ?? []).filter((name) => !name.trim().startsWith('-'));
	const validFiles = inItems?.files ?? [];
	if (validFiles.length === 0 && validFolders.length === 0) {
		return; // пусто — выходим до чтения options.json
	}

	// ====== проверяем options.json =======
	// Проект может лежать в облаке — тогда конфиг надо сначала получить. Это
	// нужны БАЙТЫ, поэтому здесь гидрация. Вне зеркала вызов — no-op.
	const optionsFile = await ensureLocal(joinPath(projectPathOnGD, 'options', 'options.json'));
	if (unwrap(await commands.checkFilePath(optionsFile, null)) == '') {
		console.log('--- no "options.json" file:\n', optionsFile);
		return;
	}
	const nodesProps = JSON.parse(unwrap(await commands.readFileSync(optionsFile)));
	if (!nodesProps) {
		console.log('--- no "options.json" file:\n', optionsFile);
		return;
	}

	// ищем необходимые файлы в папке IN и создаем объект для обработки.
	// Передаём уже отсканированный top-level список — collectFilesFromFolderFunc
	// отфильтрует его в памяти по нужному searchType (без второго IPC).
	const currentAutomationProps = await findItemAndCreateProps(nodesProps, { files: validFiles, folders: validFolders });
	if (!currentAutomationProps) {
		return;
	}

	// преобразуем ноды в очередь процессов
	// Цикл в графе означает, что часть нод молча не выполнится — говорим об этом
	// вслух, уровнем error: это не шум, а причина «пайплайн не сработал».
	const processArr = createProcessQueue(nodesProps, 'mainSearch', (message) => {
		console.warn('[createProcessQueue]', message);
		void commands.sendLog('error', `[${projectName}] ${message}`).catch(() => {});
	});

	// ── Гейт учёток внешних сервисов ─────────────────────────────────────────
	//
	// Здесь, а не глубже: очередь уже построена (значит известно, какие ноды реально
	// исполнятся), но ни один файл ещё не тронут. Нет ключа — проект в этом витке
	// просто не стартует, с причиной в логе. Плагин упал бы тоже, но уже посреди
	// работы, оставив недоделанный ролик в OUT.
	const accountProblems = await checkVendorAccounts(nodesProps, processArr);
	if (accountProblems.length > 0) {
		for (const problem of accountProblems) {
			void commands
				.sendLog('error', `[${projectName}] ${describeProblem(problem)}`)
				.catch(() => {});
		}
		console.warn('[findFilesForSingleFolder] проект пропущен, нет учёток:', projectName, accountProblems);
		return;
	}

	const description = getDescription(nodesProps);
	description.year = year;
	description.findTime = findDateName;
	description.projectName = projectName;
	description.projectPathGD = projectPathOnGD;
	description.mainFolderName = mainFolderName;
	description.mainFolderPath = mainFolderPath;
	description.infoText = `${mainFolderName}/${projectName}`;

	// Пути к программам, папки данных, алиасы масок, словарь типов, локальный корень —
	// всё, что у каждой машины своё. Общая функция с режимом воркера: задача от сайта
	// этих полей не несёт, и подставлять их обязаны обе точки входа одинаково.
	injectMachineLocals(description);

	const templateObj: any = {
		processingQueue: [],
	};

	processArr.forEach((process: any) => {
		const key = process.id;
		templateObj.processingQueue.push(key);
		templateObj[key] = process;
	});

	// разделяем каждый найденный item на отдельные процессы
	const findedItems = [...currentAutomationProps.output];
	for (let item of findedItems) {
		if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

		// Защита: если item это массив, взять первый элемент
		if (Array.isArray(item)) {
			console.warn('[findFilesForSingleFolder] Item is an array, extracting first element:', item);
			item = item[0];
		}

		// МЕТАДАННЫЕ, а не байты: гидратировать здесь нельзя. Этот вызов идёт на
		// КАЖДЫЙ найденный файл, и скачивание тут означало бы выкачивание всего
		// архива при первом же обходе проекта.
		const cloud = await pathInfo(item);
		const fileInfo: any = cloud
			? { size: cloud.size ?? 0, is_dir: cloud.isFolder, is_file: !cloud.isFolder }
			: unwrap(await commands.getFileInfo(item));
		const curItemName = basename(item);

		// Rust FileInfo сериализуется как snake_case (is_dir/is_file). Раньше тут читали
		// fileInfo.isDirectory (Electron-имя) — поле было undefined, и папки определялись
		// как файлы. Это и ломало postProcess для папок (deleteAfter+folder не отрабатывал).
		const isDir: boolean = Boolean(fileInfo?.is_dir ?? fileInfo?.isDirectory);
		const isFile: boolean = Boolean(fileInfo?.is_file ?? fileInfo?.isFile);

		if (isDir && curItemName.trim().startsWith('-')) {
			continue;
		}

		const clearNameAndId = clearFileNameAndID(curItemName);

		description.mainWorkFolder = joinPath(localFolder, mainFolderName, projectName);

		description.isFolder = isDir;
		description.curItem = curItemName;
		description.id = clearNameAndId.id;
		description.clearName = clearNameAndId.clearName;
		description.pathForDelete = Array.isArray(item) ? item[0] : item;
		description.size = isFile ? fileInfo.size : 0;

		templateObj.mainSearch.output = [item];

		const objForProcessing = structuredClone(templateObj);
		objForProcessing.mainSearch.output = [item];
		objForProcessing.description = structuredClone(description);

		await sendFindItemToRegistrationProcessDatabase(objForProcessing);
		useWorkProject_Store.getState().addWorkProjectState(objForProcessing);

		// Сразу сообщаем окну логов про queued-item, чтобы оно показало все найденные файлы,
		// а не только те (MAX_PARALLEL), что ушли в обработку прямо сейчас.
		const queuedSteps = (objForProcessing.processingQueue as string[]).slice(1).map((key: string) => {
			const s = objForProcessing[key] ?? {};
			return {
				stepId: key,
				label: s.nodeLabel || s.pluginId || key,
				pluginId: s.pluginId,
				pluginVersion: s.pluginVersion,
				nodeType: s.nodeType ?? 'default',
				cost: String(s.cost ?? '0'),
				costUnit: s.costUnit ?? 'run',
				isTerminal: Boolean(s.isTerminal),
			};
		});

		const findTime: string | undefined = objForProcessing.description?.findTime;
		const queuedItemId: string =
			objForProcessing.description?.dbItemId ??
			(objForProcessing.description?.pathForDelete && findTime ? `${objForProcessing.description.pathForDelete}:${findTime}` : undefined) ??
			objForProcessing.description?.pathForDelete ??
			objForProcessing.description?.id ??
			String(Date.now());

		const curItem: string = objForProcessing.description?.curItem ?? queuedItemId;
		const displayName = findTime ? `[${findTime}] ${curItem}` : curItem;

		commands
			.logWindowEmitItemQueued({
				itemId: queuedItemId,
				itemName: displayName,
				mainFolderName: objForProcessing.description?.mainFolderName ?? '',
				projectName: objForProcessing.description?.projectName ?? '',
				steps: queuedSteps,
				dbItemId: objForProcessing.description?.dbItemId,
			})
			.catch(() => {});
	}
}
