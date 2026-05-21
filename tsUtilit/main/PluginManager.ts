// PluginManager.ts
import fs from 'fs/promises';
import path from 'path';
import { pluginsPath } from './fileSistem/getOptionsFolder';
import { LoadedPlugin, PluginManifest, PluginInfo, PluginUINode, ExtendedPluginUINode } from '@/types/electron';
import { sendToMW } from './utilits/senderLogToMainWin';
import AdmZip from 'adm-zip';
import { ensurePluginCostDefault, setPluginCost as saveCostToSettings } from './settings/pluginCosts';

export class PluginManager {
	private plugins = new Map<string, LoadedPlugin>();
	// Кэш разобранного ui.json — заполняется при первом запросе getPluginUIData,
	// сбрасывается при load/unload/install/delete плагина.
	private uiCache = new Map<string, ExtendedPluginUINode | null>();
	private pluginsPath: string;
	private readonly apiVersion = 1;
	private readonly isDev: boolean;

	constructor(isDev: boolean) {
		this.isDev = isDev;

		// В режиме dev берем плагины из папки plugins-dev
		if (this.isDev) {
			this.pluginsPath = path.join(process.cwd(), 'distr-plugins');
		} else {
			// В production — из Application Support
			this.pluginsPath = pluginsPath;
		}
	}

	/* ================= INIT ================= */
	async initialize() {
		await fs.mkdir(this.pluginsPath, { recursive: true });
		await this.loadAllPlugins();
	}

	/* ================= LOAD ALL ================= */
	private async loadAllPlugins() {
		const entries = await fs.readdir(this.pluginsPath, { withFileTypes: true });
		for (const entry of entries) {
			if (!entry.isDirectory()) continue;
			if (!entry.name.includes('@')) continue;

			try {
				await this.loadPlugin(entry.name);
			} catch (err) {
				console.error(`[PluginManager] Failed to load ${entry.name}`, err);
			}
		}
	}

	/* ================= LOAD ONE ================= */
	async loadPlugin(folderName: string) {
		console.log(`[PluginManager] Loading plugin from folder: ${folderName}`);
		const pluginPath = path.join(this.pluginsPath, folderName);
		const manifestPath = path.join(pluginPath, 'plugin.json');

		const manifest: PluginManifest = JSON.parse(await fs.readFile(manifestPath, 'utf-8'));

		// API version check
		if (manifest.apiVersion !== this.apiVersion) {
			throw new Error(`API version mismatch: plugin=${manifest.apiVersion}, app=${this.apiVersion}`);
		}

		const key = `${manifest.id}@${manifest.version}`;
		if (this.plugins.has(key)) return;

		// Первый импорт → записываем дефолты из plugin.json.
		// Повторный импорт (переустановка) → берём уже сохранённые пользователем значения.
		const storedCost = ensurePluginCostDefault(key, {
			cost: manifest.cost ?? '0',
			costUnit: manifest.costUnit ?? 'run',
		});
		manifest.cost = storedCost.cost;
		manifest.costUnit = storedCost.costUnit;

		if (!manifest.main) {
			throw new Error(`Plugin ${key} has no "main" entry`);
		}

		const entryPath = path.join(pluginPath, manifest.main);

		// cache-busting только для dev
		const module = this.isDev ? await import(`file://${entryPath}?t=${Date.now()}`) : await import(`file://${entryPath}`);

		const plugin = module.default ?? module;

		if (typeof plugin.onLoad === 'function') {
			await plugin.onLoad(this.createPluginAPI(manifest, pluginPath));
		}

		this.plugins.set(key, {
			key,
			id: manifest.id,
			version: manifest.version,
			manifest,
			module: plugin,
			path: pluginPath,
		});

		// При (пере)загрузке плагина сбрасываем закэшированный ui.json — на диске мог измениться.
		this.uiCache.delete(key);

		console.log(`[PluginManager] Loaded ${key}`);
	}

	/* ================= API ================= */
	private createPluginAPI(manifest: PluginManifest, pluginPath: string) {
		return {
			pluginId: manifest.id,
			version: manifest.version,
			log: (...args: any[]) => {
				console.log(`[Plugin:${manifest.id}@${manifest.version}]`, ...args);
			},
			getPluginPath: () => pluginPath,
			sendToMW, //<-- ТУТ?
		};
	}

	/* ================= GET ALL PLUGINS INFO ================= */
	getAllPluginsInfo(): PluginInfo[] {
		return Array.from(this.plugins.values()).map((plugin) => ({
			id: plugin.id,
			version: plugin.version,
			name: plugin.manifest.name,
			description: plugin.manifest.description,
			type: plugin.manifest.type,
			hasUI: Boolean(plugin.manifest.ui && plugin.manifest.ui.trim() !== ''),
			path: plugin.path,
			manifest: plugin.manifest,
			uiType: null, // <-- ПОКА null, заполним ниже
		}));
	}

