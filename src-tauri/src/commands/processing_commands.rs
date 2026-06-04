#![allow(dead_code)]

use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::Emitter;
use chrono::Datelike;
use chrono::Timelike;

// ==================== TYPES ====================

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ProcessingEvent {
    #[serde(rename = "type")]
    pub event_type: String,
    pub payload: serde_json::Value,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ProcessingItem {
    pub description: serde_json::Value,
    pub processing_queue: Vec<String>,
    #[serde(flatten)]
    pub extra: serde_json::Value,
}

#[derive(Debug, Serialize, Deserialize, Clone, specta::Type)]
pub struct MoveToErrorsResult {
    pub success: bool,
    pub moved_to: Option<String>,
    pub error: Option<String>,
}

pub struct ProcessingState {
    pub abort_signal: Arc<AtomicBool>,
    pub current_step: Mutex<Option<String>>,
    pub total_steps: Mutex<usize>,
    pub completed_steps: Mutex<usize>,
    pub errors: Mutex<Vec<String>>,
}

impl ProcessingState {
    pub fn new() -> Self {
        Self {
            abort_signal: Arc::new(AtomicBool::new(false)),
            current_step: Mutex::new(None),
            total_steps: Mutex::new(0),
            completed_steps: Mutex::new(0),
            errors: Mutex::new(Vec::new()),
        }
    }
}

// ==================== COMMANDS ====================

#[tauri::command]
#[specta::specta]
pub fn abort_processing(state: tauri::State<'_, Mutex<ProcessingState>>) -> Result<(), String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    state.abort_signal.store(true, Ordering::SeqCst);
    Ok(())
}

#[tauri::command]
pub fn is_processing_aborted(state: tauri::State<'_, Mutex<ProcessingState>>) -> Result<bool, String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    Ok(state.abort_signal.load(Ordering::SeqCst))
}

#[tauri::command]
pub fn reset_processing_signal(state: tauri::State<'_, Mutex<ProcessingState>>) -> Result<(), String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    state.abort_signal.store(false, Ordering::SeqCst);
    state.current_step.lock().map_err(|e| e.to_string())?.take();
    *state.total_steps.lock().map_err(|e| e.to_string())? = 0;
    *state.completed_steps.lock().map_err(|e| e.to_string())? = 0;
    state.errors.lock().map_err(|e| e.to_string())?.clear();
    Ok(())
}

#[tauri::command]
pub fn set_processing_progress(
    current_step: String,
    total_steps: usize,
    completed_steps: usize,
    state: tauri::State<'_, Mutex<ProcessingState>>,
) -> Result<(), String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    *state.current_step.lock().map_err(|e| e.to_string())? = Some(current_step);
    *state.total_steps.lock().map_err(|e| e.to_string())? = total_steps;
    *state.completed_steps.lock().map_err(|e| e.to_string())? = completed_steps;
    Ok(())
}

#[tauri::command]
pub fn get_processing_progress(
    state: tauri::State<'_, Mutex<ProcessingState>>,
) -> Result<serde_json::Value, String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    Ok(serde_json::json!({
        "currentStep": *state.current_step.lock().map_err(|e| e.to_string())?,
        "totalSteps": *state.total_steps.lock().map_err(|e| e.to_string())?,
        "completedSteps": *state.completed_steps.lock().map_err(|e| e.to_string())?,
        "aborted": state.abort_signal.load(Ordering::SeqCst),
        "errors": *state.errors.lock().map_err(|e| e.to_string())?,
    }))
}

#[tauri::command]
pub fn add_processing_error(error: String, state: tauri::State<'_, Mutex<ProcessingState>>) -> Result<(), String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    state.errors.lock().map_err(|e| e.to_string())?.push(error);
    Ok(())
}

// ==================== FILE OPERATIONS FOR PROCESSING ====================

