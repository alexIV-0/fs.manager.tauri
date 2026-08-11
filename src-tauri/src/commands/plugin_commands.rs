use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

// ==================== TYPES ====================

fn default_cost() -> String {
    "0".to_string()
}

fn default_cost_unit() -> String {
    "run".to_string()
}

#[derive(Debug, Serialize, Deserialize, Clone, specta::Type)]
pub struct PluginManifest {
    pub id: String,
    pub name: String,
    pub description: String,
    pub version: String,
    #[serde(rename = "apiVersion")]
    pub api_version: i32,
    #[serde(rename = "type")]
    pub plugin_type: Vec<String>,
    pub main: String,
    pub ui: Option<serde_json::Value>,
    pub external: Vec<String>,
    // Централизованная цена ноды. Хранится в plugin.json, редактируется в Settings → Plugins,
    // подтягивается во все флоу через syncCostsFromManifest. Старые plugin.json без этих полей
    // получают дефолты (serde(default)).
    #[serde(default = "default_cost")]
    pub cost: String,
    #[serde(rename = "costUnit", default = "default_cost_unit")]
    pub cost_unit: String,
    // Ресурсный пул (local/online/ffmpeg/helpers). Если не задан — фронт берёт дефолт
    // по colorType. Прокидывается в processItem для резолва семафора пула.
    #[serde(rename = "resourcePool", default)]
    pub resource_pool: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, specta::Type)]
pub struct PluginInfo {
    pub id: String,
    pub version: String,
    pub name: String,
    pub description: String,
    #[serde(rename = "type")]
    pub plugin_type: Vec<String>,
    #[serde(rename = "hasUI")]
    pub has_ui: bool,
    pub path: String,
    pub manifest: PluginManifest,
    #[serde(rename = "uiType")]
    pub ui_type: Option<String>,
    // Дублируем cost/costUnit на верхний уровень, чтобы фронтенд читал их напрямую
    // (plugin_store строит PluginItem из этих полей), а не лез в manifest.
    pub cost: String,
    #[serde(rename = "costUnit")]
    pub cost_unit: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, specta::Type)]
pub struct PluginUINode {
    pub id: String,
    #[serde(rename = "type")]
    pub node_type: String,
    pub position: serde_json::Value,
    pub width: f64,
    pub height: f64,
    #[serde(default)]
    pub plugin_id: Option<String>,
    #[serde(default)]
    pub plugin_version: Option<String>,
    #[serde(default)]
    pub plugin_path: Option<String>,
    #[serde(default)]
    pub plugin_name: Option<String>,
    #[serde(default)]
    pub ui_type: Option<String>,
    pub data: serde_json::Value,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LoadedPlugin {
    pub key: String,
    pub id: String,
    pub version: String,
    pub manifest: PluginManifest,
    pub path: String,
}

// ==================== PLUGIN MANAGER STATE ====================

pub struct PluginManagerState {
    pub plugins: HashMap<String, LoadedPlugin>,
    pub plugins_path: PathBuf,
    pub is_dev: bool,
    pub api_version: i32,
}

impl PluginManagerState {
    pub fn new(is_dev: bool, app_data_dir: PathBuf) -> Self {
        let plugins_path = if is_dev {
            // В dev режиме - distr-plugins в корне проекта
            // current_dir() указывает на src-tauri/, поднимаемся на уровень выше
            std::env::current_dir()
                .unwrap_or(app_data_dir.clone())
                .parent()
                .map(|p| p.to_path_buf())
                .unwrap_or(app_data_dir.clone())
                .join("distr-plugins")
        } else {
            app_data_dir.join("plugins")
        };

        Self {
            plugins: HashMap::new(),
            plugins_path,
            is_dev,
            api_version: 1,
        }
    }
}

// ==================== INITIALIZATION ====================

#[tauri::command]
#[specta::specta]
#[allow(unused_variables)]
pub fn plugin_manager_init(
    state: tauri::State<'_, std::sync::Mutex<PluginManagerState>>,
    app: tauri::AppHandle,
) -> Result<bool, String> {
    // Загружаем все плагины
    {
        let state_guard = state.lock().map_err(|e| e.to_string())?;

        // Защита от повторной инициализации: если плагины уже загружены —
        // выходим молча. Иначе при открытии каждого окна (main/nodeWin/preview/log)
        // мы бы перечитывали все плагины и спамили в консоль.
        if !state_guard.plugins.is_empty() {
            return Ok(true);
        }

        let plugins_path = state_guard.plugins_path.clone();
        let api_version = state_guard.api_version;
        let is_dev = state_guard.is_dev;

        println!("[PluginManager] ========== INIT ==========");
        println!("[PluginManager] is_dev: {}", is_dev);
        println!("[PluginManager] plugins_path: {}", plugins_path.display());
        println!("[PluginManager] plugins_path exists: {}", plugins_path.exists());
        
        drop(state_guard);

        // Создаём директорию плагинов (зависит от режима)
        if is_dev {
            // В dev режиме - distr-plugins в корне проекта
            if !plugins_path.exists() {
                fs::create_dir_all(&plugins_path).map_err(|e| e.to_string())?;
                println!("[PluginManager] Created dev plugins dir: {}", plugins_path.display());
            }
            // Листинг директории
            if let Ok(entries) = fs::read_dir(&plugins_path) {
                for entry in entries {
                    if let Ok(e) = entry {
                        println!("[PluginManager] Found: {:?}", e.file_name());
                    }
                }
            }
        } else {
            // В prod режиме - app_data/plugins
            fs::create_dir_all(&plugins_path).map_err(|e| e.to_string())?;
        }

        let mut state_guard = state.lock().map_err(|e| e.to_string())?;
        println!("[PluginManager] Calling load_all_plugins...");
        load_all_plugins(&mut state_guard, &plugins_path, api_version)?;
        println!("[PluginManager] Total loaded plugins: {}", state_guard.plugins.len());
        println!("[PluginManager] ========== END INIT ==========");
    }

    Ok(true)
}

pub(crate) fn load_all_plugins(state: &mut PluginManagerState, plugins_path: &PathBuf, api_version: i32) -> Result<(), String> {
    if !plugins_path.exists() {
        fs::create_dir_all(plugins_path).map_err(|e| e.to_string())?;
        return Ok(());
    }

    let entries = fs::read_dir(plugins_path).map_err(|e| e.to_string())?;

    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();

        if !path.is_dir() {
            continue;
        }

        let folder_name = path.file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();

        // Пропускаем скрытые и системные файлы
        if folder_name.starts_with('.') || !folder_name.contains('@') {
            continue;
        }

        match load_plugin_internal(state, &path, &folder_name, api_version) {
            Ok(_) => println!("[PluginManager] Loaded {}", folder_name),
            Err(e) => eprintln!("[PluginManager] Failed to load {}: {}", folder_name, e),
        }
    }

