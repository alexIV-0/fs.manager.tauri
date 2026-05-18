import { joinPath } from '@/Utils/joinPath';

export async function createPathFunc__(_item: any, _description: any) {
	let curPath = _item.path;
	if (_item.import.path) {
		curPath.unshift(..._item.import.path);
	}
	const path = joinPath(...curPath);
	const pathByPattern = await window.electronAPI.invoke('formatNameByPattern', {
		string: path,
		description: _description,
	});
	return pathByPattern;
}
