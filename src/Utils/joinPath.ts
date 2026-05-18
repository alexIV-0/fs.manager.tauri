// Чистый JS-аналог node:path.join для renderer-процесса.
// Заменяет IPC-вызов 'pathJoin' там, где он горячий (списки файлов/папок, hover-превью и т.п.).
// Поддерживает POSIX (/Users/...), Windows (C:\Users\...) и UNC (\\server\share\...).
// Разделитель определяется по входящему пути (наличию '\').
export function joinPath(...segments: string[]): string {
	const parts = segments.filter((s) => s != null && s !== '');
	if (parts.length === 0) return '';

	const usesBackslash = parts[0].includes('\\');
	const sep = usesBackslash ? '\\' : '/';

	// Сохраняем абсолютный prefix первого сегмента, чтобы он не потерялся при stripping'е.
	const first = parts[0];
	let prefix = '';
	if (first.startsWith('\\\\')) prefix = '\\\\'; // UNC
	else if (first.startsWith('/')) prefix = '/';
	else if (first.startsWith('\\')) prefix = '\\';

	const cleaned = parts
		.map((p, i) => {
			if (i === 0) return p.replace(/^[\\/]+/, '').replace(/[\\/]+$/, '');
			return p.replace(/^[\\/]+/, '').replace(/[\\/]+$/, '');
		})
		.filter((p) => p !== '');

	return prefix + cleaned.join(sep);
}