    Ok(())
}

fn load_plugin_internal(
    state: &mut PluginManagerState,
    plugin_path: &PathBuf,
    folder_name: &str,
    api_version: i32,
) -> Result<(), String> {
    let manifest_path = plugin_path.join("plugin.json");
    
    if !manifest_path.exists() {
        return Err(format!("plugin.json not found in {}", folder_name));
    }

    let manifest_str = fs::read_to_string(&manifest_path).map_err(|e| e.to_string())?;
    let manifest: PluginManifest = serde_json::from_str(&manifest_str).map_err(|e| e.to_string())?;

    // API version check
    if manifest.api_version != api_version {
        return Err(format!(
            "API version mismatch: plugin={}, app={}",
            manifest.api_version, api_version
        ));
    }

    if manifest.main.is_empty() {
        return Err(format!("Plugin {}@{} has no \"main\" entry", manifest.id, manifest.version));
    }

    let key = format!("{}@{}", manifest.id, manifest.version);
    
    if state.plugins.contains_key(&key) {
        return Ok(()); // Уже загружен
    }

    let entry_path = plugin_path.join(&manifest.main);
    if !entry_path.exists() {
        return Err(format!("Main file not found: {:?}", entry_path));
    }

    let plugin = LoadedPlugin {
        key: key.clone(),
        id: manifest.id.clone(),
        version: manifest.version.clone(),
        manifest: manifest.clone(),
        path: plugin_path.to_string_lossy().to_string(),
    };

    state.plugins.insert(key, plugin);

    Ok(())
}


/// Проверяет, что строка — ОДИН компонент пути, годный как имя папки плагина.
///
/// Имя папки плагина всегда имеет вид `<id>@<version>`, то есть ровно один компонент.
/// Но собиралось оно из строк, пришедших по IPC, и уходило в `plugins_path.join(...)`
/// без всякой проверки — в том числе в `plugin_manager_delete`, где дальше стоит
/// `fs::remove_dir_all`.
///
/// Произвольное удаление через это не выходит: `@` между id и версией всегда попадает
/// внутрь одного из компонентов и ломает traversal, так что понадобилась бы реально
/// существующая папка с `@` в имени. То есть подтверждённой уязвимости здесь нет.
/// Но непроверенная склейка пути, ведущая в рекурсивное удаление, — плохая ставка:
/// инвариант очевиден, а проверка стоит пять строк.
fn validate_path_component(value: &str, what: &str) -> Result<(), String> {
    if value.is_empty() {
        return Err(format!("{} пустой", what));
    }
    if value.contains('/') || value.contains('\\') {
        return Err(format!("{} не может содержать разделители пути: {:?}", what, value));
    }
    if value == ".." || value == "." {
        return Err(format!("{} недопустим: {:?}", what, value));
    }
    Ok(())
}

// ==================== LOAD SINGLE PLUGIN ====================

#[tauri::command]
#[specta::specta]
pub fn plugin_manager_load_plugin(
    folder_name: String,
    state: tauri::State<'_, std::sync::Mutex<PluginManagerState>>,
) -> Result<bool, String> {
    validate_path_component(&folder_name, "folder_name")?;

    let mut state = state.lock().map_err(|e| e.to_string())?;

    let plugin_path = state.plugins_path.join(&folder_name);
    
    if !plugin_path.exists() {
        return Err(format!("Plugin folder not found: {}", folder_name));
    }

    let api_version = state.api_version;
    load_plugin_internal(&mut state, &plugin_path, &folder_name, api_version)?;
    
    Ok(true)
}

// ==================== UNLOAD PLUGIN ====================

