#![allow(non_snake_case, unused_variables)]

use tauri::{Emitter, Manager};

#[derive(Debug, serde::Deserialize)]
pub struct SelectFoldersOptions {
    #[serde(default)]
    pub multi_select: bool,
}

#[derive(Debug, serde::Deserialize)]
pub struct SelectFilesOptions {
    #[serde(default)]
    pub multi_select: bool,
    #[serde(default)]
    pub filters: Option<Vec<DialogFilter>>,
}

#[derive(Debug, serde::Deserialize)]
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

#[tauri::command]
pub async fn selectFolders(
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
pub async fn selectFiles(
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
pub fn copyToClipboard(_app: tauri::AppHandle, path: String) -> Result<(), String> {
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
pub fn showInFolder(_app: tauri::AppHandle, path: String) -> Result<(), String> {
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
        if let Some(parent) = std::path::Path::new(&path).parent() {
            std::process::Command::new("xdg-open").arg(parent).spawn().map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn openFileWithDefaultApp(_app: tauri::AppHandle, path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open").arg(&path).spawn().map_err(|e| e.to_string())?;
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
        std::process::Command::new("xdg-open").arg(&path).spawn().map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ==================== FOLDER/FILE ====================

#[tauri::command]
pub fn createFolder(path: String) -> Result<(), String> {
    std::fs::create_dir_all(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn renameFile(oldPath: String, newPath: String) -> Result<bool, String> {
    let old = std::path::Path::new(&oldPath);
    let new = std::path::Path::new(&newPath);
    if !old.exists() {
        return Err(format!("File not found: {}", oldPath));
    }
    if new.exists() {
        return Err(format!("Destination already exists: {}", newPath));
    }
    std::fs::rename(old, new).map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
pub fn saveFlowToOptionsFolder(path: String, flow: serde_json::Value) -> Result<serde_json::Value, String> {
    let path_buf = std::path::PathBuf::from(&path);

    if !path_buf.is_absolute() {
        return Err(format!("[saveFlowToOptionsFolder] path is not absolute: {}", path));
    }

    println!("[saveFlowToOptionsFolder] Input path: {}", path);
    println!("[saveFlowToOptionsFolder] Path is_dir: {}", path_buf.is_dir());

    // Сохраняем в {path}/options/options.json
    let json_path = path_buf.join("options").join("options.json");

    println!("[saveFlowToOptionsFolder] Saving to: {}", json_path.display());

    // Создаём директорию если нужно
    if let Some(parent) = json_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let content = serde_json::to_string_pretty(&flow).map_err(|e| e.to_string())?;
    std::fs::write(&json_path, content).map_err(|e| e.to_string())?;

    println!("[saveFlowToOptionsFolder] Successfully saved");
    Ok(serde_json::json!({ "success": true, "path": json_path.to_string_lossy().to_string() }))
}

#[tauri::command]
pub fn getNodeObjFromFile(path: String) -> Result<serde_json::Value, String> {
    let path_buf = std::path::PathBuf::from(&path);

    if !path_buf.is_absolute() {
        println!("[getNodeObjFromFile] path is not absolute, returning empty object: {}", path);
        return Ok(serde_json::json!({}));
    }

    // Загружаем из {path}/options/options.json
    let json_path = path_buf.join("options").join("options.json");

    println!("[getNodeObjFromFile] Input path: {}", path);
    println!("[getNodeObjFromFile] Looking for JSON at: {}", json_path.display());
    println!("[getNodeObjFromFile] File exists: {}", json_path.exists());

    if !json_path.exists() {
        // Если файла нет, возвращаем пустой объект
        println!("[getNodeObjFromFile] File not found, returning empty object");
        return Ok(serde_json::json!({}));
    }

    let content = std::fs::read_to_string(&json_path).map_err(|e| e.to_string())?;
    println!("[getNodeObjFromFile] Successfully read file");
    serde_json::from_str(&content).map_err(|e| format!("Invalid JSON in {}: {}", json_path.display(), e))
}

#[tauri::command]
pub fn getPathsFromFiles(paths: Vec<String>) -> Result<Vec<String>, String> {
    Ok(paths)
}

#[tauri::command]
pub fn requestDataPreview(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.emit("give-data", "");
    }
    Ok(())
}

#[tauri::command]
pub fn openDevTools() -> Result<(), String> {
    println!("[DevTools] Press Cmd+Opt+I in your browser at localhost:1420");
    Ok(())
}