	/* ================= GET PLUGINS BY TYPE ================= */
	getPluginsByType(type: string): PluginInfo[] {
		return this.getAllPluginsInfo().filter((plugin) => Array.isArray(plugin.type) && plugin.type.includes(type));
	}

	/* ================= GET PLUGIN UI DATA ================= */
	async getPluginUIData(pluginId: string, version: string): Promise<ExtendedPluginUINode | null> {
		const key = `${pluginId}@${version}`;

		// Кэш: повторный запрос отдаёт распарсенный объект без обращения к диску.
		if (this.uiCache.has(key)) {
			return this.uiCache.get(key) ?? null;
		}

		const plugin = this.plugins.get(key);

		if (!plugin) {
			console.error(`Plugin not found: ${key}`);
			return null;
		}

		if (!plugin.manifest.ui || plugin.manifest.ui.trim() === '') {
			this.uiCache.set(key, null);
			return null;
		}

		const uiPath = path.join(plugin.path, plugin.manifest.ui as string); // <-- Приводим к string
		try {
			const raw = await fs.readFile(uiPath, 'utf-8');
			const uiData = JSON.parse(raw);

			// Добавляем метаданные плагина в корень объекта
			const result: ExtendedPluginUINode = {
				...uiData,
				pluginId: plugin.id,
				pluginVersion: plugin.version,
				pluginPath: plugin.path,
				pluginName: plugin.manifest.name,
				uiType: uiData.data?.colorType || null, // <-- ДОБАВЛЯЕМ uiType
				cost: plugin.manifest.cost ?? '0',
				costUnit: plugin.manifest.costUnit ?? 'run',
			};
			this.uiCache.set(key, result);
			return result;
		} catch (err) {
			console.error(`[PluginManager] Failed to load UI for ${key}`, err);
			return null;
		}
	}

	/* ================= GET ALL UI NODES ================= */
	async getAllUINodes(): Promise<PluginUINode[]> {
		// Параллельное чтение ui.json всех плагинов — было N последовательных await,
		// при 20 плагинах это ~200мс впустую. После прогрева большинство хитов в кэш.
		const candidates = Array.from(this.plugins.values()).filter(
			(p) => p.manifest.ui && p.manifest.ui.trim() !== '',
		);
		const results = await Promise.all(
			candidates.map((p) =>
				this.getPluginUIData(p.id, p.version).catch((err) => {
					console.error(`[PluginManager] Failed to load UI for ${p.key}`, err);
					return null;
				}),
			),
		);
		return results.filter((r): r is ExtendedPluginUINode => r !== null);
	}

	/* ================= CALL ================= */
	async call(pluginId: string, version: string, method: string, ...args: any[]) {
		const key = `${pluginId}@${version}`;
		const plugin = this.plugins.get(key);

		if (!plugin) throw new Error(`Plugin not loaded: ${key}`);

		const fn = plugin.module[method];
		if (typeof fn !== 'function') throw new Error(`Method "${method}" not found in plugin ${key}`);

		return await fn(...args);
	}

	/* ================= CALL DEFAULT (без указания имени функции) ================= */
	async callDefault(pluginId: string, version: string, ...args: any[]) {
		const key = `${pluginId}@${version}`;
		const plugin = this.plugins.get(key);

		if (!plugin) throw new Error(`Plugin not loaded: ${key}`);

		// Ищем дефолтный экспорт или первую доступную функцию
		const module = plugin.module;

		// Вариант 1: Если есть default export и это функция
		if (typeof module.default === 'function') {
			return await module.default(...args);
		}

		// Вариант 2: Если сам module это функция (export default function)
		if (typeof module === 'function') {
			return await module(...args);
		}

		// Вариант 3: первая функция, исключая служебные
		const reserved = ['onLoad', 'onUnload'];
		const functionNames = Object.keys(module).filter((key) => typeof module[key] === 'function' && !reserved.includes(key));

		if (functionNames.length > 0) {
			console.log(`[PluginManager] Using function: ${functionNames[0]}`);
			return await module[functionNames[0]](...args);
		}

		throw new Error(`No callable function found in plugin ${key}`);
	}

	/* ================= SET COST ================= */
	// Сохраняет cost/costUnit в settings/pluginCosts.json (не трогает plugin.json).
	// Возвращает обновлённый PluginInfo, чтобы renderer мог синхронизировать стор.
	setPluginCost(pluginId: string, version: string, cost: string, costUnit: string): PluginInfo | null {
		const key = `${pluginId}@${version}`;
		const plugin = this.plugins.get(key);
		if (!plugin) {
			console.error(`[PluginManager] setPluginCost: plugin not loaded ${key}`);
			return null;
		}

		saveCostToSettings(key, { cost, costUnit });

		// Обновляем manifest в памяти, чтобы новые вызовы getAllUINodes отдавали актуальную цену.
		plugin.manifest.cost = cost;
		plugin.manifest.costUnit = costUnit;
		this.uiCache.delete(key);

		return this.getAllPluginsInfo().find((p) => p.id === pluginId && p.version === version) ?? null;
	}

