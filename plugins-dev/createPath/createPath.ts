import { formatNameByPattern } from '../../electron/main/fileSistem/formatNameByPattern';
import path from 'path';
import { sendToMW } from '../_template/pluginSender';

export { onLoad } from '../_template/pluginSender';

// Windows MAX_PATH safety margin: leave room for filenames inside the folder (~40+ chars)
const WIN_MAX_PATH = 200;

interface ItemType {
	id: string;
	functionName: string;
	pluginId: string;
	pluginVersion: string;
	path: string[];
	import: {
		path?: string[];
		dinamicPath?: string[];
	};
}

export async function createPathFunc(_item: ItemType, _description: any) {
	sendToMW('statusbar', `${_description.infoText}: [create Path]\n `);
	let curPath = [..._item.path];

	if (_item.import.path && _item.import.path.length > 0) {
		curPath.unshift(..._item.import.path);
	} else if (curPath.length > 0 && !path.isAbsolute(curPath[0]) && !curPath[0].startsWith('$')) {
		// Relative folder name (e.g. selected via #folders) — resolve against project root
		curPath.unshift('$projectPathGD');
	}

	const pathMerge = path.join(...curPath);
	const pathByPattern = formatNameByPattern({
		string: pathMerge,
		description: _description,
	});

	let finalPath = pathByPattern;

	const dinamicSegment = _item.import.dinamicPath?.[0];
	if (dinamicSegment) {
		finalPath = path.join(pathByPattern, dinamicSegment);
	}

	if (process.platform === 'win32' && finalPath.length > WIN_MAX_PATH) {
		const msg = `Path too long for Windows (${finalPath.length} chars, limit ${WIN_MAX_PATH}): ${finalPath}`;
		sendToMW('log', { level: 'error', text: msg });
		throw new Error(msg);
	}

	sendToMW('log', { level: 'info', text: `Result:\n${finalPath}` });
	return finalPath;
}
