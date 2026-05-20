// Команды для AppSettings и ColorTypes.
// Хранение: JSON-файлы в app_data_dir/settings.json и app_data_dir/colorTypes.json.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::Manager;

pub const APP_SETTINGS_VERSION: u32 = 1;
pub const COLOR_TYPES_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettingsState {
    pub settings: Value,
    pub color_types: Value,
    pub file_types: Value,
    pub program_paths: Value,
}

impl AppSettingsState {
    pub fn new() -> Self {
        Self {
            settings: default_app_settings(),
            color_types: default_color_types(),
            file_types: default_file_types(),
            program_paths: default_program_paths(),
        }
    }
}

fn default_app_settings() -> Value {
    json!({
        "version": APP_SETTINGS_VERSION,
        "processing": { "maxParallel": 3 },
        "scanSchedule": {
            "minScanWaitMin": 3,
            "maxScanWaitMin": 15,
            "foldersDelayMs": 200
        },
        "resourcePools": {},
        "storage": {
            "localArchives": [],
            "onlineDb": { "enabled": false, "url": "", "templateId": "database-sync" }
        },
        "cleanup": { "retentionDays": null, "autoDisableDays": null },
        "logging": { "bufferSize": 5000 }
    })
}

fn default_color_types() -> Value {
    json!({
        "version": COLOR_TYPES_VERSION,
        "types": [],
        "lastScannedAt": null
    })
}

fn default_file_types() -> Value {
    json!([
        {"id":"video","name":"video","path":["avi","mov","mp4","mpeg","mpg","m2v","m4v","ts","mxf","wmv","mkv","webm"],"color":"#0a84feff","inactivePath":[]},
        {"id":"audio","name":"audio","path":["wav","mp3","aac","m4a","flac","ogg","aiff","aif","opus","wma"],"color":"#ffae0cff","inactivePath":[]},
        {"id":"image","name":"image","path":["jpg","jpeg","png","tiff","tga","pdf","gif","pgf","bmp","webp","svg"],"color":"#00e308ff","inactivePath":[]},
        {"id":"text","name":"text","path":["txt","json","md","log","yaml","yml","xml","ini","toml","env"],"color":"#90bae5ff","inactivePath":[]},
        {"id":"title","name":"title","path":["vtt","lrc","srt"],"color":"#9be590ff","inactivePath":[]},
        {"id":"xlsx","name":"xlsx","path":["xlsx","tsv","csv"],"color":"rgb(99, 214, 81)","inactivePath":[]},
        {"id":"aep","name":"aep","path":["aep"],"color":"#9857ffff","inactivePath":[]},
        {"id":"moho","name":"moho","path":["moho"],"color":"#b20affff","inactivePath":[]},
        {"id":"ai","name":"ai","path":["ai","eps"],"color":null,"inactivePath":[]},
        {"id":"psd","name":"psd","path":["psd","psb"],"color":null,"inactivePath":[]},
        {"id":"scripts","name":"scripts","path":["js","jsx","lua"],"color":"rgb(0, 50, 200)","inactivePath":[]}
    ])
}

fn default_program_paths() -> Value {
    json!([
        {"id":"ffmpeg","name":"ffmpeg","path":[],"color":null,"inactivePath":[]},
        {"id":"ffprobe","name":"ffprobe","path":[],"color":null,"inactivePath":[]},
        {"id":"afterEffect","name":"afterEffect","path":[],"color":null,"inactivePath":[]},
        {"id":"moho","name":"moho","path":[],"color":null,"inactivePath":[]}
    ])
}

fn file_types_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {}", e))?;
    fs::create_dir_all(&dir).map_err(|e| format!("create_dir_all: {}", e))?;
    Ok(dir.join("fileTypes.json"))
}

fn program_paths_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {}", e))?;
    fs::create_dir_all(&dir).map_err(|e| format!("create_dir_all: {}", e))?;
    Ok(dir.join("programPaths.json"))
}

fn settings_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {}", e))?;
    fs::create_dir_all(&dir).map_err(|e| format!("create_dir_all: {}", e))?;
    Ok(dir.join("settings.json"))
}

fn color_types_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {}", e))?;
    fs::create_dir_all(&dir).map_err(|e| format!("create_dir_all: {}", e))?;
    Ok(dir.join("colorTypes.json"))
}

