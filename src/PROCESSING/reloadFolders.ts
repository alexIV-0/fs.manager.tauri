export async function reloadFolders(_obj: any) {
	const foldersArr: string[] = (
		await (window as any).electronAPI.invoke('getSomeFromFolder', _obj.path, [{ type: 'folders', ext: [] }])
	).folders;
	const oldProjects = _obj.projectFolders || [];
	// 4. Оставляем только те, что есть в новом массиве
	const kept = oldProjects.filter((name: string) => foldersArr.includes(name));

	// 5. Добавляем новые, которых не было
	const existingSet = new Set(kept);
	const newOnes = foldersArr.filter((name) => !existingSet.has(name));

	const finalArr = [...kept, ...newOnes];

	return finalArr;
}
