use serde::Deserialize;
use std::fs;
use std::path::Path;
use tauri::{Emitter, Manager};

#[derive(Debug, Deserialize)]
pub struct SelectFoldersOptions {
    #[serde(default)]
    pub multi_select: bool,
}

#[derive(Debug, Deserialize)]
pub struct SelectFilesOptions {
    #[serde(default)]
    pub multi_select: bool,
    #[serde(default)]
    pub filters: Option<Vec<DialogFilter>>,
}

#[derive(Debug, Deserialize)]
pub struct DialogFilter {
    pub name: String,
    pub extensions: Vec<String>,
}

/// Заглушка — диалоги будут вызываться через frontend
#[tauri::command]
pub fn select_folders(
    _app: tauri::AppHandle,
    _options: Option<SelectFoldersOptions>,
) -> Result<Vec<String>, String> {
    // В Tauri v2 dialog требует async контекст через JS
    // Возвращаем пустой — фронтенд использует fallback
    Ok(Vec::new())
}

#[tauri::command]
pub fn select_files(
    _app: tauri::AppHandle,
    _options: Option<SelectFilesOptions>,
) -> Result<Vec<String>, String> {
    Ok(Vec::new())
}

// ==================== CLIPBOARD ====================

#[tauri::command]
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
pub fn show_in_folder(_app: tauri::AppHandle, path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("-R")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
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
            std::process::Command::new("xdg-open")
                .arg(parent)
                .spawn()
                .map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn open_file_with_default_app(_app: tauri::AppHandle, path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/c", "start", "", &path])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ==================== FOLDER/FILE OPS ====================

#[tauri::command]
pub fn create_folder(path: String) -> Result<(), String> {
    fs::create_dir_all(&path).map_err(|e| e.to_string())
}

#[tauri::command]
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
pub fn get_node_obj_from_file(path: String) -> Result<serde_json::Value, String> {
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map_err(|e| format!("Invalid JSON in {}: {}", path, e))
}

#[tauri::command]
pub fn save_flow_to_options_folder(
    path: String,
    flow: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let dir = Path::new(&path).parent()
        .ok_or_else(|| format!("Invalid path: {}", path))?;
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let content = serde_json::to_string_pretty(&flow).map_err(|e| e.to_string())?;
    fs::write(&path, content).map_err(|e| e.to_string())?;
    Ok(serde_json::json!({ "success": true, "path": path }))
}

#[tauri::command]
pub fn get_paths_from_files(paths: Vec<String>) -> Result<Vec<String>, String> {
    Ok(paths)
}

#[tauri::command]
pub fn request_data_preview(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.emit("give-data", "");
    }
    Ok(())
}

#[tauri::command]
pub fn open_dev_tools() -> Result<(), String> {
    println!("[DevTools] Open browser devtools at localhost:1420");
    Ok(())
}
