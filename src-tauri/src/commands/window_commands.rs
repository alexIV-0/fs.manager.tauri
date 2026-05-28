#![allow(dead_code)]

use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{Emitter, Listener, Manager, WebviewUrl, WebviewWindowBuilder};

// macOS-специфика: между NSWindow content area и WKWebView viewport есть постоянное
// расхождение по высоте — WebView оставляет 28px сверху (предположительно safe-area
// под titlebar). Tauri's set_size задаёт NSWindow content, а JS видит WebView viewport.
// Поэтому при ресайзе под видео мы добавляем 28px к высоте, а при сохранении bounds
// — вычитаем 28px (сохраняем viewport-размер, не NSWindow-размер).
#[cfg(target_os = "macos")]
pub const WEBVIEW_TOP_INSET: f64 = 28.0;
#[cfg(not(target_os = "macos"))]
pub const WEBVIEW_TOP_INSET: f64 = 0.0;

// На macOS используем NSWindow.setContentAspectRatio: — нативное OS-level ограничение
// пропорций при ручном ресайзе. Без него `set_size` из обработчика Resized во время
// живого drag'а либо игнорируется OS, либо вызывает мерцание.
#[cfg(target_os = "macos")]
mod ns_window_aspect {
    use std::ffi::c_void;
    use std::os::raw::c_char;

    #[repr(C)]
    #[derive(Copy, Clone, Debug)]
    pub struct CGSize {
        pub width: f64,
        pub height: f64,
    }

    extern "C" {
        fn sel_registerName(name: *const c_char) -> *mut c_void;
        fn objc_msgSend();
    }

    /// Устанавливает соотношение сторон контента окна (width:height).
    /// OS ограничивает пользовательский ресайз этой пропорцией.
    /// Передать `CGSize { width: 0.0, height: 0.0 }` чтобы снять ограничение.
    pub unsafe fn set_content_aspect_ratio(ns_window: *mut c_void, ratio: CGSize) {
        if ns_window.is_null() {
            return;
        }
        let sel = sel_registerName(b"setContentAspectRatio:\0".as_ptr() as *const c_char);
        if sel.is_null() {
            return;
        }
        // objc_msgSend в реальности — variadic, но Rust требует фиксированных сигнатур.
        // Транмутируем к нужной сигнатуре; ABI (System V/AAPCS) корректно передаст CGSize.
        let msg: extern "C" fn(*mut c_void, *mut c_void, CGSize) =
            std::mem::transmute(objc_msgSend as *const ());
        msg(ns_window, sel, ratio);
    }

}

