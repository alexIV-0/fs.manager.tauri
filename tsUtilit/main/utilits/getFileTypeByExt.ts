import path from 'path';

/** Определяет тип файла по его пути/имени, используя typeOfFile из description (стора). */
export function getFileTypeByExt(filePath: string, typeOfFile: Record<string, string[]>): string {
	const raw = path.extname(filePath);
	const clean = raw.startsWith('.') ? raw.slice(1).toLowerCase() : raw.toLowerCase();

	for (const [key, extensions] of Object.entries(typeOfFile)) {
		if (extensions.includes(clean)) return key;
	}

	return 'files';
}
