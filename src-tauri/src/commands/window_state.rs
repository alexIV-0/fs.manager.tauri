use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;
use tauri::Manager;

#[derive(Debug, Serialize, Deserialize, Clone, specta::Type)]
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
#[specta::specta]
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
#[specta::specta]
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

/// Восстанавливает сохранённые размер/позицию для окна по его label из window-state.json.
/// Безопасно при отсутствии файла или записи — окно просто остаётся с initial размером.
pub fn apply_saved_state(app: &tauri::AppHandle, label: &str) {
    let Some(win) = app.get_webview_window(label) else { return; };
    let Ok(Some(state)) = load_window_state(label.to_string(), app.clone()) else { return; };
    apply_state_to_window(&win, &state);
}

/// Применяет размер+позицию к окну с защитой от «потерянного» окна: если сохранённая
/// позиция не попадает ни на один подключённый монитор (экран отключили / сменилось
/// разрешение), окно центрируется на первичном мониторе. Используется и для main,
/// и для nodeWin/logWindow — единая точка восстановления.
pub fn apply_state_to_window(win: &tauri::WebviewWindow, state: &WindowState) {
    let _ = win.set_size(tauri::Size::Physical(tauri::PhysicalSize {
        width: state.width as u32,
        height: state.height as u32,
    }));

    if let (Some(x), Some(y)) = (state.x, state.y) {
        let (px, py) = clamp_to_visible(win, x as i32, y as i32, state.width as u32, state.height as u32);
        let _ = win.set_position(tauri::Position::Physical(tauri::PhysicalPosition { x: px, y: py }));
    }
}

/// Возвращает безопасную позицию: исходную, если окно видно «ручкой» хотя бы на одном
/// мониторе, иначе — координаты центрирования на первичном (или первом доступном) мониторе.
fn clamp_to_visible(win: &tauri::WebviewWindow, x: i32, y: i32, w: u32, h: u32) -> (i32, i32) {
    let monitors = win.available_monitors().unwrap_or_default();
    if monitors.is_empty() {
        return (x, y); // нет данных о мониторах — не трогаем
    }

    // Сколько окна должно быть видно, чтобы за заголовок можно было схватиться мышкой.
    const MIN_VISIBLE_W: i32 = 120;
    const MIN_VISIBLE_H: i32 = 40;

    let (w, h) = (w as i32, h as i32);

    for m in &monitors {
        let mp = m.position();
        let ms = m.size();
        let overlap_w = (x + w).min(mp.x + ms.width as i32) - x.max(mp.x);
        let overlap_h = (y + h).min(mp.y + ms.height as i32) - y.max(mp.y);
        if overlap_w >= MIN_VISIBLE_W && overlap_h >= MIN_VISIBLE_H {
            return (x, y); // достаточно видно на этом мониторе — позиция валидна
        }
    }

    // Окна не видно ни на одном экране → центрируем на первичном (или первом) мониторе.
    let target = win
        .primary_monitor()
        .ok()
        .flatten()
        .or_else(|| monitors.into_iter().next());
    if let Some(m) = target {
        let mp = m.position();
        let ms = m.size();
        let cx = mp.x + (ms.width as i32 - w).max(0) / 2;
        let cy = mp.y + (ms.height as i32 - h).max(0) / 2;
        println!("[WindowState] Saved position off-screen → recenter to ({}, {})", cx, cy);
        return (cx, cy);
    }
    (x, y)
}

/// Если окно по своей текущей геометрии не видно ни на одном мониторе — центрирует его
/// на текущем экране. В отличие от clamp_to_visible работает с уже созданным окном
/// (читает его реальные outer_position/outer_size в physical px) — удобно для preview-окон,
/// которые спавнятся по сохранённой/каскадной позиции и могут уехать за пределы экрана.
pub fn ensure_on_screen(win: &tauri::WebviewWindow) {
    let (Ok(pos), Ok(size)) = (win.outer_position(), win.outer_size()) else {
        return;
    };
    let monitors = win.available_monitors().unwrap_or_default();
    if monitors.is_empty() {
        return;
    }

    const MIN_VISIBLE_W: i32 = 120;
    const MIN_VISIBLE_H: i32 = 40;
    let (x, y) = (pos.x, pos.y);
    let (w, h) = (size.width as i32, size.height as i32);

    for m in &monitors {
        let mp = m.position();
        let ms = m.size();
        let overlap_w = (x + w).min(mp.x + ms.width as i32) - x.max(mp.x);
        let overlap_h = (y + h).min(mp.y + ms.height as i32) - y.max(mp.y);
        if overlap_w >= MIN_VISIBLE_W && overlap_h >= MIN_VISIBLE_H {
            return; // видно на этом мониторе — ничего не делаем
        }
    }

    println!("[WindowState] preview window off-screen → centered");
    let _ = win.center();
}

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
