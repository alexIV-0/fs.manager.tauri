//! Dialog / shell / файловые команды.
//!
//! Реальные реализации (нативные диалоги через `tauri_plugin_dialog`, clipboard, show-in-folder,
//! сохранение/чтение options.json). Раньше этот код жил в `dialog_commands_camel.rs` с
//! camelCase-именами как Electron-совместимая обёртка, а здесь были мёртвые snake-заглушки.
//! При миграции на tauri-specta объединено в один честный модуль: snake-имена + `#[specta::specta]`
//! (типобезопасные биндинги `commands.*`). См. SPECTA_MIGRATION_PLAN.md.

use serde::Deserialize;
use std::fs;
use std::path::Path;
use tauri::{Emitter, Manager};
#[cfg(target_os = "windows")]
use super::process_utils::HiddenConsole;

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SelectFoldersOptions {
    #[serde(default)]
    pub multi_select: bool,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SelectFilesOptions {
    #[serde(default)]
    pub multi_select: bool,
    #[serde(default)]
    pub filters: Option<Vec<DialogFilter>>,
}

#[derive(Debug, Deserialize, specta::Type)]
pub struct DialogFilter {
    pub name: String,
    pub extensions: Vec<String>,
}

fn fp_to_string(p: &tauri_plugin_dialog::FilePath) -> String {
    match p {
        tauri_plugin_dialog::FilePath::Path(pb) => pb.to_string_lossy().to_string(),
        tauri_plugin_dialog::FilePath::Url(_u) => String::new(),
    }
}

// ==================== DIALOGS ====================

#[tauri::command]
#[specta::specta]
pub async fn select_folders(
    app: tauri::AppHandle,
    options: Option<SelectFoldersOptions>,
) -> Result<Vec<String>, String> {
    use std::sync::{Arc, Mutex};
    use tauri_plugin_dialog::DialogExt;

    let opts = options.unwrap_or(SelectFoldersOptions { multi_select: false });
    let result: Arc<Mutex<Option<Vec<String>>>> = Arc::new(Mutex::new(None));
    let result_clone = result.clone();
    let (tx, rx) = std::sync::mpsc::channel();

    let dialog = app.dialog().file().set_title("Выберите папки");

    if opts.multi_select {
        dialog.pick_folders(move |paths| {
            let r: Vec<String> = paths.iter().flat_map(|v| v.iter()).map(fp_to_string).collect();
            let mut guard = result_clone.lock().unwrap();
            *guard = Some(r);
            let _ = tx.send(());
        });
    } else {
        dialog.pick_folder(move |path| {
            let r: Vec<String> = path.iter().map(fp_to_string).collect();
            let mut guard = result_clone.lock().unwrap();
            *guard = Some(r);
            let _ = tx.send(());
        });
    }

    let _ = rx.recv_timeout(std::time::Duration::from_secs(60));
    let guard = result.lock().unwrap();
    Ok(guard.clone().unwrap_or_default())
}

#[tauri::command]
#[specta::specta]
pub async fn select_files(
    app: tauri::AppHandle,
    options: Option<SelectFilesOptions>,
) -> Result<Vec<String>, String> {
    use std::sync::{Arc, Mutex};
    use tauri_plugin_dialog::DialogExt;

    let opts = options.unwrap_or(SelectFilesOptions { multi_select: false, filters: None });
    let result: Arc<Mutex<Option<Vec<String>>>> = Arc::new(Mutex::new(None));
    let result_clone = result.clone();
    let (tx, rx) = std::sync::mpsc::channel();

    let mut dialog = app.dialog().file().set_title("Выберите файлы");

    if let Some(filters) = &opts.filters {
        for filter in filters {
            let exts: Vec<&str> = filter.extensions.iter().map(|s| s.as_str()).collect();
            dialog = dialog.add_filter(&filter.name, &exts);
        }
    }

    if opts.multi_select {
        dialog.pick_files(move |paths| {
            let r: Vec<String> = paths.iter().flat_map(|v| v.iter()).map(fp_to_string).collect();
            let mut guard = result_clone.lock().unwrap();
            *guard = Some(r);
            let _ = tx.send(());
        });
    } else {
        dialog.pick_file(move |path| {
            let r: Vec<String> = path.iter().map(fp_to_string).collect();
            let mut guard = result_clone.lock().unwrap();
            *guard = Some(r);
            let _ = tx.send(());
        });
    }

    let _ = rx.recv_timeout(std::time::Duration::from_secs(60));
    let guard = result.lock().unwrap();
    Ok(guard.clone().unwrap_or_default())
}

// ==================== CLIPBOARD ====================

#[tauri::command]
#[specta::specta]
pub fn copy_to_clipboard(_app: tauri::AppHandle, path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        use std::io::Write;
        use std::process::Command;
        let mut child = Command::new("pbcopy")
            .stdin(std::process::Stdio::piped())
            .spawn()
            .map_err(|e| e.to_string())?;
        if let Some(ref mut stdin) = child.stdin {
            stdin.write_all(path.as_bytes()).map_err(|e| e.to_string())?;
        }
        let _ = child.wait();
    }
    Ok(())
}

