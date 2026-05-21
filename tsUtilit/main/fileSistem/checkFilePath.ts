import fs from 'fs';
import path from 'path';
import { isFolder } from './operation/isFolder';

// =====================================================================
// всегда возвращается путь до файла или ''(если такого файла нет)
// =====================================================================

export function checkFilePath(_path: string, _name?: string): string {
	let checkFile = _path;
	if (typeof _name != 'undefined') {
		checkFile = path.join(_path, _name);
	}
	if (isFolder(checkFile)) {
		console.log(`"${path.basename(checkFile)}" is Folder`);
		return '';
	}
	if (!fs.existsSync(checkFile)) {
		console.log(`--- no "${path.basename(checkFile)}" file:\n${checkFile}`);
		return '';
	}

	return checkFile;
}
