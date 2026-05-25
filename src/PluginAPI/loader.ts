// Plugin loader для renderer'а. Динамически импортирует JS-модуль плагина через
// кастомный `plugin://` Tauri-протокол. Rust на лету переписывает `node:*` импорты
// на `@plugin-api/*` полифилы.
//
// Платформенная разница: в Tauri v2 кастомные URI-схемы доступны как `plugin://localhost/...`
// только на macOS/iOS. На Windows/Linux/Android WebView не поддерживает регистрацию
// произвольных схем — Tauri проксирует их через `http://plugin.localhost/...`.
// Используем `convertFileSrc(path, 'plugin')` — он строит правильный URL для каждой платформы.

import { convertFileSrc } from '@tauri-apps/api/core';

// Кэш только манифестов — JS-модуль плагина намеренно НЕ кэшируем (см. ниже).
const manifestCache = new Map<string, { mainFile: string }>();

function pluginUrl(relPath: string): string {
	// relPath: "<key>/<file>" — без ведущего слэша.
	return convertFileSrc(relPath.replace(/^\/+/, ''), 'plugin');
}

/**
 * Загружает плагин и возвращает его module-объект.
 *
 * Кэш module-instance'ов отключён: каждый вызов создаёт СВЕЖИЙ инстанс через
 * cache-bust URL (`?inst=...`). Это нужно потому, что плагин-бандл хранит
 * module-local `_bound`/`_sendToMW` (см. _template/tauri.ts, pluginSender.ts) —
 * туда processItem биндит per-execution sendToMW через onLoad. Без cache-bust
 * два параллельных запуска одного плагина делили бы один _bound, и логи второго
 * вызова уходили бы первому item'у. Парсинг плагина повторно — миллисекунды,
 * на фоне ffmpeg/HTTP незаметно.
 *
 * Манифест (plugin.json) при этом кэшируется — он маленький и не источник гонок.
 */
export async function loadPlugin(pluginId: string, version: string, execToken?: string): Promise<any> {
	const key = `${pluginId}@${version}`;

	let manifestEntry = manifestCache.get(key);
	if (!manifestEntry) {
		const manifestText = await fetchPluginText(`${key}/plugin.json`);
		const manifest = JSON.parse(manifestText);
		manifestEntry = { mainFile: manifest.main || `${pluginId}.js` };
		manifestCache.set(key, manifestEntry);
	}

	const baseUrl = pluginUrl(`${key}/${manifestEntry.mainFile}`);
	const token = execToken ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
	const moduleUrl = `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}inst=${encodeURIComponent(token)}`;
	// /* @vite-ignore */ — Vite не должен пытаться bundle'ить runtime-плагины
	const mod = await import(/* @vite-ignore */ moduleUrl);
	return mod;
}

export function clearPluginCache(pluginId?: string, version?: string): void {
	if (!pluginId) {
		manifestCache.clear();
		return;
	}
	if (!version) {
		for (const k of Array.from(manifestCache.keys())) {
			if (k.startsWith(`${pluginId}@`)) manifestCache.delete(k);
		}
		return;
	}
	manifestCache.delete(`${pluginId}@${version}`);
}

async function fetchPluginText(path: string): Promise<string> {
	const url = pluginUrl(path);
	const res = await fetch(url);
	if (!res.ok) throw new Error(`plugin:// fetch failed ${res.status} for ${path}`);
	return await res.text();
}