#[tauri::command]
#[specta::specta]
pub fn plugin_manager_unload_plugin(
    plugin_id: String,
    version: String,
    state: tauri::State<'_, std::sync::Mutex<PluginManagerState>>,
) -> Result<bool, String> {
    let mut state = state.lock().map_err(|e| e.to_string())?;
    let key = format!("{}@{}", plugin_id, version);
    
    if state.plugins.remove(&key).is_some() {
        println!("[PluginManager] Unloaded {}", key);
        Ok(true)
    } else {
        Err(format!("Plugin not found: {}", key))
    }
}

// ==================== GET ALL PLUGINS INFO ====================

#[tauri::command]
#[specta::specta]
pub fn plugin_manager_get_all_plugins(
    state: tauri::State<'_, std::sync::Mutex<PluginManagerState>>,
) -> Result<Vec<PluginInfo>, String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    
    let info: Vec<PluginInfo> = state.plugins.values().map(|plugin| PluginInfo {
        id: plugin.id.clone(),
        version: plugin.version.clone(),
        name: plugin.manifest.name.clone(),
        description: plugin.manifest.description.clone(),
        plugin_type: plugin.manifest.plugin_type.clone(),
        has_ui: plugin.manifest.ui.as_ref()
            .and_then(|v| v.as_str())
            .map(|s| !s.trim().is_empty())
            .unwrap_or(false),
        path: plugin.path.clone(),
        manifest: plugin.manifest.clone(),
        ui_type: None,
        cost: plugin.manifest.cost.clone(),
        cost_unit: plugin.manifest.cost_unit.clone(),
    }).collect();

    Ok(info)
}

// ==================== GET PLUGINS BY TYPE ====================

#[tauri::command]
#[specta::specta]
pub fn plugin_manager_get_plugins_by_type(
    plugin_type: String,
    state: tauri::State<'_, std::sync::Mutex<PluginManagerState>>,
) -> Result<Vec<PluginInfo>, String> {
    let all = plugin_manager_get_all_plugins(state)?;
    
    Ok(all.into_iter()
        .filter(|p| p.plugin_type.contains(&plugin_type))
        .collect())
}

// ==================== GET PLUGIN ====================

#[tauri::command]
#[specta::specta]
pub fn plugin_manager_get_plugin(
    plugin_id: String,
    version: Option<String>,
    state: tauri::State<'_, std::sync::Mutex<PluginManagerState>>,
) -> Result<Option<PluginInfo>, String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    
    let plugin = if let Some(ver) = version {
        let key = format!("{}@{}", plugin_id, ver);
        state.plugins.get(&key)
    } else {
        // Возвращаем последнюю версию
        let matches: Vec<&LoadedPlugin> = state.plugins.values()
            .filter(|p| p.id == plugin_id)
            .collect();
        
        if matches.is_empty() {
            None
        } else {
            let mut sorted = matches.clone();
            sorted.sort_by(|a, b| b.version.cmp(&a.version));
            sorted.first().copied()
        }
    };

    Ok(plugin.map(|p| PluginInfo {
        id: p.id.clone(),
        version: p.version.clone(),
        name: p.manifest.name.clone(),
        description: p.manifest.description.clone(),
        plugin_type: p.manifest.plugin_type.clone(),
        has_ui: p.manifest.ui.as_ref()
            .and_then(|v| v.as_str())
            .map(|s| !s.trim().is_empty())
            .unwrap_or(false),
        path: p.path.clone(),
        manifest: p.manifest.clone(),
        ui_type: None,
        cost: p.manifest.cost.clone(),
        cost_unit: p.manifest.cost_unit.clone(),
    }))
}

// ==================== SET PLUGIN COST ====================

/// Записывает централизованную цену (cost/costUnit) в plugin.json плагина и обновляет
/// in-memory manifest. Вызывается из Settings → Plugins. Пишем именно в загруженный
/// plugin.json (plugin.path) — то, что читает менеджер; читаем JSON как Value и правим
/// только два поля, чтобы не потерять остальные/порядок ключей.
#[tauri::command]
#[specta::specta]
pub fn plugin_manager_set_cost(
    plugin_id: String,
    version: String,
    cost: String,
    cost_unit: String,
    state: tauri::State<'_, std::sync::Mutex<PluginManagerState>>,
) -> Result<bool, String> {
    let mut state = state.lock().map_err(|e| e.to_string())?;
    let key = format!("{}@{}", plugin_id, version);
    let plugin = state.plugins.get_mut(&key)
        .ok_or_else(|| format!("Plugin not found: {}", key))?;

    let manifest_path = Path::new(&plugin.path).join("plugin.json");
    let raw = fs::read_to_string(&manifest_path).map_err(|e| e.to_string())?;
    let mut json: serde_json::Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;

    if let Some(obj) = json.as_object_mut() {
        obj.insert("cost".to_string(), serde_json::Value::String(cost.clone()));
        obj.insert("costUnit".to_string(), serde_json::Value::String(cost_unit.clone()));
    } else {
        return Err(format!("plugin.json is not an object: {:?}", manifest_path));
    }

    let pretty = serde_json::to_string_pretty(&json).map_err(|e| e.to_string())?;
    super::fs_commands::write_atomic(&manifest_path, pretty.as_bytes())?;

    // Обновляем in-memory manifest, чтобы get_all_plugins/get_all_ui_nodes сразу
    // отдавали свежее значение без перезагрузки плагинов.
    plugin.manifest.cost = cost;
    plugin.manifest.cost_unit = cost_unit;

    Ok(true)
}

