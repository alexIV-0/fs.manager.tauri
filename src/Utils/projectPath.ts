// Конвертация путей между формой для UI/IPC (абсолютный) и формой для сохранения
// (относительный к корню проекта, если файл внутри проекта; иначе абсолютный).
// Делает флоу портативными — путь до файла, лежащего внутри проекта, не ломается
// при переносе/переименовании проектной папки.

function isAbsolutePath(p: string): boolean {
	if (!p) return false;
	return p.startsWith('/') || p.startsWith('\\\\') || /^[A-Za-z]:[\\/]/.test(p);
}

/** absolute → stored form: relative (без ведущего /) если внутри проекта, иначе absolute as-is. */
export function toStoredPath(absolutePath: string, projectPath: string): string {
	if (!absolutePath || !projectPath) return absolutePath;
	const normProject = projectPath.replace(/\\/g, '/').replace(/\/+$/, '');
	const normFile = absolutePath.replace(/\\/g, '/');
	const prefix = normProject.toLowerCase() + '/';
	if (normFile.toLowerCase().startsWith(prefix)) {
		return normFile.slice(normProject.length + 1);
	}
	return absolutePath;
}

/** stored → absolute: если уже absolute — возвращаем как есть; иначе джойним с projectPath. */
export function toAbsolutePath(storedPath: string, projectPath: string): string {
	if (!storedPath) return '';
	if (isAbsolutePath(storedPath)) return storedPath;
	if (!projectPath) return storedPath;
	const sep = projectPath.includes('\\') && !projectPath.includes('/') ? '\\' : '/';
	const base = projectPath.replace(/[\\/]+$/, '');
	const rel = storedPath.replace(/^[\\/]+/, '');
	return base + sep + rel;
}