// Windows-аналог macOS-ного setContentAspectRatio:.
// macOS даёт OS-level aspect-constraint одним вызовом; на Windows такого API нет,
// поэтому подключаемся к WM_SIZING через SetWindowSubclass и корректируем
// предлагаемый RECT под нужное соотношение прямо во время drag'а.
#[cfg(target_os = "windows")]
mod win_aspect {
    use std::sync::atomic::{AtomicU64, Ordering};
    use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, RECT, WPARAM};
    use windows::Win32::UI::Shell::{DefSubclassProc, SetWindowSubclass};
    use windows::Win32::UI::WindowsAndMessaging::{
        GetClientRect, GetWindowRect, WMSZ_BOTTOM, WMSZ_BOTTOMLEFT, WMSZ_BOTTOMRIGHT,
        WMSZ_LEFT, WMSZ_RIGHT, WMSZ_TOP, WMSZ_TOPLEFT, WMSZ_TOPRIGHT, WM_SIZING,
    };

    // Соотношение сторон (width/height) хранится глобально — в процессе одно
    // preview-окно. f64 → биты в AtomicU64, 0 = ограничение снято.
    static ASPECT_BITS: AtomicU64 = AtomicU64::new(0);
    const SUBCLASS_ID: usize = 0xFAFA_F501;

    /// Устанавливает aspect-constraint для окна и (пере)ставит subclass на текущий HWND.
    /// SetWindowSubclass идемпотентен по паре (pfnSubclass, uIdSubclass), поэтому
    /// безопасен при повторных вызовах. Пересоздание окна → новый HWND → новый subclass.
    pub fn set_aspect_ratio(hwnd_raw: *mut core::ffi::c_void, ratio: f64) {
        if !(ratio.is_finite() && ratio > 0.0) {
            ASPECT_BITS.store(0, Ordering::Relaxed);
            return;
        }
        ASPECT_BITS.store(ratio.to_bits(), Ordering::Relaxed);

        if hwnd_raw.is_null() {
            return;
        }
        unsafe {
            let hwnd = HWND(hwnd_raw);
            let _ = SetWindowSubclass(hwnd, Some(subclass_proc), SUBCLASS_ID, 0);
        }
    }

    unsafe extern "system" fn subclass_proc(
        hwnd: HWND,
        msg: u32,
        wparam: WPARAM,
        lparam: LPARAM,
        _uidsubclass: usize,
        _dwrefdata: usize,
    ) -> LRESULT {
        if msg == WM_SIZING {
            let bits = ASPECT_BITS.load(Ordering::Relaxed);
            if bits != 0 {
                let ratio = f64::from_bits(bits);
                if ratio.is_finite() && ratio > 0.0 && lparam.0 != 0 {
                    let rect = &mut *(lparam.0 as *mut RECT);
                    apply_aspect(hwnd, rect, wparam.0 as u32, ratio);
                }
            }
        }
        unsafe { DefSubclassProc(hwnd, msg, wparam, lparam) }
    }

    /// Подгоняет proposed window-RECT под aspect ratio CLIENT-области, удерживая
    /// edge, который сейчас не тащит пользователь.
    fn apply_aspect(hwnd: HWND, rect: &mut RECT, edge: u32, ratio: f64) {
        let mut win_rect = RECT::default();
        let mut cli_rect = RECT::default();
        unsafe {
            let _ = GetWindowRect(hwnd, &mut win_rect);
            let _ = GetClientRect(hwnd, &mut cli_rect);
        }
        let frame_w = (win_rect.right - win_rect.left) - (cli_rect.right - cli_rect.left);
        let frame_h = (win_rect.bottom - win_rect.top) - (cli_rect.bottom - cli_rect.top);

        let proposed_w = (rect.right - rect.left) - frame_w;
        let proposed_h = (rect.bottom - rect.top) - frame_h;
        if proposed_w <= 0 || proposed_h <= 0 {
            return;
        }

        let drives_width = match edge {
            WMSZ_LEFT | WMSZ_RIGHT => true,
            WMSZ_TOP | WMSZ_BOTTOM => false,
            WMSZ_TOPLEFT | WMSZ_TOPRIGHT | WMSZ_BOTTOMLEFT | WMSZ_BOTTOMRIGHT => {
                // Корнер — берём то измерение, по которому окно сейчас «уже» от нужной
                // пропорции, чтобы коррекция шла в сторону расширения.
                let cur_ratio = proposed_w as f64 / proposed_h.max(1) as f64;
                cur_ratio < ratio
            }
            _ => return,
        };

        let (new_w, new_h) = if drives_width {
            (proposed_w, ((proposed_w as f64) / ratio).round() as i32)
        } else {
            (((proposed_h as f64) * ratio).round() as i32, proposed_h)
        };

        let final_w = new_w + frame_w;
        let final_h = new_h + frame_h;

        match edge {
            WMSZ_LEFT => {
                rect.left = rect.right - final_w;
                rect.bottom = rect.top + final_h;
            }
            WMSZ_RIGHT => {
                rect.right = rect.left + final_w;
                rect.bottom = rect.top + final_h;
            }
            WMSZ_TOP => {
                rect.top = rect.bottom - final_h;
                rect.right = rect.left + final_w;
            }
            WMSZ_BOTTOM => {
                rect.bottom = rect.top + final_h;
                rect.right = rect.left + final_w;
            }
            WMSZ_TOPLEFT => {
                rect.left = rect.right - final_w;
                rect.top = rect.bottom - final_h;
            }
            WMSZ_TOPRIGHT => {
                rect.right = rect.left + final_w;
                rect.top = rect.bottom - final_h;
            }
            WMSZ_BOTTOMLEFT => {
                rect.left = rect.right - final_w;
                rect.bottom = rect.top + final_h;
            }
            WMSZ_BOTTOMRIGHT => {
                rect.right = rect.left + final_w;
                rect.bottom = rect.top + final_h;
            }
            _ => {}
        }
    }
}

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
    /// Соотношение сторон медиафайла (width / height). None — не установлено.
    pub aspect_ratio: Option<f64>,
    /// Физический размер окна, который мы сами задали для коррекции пропорций.
    /// Используется чтобы пропустить Resized-событие, порождённое нашей же коррекцией.
    pub last_corrected: Option<(u32, u32)>,
}