// ==================== GET PLUGIN UI DATA ====================

#[tauri::command]
#[specta::specta]
pub fn plugin_manager_get_plugin_ui(
    plugin_id: String,
    version: String,
    state: tauri::State<'_, std::sync::Mutex<PluginManagerState>>,
) -> Result<Option<PluginUINode>, String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    let key = format!("{}@{}", plugin_id, version);
    
    let plugin = state.plugins.get(&key)
        .ok_or_else(|| format!("Plugin not found: {}", key))?;

    let ui_file = plugin.manifest.ui.as_ref()
        .and_then(|v| v.as_str())
        .filter(|s| !s.trim().is_empty());
    
    if ui_file.is_none() {
        return Ok(None);
    }

    let ui_file = ui_file.unwrap();
    let ui_path = Path::new(&plugin.path).join(ui_file);

    if !ui_path.exists() {
        return Err(format!("UI file not found: {:?}", ui_path));
    }

    let raw = fs::read_to_string(&ui_path).map_err(|e| e.to_string())?;
    let ui_data: serde_json::Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;

    // Извлекаем uiType из data.colorType
    let ui_type = ui_data.get("data")
        .and_then(|d| d.get("colorType"))
        .and_then(|c| c.as_str())
        .map(|s| s.to_string());

    Ok(Some(PluginUINode {
        id: ui_data.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        node_type: ui_data.get("type").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        position: ui_data.get("position").cloned().unwrap_or(serde_json::json!({"x": 0, "y": 0})),
        width: ui_data.get("width").and_then(|v| v.as_f64()).unwrap_or(300.0),
        height: ui_data.get("height").and_then(|v| v.as_f64()).unwrap_or(200.0),
        plugin_id: Some(plugin.id.clone()),
        plugin_version: Some(plugin.version.clone()),
        plugin_path: Some(plugin.path.clone()),
        plugin_name: Some(plugin.manifest.name.clone()),
        ui_type,
        data: ui_data.get("data").cloned().unwrap_or(serde_json::json!({})),
    }))
}

// ==================== GET ALL UI NODES ====================

#[tauri::command]
#[specta::specta]
pub fn plugin_manager_get_all_ui_nodes(
    state: tauri::State<'_, std::sync::Mutex<PluginManagerState>>,
) -> Result<Vec<PluginUINode>, String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    
    let mut ui_nodes = Vec::new();

    for plugin in state.plugins.values() {
        let ui_file = plugin.manifest.ui.as_ref()
            .and_then(|v| v.as_str())
            .filter(|s| !s.trim().is_empty());
        
        if ui_file.is_none() {
            continue;
        }

        let ui_file = ui_file.unwrap();
        let ui_path = Path::new(&plugin.path).join(ui_file);

        if !ui_path.exists() {
            eprintln!("[PluginManager] UI file not found for {}: {:?}", plugin.key, ui_path);
            continue;
        }

        match fs::read_to_string(&ui_path) {
            Ok(raw) => {
                match serde_json::from_str::<serde_json::Value>(&raw) {
                    Ok(ui_data) => {
                        let ui_type = ui_data.get("data")
                            .and_then(|d| d.get("colorType"))
                            .and_then(|c| c.as_str())
                            .map(|s| s.to_string());

                        // Цена живёт в plugin.json, а не в ui.json. Прокидываем её в data,
                        // чтобы node-definitions несли cost/costUnit и syncCostsFromManifest
                        // мог перезаписать значения в нодах флоу актуальной ценой.
                        let mut node_data = ui_data.get("data").cloned().unwrap_or(serde_json::json!({}));
                        if let Some(obj) = node_data.as_object_mut() {
                            obj.insert("cost".to_string(), serde_json::json!(plugin.manifest.cost));
                            obj.insert("costUnit".to_string(), serde_json::json!(plugin.manifest.cost_unit));
                        }

                        ui_nodes.push(PluginUINode {
                            id: ui_data.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                            node_type: ui_data.get("type").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                            position: ui_data.get("position").cloned().unwrap_or(serde_json::json!({"x": 0, "y": 0})),
                            width: ui_data.get("width").and_then(|v| v.as_f64()).unwrap_or(300.0),
                            height: ui_data.get("height").and_then(|v| v.as_f64()).unwrap_or(200.0),
                            plugin_id: Some(plugin.id.clone()),
                            plugin_version: Some(plugin.version.clone()),
                            plugin_path: Some(plugin.path.clone()),
                            plugin_name: Some(plugin.manifest.name.clone()),
                            ui_type,
                            data: node_data,
                        });
                    }
                    Err(e) => eprintln!("[PluginManager] Failed to parse UI data for {}: {}", plugin.key, e),
                }
            }
            Err(e) => eprintln!("[PluginManager] Failed to read UI file for {}: {}", plugin.key, e),
        }
    }

    Ok(ui_nodes)
}

// ==================== GET UI NODES (deprecated) ====================

