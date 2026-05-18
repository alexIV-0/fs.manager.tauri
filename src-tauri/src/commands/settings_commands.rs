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
}

impl AppSettingsState {
    pub fn new() -> Self {
        Self {
            settings: default_app_settings(),
            color_types: default_color_types(),
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

#[tauri::command]
pub fn color_types_rescan(
    app: tauri::AppHandle,
    state: tauri::State<Mutex<AppSettingsState>>,
) -> Result<Value, String> {
    color_types_get(app, state)
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
