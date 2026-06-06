// ====================================================================
// пробуем импортировать файл по его имени
// ====================================================================
import { cleanName } from '../fs/cleanName';

export function tryToImportByName(_path: string): any {
	//@ts-ignore
	var folderPath: any = File(_path).parent;

	//@ts-ignore
	var originalName: string = cleanName(File(_path).displayName);

	//@ts-ignore
	var files: any = Folder(folderPath).getFiles();
	var newF;
	for (var i = 0; i < files.length; i++) {
		var fName = cleanName(files[i].displayName);
		if (fName == originalName) {
			newF = files[i];
			break;
		}
	}
	return newF;
}