#[tauri::command]
#[specta::specta]
pub fn plugin_manager_get_ui_nodes(
    state: tauri::State<'_, std::sync::Mutex<PluginManagerState>>,
) -> Result<Vec<PluginUINode>, String> {
    eprintln!("[PluginManager] getUINodes() is deprecated, use getAllUINodes() instead");
    plugin_manager_get_all_ui_nodes(state)
}

// ==================== LIST PLUGINS ====================

#[tauri::command]
#[specta::specta]
pub fn plugin_manager_list(
    state: tauri::State<'_, std::sync::Mutex<PluginManagerState>>,
) -> Result<Vec<serde_json::Value>, String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    
    let list: Vec<serde_json::Value> = state.plugins.values().map(|p| {
        serde_json::json!({
            "id": p.id,
            "version": p.version,
            "name": p.manifest.name,
            "description": p.manifest.description,
            "type": p.manifest.plugin_type,
        })
    }).collect();

    Ok(list)
}

// ==================== GET STATE ====================

#[tauri::command]
#[specta::specta]
pub fn plugin_manager_get_state(
    state: tauri::State<'_, std::sync::Mutex<PluginManagerState>>,
) -> Result<serde_json::Value, String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    
    let plugins_count = state.plugins.len();
    let ui_count = state.plugins.values()
        .filter(|p| p.manifest.ui.as_ref()
            .and_then(|v| v.as_str())
            .map(|s| !s.trim().is_empty())
            .unwrap_or(false))
        .count();

    Ok(serde_json::json!({
        "initialized": true,
        "pluginsCount": plugins_count,
        "uiPluginsCount": ui_count,
        "pluginsPath": state.plugins_path.to_string_lossy().to_string(),
        "isDev": state.is_dev,
    }))
}

// ==================== CALL PLUGIN METHOD ====================

#[tauri::command]
#[specta::specta]
pub fn plugin_manager_call(
    plugin_id: String,
    version: String,
    method: String,
    args: Vec<serde_json::Value>,
    state: tauri::State<'_, std::sync::Mutex<PluginManagerState>>,
) -> Result<serde_json::Value, String> {
    let key = format!("{}@{}", plugin_id, version);
    
    let state = state.lock().map_err(|e| e.to_string())?;
    let plugin = state.plugins.get(&key)
        .ok_or_else(|| format!("Plugin not loaded: {}", key))?;

    // В Tauri мы не можем напрямую вызывать JS функции плагинов
    // Возвращаем информацию о том, что метод нужно вызвать через JS
    // Это будет обработано на стороне фронтенда
    
    eprintln!(
        "[PluginManager] Call method '{}' on {} - plugin processing requires JS runtime",
        method, key
    );

    Ok(serde_json::json!({
        "pluginId": plugin.id,
        "version": plugin.version,
        "method": method,
        "args": args,
        "pluginPath": plugin.path,
        "requiresJSRuntime": true,
    }))
}

// ==================== INSTALL PLUGIN FROM .fsmplug ====================

#[tauri::command]
#[specta::specta]
pub fn plugin_manager_install(
    file_path: String,
    state: tauri::State<'_, std::sync::Mutex<PluginManagerState>>,
) -> Result<PluginInfo, String> {
    println!("[PluginManager] Installing plugin from: {}", file_path);

    let path = Path::new(&file_path);
    if !path.exists() {
        return Err(format!("Plugin file not found: {}", file_path));
    }

    // Распаковываем zip
    let zip_data = fs::read(path).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(std::io::Cursor::new(zip_data))
        .map_err(|e| e.to_string())?;

    // Ищем plugin.json
    let mut manifest_name = None;
    for i in 0..archive.len() {
        let file = archive.by_index(i).map_err(|e| e.to_string())?;
        if file.name().ends_with("plugin.json") {
            manifest_name = Some(file.name().to_string());
            break;
        }
    }

    let manifest_name = manifest_name
        .ok_or_else(|| "Invalid plugin file: plugin.json not found".to_string())?;

    // Читаем манифест
    let manifest_str = {
        let mut manifest_file = archive.by_name(&manifest_name).map_err(|e| e.to_string())?;
        let mut s = String::new();
        std::io::Read::read_to_string(&mut manifest_file, &mut s).map_err(|e| e.to_string())?;
        s
    };
    
    let manifest: PluginManifest = serde_json::from_str(&manifest_str).map_err(|e| e.to_string())?;

    // API version check
    let state_ref = state.lock().map_err(|e| e.to_string())?;
    let api_version = state_ref.api_version;
    drop(state_ref);

    if manifest.api_version != api_version {
        return Err(format!(
            "API version mismatch: plugin={}, app={}",
            manifest.api_version, api_version
        ));
    }

    let folder_name = format!("{}@{}", manifest.id, manifest.version);
    
    let state_ref = state.lock().map_err(|e| e.to_string())?;
    let dest_path = state_ref.plugins_path.join(&folder_name);
    drop(state_ref);

    // Если уже установлен - удаляем старую версию
    if dest_path.exists() {
        fs::remove_dir_all(&dest_path).map_err(|e| e.to_string())?;
    }

    fs::create_dir_all(&dest_path).map_err(|e| e.to_string())?;

    // Определяем префикс (корневая папка в архиве)
    let prefix = manifest_name.replace("plugin.json", "");

    // Распаковка вынесена отдельной функцией ровно ради строки ниже: любой отказ
    // внутри (traversal, бомба, ошибка записи) обязан убрать НЕДОраспакованную
    // папку. Иначе прерванная установка оставляет полуплагин, который менеджер
    // при следующем запуске увидит как установленный.
    if let Err(e) = extract_plugin_archive(&mut archive, &dest_path, &prefix, &ArchiveLimits::DEFAULT) {
        let _ = fs::remove_dir_all(&dest_path);
        return Err(e);
    }

    println!("[PluginManager] Extracted to: {:?}", dest_path);

    // Загружаем плагин
    let mut state_ref = state.lock().map_err(|e| e.to_string())?;
    load_plugin_internal(&mut state_ref, &dest_path, &folder_name, api_version)?;
    drop(state_ref);

    // Возвращаем инфо
    let info = plugin_manager_get_plugin(manifest.id, Some(manifest.version), state.clone())?;
    info.ok_or_else(|| format!("PluginInfo not found after install: {}", folder_name))
}


