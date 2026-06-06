import { osSep } from '../fs/osSep';
import { basename } from '../fs/path/basename';
import { dirname } from '../fs/path/dirname';
import { extname } from '../fs/path/extname';

import { testFileInFolder } from '../fs/testFileInFolder';

export function saveProject(_inObj: any, _addName?: string): string {
	var _S = osSep();
	var addName = '';
	if (typeof _addName != 'undefined') {
		addName = '-' + _addName;
	}

	var folder = dirname(_inObj.targetPath);
	var extName = extname(_inObj.targetPath);
	var name = basename(_inObj.targetPath, extName) + addName + '.aep';
	var fileName = testFileInFolder(folder, name);
	var newAEP_file = new File(folder + _S + fileName);
	app.project.save(newAEP_file);
	return newAEP_file.fsName;
}
