#![allow(non_snake_case, unused_variables)]

// CamelCase команды для совместимости с фронтендом
// Каждая вызывает соответствующую snake_case функцию

// ==================== PATH ====================
// pathJoin/pathBasename/pathDirname/pathExtname/pathParse/pathRelative удалены при
// миграции на tauri-specta. Call-sites зовут commands.path* (unwrap из @/Utils/specta)
// → snake path_* напрямую. См. SPECTA_MIGRATION_PLAN.md.

// ==================== FILE INFO ====================

#[tauri::command]
pub fn getFileInfo(path: String) -> Result<super::fs_commands::FileInfo, String> {
    super::fs_commands::get_file_info(path)
}

#[tauri::command]
pub fn getFileTypeByExtname(
    ext: String,
    state: tauri::State<std::sync::Mutex<super::settings_commands::AppSettingsState>>,
) -> Result<String, String> {
    Ok(super::fs_commands::get_file_type_by_extname(ext, state))
}

// ==================== FILE OPERATIONS ====================

#[tauri::command]
pub fn testAndCreateFolder(path: String) -> Result<(), String> {
    super::fs_commands::test_and_create_folder(path)
}

#[tauri::command]
pub fn testAndCreateFolders(paths: Vec<String>) -> Result<Vec<String>, String> {
    super::fs_commands::test_and_create_folders(paths)
}

#[tauri::command]
pub fn createTextFile(path: String) -> Result<(), String> {
    super::fs_commands::create_text_file(path)
}

#[tauri::command]
pub fn renameFolder(oldPath: String, newPath: String) -> Result<(), String> {
    super::fs_commands::rename_folder(oldPath, newPath)
}

#[tauri::command]
pub fn setPathMtime(path: String, mtimeMs: f64) -> Result<(), String> {
    super::fs_commands::set_path_mtime(path, mtimeMs)
}

#[tauri::command]
pub fn copyItem(sourcePath: String, destinationPath: String, options: Option<super::fs_commands::CopyMoveOptions>) -> Result<(), String> {
    super::fs_commands::copy_item(sourcePath, destinationPath, options)
}

#[tauri::command]
pub fn moveItem(sourcePath: String, destinationPath: String, options: Option<super::fs_commands::CopyMoveOptions>) -> Result<(), String> {
    super::fs_commands::move_item(sourcePath, destinationPath, options)
}

#[tauri::command]
pub fn deleteItem(itemPath: String) -> Result<bool, String> {
    super::fs_commands::delete_item(itemPath)
}

// ==================== READ/WRITE ====================

#[tauri::command]
pub fn readFileSync(file_path: String) -> Result<String, String> {
    super::fs_commands::read_file_sync(file_path)
}

#[tauri::command]
pub fn readMediaPreview(file_path: String) -> Result<String, String> {
    super::fs_commands::read_media_preview(file_path)
}

#[tauri::command]
pub fn writeFile(file_path: String, content: String) -> Result<serde_json::Value, String> {
    super::fs_commands::write_file(file_path, content)
}

// ==================== SEARCH ====================

#[tauri::command]
pub fn getSomeFromFolder(path: String, search: Option<super::fs_commands::SearchPattern>) -> Result<serde_json::Value, String> {
    super::fs_commands::get_some_from_folder(path, search)
}

#[tauri::command]
pub fn listSubfolders(paths: Vec<String>) -> Result<serde_json::Value, String> {
    super::fs_commands::list_subfolders(paths)
}

#[tauri::command]
pub fn recursiveFindFiles(path: String, search: Option<super::fs_commands::SearchPattern>) -> Result<serde_json::Value, String> {
    super::fs_commands::recursive_find_files(path, search)
}

// ==================== USER DATA ====================

#[tauri::command]
pub fn getOptionsFolder(app: tauri::AppHandle) -> Result<String, String> {
    super::fs_commands::get_user_data_path(app)
}

#[tauri::command]
pub fn getPluginsDevPath() -> Result<String, String> {
    super::fs_commands::get_plugins_dev_path()
}

#[tauri::command]
pub fn getPlatformTarget() -> String {
    super::fs_commands::get_platform_target()
}

#[tauri::command]
pub fn getCpuCount() -> usize {
    super::fs_commands::get_cpu_count()
}

// ==================== CHECK ====================

#[tauri::command]
pub fn checkFilePath(path: String, name: Option<String>) -> Result<String, String> {
    super::fs_commands::check_file_path(path, name)
}