// ==================== SHELL ====================

#[tauri::command]
#[specta::specta]
pub fn show_in_folder(_app: tauri::AppHandle, path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open").arg("-R").arg(&path).spawn().map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(format!("/select,{}", path))
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        if let Some(parent) = Path::new(&path).parent() {
            std::process::Command::new("xdg-open").arg(parent).spawn().map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn open_file_with_default_app(_app: tauri::AppHandle, path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open").arg(&path).spawn().map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/c", "start", "", &path])
            .hide_console()
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        std::process::Command::new("xdg-open").arg(&path).spawn().map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ==================== FOLDER/FILE ====================

#[tauri::command]
#[specta::specta]
pub fn create_folder(path: String) -> Result<(), String> {
    fs::create_dir_all(&path).map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn rename_file(old_path: String, new_path: String) -> Result<bool, String> {
    let old = Path::new(&old_path);
    let new = Path::new(&new_path);
    if !old.exists() {
        return Err(format!("File not found: {}", old_path));
    }
    if new.exists() {
        return Err(format!("Destination already exists: {}", new_path));
    }
    fs::rename(old, new).map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
#[specta::specta]
pub fn save_flow_to_options_folder(
    path: String,
    flow: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let path_buf = std::path::PathBuf::from(&path);

    if !path_buf.is_absolute() {
        return Err(format!("[save_flow_to_options_folder] path is not absolute: {}", path));
    }

    // Сохраняем в {path}/options/options.json
    let json_path = path_buf.join("options").join("options.json");

    if let Some(parent) = json_path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let content = serde_json::to_string_pretty(&flow).map_err(|e| e.to_string())?;
    fs::write(&json_path, content).map_err(|e| e.to_string())?;

    Ok(serde_json::json!({ "success": true, "path": json_path.to_string_lossy().to_string() }))
}

#[tauri::command]
#[specta::specta]
pub fn get_node_obj_from_file(path: String) -> Result<serde_json::Value, String> {
    let path_buf = std::path::PathBuf::from(&path);

    if !path_buf.is_absolute() {
        return Ok(serde_json::json!({}));
    }

    // Загружаем из {path}/options/options.json
    let json_path = path_buf.join("options").join("options.json");

    if !json_path.exists() {
        return Ok(serde_json::json!({}));
    }

    let content = fs::read_to_string(&json_path).map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map_err(|e| format!("Invalid JSON in {}: {}", json_path.display(), e))
}

#[tauri::command]
#[specta::specta]
pub fn get_paths_from_files(paths: Vec<String>) -> Result<Vec<String>, String> {
    Ok(paths)
}

#[tauri::command]
#[specta::specta]
pub fn request_data_preview(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.emit("give-data", "");
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn open_dev_tools() -> Result<(), String> {
    println!("[DevTools] Press Cmd+Opt+I in your browser at localhost:1420");
    Ok(())
}
