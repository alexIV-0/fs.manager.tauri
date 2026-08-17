// ensureProjectFolders — создание папок проекта (IN / OUT) при сохранении флоу.
//
// Раньше IN/OUT/options создавались при КАЖДОМ открытии окна нод — даже у пустого,
// нетронутого проекта (см. старый init-эффект в NODE_WIN/index.tsx). Теперь папки
// появляются только когда пользователь реально настроил и сохранил флоу, и только те,
// что осмысленны для этого флоу:
//   - IN  — если есть ВКЛючённая нода mainSearch (источник файлов для обработки);
//   - OUT — если есть ВКЛючённая нода saveFileOnGD (сохранение финала на GD).
// Папка options создаётся самим save_flow_to_options_folder (create_dir_all на родителе),
// поэтому здесь её не трогаем. Остальные рабочие папки создаются на лету в процессе
// обработки — плодить их заранее незачем. IN/OUT создаём авансом чисто психологически:
// чтобы пользователю сразу было видно, куда класть и куда придёт результат.
//
// Выключенная нода (Power-тумблер, data.disabled === true) = папку НЕ создаём: как и в
// sidecar-синках (syncTgSearchSidecar), выключение = пауза/неактуальность этого пути.
//
// Детект нод — по node.type, единообразно с syncTgSearchSidecar ('autoTGcollect') и
// syncPostSourcesSidecar ('finder'). У плагин-ноды saveFileOnGD type === 'saveFileOnGD'
// (из её ui.json), у встроенной mainSearch type === 'mainSearch'.
//
// Вызывается из SaveButton/TopPanel сразу после commands.saveFlowToOptionsFolder. Никогда
// не бросает — ошибки только логируются, чтобы не ломать сохранение флоу.

import { joinPath } from '@/Utils/joinPath';
import { ensureDir } from '@/Utils/storageSeam';

const MAIN_SEARCH_TYPE = 'mainSearch';
const GD_SAVE_TYPE = 'saveFileOnGD';

function hasEnabledNode(nodes: any[], type: string): boolean {
	return nodes.some((n) => n?.type === type && n?.data?.disabled !== true);
}

export async function ensureProjectFolders(path: string | null, flow: any): Promise<void> {
	try {
		if (!path) return;
		const nodes: any[] = Array.isArray(flow?.nodes) ? flow.nodes : [];

		const folders: string[] = [];
		if (hasEnabledNode(nodes, MAIN_SEARCH_TYPE)) folders.push(joinPath(path, 'IN'));
		if (hasEnabledNode(nodes, GD_SAVE_TYPE)) folders.push(joinPath(path, 'OUT'));

		// Через шов, а не `testAndCreateFolders`: в зеркале папку надо заводить в
		// КАТАЛОГЕ, иначе она существует только на диске — на сайте её нет, значка
		// синхронизации нет, переименовать и удалить через API нельзя. Именно так и
		// пропадала `IN`. По одной, последовательно: пакетной команды в шве нет, а
		// папок здесь максимум две.
		for (const folder of folders) await ensureDir(folder);
	} catch (e) {
		console.error('[ensureProjectFolders] ошибка создания папок проекта:', e);
	}
}
