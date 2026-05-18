import { useStatusBar_Store } from '@/Store/Processing/useStatusBar_Store';
import { joinPath } from '@/Utils/joinPath';

export async function copyFileFunc__(_item: any, _description: any) {
	const finalFile = [];

	for (let fileFrom of _item.import.inputFile) {
		let curPath = _item.targetPath;
		if (_item.import.targetPath) {
			curPath.unshift(..._item.import.targetPath);
		}
		const filePathArr = joinPath(...curPath);
		const newFileName = (await window.electronAPI.invoke('formatNameByPattern', {
			string: filePathArr,
			description: _description,
			file: fileFrom,
		})) as string;
		const fileExt = await window.electronAPI.invoke('pathExtname', fileFrom);
		const fileTo = newFileName + fileExt;

		// проверка существования папки для копирования происходит внутри процесса копирования
		const fName = await window.electronAPI.invoke('pathBasename', fileFrom);
		useStatusBar_Store
			.getState()
			.setStatusBarState(`[${_description.mainFolderName}/${_description.projectName}] - copy file: ${fName} -> ${fileTo}`);

		await window.electronAPI.invoke('copyItem', fileFrom, fileTo, { overwrite: _item.overwriteOldest });
		if (_item.deleteAfter) {
			await window.electronAPI.invoke('deleteItem', fileFrom);
		}
		finalFile.push(fileTo);
	}

	return finalFile;
}