	/* ================= UNLOAD ================= */
	async unloadPlugin(pluginId: string, version: string) {
		const key = `${pluginId}@${version}`;
		const plugin = this.plugins.get(key);
		if (!plugin) return;

		if (typeof plugin.module.onUnload === 'function') {
			await plugin.module.onUnload();
		}

		this.plugins.delete(key);
		this.uiCache.delete(key);
	}

	/* ================= INFO ================= */
	listPlugins() {
		return Array.from(this.plugins.values()).map((p) => ({
			id: p.id,
			version: p.version,
			name: p.manifest.name,
			description: p.manifest.description,
			type: p.manifest.type,
		}));
	}

	/* ================= GET UI NODES (для обратной совместимости) ================= */
	async getUINodes(): Promise<PluginUINode[]> {
		console.warn('[PluginManager] getUINodes() is deprecated, use getAllUINodes() instead');
		return this.getAllUINodes();
	}

	/* ================= GETTERS ================= */
	getPlugins() {
		return this.listPlugins();
	}

	getPlugin(pluginId: string, version?: string) {
		if (version) {
			return this.plugins.get(`${pluginId}@${version}`);
		}
		// Если версия не указана, возвращаем последнюю
		const matches = Array.from(this.plugins.values()).filter((p) => p.id === pluginId);
		if (!matches.length) return null;
		return matches.sort((a, b) => b.version.localeCompare(a.version))[0];
	}

	/* ================= DESTROY ================= */
	async destroy() {
		for (const plugin of this.plugins.values()) {
			if (typeof plugin.module.onUnload === 'function') {
				await plugin.module.onUnload();
			}
		}
		this.plugins.clear();
		this.uiCache.clear();
	}

	/* ================= INSTALL PLUGIN FROM .fsmplug ================= */
	async installPlugin(filePath: string): Promise<PluginInfo> {
		console.log(`[PluginManager] Installing plugin from: ${filePath}`);

		// Распаковываем zip во временную папку, читаем манифест
		const zip = new AdmZip(filePath);
		const zipEntries = zip.getEntries();

		// Ищем plugin.json в архиве (может быть на любом уровне вложенности)
		const manifestEntry = zipEntries.find((e) => e.entryName.endsWith('plugin.json'));
		if (!manifestEntry) {
			throw new Error('Invalid plugin file: plugin.json not found');
		}

		const manifest: PluginManifest = JSON.parse(manifestEntry.getData().toString('utf-8'));

		// Проверяем API version
		if (manifest.apiVersion !== this.apiVersion) {
			throw new Error(`API version mismatch: plugin=${manifest.apiVersion}, app=${this.apiVersion}`);
		}

		const folderName = `${manifest.id}@${manifest.version}`;
		const destPath = path.join(this.pluginsPath, folderName);

		// Если уже установлен — удаляем старую версию
		try {
			await fs.rm(destPath, { recursive: true, force: true });
		} catch {}

		await fs.mkdir(destPath, { recursive: true });

		// Извлекаем все файлы, срезая корневую папку из архива
		// Определяем общий префикс (корневая папка в архиве)
		const prefix = manifestEntry.entryName.replace('plugin.json', '');

		for (const entry of zipEntries) {
			if (entry.isDirectory) continue;

			// Срезаем префикс чтобы получить относительный путь
			const relativePath = entry.entryName.startsWith(prefix) ? entry.entryName.slice(prefix.length) : entry.entryName;

			if (!relativePath) continue;

			const outPath = path.join(destPath, relativePath);
			await fs.mkdir(path.dirname(outPath), { recursive: true });
			await fs.writeFile(outPath, entry.getData());
		}

		console.log(`[PluginManager] Extracted to: ${destPath}`);

		// Загружаем плагин
		await this.loadPlugin(folderName);

		// Возвращаем инфо о плагине
		const loaded = this.plugins.get(folderName);
		if (!loaded) throw new Error(`Plugin loaded but not found in map: ${folderName}`);

		const info = this.getAllPluginsInfo().find((p) => `${p.id}@${p.version}` === folderName);
		if (!info) throw new Error(`PluginInfo not found after install: ${folderName}`);

		return info;
	}

	/* ================= DELETE PLUGIN FROM DISK ================= */
	async deletePlugin(pluginId: string, version: string): Promise<void> {
		const key = `${pluginId}@${version}`;

		// Сначала выгружаем если загружен
		if (this.plugins.has(key)) {
			await this.unloadPlugin(pluginId, version);
		}
		this.uiCache.delete(key);

		// Удаляем папку с диска
		const folderName = key;
		const pluginPath = path.join(this.pluginsPath, folderName);

		try {
			await fs.rm(pluginPath, { recursive: true, force: true });
			console.log(`[PluginManager] Deleted plugin from disk: ${pluginPath}`);
		} catch (err) {
			console.error(`[PluginManager] Failed to delete plugin folder: ${pluginPath}`, err);
			throw err;
		}
	}
}
