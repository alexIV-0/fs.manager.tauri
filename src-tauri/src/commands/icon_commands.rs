// Нативная системная иконка файла как PNG data-URL — для drag-preview (как в Finder/Explorer).
// systemicons отдаёт PNG-байты иконки кроссплатформенно (macOS NSWorkspace / Windows SHGetFileInfo).
//
// Команда синхронная → выполняется на главном потоке, что безопасно для AppKit-вызовов на macOS.

/// Возвращает иконку файла как строку "data:image/png;base64,...".
/// При ошибке возвращает Err — фронт тогда откатывается на нарисованную canvas-иконку.
#[tauri::command]
#[specta::specta]
pub fn get_file_icon(path: String, size: Option<i32>) -> Result<String, String> {
    use base64::Engine;

    let sz = size.unwrap_or(128);
    let png = systemicons::get_icon(&path, sz).map_err(|e| format!("get_file_icon failed: {:?}", e))?;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&png);
    Ok(format!("data:image/png;base64,{}", b64))
}
