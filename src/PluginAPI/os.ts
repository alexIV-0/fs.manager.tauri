// Полифил node:os для renderer'а. Минимальный набор того что используется в плагинах.

import { commands } from '@/Utils/specta';

let _tmpdirCache: string | null = null;

export async function tmpdir(): Promise<string> {
	// Sync-вызов в Node; в renderer всегда async. Плагин должен делать `await tmpdir()`.
	if (_tmpdirCache !== null) return _tmpdirCache;
	const dir = await commands.osTmpdir();
	_tmpdirCache = dir;
	return dir;
}

// Synchronous accessor: в Node возвращает строку; здесь — Promise. Плагин должен await.
export function tmpdirSync(): Promise<string> {
	return tmpdir();
}

export function type(): string {
	// navigator.platform теперь deprecated, но в WebView он надёжен.
	const p = (typeof navigator !== 'undefined' ? navigator.userAgent : '') ?? '';
	if (p.includes('Windows')) return 'Windows_NT';
	if (p.includes('Mac')) return 'Darwin';
	if (p.includes('Linux')) return 'Linux';
	return 'Unknown';
}

export function platform(): string {
	const t = type();
	if (t === 'Darwin') return 'darwin';
	if (t === 'Windows_NT') return 'win32';
	if (t === 'Linux') return 'linux';
	return 'unknown';
}

export function arch(): string {
	const ua = (typeof navigator !== 'undefined' ? navigator.userAgent : '') ?? '';
	if (ua.includes('arm64') || ua.includes('aarch64')) return 'arm64';
	return 'x64';
}

export function homedir(): string {
	// Этого нет надёжного способа получить из renderer'а; обычно плагины не используют.
	return '';
}

export function hostname(): string {
	return (typeof location !== 'undefined' ? location.hostname : 'localhost') || 'localhost';
}

export function endianness(): 'BE' | 'LE' {
	return 'LE';
}

export const EOL = '\n';

export default {
	tmpdir,
	tmpdirSync,
	type,
	platform,
	arch,
	homedir,
	hostname,
	endianness,
	EOL,
};
