// ====================================================================
// импортируем файл и возвращаем его. либо папку, если это был проект
// ====================================================================
import { tryToImportByName } from './tryToImportByName';

export function importFile(_path: string, _type?: keyof typeof ImportAsType) {
	if (typeof _type == 'undefined') {
		_type = 'FOOTAGE';
	}
	var newFile;
	var importOptions;
	try {
		importOptions = new ImportOptions(File(_path));
	} catch (e) {
		if (_type == 'FOOTAGE') {
			newFile = tryToImportByName(_path);

			importOptions = new ImportOptions(newFile);
		}
		// return;
	}

	if (importOptions && importOptions.canImportAs(ImportAsType[_type])) {
		newFile = app.project.importFile(importOptions);
		if (_type == 'PROJECT') {
			var regEx = new RegExp('.aep');
			for (var i = 1; i <= app.project.rootFolder.numItems; i++) {
				var item = app.project.items[i];

				if (item instanceof FolderItem && regEx.test(item.name)) {
					newFile = item;
					break;
				}
			}
		}
		return newFile;
	} else {
		return false;
	}
}
