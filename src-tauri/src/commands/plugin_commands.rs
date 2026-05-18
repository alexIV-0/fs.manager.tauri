use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

// ==================== TYPES ====================

#[derive(Debug, Serialize, Deserialize, Clone)]
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
}

#[derive(Debug, Serialize, Deserialize, Clone)]
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
}

#[derive(Debug, Serialize, Deserialize, Clone)]
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

// ==================== LOAD SINGLE PLUGIN ====================

#[tauri::command]
pub fn plugin_manager_load_plugin(
    folder_name: String,
    state: tauri::State<'_, std::sync::Mutex<PluginManagerState>>,
) -> Result<bool, String> {
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
    }).collect();

    Ok(info)
}

// ==================== GET PLUGINS BY TYPE ====================

#[tauri::command]
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
    }))
}

// ==================== GET PLUGIN UI DATA ====================

#[tauri::command]
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
                            data: ui_data.get("data").cloned().unwrap_or(serde_json::json!({})),
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
pub fn plugin_manager_get_ui_nodes(
    state: tauri::State<'_, std::sync::Mutex<PluginManagerState>>,
) -> Result<Vec<PluginUINode>, String> {
    eprintln!("[PluginManager] getUINodes() is deprecated, use getAllUINodes() instead");
    plugin_manager_get_all_ui_nodes(state)
}

// ==================== LIST PLUGINS ====================

#[tauri::command]
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

    // Извлекаем все файлы
    for i in 0..archive.len() {
        let mut file = archive.by_index(i).map_err(|e| e.to_string())?;
        
        if file.is_dir() {
            continue;
        }

        let relative_path = if file.name().starts_with(&prefix) {
            file.name()[prefix.len()..].to_string()
        } else {
            file.name().to_string()
        };

        if relative_path.is_empty() {
            continue;
        }

        let out_path = dest_path.join(&relative_path);
        
        if let Some(parent) = out_path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }

        let mut contents = Vec::new();
        std::io::Read::read_to_end(&mut file, &mut contents).map_err(|e| e.to_string())?;
        fs::write(&out_path, contents).map_err(|e| e.to_string())?;
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

// ==================== DELETE PLUGIN ====================

#[tauri::command]
pub fn plugin_manager_delete(
    plugin_id: String,
    version: String,
    state: tauri::State<'_, std::sync::Mutex<PluginManagerState>>,
) -> Result<(), String> {
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
pub fn plugin_manager_destroy(
    state: tauri::State<'_, std::sync::Mutex<PluginManagerState>>,
) -> Result<(), String> {
    let mut state = state.lock().map_err(|e| e.to_string())?;
    state.plugins.clear();
    println!("[PluginManager] Destroyed");
    Ok(())
}
