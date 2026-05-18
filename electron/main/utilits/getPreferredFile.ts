type ImportFiles = Record<string, string[]>;

export function getPreferredFile(_import: ImportFiles, _description: any): string | undefined {
	const priority = ['video', 'audio', 'text', 'image', 'title', 'aep', 'moho', 'xlsx'];

	const getExt = (file: string) => file.split('.').pop()?.toLowerCase() ?? '';

	const allFiles = Object.values(_import).flat();

	if (!allFiles.length) return undefined;

	for (const type of priority) {
		const exts = _description.typeOfFile[type];
		if (!exts) continue;

		const found = allFiles.find((file) => exts.includes(getExt(file)));
		if (found) return found;
	}

	// если ничего из приоритетных не найдено
	return allFiles[0];
}