/// Переместить файл/папку в папку errors в корне проекта
#[tauri::command]
#[specta::specta]
pub fn move_to_errors(
    item_path: String,
    project_path: String,
) -> Result<MoveToErrorsResult, String> {
    use std::fs;

    let item_path_buf = std::path::PathBuf::from(&item_path);
    let project_path_buf = std::path::PathBuf::from(&project_path);
    
    if !item_path_buf.exists() {
        return Ok(MoveToErrorsResult {
            success: false,
            moved_to: None,
            error: Some(format!("Item not found: {}", item_path)),
        });
    }
    
    // 1. Ищем существующую папку errors (*) в корне проекта
    let entries = fs::read_dir(&project_path_buf).map_err(|e| e.to_string())?;
    let mut errors_folder: Option<std::path::PathBuf> = None;
    
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with("errors") {
                errors_folder = Some(entry.path());
                break;
            }
        }
    }
    
    // 2. Если не нашли — создаём папку errors
    let errors_folder = errors_folder.unwrap_or_else(|| {
        let path = project_path_buf.join("errors");
        let _ = fs::create_dir_all(&path);
        path
    });
    
    // 3. Определяем имя назначения
    let ext = item_path_buf
        .extension()
        .map(|e| format!(".{}", e.to_string_lossy()))
        .unwrap_or_default();
    let base_name = item_path_buf
        .file_stem()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    let is_dir = item_path_buf.is_dir();
    
    let mut dest_path = errors_folder.join(item_path_buf.file_name().unwrap_or_default());
    
    if dest_path.exists() {
        let now = chrono::Local::now();
        let date_str = format!("{:02}.{:02}-{:02}.{:02}", 
            now.month(), now.day(), now.hour(), now.minute());
        
        let dest_name = if is_dir {
            format!("{} ({})", base_name, date_str)
        } else {
            format!("{} ({}){}", base_name, date_str, ext)
        };
        
        dest_path = errors_folder.join(&dest_name);
    }
    
    // 4. Перемещаем
    if let Some(parent) = dest_path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    
    if let Err(_e) = fs::rename(&item_path_buf, &dest_path) {
        // Fallback: copy + delete
        if is_dir {
            if let Err(e) = copy_dir_all(&item_path_buf, &dest_path) {
                return Ok(MoveToErrorsResult {
                    success: false,
                    moved_to: None,
                    error: Some(format!("Failed to move: {}", e)),
                });
            }
            let _ = fs::remove_dir_all(&item_path_buf);
        } else {
            if let Err(e) = fs::copy(&item_path_buf, &dest_path) {
                return Ok(MoveToErrorsResult {
                    success: false,
                    moved_to: None,
                    error: Some(format!("Failed to copy: {}", e)),
                });
            }
            let _ = fs::remove_file(&item_path_buf);
        }
    }
    
    // 5. Переименовываем папку errors → errors (DD.MM-HH.mm)
    let now = chrono::Local::now();
    let date_str = format!("{:02}.{:02}-{:02}.{:02}", 
        now.day(), now.month(), now.hour(), now.minute());
    let new_folder_name = format!("errors ({})", date_str);
    let new_folder_path = project_path_buf.join(&new_folder_name);
    
    if !new_folder_path.exists() {
        let _ = fs::rename(&errors_folder, &new_folder_path);
    }
    
    let moved_to = dest_path.to_string_lossy().to_string();
    
    println!("[Processing] Error — moved to \"{}\": {}", 
        new_folder_name, 
        dest_path.file_name().map(|n| n.to_string_lossy()).unwrap_or_default());
    
    Ok(MoveToErrorsResult {
        success: true,
        moved_to: Some(moved_to),
        error: None,
    })
}

fn copy_dir_all(src: impl AsRef<std::path::Path>, dst: impl AsRef<std::path::Path>) -> std::io::Result<()> {
    use std::fs;
    fs::create_dir_all(&dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let ty = entry.file_type()?;
        let src_path = entry.path();
        let dst_path = dst.as_ref().join(entry.file_name());
        
        if ty.is_dir() {
            copy_dir_all(src_path, dst_path)?;
        } else {
            fs::copy(src_path, dst_path)?;
        }
    }
    Ok(())
}

