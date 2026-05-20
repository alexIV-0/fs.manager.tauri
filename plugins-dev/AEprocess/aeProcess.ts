// aeProcess — запускает JSX-скрипт в After Effects, ждёт результат через
// файловую "договорённость" (lock + result.json). Tauri-port: вся механика
// (build script, launch AE, poll result file) перенесена в Rust-команду
// run_script_in_ae — здесь только формируем args.

import path from 'path';
import { fs, ae, sendToMW } from '../_template/tauri';
import { createPathForFileByPattern } from '../../electron/main/utilits/createPathForFileByPattern';

export { onLoad } from '../_template/tauri';

export async function aeProcess(_item: any, _description: any): Promise<any[]> {
	let finalFile: any[] = [];

	let curPath: string[] =
		_item.targetPath.length === 0 ? ['$clearName ($random(3))'] : [..._item.targetPath];
	if (_item.import.targetPath?.length) {
		curPath.unshift(..._item.import.targetPath);
	} else {
		curPath.unshift('$localFolder', '$mainFolderName', '$projectName', '$findTime');
	}

	const fileForName = _description.pathForDelete;
	const fileTo = createPathForFileByPattern(curPath, _description, fileForName);

	await fs.mkdir(path.dirname(fileTo));

	sendToMW('statusbar', { text: `${_description.infoText}: [AE process]\n ${_description.curItem}` });

	const aeScript: string = _item.import.aeScript[0];
	const aePath: string = _description.programmPath?.afterEffect?.[0];
	if (!aePath) {
		throw new Error('[aeProcess] description.programmPath.afterEffect не указан — пропиши путь до After Effects в настройках');
	}

	// inObj — что попадёт в JSX как `var inObj = {...}`.
	const { id: _removed, ...itemWithoutId } = _item;
	const inObj: Record<string, any> = {
		..._description,
		...itemWithoutId,
		tempScriptPath: fileTo,
	};

	const result = await ae.runScript({
		aePath,
		scriptPath: aeScript,
		inObj,
		// tempDir — оставляем дефолт (system temp), Rust сам разрулит уникальные имена.
		timeoutSec: 600, // 10 мин — для долгих рендеров
	});

	if (result.success) {
		finalFile = Array.isArray(result.data) ? result.data : [result.data];
	} else {
		console.error('Ошибка AE:', result.error);
		sendToMW('log', { level: 'error', text: `[aeProcess] AE error: ${result.error}` });
	}

	sendToMW('log', { level: 'info', text: `Result:\n${finalFile.join('\n')}` });
	return finalFile;
}
