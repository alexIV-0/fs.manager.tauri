import fs from 'fs';
import path from 'path';
import { isFolder } from './operation/isFolder';

// =====================================================================
// всегда возвращается путь до папки, даже если передали путь до файла
// =====================================================================

export function checkFolderPath(_path: string, _name?: string): string {
	let chekFolder = _path;
	if (typeof _name != 'undefined') {
		chekFolder = path.join(_path, _name);
	}
	if (!fs.existsSync(chekFolder)) {
		console.log(`--- no "${path.basename(chekFolder)}" folder:\n${chekFolder}`);
		return '';
	}
	if (!isFolder(chekFolder)) {
		chekFolder = path.dirname(chekFolder);
	}

	return chekFolder;
}
