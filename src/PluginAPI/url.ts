// Полифил node:url — минимально, для fileURLToPath.

export function fileURLToPath(url: string | URL): string {
	const u = typeof url === 'string' ? new URL(url) : url;
	if (u.protocol !== 'file:') {
		throw new Error('Expected file:// URL');
	}
	let p = decodeURIComponent(u.pathname);
	// Windows path: file:///C:/... → /C:/... → C:/... (убираем ведущий /)
	if (/^\/[a-zA-Z]:/.test(p)) p = p.slice(1);
	return p;
}

export function pathToFileURL(p: string): URL {
	let absPath = p;
	if (!p.startsWith('/') && !/^[a-zA-Z]:/.test(p)) {
		absPath = '/' + p;
	}
	const encoded = absPath.split(/[\\/]/).map(encodeURIComponent).join('/');
	return new URL('file://' + encoded);
}

export { URL, URLSearchParams };

export default { fileURLToPath, pathToFileURL, URL, URLSearchParams };