impl PreviewWindowState {
    pub fn new() -> Self {
        Self { last_data: None, aspect_ratio: None, last_corrected: None }
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
            .emit_to("nodeWin", "update-data", &data)
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

    // Edit-меню для нового окна: без него macOS не маршрутизирует Cmd+C/V.
    #[cfg(target_os = "macos")]
    {
        use tauri::menu::{Menu, Submenu, PredefinedMenuItem};
        let _ = (|| -> Result<(), tauri::Error> {
            let edit = Submenu::with_items(&app, "Edit", true, &[
                &PredefinedMenuItem::undo(&app, None)?,
                &PredefinedMenuItem::redo(&app, None)?,
                &PredefinedMenuItem::separator(&app)?,
                &PredefinedMenuItem::cut(&app, None)?,
                &PredefinedMenuItem::copy(&app, None)?,
                &PredefinedMenuItem::paste(&app, None)?,
                &PredefinedMenuItem::select_all(&app, None)?,
            ])?;
            let menu = Menu::with_items(&app, &[&edit])?;
            window.set_menu(menu)?;
            Ok(())
        })();
    }

    // Отправляем данные после загрузки
    let data_clone = data.clone();
    let app_clone = app.clone();
    println!("[NodeWindow] ⏳ Waiting for window to load...");
    window.once("tauri://loaded", move |_event| {
        println!("[NodeWindow] 📤 Window loaded, emitting update-data");
        if let Some(win) = app_clone.get_webview_window("nodeWin") {
            let _ = win.emit_to("nodeWin", "update-data", &data_clone);
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
//
// Логика портирована из electron/main/index.ts + electron/main/previewBounds.ts.
// Ключевая идея — bounds-per-file-type:
//   * Для каждого типа (video/image/audio/text/...) свой сохранённый размер и позиция.
//   * Когда открываем preview и для типа уже есть сохранённый размер — НЕ ТРОГАЕМ его,
//     preview_resize применит только aspect-constraint.
//   * Когда тип меняется и сохранённых bounds нет — preview_resize подгоняет под видео
//     и центрирует (один раз).
//   * Любой resize/move сохраняет bounds под текущим типом и ставит lock=true.

#[tauri::command]
pub async fn preview_open(
    app: tauri::AppHandle,
    data: String,
    state: tauri::State<'_, Mutex<PreviewWindowState>>,
    bounds_state: tauri::State<'_, Mutex<crate::commands::preview_bounds::PreviewBoundsState>>,
) -> Result<(), String> {
    use crate::commands::preview_bounds as pb;

    let parsed: PreviewOpenData = serde_json::from_str(&data).map_err(|e| e.to_string())?;
    println!("[Preview] Opening: {} (type={})", parsed.file_path, parsed.file_type);

    let next_type = pb::normalize_type(&parsed.file_type);

    // Сохраняем data для handshake-перезапроса.
    {
        let mut st = state.lock().map_err(|e| e.to_string())?;
        st.last_data = Some(data.clone());
    }

    // Окно уже существует — обновляем контент. preview_resize позже подберёт
    // правильный размер/позицию по orientation-bucket'у новой записи.
    if let Some(existing_win) = app.get_webview_window("previewWin") {
        let prev_path = {
            let bs = bounds_state.lock().map_err(|e| e.to_string())?;
            bs.current_file_path.clone()
        };

        // Тот же файл — Space-toggle: закрываем окно.
        if prev_path.as_deref() == Some(parsed.file_path.as_str()) {
            let _ = existing_win.close();
            return Ok(());
        }

        {
            let mut bs = bounds_state.lock().map_err(|e| e.to_string())?;
            bs.current_file_path = Some(parsed.file_path.clone());
            bs.current_type = next_type.clone();
            bs.should_center = false; // окно уже на экране — не центрируем
        }

        existing_win.show().map_err(|e| e.to_string())?;
        existing_win.set_focus().map_err(|e| e.to_string())?;
        existing_win
            .emit_to("previewWin", "update-data", &data)
            .map_err(|e| e.to_string())?;
        return Ok(());
    }

    // Окна нет — создаём. Initial size берём из любого сохранённого bounds для
    // этого типа (любой ориентации) — чтобы минимизировать визуальный flicker
    // перед тем как preview_resize выставит точный размер под актуальную
    // ориентацию видео.
    let any_saved = pb::any_bounds_for_type(&app, &next_type);
    let (init_w, init_h) = any_saved
        .as_ref()
        .map(|b| (b.width, b.height))
        .unwrap_or((800.0, 600.0));

    {
        let mut bs = bounds_state.lock().map_err(|e| e.to_string())?;
        bs.current_type = next_type.clone();
        bs.current_file_path = Some(parsed.file_path.clone());
        bs.should_center = any_saved.is_none();
    }

    let mut builder = WebviewWindowBuilder::new(
        &app,
        "previewWin",
        WebviewUrl::App("previewWin.html".into()),
    )
    .title("fsManager — Preview")
    .inner_size(init_w, init_h)
    .visible(true);

    if let Some(b) = &any_saved {
        if let (Some(x), Some(y)) = (b.x, b.y) {
            builder = builder.position(x, y);
        }
    }

    let window = builder.build().map_err(|e| e.to_string())?;

    // Отправляем данные после загрузки окна.
    let data_clone = data.clone();
    let app_clone = app.clone();
    window.once("tauri://loaded", move |_event| {
        if let Some(win) = app_clone.get_webview_window("previewWin") {
            let _ = win.emit_to("previewWin", "update-data", &data_clone);
        }
    });

    // Resize/Move handler: сохраняем bounds под текущим типом и ставим lock.
    // Это работает и для пользовательского ресайза, и для нашего setContentSize —
    // в обоих случаях после первого вызова бунды зафиксированы.
    let app_for_save = app.clone();
    window.on_window_event(move |event| {
        match event {
            tauri::WindowEvent::Resized(s) => {
                // DEBUG: смотрим что реально применилось — это physical inner size окна
                if let Some(win) = app_for_save.get_webview_window("previewWin") {
                    let outer = win.outer_size().ok();
                    let inner = win.inner_size().ok();
                    let aspect = inner.as_ref().map(|i| i.width as f64 / i.height.max(1) as f64);
                    println!(
                        "[previewWin Resized] event.physical={}x{} | inner={:?} outer={:?} aspect={:?}",
                        s.width, s.height, inner, outer, aspect
                    );
                }
                save_current_bounds(&app_for_save);
            }
            tauri::WindowEvent::Moved(_) => {
                save_current_bounds(&app_for_save);
            }
            _ => {}
        }
    });

    // Close handler: сбрасываем state preview_bounds, чтобы следующий preview_open
    // пересоздал окно с восстановленными bounds.
    let app_for_close = app.clone();
    window.on_window_event(move |event| {
        if matches!(event, tauri::WindowEvent::Destroyed) {
            let bs = app_for_close.state::<Mutex<pb::PreviewBoundsState>>();
            let _ = bs.lock().map(|mut guard| {
                guard.current_file_path = None;
                guard.bounds_locked = false;
                guard.should_center = false;
                // current_type оставляем — пригодится для следующего открытия
            });
        }
    });

    Ok(())
}

/// Снимает bounds окна (inner size + outer position в logical px) и сохраняет
/// под ключом "{type}_{orientation}" — для каждой ориентации свои размеры.
fn save_current_bounds(app: &tauri::AppHandle) {
    use crate::commands::preview_bounds as pb;

    let Some(win) = app.get_webview_window("previewWin") else { return };
    let Ok(inner) = win.inner_size() else { return };
    let pos = win.outer_position().ok();
    let scale = win.scale_factor().unwrap_or(1.0);

    let logical_w = inner.width as f64 / scale;
    let nswindow_logical_h = inner.height as f64 / scale;
    // Сохраняем размер VIEWPORT (а не NSWindow content). preview_resize при
    // восстановлении добавит обратно WEBVIEW_TOP_INSET.
    let logical_h = nswindow_logical_h - WEBVIEW_TOP_INSET;

    if logical_w < 1.0 || logical_h < 1.0 {
        return;
    }

    let aspect = logical_w / logical_h;

    let bounds = pb::PreviewBounds {
        width: logical_w,
        height: logical_h,
        x: pos.map(|p| p.x as f64 / scale),
        y: pos.map(|p| p.y as f64 / scale),
    };

    let current_type = {
        let bs = app.state::<Mutex<pb::PreviewBoundsState>>();
        let result = bs.lock().ok().map(|g| g.current_type.clone());
        match result {
            Some(t) => t,
            None => return,
        }
    };

    let key = pb::make_key(&current_type, aspect);
    let _ = pb::save_bounds(app, &key, bounds);

    {
        let bs = app.state::<Mutex<pb::PreviewBoundsState>>();
        let _ = bs.lock().map(|mut g| { g.bounds_locked = true; });
    }
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

/// Подгонка окна под видео + установка aspect-constraint.
///
/// Логика (доработка Electron'овской):
///   * Bounds сохраняются под ключом "{type}_{orientation}" — отдельно vertical/
///     horizontal/square. Это решает проблему letterbox'а при переключении между
///     9:16 и 16:9 видео — каждая ориентация имеет свои сохранённые размеры.
///   * Если для текущей ориентации есть сохранённые bounds — применяем их.
///     Иначе ресайзим под native-размеры видео.
///   * Aspect-constraint (для пользовательского drag-ресайза) ставим всегда.
#[tauri::command]
pub async fn preview_resize(
    app: tauri::AppHandle,
    opts: crate::commands::fs_commands::PreviewResizeOpts,
    _state: tauri::State<'_, Mutex<PreviewWindowState>>,
    bounds_state: tauri::State<'_, Mutex<crate::commands::preview_bounds::PreviewBoundsState>>,
) -> Result<(), String> {
    use crate::commands::preview_bounds as pb;

    let Some(preview_win) = app.get_webview_window("previewWin") else {
        return Ok(());
    };

    let new_aspect = opts.width / opts.height.max(1.0);
    let current_type = {
        let bs = bounds_state.lock().map_err(|e| e.to_string())?;
        bs.current_type.clone()
    };
    let key = pb::make_key(&current_type, new_aspect);
    let (saved, has_saved) = pb::bounds_for_type(&app, &key);

    // Используем сохранённые bounds если есть и их aspect близко к новому,
    // иначе — native размеры видео.
    let (target_w, target_h) = if has_saved {
        let saved_aspect = saved.width / saved.height.max(1.0);
        if (saved_aspect - new_aspect).abs() / new_aspect < 0.05 {
            (saved.width, saved.height)
        } else {
            // Сохранённое не подходит — берём native (не должно случаться благодаря
            // ориентационному bucket'у, но защита на случай tolerance).
            (opts.width, opts.height)
        }
    } else {
        (opts.width, opts.height)
    };

    let scale = preview_win.scale_factor().unwrap_or(1.0);
    let before_inner = preview_win.inner_size().ok();
    let before_outer = preview_win.outer_size().ok();

    println!(
        "[preview_resize] type={} aspect={:.3} key={} has_saved={} → target={}x{} pos={:?} | scale={}",
        current_type, new_aspect, key, has_saved, target_w, target_h,
        (saved.x, saved.y), scale
    );
    let titlebar_logical = match (before_outer.as_ref(), before_inner.as_ref()) {
        (Some(o), Some(i)) => Some((o.height as f64 - i.height as f64) / scale),
        _ => None,
    };
    println!(
        "[preview_resize] BEFORE set_size: inner={:?} outer={:?} | titlebar_logical={:?}",
        before_inner, before_outer, titlebar_logical
    );

    // 1) Размер окна.
    // target_w/target_h — это желаемый размер WKWebView VIEWPORT (что увидит JS как
    // window.innerWidth/innerHeight). Из-за safe-area WebView на macOS — NSWindow
    // content area должна быть на WEBVIEW_TOP_INSET больше по высоте, чтобы viewport
    // получился ровно target_h.
    let nswindow_h = target_h + WEBVIEW_TOP_INSET;
    preview_win
        .set_size(tauri::Size::Logical(tauri::LogicalSize {
            width: target_w,
            height: nswindow_h,
        }))
        .map_err(|e| e.to_string())?;

    // tao на macOS делает setContentSize асинхронно. Дождёмся для логирования.
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;

    let after_inner = preview_win.inner_size().ok();
    println!(
        "[preview_resize] AFTER set_size({}, {}): inner={:?} | expected webview viewport={}x{}",
        target_w, nswindow_h, after_inner, target_w, target_h
    );

    // 2) Позиция — только если есть сохранённая для этой ориентации.
    if let (Some(x), Some(y)) = (saved.x, saved.y) {
        let _ = preview_win.set_position(tauri::Position::Logical(tauri::LogicalPosition {
            x,
            y,
        }));
    }

    // 3) Aspect-constraint (всегда). На macOS — нативный setContentAspectRatio:.
    //    На Windows — subclass HWND и перехват WM_SIZING, поведение эквивалентно.
    #[cfg(target_os = "macos")]
    {
        if let Some(ratio) = opts.aspect_ratio {
            if ratio > 0.0 {
                if let Ok(ns_window) = preview_win.ns_window() {
                    let ns = ns_window as *mut _;
                    let ratio_size = ns_window_aspect::CGSize {
                        width: opts.width,
                        height: opts.height,
                    };
                    unsafe {
                        ns_window_aspect::set_content_aspect_ratio(ns, ratio_size);
                    }
                }
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        if let Some(ratio) = opts.aspect_ratio {
            if ratio > 0.0 {
                if let Ok(hwnd) = preview_win.hwnd() {
                    win_aspect::set_aspect_ratio(hwnd.0, ratio);
                }
            }
        }
    }

    // 4) Центрируем один раз если нет сохранённой позиции и стоит флаг.
    let should_center = {
        let bs = bounds_state.lock().map_err(|e| e.to_string())?;
        bs.should_center && !has_saved
    };
    if should_center {
        let _ = preview_win.center();
        let _ = bounds_state.lock().map(|mut bs| { bs.should_center = false; });
    }

    Ok(())
}

// ==================== DEVTOOLS ====================

/// Toggles the Web Inspector for the window that invoked the command.
/// `window` is injected by Tauri — it's the caller's own webview, so F12 in any
/// window opens that window's devtools. The inspector methods are compiled in
/// because `tauri` is built with the `devtools` feature (see Cargo.toml).
#[tauri::command]
pub fn open_devtools(window: tauri::WebviewWindow) -> Result<bool, String> {
    if window.is_devtools_open() {
        window.close_devtools();
        Ok(false)
    } else {
        window.open_devtools();
        Ok(true)
    }
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

/// Рекурсивный поиск шага по stepId среди steps + subSteps (для loop'ов).
/// Возвращает mut-ссылку на найденный шаг. Сначала ищется индекс (без &mut), затем
/// возвращается &mut по этому индексу — иначе borrow checker не пропускает один &mut
/// борровинг через двухпроходный поиск.
fn find_step_mut<'a>(steps: &'a mut Vec<serde_json::Value>, step_id: &str) -> Option<&'a mut serde_json::Value> {
    enum Hit {
        Top(usize),
        Nested(usize),
    }
    let mut hit: Option<Hit> = None;
    for (i, step) in steps.iter().enumerate() {
        if step.get("stepId").and_then(|v| v.as_str()) == Some(step_id) {
            hit = Some(Hit::Top(i));
            break;
        }
    }
    if hit.is_none() {
        for (i, step) in steps.iter().enumerate() {
            if let Some(subs) = step.get("subSteps").and_then(|v| v.as_array()) {
                if find_step_index_recursive(subs, step_id) {
                    hit = Some(Hit::Nested(i));
                    break;
                }
            }
        }
    }
    match hit {
        Some(Hit::Top(i)) => Some(&mut steps[i]),
        Some(Hit::Nested(i)) => {
            let subs = steps[i].get_mut("subSteps")?.as_array_mut()?;
            find_step_mut(subs, step_id)
        }
        None => None,
    }
}

/// Immutable-проверка: есть ли где-то ниже шаг с таким stepId.
fn find_step_index_recursive(steps: &[serde_json::Value], step_id: &str) -> bool {
    for step in steps {
        if step.get("stepId").and_then(|v| v.as_str()) == Some(step_id) {
            return true;
        }
        if let Some(subs) = step.get("subSteps").and_then(|v| v.as_array()) {
            if find_step_index_recursive(subs, step_id) {
                return true;
            }
        }
    }
    false
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
                let mut routed_to_step = false;
                if let Some(sid) = step_id.as_deref() {
                    if let Some(steps) = it.get_mut("steps").and_then(|v| v.as_array_mut()) {
                        if let Some(step) = find_step_mut(steps, sid) {
                            if let Some(logs) = step.get_mut("logs").and_then(|v| v.as_array_mut()) {
                                logs.push(payload.clone());
                                routed_to_step = true;
                            }
                        }
                    }
                }
                // stepId не указан или не найден — на item-уровень
                if !routed_to_step {
                    if let Some(item_logs) = it.get_mut("itemLogs").and_then(|v| v.as_array_mut()) {
                        item_logs.push(payload.clone());
                    }
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
                    if let Some(step) = find_step_mut(steps, node_id) {
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

/// Сколько завершённых item'ов держим в горячем буфере (RAM). Активные (queued/running)
/// не ограничиваем. Старые завершённые уже лежат в архиве на диске — их можно открыть
/// во вкладке «Архив». Это и не даёт окну логов вешать программу при больших сессиях.
const HOT_BUFFER_FINISHED_LIMIT: usize = 40;

/// Обрезает st.items: оставляет все активные (queued/running) + последние N завершённых,
/// удаляя самые старые завершённые. Порядок остальных элементов сохраняется.
fn trim_hot_buffer(items: &mut Vec<serde_json::Value>) {
    let is_active = |it: &serde_json::Value| {
        matches!(
            it.get("status").and_then(|v| v.as_str()),
            Some("queued") | Some("running")
        )
    };
    let finished_total = items.iter().filter(|it| !is_active(it)).count();
    if finished_total <= HOT_BUFFER_FINISHED_LIMIT {
        return;
    }
    let mut to_drop = finished_total - HOT_BUFFER_FINISHED_LIMIT;
    items.retain(|it| {
        if to_drop > 0 && !is_active(it) {
            to_drop -= 1;
            false
        } else {
            true
        }
    });
}

/// Loop отправил батч саб-шагов очередной итерации. payload:
///   { itemId, parentStepId, subSteps: [{ stepId, label, pluginId?, pluginVersion?,
///                                         nodeType, cost?, costUnit?, status, logs, errorCount }] }
/// Дописывает входящие шаги в parent.subSteps и эмитит `log-window:substep-batch` в renderer.
#[tauri::command]
pub fn log_window_emit_substep_batch(
    app: tauri::AppHandle,
    state: tauri::State<Mutex<LogState>>,
    payload: serde_json::Value,
) -> Result<(), String> {
    if let Ok(mut st) = state.lock() {
        if let (Some(item_id), Some(parent_id)) = (
            payload.get("itemId").and_then(|v| v.as_str()),
            payload.get("parentStepId").and_then(|v| v.as_str()),
        ) {
            if let Some(it) = st.items.iter_mut().find(|it| {
                it.get("itemId").and_then(|v| v.as_str()) == Some(item_id)
            }) {
                if let Some(steps) = it.get_mut("steps").and_then(|v| v.as_array_mut()) {
                    if let Some(parent) = find_step_mut(steps, parent_id) {
                        if let Some(parent_obj) = parent.as_object_mut() {
                            let entry = parent_obj
                                .entry("subSteps".to_string())
                                .or_insert_with(|| serde_json::json!([]));
                            if let Some(arr) = entry.as_array_mut() {
                                if let Some(incoming) = payload.get("subSteps").and_then(|v| v.as_array()) {
                                    // Дедуп по stepId — защита от двойной доставки.
                                    let existing: std::collections::HashSet<String> = arr
                                        .iter()
                                        .filter_map(|s| s.get("stepId").and_then(|v| v.as_str()).map(String::from))
                                        .collect();
                                    for s in incoming {
                                        let sid = s.get("stepId").and_then(|v| v.as_str()).unwrap_or("");
                                        if existing.contains(sid) {
                                            continue;
                                        }
                                        let mut sub = s.clone();
                                        if let Some(so) = sub.as_object_mut() {
                                            so.entry("logs").or_insert_with(|| serde_json::json!([]));
                                            so.entry("errorCount").or_insert_with(|| serde_json::json!(0));
                                            so.entry("status").or_insert_with(|| serde_json::json!("queued"));
                                        }
                                        arr.push(sub);
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    app.emit("log-window:substep-batch", &payload).map_err(|e| e.to_string())
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
    db_state: tauri::State<Mutex<super::db_analytics::DbState>>,
    payload: serde_json::Value,
) -> Result<(), String> {
    // Завершённую лог-группу архивируем на диск и обрезаем горячий буфер в RAM.
    let mut finished_group: Option<serde_json::Value> = None;
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
                finished_group = Some(it.clone());
            }
        }
        trim_hot_buffer(&mut st.items);
    }

    // Архивация — вне блокировки state, чтобы не держать мьютекс на время записи в файл.
    if let Some(group) = &finished_group {
        super::log_archive::append_item(&app, group);
    }

    if let Some(item_id) = payload.get("itemId").and_then(|v| v.as_str()) {
        let status    = payload.get("status").and_then(|v| v.as_str()).unwrap_or("unknown");
        let cost      = payload.get("totalCost").and_then(|v| v.as_f64()).unwrap_or(0.0);
        let ended_at  = payload.get("endTime").and_then(|v| v.as_str()).unwrap_or("");
        let duration  = payload.get("duration").and_then(|v| v.as_str()).unwrap_or("00:00:00");
        if let Ok(db) = db_state.lock() {
            super::db_analytics::write_analytics(&app, item_id, status, cost, ended_at, duration, &db);
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