#[tauri::command]
pub fn checkFolderPath(path: String, name: Option<String>) -> Result<String, String> {
    super::fs_commands::check_folder_path(path, name)
}

// ==================== FONTS ====================

#[tauri::command]
pub fn fontsGetList() -> Result<Vec<super::fs_commands::FontInfo>, String> {
    super::fs_commands::fonts_get_list()
}

#[tauri::command]
pub fn fontsLoadOne(fontPath: String) -> Result<Option<String>, String> {
    super::fs_commands::fonts_load_one(fontPath)
}

// ==================== SHELL ====================

#[tauri::command]
pub fn shellOpenPath(folderPath: String) -> Result<(), String> {
    super::fs_commands::shell_open_path(folderPath)
}

// ==================== FS WATCH ====================
// fsWatchStart/fsWatchStop удалены при миграции на tauri-specta (Stage 1).
// Call-sites теперь зовут типизированные commands.fsWatchStart/Stop → snake-команды
// fs_watch_start/fs_watch_stop напрямую. См. SPECTA_MIGRATION_PLAN.md.

// ==================== PREVIEW ====================

#[tauri::command]
pub async fn previewResize(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    opts: super::fs_commands::PreviewResizeOpts,
    state: tauri::State<'_, std::sync::Mutex<super::window_commands::PreviewWindowState>>,
    bounds_state: tauri::State<'_, std::sync::Mutex<super::preview_bounds::PreviewBoundsState>>,
) -> Result<(), String> {
    super::window_commands::preview_resize(app, window, opts, state, bounds_state).await
}

#[tauri::command]
pub async fn previewOpen(
    app: tauri::AppHandle,
    data: String,
    state: tauri::State<'_, std::sync::Mutex<super::window_commands::PreviewWindowState>>,
    bounds_state: tauri::State<'_, std::sync::Mutex<super::preview_bounds::PreviewBoundsState>>,
) -> Result<(), String> {
    super::window_commands::preview_open(app, data, state, bounds_state).await
}

// ==================== WINDOW ====================

#[tauri::command]
pub async fn openNodeWindow(app: tauri::AppHandle, data: String, state: tauri::State<'_, std::sync::Mutex<super::window_commands::NodeWindowState>>) -> Result<bool, String> {
    super::window_commands::open_node_window(app, data, state).await
}

// ==================== PROCESSING ====================

#[tauri::command]
pub fn abortProcessing(state: tauri::State<'_, std::sync::Mutex<super::processing_commands::ProcessingState>>) -> Result<(), String> {
    super::processing_commands::abort_processing(state)
}

#[tauri::command]
pub async fn processItem(app: tauri::AppHandle, item: serde_json::Value, state: tauri::State<'_, std::sync::Mutex<super::processing_commands::ProcessingState>>) -> Result<serde_json::Value, String> {
    super::processing_commands::process_item(app, item, state).await
}

// ==================== STATUS BAR / LOGS ====================

#[tauri::command]
pub fn setStatusBar(text: String, app: tauri::AppHandle) -> Result<(), String> {
    super::processing_commands::set_status_bar(text, app)
}

#[tauri::command]
pub fn sendLog(level: String, text: String, app: tauri::AppHandle) -> Result<(), String> {
    super::processing_commands::send_log(level, text, app)
}

#[tauri::command]
pub fn sendNodeStart(nodeId: String, app: tauri::AppHandle) -> Result<(), String> {
    super::processing_commands::send_node_start(nodeId, app)
}

#[tauri::command]
pub fn sendNodeDone(nodeId: String, output: serde_json::Value, app: tauri::AppHandle) -> Result<(), String> {
    super::processing_commands::send_node_done(nodeId, output, app)
}

#[tauri::command]
pub fn sendNodeError(nodeId: String, message: String, app: tauri::AppHandle) -> Result<(), String> {
    super::processing_commands::send_node_error(nodeId, message, app)
}

#[tauri::command]
pub fn sendProcessComplete(app: tauri::AppHandle) -> Result<(), String> {
    super::processing_commands::send_process_complete(app)
}

// ==================== WINDOW STATE ====================

#[tauri::command]
pub fn saveWindowState(label: String, state: super::window_state::WindowState, app: tauri::AppHandle) -> Result<(), String> {
    super::window_state::save_window_state(label, state, app)
}

#[tauri::command]
pub fn loadWindowState(label: String, app: tauri::AppHandle) -> Result<Option<super::window_state::WindowState>, String> {
    super::window_state::load_window_state(label, app)
}
