// Plugin loader для renderer'а. Динамически импортирует JS-модуль плагина через
// кастомный `plugin://` Tauri-протокол. Rust на лету переписывает `node:*` импорты
// на `@plugin-api/*` полифилы.

const cache = new Map<string, any>();

/**
 * Загружает плагин и возвращает его module-объект.
 * Кэшируется по ключу `id@version` — повторные вызовы мгновенные.
 *
 * Чтобы перезагрузить плагин в dev (после ребилда) — вызвать `clearPluginCache(id, version)`.
 */
export async function loadPlugin(pluginId: string, version: string): Promise<any> {
	const key = `${pluginId}@${version}`;
	const cached = cache.get(key);
	if (cached) return cached;

	// Главный файл плагина — обычно `<id>.js` (см. plugin.json[main]).
	// Просим Tauri через plugin:// — он зарезолвит путь и сам выберет main.
	// Конвенция URL: plugin://localhost/<key>/<main-file>
	// Для упрощения сначала читаем manifest, чтобы узнать main.
	const manifestText = await fetchPluginText(`/${key}/plugin.json`);
	const manifest = JSON.parse(manifestText);
	const mainFile: string = manifest.main || `${pluginId}.js`;

	const moduleUrl = `plugin://localhost/${key}/${mainFile}`;
	// /* @vite-ignore */ — Vite не должен пытаться bundle'ить runtime-плагины
	const mod = await import(/* @vite-ignore */ moduleUrl);
	cache.set(key, mod);
	console.log(`[PluginLoader] Loaded ${key} via ${moduleUrl}`);
	return mod;
}

export function clearPluginCache(pluginId?: string, version?: string): void {
	if (!pluginId) {
		cache.clear();
		return;
	}
	if (!version) {
		// Очищаем все версии плагина
		for (const k of Array.from(cache.keys())) {
			if (k.startsWith(`${pluginId}@`)) cache.delete(k);
		}
		return;
	}
	cache.delete(`${pluginId}@${version}`);
}

async function fetchPluginText(path: string): Promise<string> {
	const url = `plugin://localhost${path}`;
	const res = await fetch(url);
	if (!res.ok) throw new Error(`plugin:// fetch failed ${res.status} for ${path}`);
	return await res.text();
}