fn read_json(path: &PathBuf, fallback: Value) -> Value {
    match fs::read_to_string(path) {
        Ok(content) => serde_json::from_str(&content).unwrap_or(fallback),
        Err(_) => fallback,
    }
}

fn write_json(path: &PathBuf, value: &Value) -> Result<(), String> {
    let content =
        serde_json::to_string_pretty(value).map_err(|e| format!("to_string_pretty: {}", e))?;
    fs::write(path, content).map_err(|e| format!("write: {}", e))
}

// ==================== App Settings ====================

#[tauri::command]
pub fn app_settings_get(
    app: tauri::AppHandle,
    state: tauri::State<Mutex<AppSettingsState>>,
) -> Result<Value, String> {
    let path = settings_path(&app)?;
    let value = read_json(&path, default_app_settings());
    if let Ok(mut st) = state.lock() {
        st.settings = value.clone();
    }
    Ok(value)
}

#[tauri::command]
pub fn app_settings_set(
    app: tauri::AppHandle,
    state: tauri::State<Mutex<AppSettingsState>>,
    settings: Value,
) -> Result<Value, String> {
    let path = settings_path(&app)?;
    write_json(&path, &settings)?;
    if let Ok(mut st) = state.lock() {
        st.settings = settings.clone();
    }
    Ok(settings)
}

#[tauri::command]
pub fn app_settings_patch(
    app: tauri::AppHandle,
    state: tauri::State<Mutex<AppSettingsState>>,
    patch: Value,
) -> Result<Value, String> {
    let path = settings_path(&app)?;
    let mut current = read_json(&path, default_app_settings());

    if let (Some(curr_obj), Some(patch_obj)) = (current.as_object_mut(), patch.as_object()) {
        for (k, v) in patch_obj {
            if let Some(curr_val) = curr_obj.get_mut(k) {
                if curr_val.is_object() && v.is_object() {
                    let curr_map = curr_val.as_object_mut().unwrap();
                    let patch_map = v.as_object().unwrap();
                    for (sub_k, sub_v) in patch_map {
                        curr_map.insert(sub_k.clone(), sub_v.clone());
                    }
                    continue;
                }
            }
            curr_obj.insert(k.clone(), v.clone());
        }
    }

    write_json(&path, &current)?;
    if let Ok(mut st) = state.lock() {
        st.settings = current.clone();
    }
    Ok(current)
}

// ==================== Cleanup ====================

/// Стаб для cleanup:auto-delete. Реальная очистка по retentionDays/autoDisableDays
/// должна сканировать папки и удалять/отключать устаревшие. Пока no-op.
#[tauri::command]
pub fn cleanup_auto_delete() -> Result<Value, String> {
    Ok(json!({ "deleted": 0, "disabled": 0 }))
}

// ==================== Database ====================

/// Стаб для db:registerFound. Реальный online-DB sync не реализован,
/// но фронту нужен **строковый** dbItemId для трекинга item'а в LogWindow и processItem.
/// Возвращаем детерминированный ID на основе pathForDelete + findTime — так чтобы
/// повторный вызов на тот же item дал тот же ID (как и должно быть при идемпотентной регистрации).
#[tauri::command]
pub fn db_register_found(payload: Value) -> Result<String, String> {
    let desc = payload.get("description").cloned().unwrap_or(Value::Null);
    let path_for_delete = desc
        .get("pathForDelete")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let find_time = desc.get("findTime").and_then(|v| v.as_str()).unwrap_or("");

    let id = if !path_for_delete.is_empty() && !find_time.is_empty() {
        format!("{}:{}", path_for_delete, find_time)
    } else if !path_for_delete.is_empty() {
        path_for_delete.to_string()
    } else {
        // Fallback: timestamp + short random
        format!(
            "{}-{}",
            chrono::Utc::now().timestamp_millis(),
            uuid::Uuid::new_v4().simple().to_string().chars().take(8).collect::<String>()
        )
    };

    Ok(id)
}

// ==================== Color Types ====================

#[tauri::command]
pub fn color_types_get(
    app: tauri::AppHandle,
    state: tauri::State<Mutex<AppSettingsState>>,
) -> Result<Value, String> {
    let path = color_types_path(&app)?;
    let value = read_json(&path, default_color_types());
    if let Ok(mut st) = state.lock() {
        st.color_types = value.clone();
    }
    Ok(value)
}