/// Потолки на распаковку архива плагина.
///
/// Параметром, а не константой внутри: иначе проверку не проверить — тест на
/// настоящий предел потребовал бы собрать двухгигабайтный архив. Тесты подставляют
/// крошечные значения и убеждаются, что обе границы реально срабатывают.
pub(crate) struct ArchiveLimits {
    /// Максимум записей в архиве.
    pub entries: usize,
    /// Максимум суммарного РАСПАКОВАННОГО размера.
    pub unpacked_total: u64,
}

impl ArchiveLimits {
    /// Запас большой: плагин — это собранный esbuild'ом файл плюс, в редких
    /// случаях, бинарник-хелпер (whisper-cli ~150 МБ). Если законный плагин
    /// однажды упрётся в потолок, в тексте ошибки будет и он, и сам предел.
    pub(crate) const DEFAULT: Self = Self {
        entries: 5_000,
        unpacked_total: 2 * 1024 * 1024 * 1024,
    };
}

/// Распаковывает архив плагина в `dest_path`, проверяя каждое имя и держа потолок
/// на объём. Вызывающий обязан снести `dest_path` при ошибке.
fn extract_plugin_archive(
    archive: &mut zip::ZipArchive<std::io::Cursor<Vec<u8>>>,
    dest_path: &Path,
    prefix: &str,
    limits: &ArchiveLimits,
) -> Result<(), String> {
    // ZIP-БОМБА. Размер архива ничего не говорит о размере распакованного: 42 КБ
    // разворачиваются в терабайты, потому что степень сжатия нулей неограниченна.
    // Traversal мы закрыли, но без потолка остаётся второй способ навредить —
    // забить диск досуха. Считаем и записи, и распакованные байты.
    //
    // Значения с большим запасом: плагин — это собранный esbuild'ом файл плюс,
    // в редких случаях, бинарник-хелпер (whisper-cli ~150 МБ). Если законный
    // плагин однажды упрётся в потолок, в тексте ошибки будет и он, и сам предел.
    if archive.len() > limits.entries {
        return Err(format!(
            "в архиве {} записей при пределе {} — установка отменена",
            archive.len(),
            limits.entries
        ));
    }
    let mut unpacked_total: u64 = 0;

    // Извлекаем все файлы
    for i in 0..archive.len() {
        let mut file = archive.by_index(i).map_err(|e| e.to_string())?;

        if file.is_dir() {
            continue;
        }

        // Объявленный в заголовке размер — быстрый отказ, ещё не читая запись.
        if file.size() > limits.unpacked_total {
            return Err(format!(
                "запись {:?} объявляет {} байт при пределе {} — установка отменена",
                file.name(),
                file.size(),
                limits.unpacked_total
            ));
        }

        // ZIP SLIP. Имя записи в архиве — внешние данные, и раньше оно уходило в
        // `dest_path.join(...)` как есть. Запись с именем `../../../Library/LaunchAgents/x`
        // писалась КУДА УГОДНО, куда есть доступ у приложения (а capability даёт
        // `fs:write-all` и `scope-home`). Канал доставки плагинов — zip-архивы, то есть
        // подменённый в пути архив означал произвольную запись файлов.
        //
        // Проверяем той же функцией, что и протокол `plugin://` — опасность одна и та
        // же, а держать две копии проверки нельзя.
        let entry_name = file.name().to_string();
        let stripped = entry_name.strip_prefix(prefix).unwrap_or(&entry_name);
        let Some(relative_path) = super::plugin_protocol::sanitize_relative(stripped) else {
            return Err(format!(
                "архив содержит небезопасное имя файла: {:?} — установка отменена",
                entry_name
            ));
        };

        let out_path = dest_path.join(&relative_path);

        // Двойная защита: даже если проверка выше однажды ослабнет, результат обязан
        // остаться внутри папки плагина.
        if !out_path.starts_with(dest_path) {
            return Err(format!(
                "путь из архива уходит за пределы папки плагина: {:?}",
                entry_name
            ));
        }

        if let Some(parent) = out_path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }

        // Заголовок может врать, поэтому читаем через `take` с остатком бюджета +1
        // байт: перебор обнаружится по факту, а не по обещанию архива.
        let remaining = limits.unpacked_total - unpacked_total;
        let mut contents = Vec::new();
        std::io::Read::read_to_end(
            &mut std::io::Read::take(&mut file, remaining + 1),
            &mut contents,
        )
        .map_err(|e| e.to_string())?;

        if contents.len() as u64 > remaining {
            return Err(format!(
                "суммарный распакованный размер превысил предел {} байт — установка отменена",
                limits.unpacked_total
            ));
        }
        unpacked_total += contents.len() as u64;

        fs::write(&out_path, contents).map_err(|e| e.to_string())?;
    }


    Ok(())
}