/// Удалить файл/папку (processing)
#[tauri::command]
pub fn processing_delete_item(item_path: String) -> Result<bool, String> {
    use std::fs;
    use std::path::Path;
    
    let path = Path::new(&item_path);
    
    if !path.exists() {
        return Ok(false);
    }
    
    if path.is_dir() {
        fs::remove_dir_all(path).map_err(|e| e.to_string())?;
    } else {
        fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    
    println!("[Processing] Deleted: {}", item_path);
    Ok(true)
}

/// Проверить существует ли путь
#[tauri::command]
#[specta::specta]
pub fn path_exists(path: String) -> Result<bool, String> {
    use std::path::Path;
    Ok(Path::new(&path).exists())
}

/// Получить информацию о файле/папке
#[tauri::command]
pub fn get_item_info(path: String) -> Result<serde_json::Value, String> {
    use std::fs;
    use std::path::Path;
    
    let p = Path::new(&path);
    
    if !p.exists() {
        return Err(format!("Path not found: {}", path));
    }
    
    let metadata = fs::metadata(p).map_err(|e| e.to_string())?;
    let is_dir = metadata.is_dir();
    let is_file = metadata.is_file();
    let size = metadata.len();
    
    let name = p.file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    
    let ext = p.extension()
        .map(|e| e.to_string_lossy().to_string())
        .unwrap_or_default();
    
    Ok(serde_json::json!({
        "path": path,
        "name": name,
        "extension": ext,
        "isDir": is_dir,
        "isFile": is_file,
        "size": size,
        "modified": metadata.modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64),
    }))
}

// Заглушка для process-item - полная реализация будет через фронтенд
#[tauri::command]
pub async fn process_item(
    _app: tauri::AppHandle,
    _item: serde_json::Value,
    _state: tauri::State<'_, Mutex<ProcessingState>>,
) -> Result<serde_json::Value, String> {
    // Processing выполняется на фронтенде через плагины
    // Эта команда只是用于向后兼容
    Err("Processing is executed on frontend via plugins".into())
}

// ==================== EVENT HELPERS ====================

pub fn emit_processing_event(
    app: &tauri::AppHandle,
    event_type: &str,
    payload: serde_json::Value,
) {
    let event = ProcessingEvent {
        event_type: event_type.to_string(),
        payload,
    };
    
    let _ = app.emit("processing-event", &event);
}

// ==================== STATUS BAR ====================

#[tauri::command]
pub fn set_status_bar(text: String, app: tauri::AppHandle) -> Result<(), String> {
    app.emit("processing-event", &ProcessingEvent {
        event_type: "statusbar".to_string(),
        payload: serde_json::json!({ "text": text }),
    }).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn send_log(
    level: String,
    text: String,
    app: tauri::AppHandle,
) -> Result<(), String> {
    app.emit("processing-event", &ProcessingEvent {
        event_type: "log".to_string(),
        payload: serde_json::json!({ "level": level, "text": text }),
    }).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn send_node_start(
    node_id: String,
    app: tauri::AppHandle,
) -> Result<(), String> {
    app.emit("processing-event", &ProcessingEvent {
        event_type: "node:start".to_string(),
        payload: serde_json::json!({ "nodeId": node_id }),
    }).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn send_node_done(
    node_id: String,
    output: serde_json::Value,
    app: tauri::AppHandle,
) -> Result<(), String> {
    app.emit("processing-event", &ProcessingEvent {
        event_type: "node:done".to_string(),
        payload: serde_json::json!({ "nodeId": node_id, "output": output }),
    }).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn send_node_error(
    node_id: String,
    message: String,
    app: tauri::AppHandle,
) -> Result<(), String> {
    app.emit("processing-event", &ProcessingEvent {
        event_type: "node:error".to_string(),
        payload: serde_json::json!({ "nodeId": node_id, "message": message }),
    }).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn send_process_complete(app: tauri::AppHandle) -> Result<(), String> {
    app.emit("processing-event", &ProcessingEvent {
        event_type: "process:complete".to_string(),
        payload: serde_json::json!(null),
    }).map_err(|e| e.to_string())?;
    Ok(())
}