#[tauri::command]
pub fn color_types_set(
    app: tauri::AppHandle,
    state: tauri::State<Mutex<AppSettingsState>>,
    types: Value,
) -> Result<Value, String> {
    let path = color_types_path(&app)?;
    write_json(&path, &types)?;
    if let Ok(mut st) = state.lock() {
        st.color_types = types.clone();
    }
    Ok(types)
}

/// Пересканит установленные плагины и обновит список colorTypes:
/// — добавляет новые colorType (которые встречаются в `ui.json#data.colorType`)
/// — помечает orphan: true тем, что больше не используются ни одним плагином
/// — ничего не удаляет (юзер может вернуть плагин обратно)
///
/// Порт `electron/main/settings/colorTypes.ts#rescanColorTypes`.
#[tauri::command]
pub fn color_types_rescan(
    app: tauri::AppHandle,
    state: tauri::State<Mutex<AppSettingsState>>,
    plugin_state: tauri::State<Mutex<super::plugin_commands::PluginManagerState>>,
) -> Result<Value, String> {
    let path = color_types_path(&app)?;
    let mut current = read_json(&path, default_color_types());

    // Системные типы — всегда присутствуют, их defaultLimit задан жёстко.
    // ffplay исключён полностью.
    let system_types: &[(&str, i64)] = &[
        ("afterEffect", 1),
        ("moho", 1),
        ("ffmpeg", 2),
        ("ffprobe", 4),
        ("ai", 1),
        ("helpers", 10),
        ("main", 5),
    ];
    let excluded: std::collections::HashSet<&str> = ["ffplay"].iter().copied().collect();

    // Собираем уникальные colorType из ui.json всех загруженных плагинов.
    let mut used: std::collections::HashSet<String> = std::collections::HashSet::new();
    // Системные типы всегда считаются "используемыми" (не orphan).
    for (name, _) in system_types {
        used.insert(name.to_string());
    }
    if let Ok(pm) = plugin_state.lock() {
        for plugin in pm.plugins.values() {
            let ui_file = plugin
                .manifest
                .ui
                .as_ref()
                .and_then(|v| v.as_str())
                .filter(|s| !s.trim().is_empty());
            let Some(ui_file) = ui_file else { continue };

            let ui_path = std::path::Path::new(&plugin.path).join(ui_file);
            if !ui_path.exists() {
                continue;
            }
            let Ok(raw) = fs::read_to_string(&ui_path) else { continue };
            let Ok(json) = serde_json::from_str::<Value>(&raw) else { continue };

            if let Some(ct) = json
                .get("data")
                .and_then(|d| d.get("colorType"))
                .and_then(|c| c.as_str())
            {
                let trimmed = ct.trim();
                if !trimmed.is_empty() && !excluded.contains(trimmed) {
                    used.insert(trimmed.to_string());
                }
            }
        }
    }

    // Берём существующие записи, обновляем orphan-флаг. ffplay пропускаем.
    let mut merged: Vec<Value> = Vec::new();
    let mut existing_names: std::collections::HashSet<String> = std::collections::HashSet::new();
    if let Some(types_arr) = current.get("types").and_then(|t| t.as_array()) {
        for entry in types_arr {
            let name = entry
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            if name.is_empty() || excluded.contains(name.as_str()) {
                continue;
            }
            let mut e = entry.clone();
            if let Some(obj) = e.as_object_mut() {
                obj.insert("orphan".to_string(), json!(!used.contains(&name)));
            }
            existing_names.insert(name);
            merged.push(e);
        }
    }

    // Добавляем системные типы, которых ещё нет в файле.
    for (name, default_limit) in system_types {
        if !existing_names.contains(*name) {
            merged.push(json!({
                "name": name,
                "defaultLimit": default_limit,
                "orphan": false,
            }));
            existing_names.insert(name.to_string());
        }
    }

    // Добавляем новые colorType из плагинов (не системные и не существующие).
    for name in &used {
        if !existing_names.contains(name) {
            merged.push(json!({
                "name": name,
                "defaultLimit": 1,
                "orphan": false,
            }));
        }
    }

    // Сортируем: сначала активные (по имени), потом orphan.
    merged.sort_by(|a, b| {
        let a_orphan = a.get("orphan").and_then(|v| v.as_bool()).unwrap_or(false);
        let b_orphan = b.get("orphan").and_then(|v| v.as_bool()).unwrap_or(false);
        if a_orphan != b_orphan {
            return if a_orphan {
                std::cmp::Ordering::Greater
            } else {
                std::cmp::Ordering::Less
            };
        }
        let a_name = a.get("name").and_then(|v| v.as_str()).unwrap_or("");
        let b_name = b.get("name").and_then(|v| v.as_str()).unwrap_or("");
        a_name.cmp(b_name)
    });

    if let Some(obj) = current.as_object_mut() {
        obj.insert("types".to_string(), Value::Array(merged));
        obj.insert(
            "lastScannedAt".to_string(),
            json!(chrono::Utc::now().to_rfc3339()),
        );
    }

    write_json(&path, &current)?;
    if let Ok(mut st) = state.lock() {
        st.color_types = current.clone();
    }
    Ok(current)
}

