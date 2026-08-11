// Plugin loader для renderer'а. Динамически импортирует JS-модуль плагина через
// кастомный `plugin://` Tauri-протокол. Rust на лету переписывает `node:*` импорты
// на `@plugin-api/*` полифилы.
//
// Платформенная разница: в Tauri v2 кастомные URI-схемы доступны как `plugin://localhost/...`
// только на macOS/iOS. На Windows/Linux/Android WebView не поддерживает регистрацию
// произвольных схем — Tauri проксирует их через `http://plugin.localhost/...`.
// Используем `convertFileSrc(path, 'plugin')` — он строит правильный URL для каждой платформы.

import { convertFileSrc } from '@tauri-apps/api/core';

const manifestCache = new Map<string, { mainFile: string }>();

// Кэш module-instance'ов для плагинов НОВОГО стиля (без `onLoad`), см. loadPlugin.
const moduleCache = new Map<string, any>();

function pluginUrl(relPath: string): string {
	// relPath: "<key>/<file>" — без ведущего слэша.
	return convertFileSrc(relPath.replace(/^\/+/, ''), 'plugin');
}

/**
 * Загружает плагин и возвращает его module-объект.
 *
 * Два режима, и определяются они по наличию экспорта `onLoad`:
 *
 * • НОВЫЙ стиль (нет `onLoad`) — плагин берёт `sendToMW` и host-сервисы из
 *   третьего аргумента (`ctx`), module-local состояния у него нет. Значит инстанс
 *   можно переиспользовать: кэшируем и грузим один раз.
 *
 * • СТАРЫЙ стиль (есть `onLoad`) — бандл хранит module-local `_bound`, куда
 *   processItem биндит per-execution `sendToMW`. Два параллельных вызова одного
 *   плагина делили бы этот `_bound`, и логи второго уходили бы первому item'у.
 *   Поэтому для таких плагинов сохраняем cache-bust: свежий инстанс на вызов.
 *
 * Почему это важно, а не косметика: ES-модули, загруженные динамическим импортом,
 * НЕЛЬЗЯ выгрузить — module map держит их до перезагрузки окна. Прогон 500 файлов
 * через 5 нод оставлял 2500 забытых копий бандла. Для новых плагинов копия одна.
 *
 * Оговорка: на первом параллельном всплеске (несколько item'ов стартуют разом, кэш
 * ещё пуст) создастся до N инстансов по числу параллельных вызовов, дальше живёт
 * один. Дедуплицировать in-flight промисом нельзя: для СТАРОГО стиля это вернуло бы
 * ровно ту гонку за `_bound`, от которой защищает cache-bust, а стиль известен
 * только после загрузки. Потолок N на плагин за сессию — приемлемо.
 *
 * Манифест (plugin.json) кэшируется всегда — он маленький и не источник гонок.
 */
export async function loadPlugin(pluginId: string, version: string, execToken?: string): Promise<any> {
	const key = `${pluginId}@${version}`;

	const cached = moduleCache.get(key);
	if (cached) return cached;

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

	// Кэшируем только плагины без module-local состояния. Наличие `onLoad` —
	// признак старого стиля: там состояние есть, переиспользовать нельзя.
	if (typeof mod?.onLoad !== 'function') {
		moduleCache.set(key, mod);
	}
	return mod;
}

/**
 * Сбрасывает кэши плагина. Чистить ОБА обязательно: после пересборки через
 * PluginBuilder (`plugin_build`) закэшированный module-instance иначе продолжит
 * отдавать старый код, и правка «не применится» без перезапуска окна.
 *
 * Полностью выгрузить старый инстанс из module map браузера нельзя — но
 * следующий `loadPlugin` создаст новый по cache-bust URL и закэширует уже его.
 */
export function clearPluginCache(pluginId?: string, version?: string): void {
	if (!pluginId) {
		manifestCache.clear();
		moduleCache.clear();
		return;
	}
	if (!version) {
		for (const k of Array.from(manifestCache.keys())) {
			if (k.startsWith(`${pluginId}@`)) manifestCache.delete(k);
		}
		for (const k of Array.from(moduleCache.keys())) {
			if (k.startsWith(`${pluginId}@`)) moduleCache.delete(k);
		}
		return;
	}
	manifestCache.delete(`${pluginId}@${version}`);
	moduleCache.delete(`${pluginId}@${version}`);
}

async function fetchPluginText(path: string): Promise<string> {
	const url = pluginUrl(path);
	const res = await fetch(url);
	if (!res.ok) throw new Error(`plugin:// fetch failed ${res.status} for ${path}`);
	return await res.text();
}
