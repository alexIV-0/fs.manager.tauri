use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;
use tauri::Manager;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WindowState {
    pub width: f64,
    pub height: f64,
    pub x: Option<f64>,
    pub y: Option<f64>,
    pub is_maximized: Option<bool>,
}

fn get_store_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("window-state.json"))
}

/// Сохранить состояние окна
#[tauri::command]
pub fn save_window_state(
    label: String,
    state: WindowState,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let path = get_store_path(&app)?;
    
    let mut states: std::collections::HashMap<String, WindowState> = if path.exists() {
        let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        serde_json::from_str(&content).unwrap_or_default()
    } else {
        std::collections::HashMap::new()
    };
    
    states.insert(label.clone(), state.clone());
    
    let content = serde_json::to_string_pretty(&states).map_err(|e| e.to_string())?;
    fs::write(&path, content).map_err(|e| e.to_string())?;
    
    println!("[WindowState] Saved {}: {:?}", label, state);
    Ok(())
}

/// Загрузить состояние окна
#[tauri::command]
pub fn load_window_state(
    label: String,
    app: tauri::AppHandle,
) -> Result<Option<WindowState>, String> {
    let path = get_store_path(&app)?;

    if !path.exists() {
        return Ok(None);
    }

    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let states: std::collections::HashMap<String, WindowState> =
        serde_json::from_str(&content).unwrap_or_default();

    Ok(states.get(&label).cloned())
}

// ==================== Debounced autosave ====================

/// Глобальный счётчик токенов для дебаунса: каждое Resized/Moved-событие инкрементирует
/// токен соответствующего окна; запланированный save проверяет, что его токен остался
/// последним — иначе тихо отменяется. Это работает как "сохранение по mouseup" — Tauri не
/// шлёт явный mouseup для resize/move, но события прекращают приходить когда drag окончен.
fn debounce_tokens() -> &'static Mutex<HashMap<String, u64>> {
    static TOKENS: OnceLock<Mutex<HashMap<String, u64>>> = OnceLock::new();
    TOKENS.get_or_init(|| Mutex::new(HashMap::new()))
}

const DEBOUNCE_MS: u64 = 350;

/// Регистрирует на окне обработчик Resized + Moved, который сохраняет состояние
/// с дебаунсом (по окончании drag).
pub fn register_autosave(app: &tauri::AppHandle, label: &str) {
    let win = match app.get_webview_window(label) {
        Some(w) => w,
        None => return,
    };
    let app_handle = app.clone();
    let label_owned = label.to_string();

    let _ = win.on_window_event(move |event| {
        let should_save = matches!(
            event,
            tauri::WindowEvent::Resized(_) | tauri::WindowEvent::Moved(_)
        );
        if !should_save {
            return;
        }
        schedule_save(app_handle.clone(), label_owned.clone());
    });
}

fn schedule_save(app: tauri::AppHandle, label: String) {
    let token = {
        let mut tokens = match debounce_tokens().lock() {
            Ok(t) => t,
            Err(_) => return,
        };
        let entry = tokens.entry(label.clone()).or_insert(0);
        *entry += 1;
        *entry
    };

    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_millis(DEBOUNCE_MS)).await;

        // Проверяем что наш токен всё ещё актуален — иначе пришли новые события, мы устарели.
        let is_current = {
            let tokens = match debounce_tokens().lock() {
                Ok(t) => t,
                Err(_) => return,
            };
            tokens.get(&label).copied() == Some(token)
        };
        if !is_current {
            return;
        }

        let Some(win) = app.get_webview_window(&label) else { return; };
        let size = match win.inner_size() {
            Ok(s) => s,
            Err(_) => return,
        };
        let pos = win.outer_position().ok();
        let is_maximized = win.is_maximized().ok();

        let state = WindowState {
            width: size.width as f64,
            height: size.height as f64,
            x: pos.map(|p| p.x as f64),
            y: pos.map(|p| p.y as f64),
            is_maximized,
        };
        let _ = save_window_state(label.clone(), state, app);
    });
}
