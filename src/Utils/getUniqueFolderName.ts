export function getUniqueFolderName(newName: string, existingNamesArr: string[]): string {
	console.log(existingNamesArr);
	if (existingNamesArr.length == 0 || !existingNamesArr.includes(newName)) return newName;

	let i = 1;
	let candidate = `${newName} (${i})`;
	while (existingNamesArr.includes(candidate)) {
		i += 1;
		candidate = `${newName} (${i})`;
	}
	return candidate;
}