// ==================== DELETE PLUGIN ====================

#[tauri::command]
#[specta::specta]
pub fn plugin_manager_delete(
    plugin_id: String,
    version: String,
    state: tauri::State<'_, std::sync::Mutex<PluginManagerState>>,
) -> Result<(), String> {
    // Проверяем ДО склейки: дальше по коду стоит fs::remove_dir_all.
    validate_path_component(&plugin_id, "plugin_id")?;
    validate_path_component(&version, "version")?;

    let key = format!("{}@{}", plugin_id, version);

    // Выгружаем если загружен
    let mut state_ref = state.lock().map_err(|e| e.to_string())?;
    state_ref.plugins.remove(&key);
    
    // Удаляем папку с диска
    let folder_name = &key;
    let plugin_path = state_ref.plugins_path.join(folder_name);
    drop(state_ref);

    if plugin_path.exists() {
        fs::remove_dir_all(&plugin_path).map_err(|e| e.to_string())?;
        println!("[PluginManager] Deleted plugin from disk: {:?}", plugin_path);
    }

    Ok(())
}

// ==================== DESTROY ====================

#[tauri::command]
#[specta::specta]
pub fn plugin_manager_destroy(
    state: tauri::State<'_, std::sync::Mutex<PluginManagerState>>,
) -> Result<(), String> {
    let mut state = state.lock().map_err(|e| e.to_string())?;
    state.plugins.clear();
    println!("[PluginManager] Destroyed");
    Ok(())
}

// ==================== BUILD PLUGIN (dev only) ====================

/// Результат сборки плагина. Форма совпадает с тем, что ждёт фронтовый handleBuild
/// (success/stdout/stderr/error).
#[derive(Debug, Serialize, Clone, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PluginBuildResult {
    pub success: bool,
    pub stdout: String,
    pub stderr: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Собирает один плагин из `plugins-dev/<id>` в `distr-plugins/` через
/// `plugins-dev/_packScripts/build-plugin.js` (esbuild). Доступно только в dev —
/// в собранном приложении нет ни исходников, ни node.
///
/// GUI-процесс на macOS не наследует PATH из шелла, поэтому node запускается через
/// login-shell (`$SHELL -lc`), который подтягивает PATH из профиля (homebrew/nvm).
#[tauri::command]
#[specta::specta]
pub fn plugin_build(plugin_id: String) -> Result<PluginBuildResult, String> {
    // id уходит в shell-строку — пускаем только безопасные символы.
    if plugin_id.is_empty()
        || !plugin_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-' || c == '.')
    {
        return Err(format!("Invalid plugin id: {:?}", plugin_id));
    }

    // В dev current_dir() = src-tauri/, корень репо — на уровень выше.
    let cwd = std::env::current_dir().map_err(|e| e.to_string())?;
    let repo_root = cwd.parent().map(|p| p.to_path_buf()).unwrap_or(cwd.clone());
    let build_script = repo_root
        .join("plugins-dev")
        .join("_packScripts")
        .join("build-plugin.js");

    if !build_script.exists() {
        return Err(format!(
            "Build script not found: {} — сборка плагинов доступна только в dev-окружении с исходниками репозитория.",
            build_script.display()
        ));
    }

    let output = run_plugin_build(&repo_root, &build_script, &plugin_id)?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let success = output.status.success();

    Ok(PluginBuildResult {
        success,
        stdout,
        stderr,
        error: if success {
            None
        } else {
            Some(format!(
                "build-plugin.js завершился с кодом {:?}. Проверь, что установлен node (см. stderr).",
                output.status.code()
            ))
        },
    })
}

#[cfg(not(target_os = "windows"))]
fn run_plugin_build(
    repo_root: &Path,
    build_script: &Path,
    plugin_id: &str,
) -> Result<std::process::Output, String> {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    // cd в корень репо (build-plugin.js читает process.cwd()) + node <script> <id>.
    let cmd = format!(
        "cd {} && node {} {}",
        sh_single_quote(&repo_root.to_string_lossy()),
        sh_single_quote(&build_script.to_string_lossy()),
        sh_single_quote(plugin_id),
    );
    std::process::Command::new(&shell)
        .arg("-lc")
        .arg(&cmd)
        .output()
        .map_err(|e| format!("Не удалось запустить shell '{}': {}", shell, e))
}

#[cfg(target_os = "windows")]
fn run_plugin_build(
    repo_root: &Path,
    build_script: &Path,
    plugin_id: &str,
) -> Result<std::process::Output, String> {
    std::process::Command::new("node")
        .current_dir(repo_root)
        .arg(build_script)
        .arg(plugin_id)
        .output()
        .map_err(|e| format!("Не удалось запустить node: {}. Убедись, что node в PATH.", e))
}

