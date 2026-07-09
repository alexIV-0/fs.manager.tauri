import { importFile } from './importFile';

export function manyImportFile(_arr: any[]) {
	var filesArr = [];
	var problemsArr = [];
	for (var i = 0; i < _arr.length; i++) {
		var item = _arr[i];
		var curFile = importFile(item, 'FOOTAGE');
		if (!curFile) {
			problemsArr.push('coud not import file: ' + item.path);
			continue;
		}
		filesArr.push(curFile);
	}

	return { files: filesArr, problems: problemsArr };
}
