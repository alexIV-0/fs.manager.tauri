#![allow(dead_code)]

use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{Emitter, Listener, Manager, WebviewUrl, WebviewWindowBuilder};

// Хранилище для последних данных окна Node
pub struct NodeWindowState {
    pub last_data: Option<String>,
}

impl NodeWindowState {
    pub fn new() -> Self {
        Self { last_data: None }
    }
}

// Хранилище для последних данных Preview-окна (для handshake-перезапроса)
pub struct PreviewWindowState {
    pub last_data: Option<String>,
}

impl PreviewWindowState {
    pub fn new() -> Self {
        Self { last_data: None }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewOpenData {
    pub file_path: String,
    pub file_type: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct LogWindowStatus {
    pub is_open: bool,
    pub is_visible: bool,
    pub log_count: usize,
    pub stats: LogStats,
}

#[derive(Debug, Serialize, Clone)]
pub struct LogStats {
    pub total: usize,
    pub errors: usize,
    pub warnings: usize,
    pub infos: usize,
    pub debugs: usize,
}

#[derive(Debug, Serialize)]
pub struct LogHistory {
    pub items: Vec<serde_json::Value>,
}

// Хранилище для логов. items — массив ProcessingItemGroup в формате LogApp.tsx.
// logs/stats оставлены для обратной совместимости со старыми вызовами.

pub struct LogState {
    pub items: Vec<serde_json::Value>,
    pub logs: Vec<serde_json::Value>,
    pub stats: LogStats,
}

impl LogState {
    pub fn new() -> Self {
        Self {
            items: Vec::new(),
            logs: Vec::new(),
            stats: LogStats {
                total: 0,
                errors: 0,
                warnings: 0,
                infos: 0,
                debugs: 0,
            },
        }
    }
}

// ==================== NODE WINDOW ====================

#[tauri::command]
pub async fn open_node_window(app: tauri::AppHandle, data: String, state: tauri::State<'_, Mutex<NodeWindowState>>) -> Result<bool, String> {
    println!("[NodeWindow] 🚀 open_node_window called with data: {}", data);
    
    // Сохраняем данные в глобальное состояние
    {
        let mut node_state = state.lock().map_err(|e| e.to_string())?;
        node_state.last_data = Some(data.clone());
        println!("[NodeWindow] 💾 Saved data to global state");
    }
    
    // Проверяем, существует ли уже окно
    if let Some(existing_win) = app.get_webview_window("nodeWin") {
        println!("[NodeWindow] 🔄 Window already exists, showing and sending data");
        existing_win.show().map_err(|e| e.to_string())?;
        existing_win.set_focus().map_err(|e| e.to_string())?;
        // Отправляем данные
        println!("[NodeWindow] 📤 Emitting update-data to existing window");
        existing_win
            .emit("update-data", &data)
            .map_err(|e| e.to_string())?;
        println!("[NodeWindow] ✅ Data sent successfully");
        return Ok(true);
    }

    println!("[NodeWindow] ✨ Creating new window");
    // Создаём новое окно. disable_drag_drop_handler() — иначе HTML5 drag-and-drop ломается.
    let window = WebviewWindowBuilder::new(
        &app,
        "nodeWin",
        WebviewUrl::App("nodeWin.html".into()),
    )
    .title("fsManager — Node Editor")
    .inner_size(1400.0, 900.0)
    .visible(true)
    .disable_drag_drop_handler()
    .build()
    .map_err(|e| e.to_string())?;

    // Отправляем данные после загрузки
    let data_clone = data.clone();
    let app_clone = app.clone();
    println!("[NodeWindow] ⏳ Waiting for window to load...");
    window.once("tauri://loaded", move |_event| {
        println!("[NodeWindow] 📤 Window loaded, emitting update-data");
        if let Some(win) = app_clone.get_webview_window("nodeWin") {
            let _ = win.emit("update-data", &data_clone);
            println!("[NodeWindow] ✅ Initial data sent to new window");
        } else {
            println!("[NodeWindow] ❌ Could not find window after load");
        }
    });

    Ok(true)
}

// Команда для запроса данных от фронтенда (handshake)
#[tauri::command]
pub async fn request_node_window_data(state: tauri::State<'_, Mutex<NodeWindowState>>, app: tauri::AppHandle) -> Result<(), String> {
    println!("[NodeWindow] 🤝 Frontend requested data");
    
    let node_state = state.lock().map_err(|e| e.to_string())?;
    if let Some(data) = &node_state.last_data {
        println!("[NodeWindow] 📤 Sending saved data to requesting window");
        app.emit("update-data", data)
            .map_err(|e| e.to_string())?;
        println!("[NodeWindow] ✅ Data sent successfully via handshake");
    } else {
        println!("[NodeWindow] ⚠️ No saved data available");
    }
    
    Ok(())
}

#[tauri::command]
pub async fn request_data_from_main_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(main_win) = app.get_webview_window("main") {
        main_win
            .emit("give-data", "")
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn send_data_to_node_window(app: tauri::AppHandle, data: serde_json::Value) -> Result<(), String> {
    if let Some(node_win) = app.get_webview_window("nodeWin") {
        node_win
            .emit("update-data", &data)
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ==================== PREVIEW WINDOW ====================

#[tauri::command]
pub async fn preview_open(
    app: tauri::AppHandle,
    data: String,
    state: tauri::State<'_, Mutex<PreviewWindowState>>,
) -> Result<(), String> {
    let parsed: PreviewOpenData = serde_json::from_str(&data).map_err(|e| e.to_string())?;
    println!("[Preview] Opening: {}", parsed.file_path);

    // Сохраняем data для handshake-перезапроса (если окно пересоздаётся или подписка ещё не готова)
    {
        let mut st = state.lock().map_err(|e| e.to_string())?;
        st.last_data = Some(data.clone());
    }

    // Проверяем существует ли уже окно
    if let Some(existing_win) = app.get_webview_window("previewWin") {
        existing_win.show().map_err(|e| e.to_string())?;
        existing_win.set_focus().map_err(|e| e.to_string())?;
        existing_win
            .emit("update-data", &data)
            .map_err(|e| e.to_string())?;
        return Ok(());
    }

    // Создаём новое окно
    let window = WebviewWindowBuilder::new(
        &app,
        "previewWin",
        WebviewUrl::App("previewWin.html".into()),
    )
    .title("fsManager — Preview")
    .inner_size(800.0, 600.0)
    .visible(true)
    .build()
    .map_err(|e| e.to_string())?;

    // Отправляем данные после загрузки окна
    let data_clone = data.clone();
    let app_clone = app.clone();
    window.once("tauri://loaded", move |_event| {
        if let Some(win) = app_clone.get_webview_window("previewWin") {
            let _ = win.emit("update-data", &data_clone);
        }
    });

    Ok(())
}

/// Стаб: определяет наличие альфа-канала в видео. Реальная реализация требует ffprobe.
/// Пока возвращаем false — Quick Look альфа-channel webm работать не будет, но
/// обычные видео будут проигрываться нормально.
#[tauri::command]
pub fn preview_detect_alpha(_file_path: String) -> Result<bool, String> {
    Ok(false)
}

/// Стаб: транскодит webm в нужный формат для проигрывания альфа-канала.
/// Возвращает None — frontend упадёт в catch и проиграет оригинал.
#[tauri::command]
pub fn preview_transcode_webm(_file_path: String) -> Result<Option<String>, String> {
    Ok(None)
}

/// Стаб: удаляет временный файл после транскодинга.
#[tauri::command]
pub fn preview_delete_temp(_file_path: String) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
pub async fn preview_resize(app: tauri::AppHandle, opts: crate::commands::fs_commands::PreviewResizeOpts) -> Result<(), String> {
    if let Some(preview_win) = app.get_webview_window("previewWin") {
        let width = opts.width.round() as u32;
        let height = opts.height.round() as u32;
        preview_win
            .set_size(tauri::Size::Physical(tauri::PhysicalSize { width, height }))
            .map_err(|e| e.to_string())?;
        
        preview_win.center().map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ==================== DEVTOOLS ====================

#[tauri::command]
pub async fn open_devtools(_app: tauri::AppHandle) -> Result<bool, String> {
    // В Tauri v2 DevTools можно открыть только через браузер
    // Пытаемся открыть Safari с инструкцией на macOS
    #[cfg(target_os = "macos")]
    {
        use std::process::Command;
        
        // Пробуем открыть Safari и показать Web Inspector через AppleScript
        let script = r#"
            tell application "Safari"
                activate
                tell application "System Events"
                    keystroke "i" using {command down, option down}
                end tell
            end tell
        "#;
        
        let result = Command::new("osascript")
            .arg("-e")
            .arg(script)
            .output();
        
        match result {
            Ok(_) => {
                println!("[DevTools] Attempted to open Safari Web Inspector via AppleScript");
                println!("[DevTools] If it didn't work, press Cmd+Option+I manually");
            }
            Err(e) => {
                println!("[DevTools] Failed to open via AppleScript: {}", e);
                println!("[DevTools] Press Cmd+Option+I to open DevTools manually");
            }
        }
    }
    
    #[cfg(target_os = "windows")]
    {
        println!("[DevTools] Press Ctrl+Shift+I or F12 to open DevTools");
    }
    
    #[cfg(target_os = "linux")]
    {
        println!("[DevTools] Press Ctrl+Shift+I to open DevTools");
    }
    
    Ok(true)
}

// ==================== LOG WINDOW ====================

#[tauri::command]
pub fn log_message(level: String, message: String, meta: Option<serde_json::Value>, app: tauri::AppHandle, state: tauri::State<Mutex<LogState>>) {
    // Логируем в консоль
    match level.as_str() {
        "info" => println!("[INFO] {}", message),
        "warn" => println!("[WARN] {}", message),
        "error" => eprintln!("[ERROR] {}", message),
        "debug" => println!("[DEBUG] {}", message),
        _ => println!("[{}] {}", level, message),
    }

    // Добавляем в состояние
    if let Ok(mut log_state) = state.lock() {
        let log_entry = serde_json::json!({
            "level": level,
            "message": message,
            "meta": meta,
            "timestamp": chrono::Utc::now().timestamp_millis(),
        });

        log_state.logs.push(log_entry.clone());
        log_state.stats.total += 1;

        match level.as_str() {
            "error" => log_state.stats.errors += 1,
            "warn" => log_state.stats.warnings += 1,
            "info" => log_state.stats.infos += 1,
            "debug" => log_state.stats.debugs += 1,
            _ => {}
        }

        // Отправляем событие во все окна
        let _ = app.emit("log-event", log_entry);
    }
}

#[tauri::command]
pub fn log_window_open(app: tauri::AppHandle) -> Result<bool, String> {
    // Проверяем существует ли уже окно
    if let Some(existing_win) = app.get_webview_window("logWindow") {
        existing_win.show().map_err(|e| e.to_string())?;
        existing_win.set_focus().map_err(|e| e.to_string())?;
        return Ok(true);
    }

    // Создаём новое окно
    let _window = WebviewWindowBuilder::new(
        &app,
        "logWindow",
        WebviewUrl::App("logWindow.html".into()),
    )
    .title("fsManager — Log Window")
    .inner_size(1000.0, 700.0)
    .visible(true)
    .build()
    .map_err(|e| e.to_string())?;

    Ok(true)
}

#[tauri::command]
pub fn log_window_toggle() -> Result<bool, String> {
    Ok(true)
}

#[tauri::command]
pub fn log_window_close() -> Result<bool, String> {
    Ok(true)
}

#[tauri::command]
pub fn log_window_get_status(state: tauri::State<Mutex<LogState>>) -> Result<LogWindowStatus, String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    Ok(LogWindowStatus {
        is_open: true,
        is_visible: true,
        log_count: state.logs.len(),
        stats: state.stats.clone(),
    })
}

#[tauri::command]
pub fn log_window_get_history(state: tauri::State<Mutex<LogState>>) -> Result<LogHistory, String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    Ok(LogHistory {
        items: state.items.clone(),
    })
}

#[tauri::command]
pub fn log_window_clear(app: tauri::AppHandle, state: tauri::State<Mutex<LogState>>) -> Result<bool, String> {
    {
        let mut state = state.lock().map_err(|e| e.to_string())?;
        state.items.clear();
        state.logs.clear();
        state.stats = LogStats {
            total: 0,
            errors: 0,
            warnings: 0,
            infos: 0,
            debugs: 0,
        };
    }
    let _ = app.emit("log-window:cleared", ());
    Ok(true)
}

/// Экспорт логов. format: "txt" | "json". Пока возвращаем JSON; в будущем — открыть диалог сохранения.
#[tauri::command]
pub fn log_window_export(
    format: Option<String>,
    state: tauri::State<Mutex<LogState>>,
) -> Result<Option<String>, String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    if state.items.is_empty() {
        return Ok(None);
    }
    let fmt = format.unwrap_or_else(|| "json".to_string());
    if fmt == "txt" {
        // Простой текстовый дамп: itemName \n step → log lines
        let mut out = String::new();
        for it in &state.items {
            let name = it.get("itemName").and_then(|v| v.as_str()).unwrap_or("?");
            out.push_str(&format!("=== {} ===\n", name));
            if let Some(item_logs) = it.get("itemLogs").and_then(|v| v.as_array()) {
                for l in item_logs {
                    let ts = l.get("timestamp").and_then(|v| v.as_str()).unwrap_or("");
                    let lvl = l.get("level").and_then(|v| v.as_str()).unwrap_or("");
                    let msg = l.get("message").and_then(|v| v.as_str()).unwrap_or("");
                    out.push_str(&format!("[{}] [{}] {}\n", ts, lvl, msg));
                }
            }
            if let Some(steps) = it.get("steps").and_then(|v| v.as_array()) {
                for s in steps {
                    let label = s.get("label").and_then(|v| v.as_str()).unwrap_or("");
                    let status = s.get("status").and_then(|v| v.as_str()).unwrap_or("");
                    out.push_str(&format!("  - {} [{}]\n", label, status));
                    if let Some(slogs) = s.get("logs").and_then(|v| v.as_array()) {
                        for l in slogs {
                            let ts = l.get("timestamp").and_then(|v| v.as_str()).unwrap_or("");
                            let lvl = l.get("level").and_then(|v| v.as_str()).unwrap_or("");
                            let msg = l.get("message").and_then(|v| v.as_str()).unwrap_or("");
                            out.push_str(&format!("    [{}] [{}] {}\n", ts, lvl, msg));
                        }
                    }
                }
            }
            out.push('\n');
        }
        Ok(Some(out))
    } else {
        let json = serde_json::to_string_pretty(&state.items).map_err(|e| e.to_string())?;
        Ok(Some(json))
    }
}

// ==================== LOG WINDOW: запись событий обработки ====================

/// Регистрирует новый item в LogState и эмитит событие log-window:item-start.
/// payload — ProcessingItemGroup (с полями itemId, itemName, mainFolderName, projectName, status, startTime, steps, errorCount, warnCount, itemLogs).
#[tauri::command]
pub fn log_window_emit_item_start(
    app: tauri::AppHandle,
    state: tauri::State<Mutex<LogState>>,
    mut payload: serde_json::Value,
) -> Result<(), String> {
    normalize_item_group(&mut payload);
    {
        let mut st = state.lock().map_err(|e| e.to_string())?;
        let id = payload
            .get("itemId")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();
        // Заменить существующий или добавить
        if let Some(pos) = st.items.iter().position(|it| {
            it.get("itemId").and_then(|v| v.as_str()) == Some(&id)
        }) {
            st.items[pos] = payload.clone();
        } else {
            st.items.push(payload.clone());
        }
    }
    app.emit("log-window:item-start", &payload).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn log_window_emit_item_log(
    app: tauri::AppHandle,
    state: tauri::State<Mutex<LogState>>,
    payload: serde_json::Value,
) -> Result<(), String> {
    // Опционально аккумулируем лог в соответствующем item.
    if let Ok(mut st) = state.lock() {
        if let Some(item_id) = payload.get("itemId").and_then(|v| v.as_str()) {
            if let Some(it) = st.items.iter_mut().find(|it| {
                it.get("itemId").and_then(|v| v.as_str()) == Some(item_id)
            }) {
                let step_id = payload.get("stepId").and_then(|v| v.as_str()).map(String::from);
                if let Some(sid) = step_id {
                    if let Some(steps) = it.get_mut("steps").and_then(|v| v.as_array_mut()) {
                        if let Some(step) = steps.iter_mut().find(|s| {
                            s.get("stepId").and_then(|v| v.as_str()) == Some(&sid)
                        }) {
                            if let Some(logs) = step.get_mut("logs").and_then(|v| v.as_array_mut()) {
                                logs.push(payload.clone());
                            }
                        }
                    }
                } else if let Some(item_logs) = it.get_mut("itemLogs").and_then(|v| v.as_array_mut()) {
                    item_logs.push(payload.clone());
                }
            }
        }
    }
    app.emit("log-window:item-log", &payload).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn log_window_emit_node_update(
    app: tauri::AppHandle,
    state: tauri::State<Mutex<LogState>>,
    payload: serde_json::Value,
) -> Result<(), String> {
    if let Ok(mut st) = state.lock() {
        if let (Some(item_id), Some(node_id)) = (
            payload.get("itemId").and_then(|v| v.as_str()),
            payload.get("nodeId").and_then(|v| v.as_str()),
        ) {
            if let Some(it) = st.items.iter_mut().find(|it| {
                it.get("itemId").and_then(|v| v.as_str()) == Some(item_id)
            }) {
                if let Some(steps) = it.get_mut("steps").and_then(|v| v.as_array_mut()) {
                    if let Some(step) = steps.iter_mut().find(|s| {
                        s.get("stepId").and_then(|v| v.as_str()) == Some(node_id)
                    }) {
                        if let Some(s) = step.as_object_mut() {
                            for k in ["status", "startTime", "endTime", "finalCost"] {
                                if let Some(v) = payload.get(k) {
                                    s.insert(k.to_string(), v.clone());
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    app.emit("log-window:node-update", &payload).map_err(|e| e.to_string())
}

/// Нормализует payload `ProcessingItemGroup`: добавляет дефолты для полей, которые
/// LogApp ожидает увидеть (`itemLogs:[]`, `errorCount:0`, `warnCount:0`, `status:"queued"`,
/// у каждого step → `logs:[]`, `status:"queued"`, `errorCount:0`).
fn normalize_item_group(payload: &mut serde_json::Value) {
    let now = chrono::Utc::now().to_rfc3339();
    if let Some(obj) = payload.as_object_mut() {
        obj.entry("itemLogs").or_insert_with(|| serde_json::json!([]));
        obj.entry("errorCount").or_insert_with(|| serde_json::json!(0));
        obj.entry("warnCount").or_insert_with(|| serde_json::json!(0));
        obj.entry("status").or_insert_with(|| serde_json::json!("queued"));
        obj.entry("startTime").or_insert_with(|| serde_json::json!(now.clone()));
        if let Some(steps) = obj.get_mut("steps").and_then(|s| s.as_array_mut()) {
            for step in steps {
                if let Some(so) = step.as_object_mut() {
                    so.entry("logs").or_insert_with(|| serde_json::json!([]));
                    so.entry("errorCount").or_insert_with(|| serde_json::json!(0));
                    so.entry("status").or_insert_with(|| serde_json::json!("queued"));
                }
            }
        }
    }
}

/// Item поставлен в очередь — добавляется в LogState и эмитит событие item-start (с status="queued").
#[tauri::command]
pub fn log_window_emit_item_queued(
    app: tauri::AppHandle,
    state: tauri::State<Mutex<LogState>>,
    mut payload: serde_json::Value,
) -> Result<(), String> {
    normalize_item_group(&mut payload);
    {
        let mut st = state.lock().map_err(|e| e.to_string())?;
        let id = payload
            .get("itemId")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();
        if let Some(pos) = st.items.iter().position(|it| {
            it.get("itemId").and_then(|v| v.as_str()) == Some(&id)
        }) {
            st.items[pos] = payload.clone();
        } else {
            st.items.push(payload.clone());
        }
    }
    app.emit("log-window:item-start", &payload).map_err(|e| e.to_string())
}

/// Отмена ожидающих item'ов — статус всех queued items меняется на "aborted".
#[tauri::command]
pub fn log_window_emit_abort_queued(
    app: tauri::AppHandle,
    state: tauri::State<Mutex<LogState>>,
) -> Result<(), String> {
    let end_time = chrono::Utc::now().to_rfc3339();
    let mut updated: Vec<serde_json::Value> = Vec::new();
    {
        let mut st = state.lock().map_err(|e| e.to_string())?;
        for it in st.items.iter_mut() {
            let is_queued = it
                .get("status")
                .and_then(|v| v.as_str())
                .map(|s| s == "queued")
                .unwrap_or(false);
            if is_queued {
                if let Some(o) = it.as_object_mut() {
                    o.insert("status".to_string(), serde_json::json!("aborted"));
                    o.insert("endTime".to_string(), serde_json::json!(end_time.clone()));
                }
                updated.push(it.clone());
            }
        }
    }
    for it in updated {
        let item_id = it.get("itemId").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let payload = serde_json::json!({
            "itemId": item_id,
            "status": "aborted",
            "endTime": end_time.clone(),
        });
        let _ = app.emit("log-window:item-end", payload);
    }
    Ok(())
}

#[tauri::command]
pub fn log_window_emit_item_end(
    app: tauri::AppHandle,
    state: tauri::State<Mutex<LogState>>,
    payload: serde_json::Value,
) -> Result<(), String> {
    if let Ok(mut st) = state.lock() {
        if let Some(item_id) = payload.get("itemId").and_then(|v| v.as_str()) {
            if let Some(it) = st.items.iter_mut().find(|it| {
                it.get("itemId").and_then(|v| v.as_str()) == Some(item_id)
            }) {
                if let Some(s) = it.as_object_mut() {
                    for k in ["status", "endTime", "totalCost"] {
                        if let Some(v) = payload.get(k) {
                            s.insert(k.to_string(), v.clone());
                        }
                    }
                }
            }
        }
    }
    app.emit("log-window:item-end", &payload).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn log_window_open_quick() -> Result<bool, String> {
    Ok(true)
}

#[tauri::command]
pub fn log_window_open_errors_only() -> Result<bool, String> {
    Ok(true)
}

#[tauri::command]
pub fn log_window_has_errors(state: tauri::State<Mutex<LogState>>) -> Result<bool, String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    Ok(state.stats.errors > 0)
}

#[tauri::command]
pub fn log_window_get_recent(count: Option<usize>, state: tauri::State<Mutex<LogState>>) -> Result<Vec<serde_json::Value>, String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    let count = count.unwrap_or(50);
    let len = state.logs.len();
    let start = len.saturating_sub(count);
    Ok(state.logs[start..].to_vec())
}

#[tauri::command]
pub fn log_window_get_errors(state: tauri::State<Mutex<LogState>>) -> Result<Vec<serde_json::Value>, String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    let errors: Vec<serde_json::Value> = state.logs.iter()
        .filter(|log| log.get("level").and_then(|l| l.as_str()) == Some("error"))
        .cloned()
        .collect();
    Ok(errors)
}

// ==================== CONSOLE ====================

#[tauri::command]
pub fn intercept_console() {
    println!("[Console] Intercept is not needed in Tauri");
}

#[tauri::command]
pub fn restore_console() {
    println!("[Console] Restore is not needed in Tauri");
}

// ==================== REQUEST DATA ====================

/// Handshake: окно (nodeWin/previewWin) запрашивает свои данные после монтирования React.
/// Решает race-condition: tauri://loaded → emit("update-data") может произойти раньше, чем
/// React успел подписаться. Команда смотрит метку вызывающего webview и шлёт last_data.
#[tauri::command]
pub fn request_data(
    webview: tauri::Webview,
    node_state: tauri::State<'_, Mutex<NodeWindowState>>,
    preview_state: tauri::State<'_, Mutex<PreviewWindowState>>,
) {
    let label = webview.label().to_string();
    println!("[request_data] called from webview '{}'", label);

    let data = match label.as_str() {
        "nodeWin" => node_state.lock().ok().and_then(|s| s.last_data.clone()),
        "previewWin" => preview_state.lock().ok().and_then(|s| s.last_data.clone()),
        _ => None,
    };

    if let Some(d) = data {
        if let Err(e) = webview.emit_to(&label, "update-data", d) {
            eprintln!("[request_data] emit_to failed: {}", e);
        }
    } else {
        println!("[request_data] no last_data for '{}'", label);
    }
}