/// Экранирование строки для помещения в одиночные кавычки POSIX-shell.
#[cfg(not(target_os = "windows"))]
fn sh_single_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

#[cfg(test)]
mod path_component_tests {
    use super::validate_path_component;

    #[test]
    fn нормальные_имена_папок_проходят() {
        for ok in ["copyFile@0.1", "autoPostVK@0.1", "updater@1.0.0", "a", "x-y_z@1.2.3"] {
            assert!(validate_path_component(ok, "id").is_ok(), "должно проходить: {ok}");
        }
    }

    /// Эти значения уходили в `plugins_path.join(...)`, а в delete — дальше в
    /// `fs::remove_dir_all`. Проверки не было вообще.
    #[test]
    fn разделители_и_traversal_не_проходят() {
        for bad in ["..", ".", "", "../x", "a/b", "a\\b", "../../Documents", "/etc"] {
            assert!(validate_path_component(bad, "id").is_err(), "должно отвергаться: {bad:?}");
        }
    }

    #[test]
    fn текст_ошибки_называет_поле() {
        let e = validate_path_component("../x", "plugin_id").unwrap_err();
        assert!(e.contains("plugin_id"), "в ошибке должно быть имя поля: {e}");
    }
}

#[cfg(test)]
mod archive_tests {
    use super::{extract_plugin_archive, ArchiveLimits};
    use std::io::{Cursor, Write};
    use std::path::{Path, PathBuf};

    /// Собирает настоящий zip в памяти из пар (имя записи, содержимое).
    fn архив(entries: &[(&str, &[u8])]) -> zip::ZipArchive<Cursor<Vec<u8>>> {
        let mut buf = Cursor::new(Vec::new());
        {
            let mut w = zip::ZipWriter::new(&mut buf);
            for (name, data) in entries {
                w.start_file(*name, zip::write::SimpleFileOptions::default()).unwrap();
                w.write_all(data).unwrap();
            }
            w.finish().unwrap();
        }
        zip::ZipArchive::new(buf).unwrap()
    }

    /// Отдельная папка на каждый тест: тесты в одном процессе идут параллельно.
    fn песочница(имя: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("fsm_zip_test_{имя}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn обычный_архив_распаковывается() {
        let dir = песочница("ok");
        let mut a = архив(&[("plugin.json", b"{}"), ("copyFile.js", b"export {}")]);
        extract_plugin_archive(&mut a, &dir, "", &ArchiveLimits::DEFAULT).unwrap();

        assert_eq!(std::fs::read(dir.join("plugin.json")).unwrap(), b"{}");
        assert!(dir.join("copyFile.js").is_file());
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// ZIP SLIP на настоящем архиве. Раньше имя записи уходило в `join` как есть,
    /// а capability даёт `fs:write-all` + `scope-home` — то есть запись куда угодно.
    #[test]
    fn запись_с_traversal_не_пишет_наружу() {
        let dir = песочница("slip");
        let наружу = dir.parent().unwrap().join("fsm_zip_test_ESCAPED.txt");
        let _ = std::fs::remove_file(&наружу);

        let mut a = архив(&[
            ("plugin.json", b"{}"),
            ("../fsm_zip_test_ESCAPED.txt", b"pwned"),
        ]);
        let err = extract_plugin_archive(&mut a, &dir, "", &ArchiveLimits::DEFAULT).unwrap_err();

        assert!(err.contains("небезопасное"), "ошибка должна называть причину: {err}");
        assert!(!наружу.exists(), "файл записан ЗА пределы папки плагина: {наружу:?}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn слишком_много_записей_отвергается() {
        let dir = песочница("entries");
        let mut a = архив(&[("a", b"1"), ("b", b"2"), ("c", b"3")]);
        let limits = ArchiveLimits { entries: 2, unpacked_total: 1024 };

        let err = extract_plugin_archive(&mut a, &dir, "", &limits).unwrap_err();
        assert!(err.contains("записей"), "ошибка должна называть записи: {err}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// ZIP-БОМБА: сжатие нулей неограниченно, поэтому маленький архив может
    /// распаковаться в терабайты и забить диск досуха.
    #[test]
    fn превышение_суммарного_размера_отвергается() {
        let dir = песочница("bomb");
        let mut a = архив(&[("zeros.bin", &[0u8; 4096])]);
        let limits = ArchiveLimits { entries: 10, unpacked_total: 64 };

        let err = extract_plugin_archive(&mut a, &dir, "", &limits).unwrap_err();
        assert!(err.contains("64"), "ошибка должна называть предел: {err}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Потолок именно СУММАРНЫЙ: каждая запись по отдельности в предел влезает.
    #[test]
    fn сумма_по_записям_копится() {
        let dir = песочница("sum");
        let mut a = архив(&[("a", &[1u8; 40]), ("b", &[2u8; 40])]);
        let limits = ArchiveLimits { entries: 10, unpacked_total: 64 };

        let err = extract_plugin_archive(&mut a, &dir, "", &limits).unwrap_err();
        assert!(err.contains("суммарный"), "должен упасть на сумме: {err}");
        // первая запись успела лечь — потому вызывающий и сносит папку целиком
        assert!(Path::new(&dir.join("a")).is_file());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