#[tauri::command]
pub fn color_types_add(
    app: tauri::AppHandle,
    state: tauri::State<Mutex<AppSettingsState>>,
    name: String,
    default_limit: Option<i64>,
) -> Result<Value, String> {
    let limit = default_limit.unwrap_or(1);
    let path = color_types_path(&app)?;
    let mut current = read_json(&path, default_color_types());

    if let Some(types) = current.get_mut("types").and_then(|t| t.as_array_mut()) {
        if !types
            .iter()
            .any(|t| t.get("name").and_then(|n| n.as_str()) == Some(&name))
        {
            types.push(json!({
                "name": name,
                "defaultLimit": limit,
                "orphan": false
            }));
        }
    }

    write_json(&path, &current)?;
    if let Ok(mut st) = state.lock() {
        st.color_types = current.clone();
    }
    Ok(current)
}

#[tauri::command]
pub fn color_types_remove(
    app: tauri::AppHandle,
    state: tauri::State<Mutex<AppSettingsState>>,
    name: String,
) -> Result<Value, String> {
    let path = color_types_path(&app)?;
    let mut current = read_json(&path, default_color_types());

    if let Some(types) = current.get_mut("types").and_then(|t| t.as_array_mut()) {
        types.retain(|t| t.get("name").and_then(|n| n.as_str()) != Some(&name));
    }

    write_json(&path, &current)?;
    if let Ok(mut st) = state.lock() {
        st.color_types = current.clone();
    }
    Ok(current)
}

// ==================== File Types ====================

#[tauri::command]
pub fn file_types_get(
    app: tauri::AppHandle,
    state: tauri::State<Mutex<AppSettingsState>>,
) -> Result<Value, String> {
    let path = file_types_path(&app)?;
    let value = read_json(&path, default_file_types());
    if let Ok(mut st) = state.lock() {
        st.file_types = value.clone();
    }
    Ok(value)
}

#[tauri::command]
pub fn file_types_set(
    app: tauri::AppHandle,
    state: tauri::State<Mutex<AppSettingsState>>,
    types: Value,
) -> Result<Value, String> {
    let path = file_types_path(&app)?;
    write_json(&path, &types)?;
    if let Ok(mut st) = state.lock() {
        st.file_types = types.clone();
    }
    Ok(types)
}

// ==================== Program Paths ====================

#[tauri::command]
pub fn program_paths_get(
    app: tauri::AppHandle,
    state: tauri::State<Mutex<AppSettingsState>>,
) -> Result<Value, String> {
    let path = program_paths_path(&app)?;
    let value = read_json(&path, default_program_paths());
    if let Ok(mut st) = state.lock() {
        st.program_paths = value.clone();
    }
    Ok(value)
}

#[tauri::command]
pub fn program_paths_set(
    app: tauri::AppHandle,
    state: tauri::State<Mutex<AppSettingsState>>,
    paths: Value,
) -> Result<Value, String> {
    let path = program_paths_path(&app)?;
    write_json(&path, &paths)?;
    if let Ok(mut st) = state.lock() {
        st.program_paths = paths.clone();
    }
    Ok(paths)
}
