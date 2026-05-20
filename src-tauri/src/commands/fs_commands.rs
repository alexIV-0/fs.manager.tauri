#![allow(dead_code)]

use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use tauri::Manager;

// ==================== TYPES ====================

#[derive(Debug, Serialize)]
pub struct FileInfo {
    pub path: String,
    pub name: String,
    pub size: u64,
    pub is_dir: bool,
    pub is_file: bool,
    pub modified: Option<u64>,
    pub created: Option<u64>,
    pub extension: String,
}

#[derive(Debug, Serialize)]
pub struct PathInfo {
    pub root: String,
    pub dir: String,
    pub base: String,
    pub ext: String,
    pub name: String,
}

#[derive(Debug, Deserialize)]
pub struct CopyMoveOptions {
    #[serde(default)]
    pub use_hash_check: bool,
    #[serde(default)]
    pub overwrite: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewResizeOpts {
    pub width: f64,
    pub height: f64,
    #[serde(default)]
    pub aspect_ratio: Option<f64>,
    #[serde(default)]
    pub extra_height: Option<f64>,
}

#[derive(Debug, Deserialize)]
pub struct FormatNameByPatternArgs {
    pub string: String,
    pub description: Option<serde_json::Value>,
    pub file: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct FontInfo {
    pub name: String,
    pub path: String,
    pub loadable: bool,
}

// ==================== PATH UTILITIES ====================

#[tauri::command]
pub fn path_join(segments: Vec<String>) -> Result<String, String> {
    if segments.is_empty() {
        return Err("No segments provided".into());
    }
    let mut result = PathBuf::from(&segments[0]);
    for segment in &segments[1..] {
        result.push(segment);
    }
    Ok(result.to_string_lossy().to_string())
}

#[tauri::command]
pub fn path_basename(file_path: String, ext: Option<String>) -> Result<String, String> {
    let path = Path::new(&file_path);
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    
    if let Some(remove_ext) = ext {
        if name.ends_with(&remove_ext) {
            return Ok(name[..name.len() - remove_ext.len()].to_string());
        }
    }
    
    Ok(name)
}

#[tauri::command]
pub fn path_dirname(file_path: String) -> Result<String, String> {
    let path = Path::new(&file_path);
    path.parent()
        .map(|p| p.to_string_lossy().to_string())
        .ok_or_else(|| "Cannot get parent directory".into())
}

#[tauri::command]
pub fn path_extname(file_path: String) -> Result<String, String> {
    let path = Path::new(&file_path);
    Ok(path
        .extension()
        .map(|e| format!(".{}", e.to_string_lossy()))
        .unwrap_or_default())
}

#[tauri::command]
pub fn path_parse(file_path: String) -> Result<PathInfo, String> {
    let path = Path::new(&file_path);
    let root = path
        .components()
        .next()
        .map(|c| c.as_os_str().to_string_lossy().to_string())
        .unwrap_or_default();
    let dir = path
        .parent()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();
    let base = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    let ext = path
        .extension()
        .map(|e| e.to_string_lossy().to_string())
        .unwrap_or_default();
    let name = path
        .file_stem()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();

    Ok(PathInfo {
        root,
        dir,
        base,
        ext,
        name,
    })
}

#[tauri::command]
pub fn path_relative(from: String, to: String) -> Result<String, String> {
    let from_path = Path::new(&from);
    let to_path = Path::new(&to);
    
    pathdiff::diff_paths(to_path, from_path)
        .map(|p| p.to_string_lossy().to_string())
        .ok_or_else(|| "Cannot compute relative path".into())
}

// ==================== FILE INFO ====================

#[tauri::command]
pub fn get_file_info(path: String) -> Result<FileInfo, String> {
    let metadata = fs::metadata(&path).map_err(|e| e.to_string())?;
    let std_path = Path::new(&path);
    let name = std_path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    let extension = std_path
        .extension()
        .map(|e| e.to_string_lossy().to_string())
        .unwrap_or_default();

    Ok(FileInfo {
        path,
        name,
        size: metadata.len(),
        is_dir: metadata.is_dir(),
        is_file: metadata.is_file(),
        modified: metadata
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64),
        created: metadata
            .created()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64),
        extension,
    })
}

#[tauri::command]
pub fn get_file_type_by_extname(
    ext: String,
    state: tauri::State<std::sync::Mutex<super::settings_commands::AppSettingsState>>,
) -> String {
    let ext_lower = ext.to_lowercase().trim_start_matches('.').to_string();

    if let Ok(guard) = state.lock() {
        if let Some(arr) = guard.file_types.as_array() {
            for entry in arr {
                let name = entry.get("name").and_then(|v| v.as_str()).unwrap_or("");
                if let Some(paths) = entry.get("path").and_then(|v| v.as_array()) {
                    for p in paths {
                        if p.as_str() == Some(ext_lower.as_str()) {
                            return name.to_string();
                        }
                    }
                }
            }
        }
    }

    "files".to_string()
}

// ==================== FILE OPERATIONS ====================

#[tauri::command]
pub fn test_and_create_folder(path: String) -> Result<(), String> {
    fs::create_dir_all(&path).map_err(|e| e.to_string())
}

/// Возвращает метаданные файла (для полифила node:fs.stat).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatInfo {
    pub size: u64,
    pub mtime_ms: f64,
    pub atime_ms: f64,
    pub ctime_ms: f64,
    pub birthtime_ms: f64,
    pub is_file: bool,
    pub is_dir: bool,
    pub is_symlink: bool,
}

#[tauri::command]
pub fn get_stat(path: String) -> Result<StatInfo, String> {
    let meta = fs::metadata(&path).map_err(|e| e.to_string())?;
    let to_ms = |t: std::io::Result<std::time::SystemTime>| -> f64 {
        t.ok()
            .and_then(|st| st.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs_f64() * 1000.0)
            .unwrap_or(0.0)
    };
    Ok(StatInfo {
        size: meta.len(),
        mtime_ms: to_ms(meta.modified()),
        atime_ms: to_ms(meta.accessed()),
        ctime_ms: to_ms(meta.created()),
        birthtime_ms: to_ms(meta.created()),
        is_file: meta.is_file(),
        is_dir: meta.is_dir(),
        is_symlink: meta.file_type().is_symlink(),
    })
}

/// Возвращает путь к временной директории (для полифила node:os.tmpdir).
#[tauri::command]
pub fn os_tmpdir() -> String {
    std::env::temp_dir().to_string_lossy().to_string()
}

/// Считает хеш файла по алгоритму (sha256 | sha1 | md5). Возвращает hex.
/// Для полифила node:crypto.createHash, чтобы не таскать содержимое через IPC.
#[tauri::command]
pub fn hash_file(path: String, algo: Option<String>) -> Result<String, String> {
    use std::io::Read;
    let algo = algo.unwrap_or_else(|| "sha256".to_string()).to_lowercase();
    let mut file = fs::File::open(&path).map_err(|e| e.to_string())?;
    let mut buf = [0u8; 64 * 1024];

    match algo.as_str() {
        "sha256" => {
            use sha2::{Digest, Sha256};
            let mut hasher = Sha256::new();
            loop {
                let n = file.read(&mut buf).map_err(|e| e.to_string())?;
                if n == 0 { break; }
                hasher.update(&buf[..n]);
            }
            Ok(format!("{:x}", hasher.finalize()))
        }
        "sha1" => {
            use sha1::{Digest, Sha1};
            let mut hasher = Sha1::new();
            loop {
                let n = file.read(&mut buf).map_err(|e| e.to_string())?;
                if n == 0 { break; }
                hasher.update(&buf[..n]);
            }
            Ok(format!("{:x}", hasher.finalize()))
        }
        "md5" => {
            use md5::{Digest, Md5};
            let mut hasher = Md5::new();
            loop {
                let n = file.read(&mut buf).map_err(|e| e.to_string())?;
                if n == 0 { break; }
                hasher.update(&buf[..n]);
            }
            Ok(format!("{:x}", hasher.finalize()))
        }
        _ => Err(format!("Unsupported hash algo: {}", algo)),
    }
}

#[tauri::command]
pub fn test_and_create_folders(paths: Vec<String>) -> Result<Vec<String>, String> {
    for p in &paths {
        fs::create_dir_all(p).map_err(|e| e.to_string())?;
    }
    Ok(paths)
}

/// Создаёт папку (если нет) и возвращает её содержимое в формате `{ folders: [], files: [] }`.
/// Аналог Electron'овского ensureAndReadDir.
#[tauri::command]
pub fn ensure_and_read_dir(path: String) -> Result<serde_json::Value, String> {
    fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    let mut folders: Vec<String> = Vec::new();
    let mut files: Vec<String> = Vec::new();
    let entries = fs::read_dir(&path).map_err(|e| e.to_string())?;
    for entry in entries.flatten() {
        let name = match entry.file_name().to_str() {
            Some(s) => s.to_string(),
            None => continue,
        };
        if name.starts_with('.') {
            continue;
        }
        let ft = entry.file_type().map_err(|e| e.to_string())?;
        if ft.is_dir() {
            folders.push(name);
        } else if ft.is_file() {
            files.push(name);
        }
    }
    folders.sort();
    files.sort();
    Ok(serde_json::json!({ "folders": folders, "files": files }))
}

/// Создаёт пустой текстовый файл по указанному пути. Если файл уже существует — ошибка.
#[tauri::command]
pub fn create_text_file(path: String) -> Result<(), String> {
    if std::path::Path::new(&path).exists() {
        return Err(format!("File already exists: {}", path));
    }
    if let Some(parent) = std::path::Path::new(&path).parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&path, "").map_err(|e| e.to_string())
}

#[tauri::command]
pub fn rename_folder(old_path: String, new_path: String) -> Result<(), String> {
    fs::rename(&old_path, &new_path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn copy_item(
    source_path: String,
    destination_path: String,
    options: Option<CopyMoveOptions>,
) -> Result<(), String> {
    let opts = options.unwrap_or(CopyMoveOptions {
        use_hash_check: false,
        overwrite: false,
    });

    let source = Path::new(&source_path);
    let dest = Path::new(&destination_path);

    if !source.exists() {
        return Err(format!("Source path does not exist: {}", source_path));
    }

    if dest.exists() && !opts.overwrite {
        return Err(format!("Destination already exists: {}", destination_path));
    }

    if source.is_dir() {
        copy_dir_all(source, dest).map_err(|e| e.to_string())?;
    } else {
        if let Some(parent) = dest.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        fs::copy(source, dest).map_err(|e| e.to_string())?;
    }

    Ok(())
}

fn copy_dir_all(src: impl AsRef<Path>, dst: impl AsRef<Path>) -> std::io::Result<()> {
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

#[tauri::command]
pub fn move_item(
    source_path: String,
    destination_path: String,
    options: Option<CopyMoveOptions>,
) -> Result<(), String> {
    let opts = options.unwrap_or(CopyMoveOptions {
        use_hash_check: false,
        overwrite: false,
    });

    let source = Path::new(&source_path);
    let dest = Path::new(&destination_path);

    if !source.exists() {
        return Err(format!("Source path does not exist: {}", source_path));
    }

    if dest.exists() && !opts.overwrite {
        return Err(format!("Destination already exists: {}", destination_path));
    }

    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    fs::rename(source, dest)
        .or_else(|_| {
            // Fallback: copy + delete
            if source.is_dir() {
                copy_dir_all(source, dest)?;
                fs::remove_dir_all(source)
            } else {
                fs::copy(source, dest)?;
                fs::remove_file(source)
            }
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_item(item_path: String) -> Result<bool, String> {
    let path = Path::new(&item_path);
    
    if !path.exists() {
        return Ok(false);
    }

    if path.is_dir() {
        fs::remove_dir_all(path).map_err(|e| e.to_string())?;
    } else {
        fs::remove_file(path).map_err(|e| e.to_string())?;
    }

    Ok(true)
}

// ==================== READ/WRITE FILES ====================

#[tauri::command]
pub fn read_file_sync(file_path: String) -> Result<String, String> {
    fs::read_to_string(&file_path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn read_media_preview(file_path: String) -> Result<String, String> {
    let path = Path::new(&file_path);
    
    if !path.exists() {
        return Ok("".to_string());
    }

    let ext = path
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();

    let image_exts = ["jpg", "jpeg", "png", "gif", "webp", "bmp", "tif", "tiff"];
    let video_exts = ["mp4", "mov", "avi", "mkv", "webm", "mts", "mxf", "m4v"];

    if image_exts.contains(&ext.as_str()) {
        let mut file = fs::File::open(path).map_err(|e| e.to_string())?;
        let mut buffer = Vec::new();
        file.read_to_end(&mut buffer).map_err(|e| e.to_string())?;
        let base64_str = base64_encode(&buffer);

        let mime = match ext.as_str() {
            "jpg" | "jpeg" => "image/jpeg",
            "png" => "image/png",
            "gif" => "image/gif",
            "webp" => "image/webp",
            _ => "image/bmp",
        };

        return Ok(format!("data:{};base64,{}", mime, base64_str));
    }

    // Для видео возвращаем пустую строку (ffmpeg preview не поддерживается в Tauri напрямую)
    if video_exts.contains(&ext.as_str()) {
        // TODO: Implement ffmpeg snapshot if needed
        return Ok("".to_string());
    }

    Ok("".to_string())
}

// Simple base64 encoder
fn base64_encode(data: &[u8]) -> String {
    use std::fmt::Write;
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut result = String::new();
    
    for chunk in data.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = if chunk.len() > 1 { chunk[1] as u32 } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] as u32 } else { 0 };
        
        let triple = (b0 << 16) | (b1 << 8) | b2;
        
        write!(result, "{}", CHARS[((triple >> 18) & 0x3F) as usize] as char).unwrap();
        write!(result, "{}", CHARS[((triple >> 12) & 0x3F) as usize] as char).unwrap();
        
        if chunk.len() > 1 {
            write!(result, "{}", CHARS[((triple >> 6) & 0x3F) as usize] as char).unwrap();
        } else {
            result.push('=');
        }
        
        if chunk.len() > 2 {
            write!(result, "{}", CHARS[(triple & 0x3F) as usize] as char).unwrap();
        } else {
            result.push('=');
        }
    }
    
    result
}

#[tauri::command]
pub fn write_file(file_path: String, content: String) -> Result<serde_json::Value, String> {
    let path = Path::new(&file_path);

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    fs::write(path, content).map_err(|e| e.to_string())?;

    Ok(serde_json::json!({ "success": true }))
}

/// Записывает бинарный файл из base64-строки.
/// Используется плагинами для сохранения скачанных через fetch результатов
/// (видео, аудио, изображения). Создаёт родительские директории при необходимости.
#[tauri::command]
pub fn write_binary_file(file_path: String, data_b64: String) -> Result<u64, String> {
    let path = Path::new(&file_path);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let bytes = base64_decode(&data_b64).map_err(|e| format!("base64 decode: {}", e))?;
    fs::write(path, &bytes).map_err(|e| e.to_string())?;
    Ok(bytes.len() as u64)
}

fn base64_decode(s: &str) -> Result<Vec<u8>, String> {
    // Стандартный alphabet RFC 4648. Игнорируем whitespace и '=' padding.
    const TABLE: [i8; 128] = {
        let mut t = [-1i8; 128];
        let alpha = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let mut i = 0;
        while i < 64 {
            t[alpha[i] as usize] = i as i8;
            i += 1;
        }
        t
    };

    let mut out: Vec<u8> = Vec::with_capacity(s.len() * 3 / 4);
    let mut buf: u32 = 0;
    let mut bits: u32 = 0;
    for &b in s.as_bytes() {
        if b == b'=' || b == b'\n' || b == b'\r' || b == b' ' || b == b'\t' {
            continue;
        }
        let v = if (b as usize) < 128 { TABLE[b as usize] } else { -1 };
        if v < 0 {
            return Err(format!("invalid character: {:?}", b as char));
        }
        buf = (buf << 6) | (v as u32);
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((buf >> bits) as u8);
            buf &= (1 << bits) - 1;
        }
    }
    Ok(out)
}

// ==================== PATH VALIDATION ====================

#[tauri::command]
pub fn check_file_path(path: String, _name: Option<String>) -> Result<String, String> {
    let p = Path::new(&path);
    
    if !p.exists() {
        return Err(format!("Path does not exist: {}", path));
    }
    
    if !p.is_file() {
        return Err(format!("Path is not a file: {}", path));
    }
    
    Ok(path)
}

#[tauri::command]
pub fn check_folder_path(path: String, _name: Option<String>) -> Result<String, String> {
    let p = Path::new(&path);
    
    if !p.exists() {
        return Err(format!("Path does not exist: {}", path));
    }
    
    if !p.is_dir() {
        return Err(format!("Path is not a directory: {}", path));
    }
    
    Ok(path)
}

// ==================== SEARCH IN FOLDER ====================

/// Один элемент паттерна поиска. Формат совместим с Electron:
/// `{ type: 'files'|'folders', ext: string[] }`.
/// Пустой массив `ext` означает «все расширения».
#[derive(Debug, Deserialize, Clone)]
pub struct SearchEntry {
    #[serde(default, rename = "type")]
    pub kind: String,
    #[serde(default)]
    pub ext: Vec<String>,
}

/// SearchPattern — массив SearchEntry. Если массив пустой / отсутствует —
/// возвращаются и файлы, и папки без фильтра.
pub type SearchPattern = Vec<SearchEntry>;

fn want_files(search: &[SearchEntry]) -> Option<&SearchEntry> {
    search.iter().find(|s| s.kind == "files")
}

fn want_folders(search: &[SearchEntry]) -> bool {
    search.iter().any(|s| s.kind == "folders")
}

fn ext_matches(path: &Path, exts: &[String]) -> bool {
    if exts.is_empty() {
        return true;
    }
    let ext = path
        .extension()
        .map(|e| e.to_string_lossy().to_string())
        .unwrap_or_default()
        .to_lowercase();
    exts.iter().any(|e| e.trim_start_matches('.').to_lowercase() == ext)
}

/// Возвращает объект вида `{[type]: string[]}` — для каждого `{type, ext}` в search
/// собирает массив **имён** (не полных путей), соответствующих фильтру.
/// Совместимо с Electron Node-fallback'ом, который ожидают callers вроде
/// findFilesForSingleFolder и collectFilesFromFolderFunc.
#[tauri::command]
pub fn get_some_from_folder(
    path: String,
    search: Option<SearchPattern>,
) -> Result<serde_json::Value, String> {
    let dir = Path::new(&path);
    if !dir.exists() || !dir.is_dir() {
        return Err(format!("Invalid directory: {}", path));
    }

    let search = search.unwrap_or_else(|| vec![
        SearchEntry { kind: "files".to_string(), ext: vec![] },
        SearchEntry { kind: "folders".to_string(), ext: vec![] },
    ]);

    // Подготовим map type → Vec<String>
    let mut by_type: std::collections::HashMap<String, Vec<String>> = std::collections::HashMap::new();
    for entry in &search {
        by_type.entry(entry.kind.clone()).or_default();
    }

    let files_filter = want_files(&search);
    let take_folders = want_folders(&search);

    for entry in fs::read_dir(dir).map_err(|e| e.to_string())?.flatten() {
        let entry_path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();

        if entry_path.is_file() {
            if let Some(f) = files_filter {
                if ext_matches(&entry_path, &f.ext) {
                    if let Some(arr) = by_type.get_mut("files") {
                        arr.push(name);
                    }
                }
            }
        } else if entry_path.is_dir() && take_folders {
            if let Some(arr) = by_type.get_mut("folders") {
                arr.push(name);
            }
        }
    }

    // Сортируем по имени внутри каждого типа
    for arr in by_type.values_mut() {
        arr.sort();
    }

    Ok(serde_json::to_value(by_type).map_err(|e| e.to_string())?)
}


/// Возвращает имена подпапок (только верхний уровень) для каждой переданной директории.
/// Output: `Record<dirPath, string[]>`. Если папка не существует — пустой массив.
/// Использование: главное окно сканирует все «main folders» в одном IPC и получает
/// списки проектов внутри каждой.
#[tauri::command]
pub fn list_subfolders(paths: Vec<String>) -> Result<serde_json::Value, String> {
    let mut out = serde_json::Map::new();
    for p in &paths {
        let mut folders: Vec<String> = Vec::new();
        if let Ok(rd) = fs::read_dir(p) {
            for entry in rd.flatten() {
                if let Ok(ft) = entry.file_type() {
                    if ft.is_dir() {
                        if let Some(name) = entry.file_name().to_str() {
                            folders.push(name.to_string());
                        }
                    }
                }
            }
            folders.sort();
        }
        out.insert(
            p.clone(),
            serde_json::to_value(folders).unwrap_or(serde_json::Value::Array(vec![])),
        );
    }
    Ok(serde_json::Value::Object(out))
}

/// Рекурсивный поиск. Возвращает `{[type]: string[]}` — относительные пути от `path`,
/// разбитые по типу (как в Electron'е). Папки тоже могут включаться если в search есть type=folders.
#[tauri::command]
pub fn recursive_find_files(
    path: String,
    search: Option<SearchPattern>,
) -> Result<serde_json::Value, String> {
    let dir = Path::new(&path);
    if !dir.exists() || !dir.is_dir() {
        return Err(format!("Invalid directory: {}", path));
    }

    let search = search.unwrap_or_else(|| vec![
        SearchEntry { kind: "files".to_string(), ext: vec![] },
    ]);

    let mut by_type: std::collections::HashMap<String, Vec<String>> = std::collections::HashMap::new();
    for entry in &search {
        by_type.entry(entry.kind.clone()).or_default();
    }

    let files_filter = want_files(&search);
    let take_folders = want_folders(&search);

    fn walk(
        dir: &Path,
        rel_prefix: &Path,
        files_filter: Option<&SearchEntry>,
        take_folders: bool,
        by_type: &mut std::collections::HashMap<String, Vec<String>>,
    ) -> std::io::Result<()> {
        for entry in fs::read_dir(dir)?.flatten() {
            let p = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            let rel = rel_prefix.join(&name);
            let rel_str = rel.to_string_lossy().to_string();

            if p.is_file() {
                if let Some(f) = files_filter {
                    if ext_matches(&p, &f.ext) {
                        if let Some(arr) = by_type.get_mut("files") {
                            arr.push(rel_str);
                        }
                    }
                }
            } else if p.is_dir() {
                if take_folders {
                    if let Some(arr) = by_type.get_mut("folders") {
                        arr.push(rel_str.clone());
                    }
                }
                walk(&p, &rel, files_filter, take_folders, by_type)?;
            }
        }
        Ok(())
    }

    walk(dir, Path::new(""), files_filter, take_folders, &mut by_type)
        .map_err(|e| e.to_string())?;

    for arr in by_type.values_mut() {
        arr.sort();
    }

    Ok(serde_json::to_value(by_type).map_err(|e| e.to_string())?)
}

// ==================== FORMAT NAME BY PATTERN ====================

#[tauri::command]
pub fn format_name_by_pattern(args: FormatNameByPatternArgs) -> Result<String, String> {
    // Упрощённая реализация - базовая подстановка паттернов
    let mut result = args.string.clone();
    
    // Подстановка паттернов на основе описания
    if let Some(desc) = args.description {
        if let Some(val) = desc.get("clearName").and_then(|v| v.as_str()) {
            result = result.replace("$clearName", val);
        }
        if let Some(val) = desc.get("curItemName").and_then(|v| v.as_str()) {
            result = result.replace("$curItemName", val);
        }
        if let Some(val) = desc.get("projectName").and_then(|v| v.as_str()) {
            result = result.replace("$projectName", val);
        }
        if let Some(val) = desc.get("id").and_then(|v| v.as_str()) {
            result = result.replace("$id", val);
        }
    }

    // Подстановка временных паттернов
    let now = chrono::Local::now();
    result = result.replace("$YYYY", &now.format("%Y").to_string());
    result = result.replace("$MM", &now.format("%m").to_string());
    result = result.replace("$DD", &now.format("%d").to_string());
    result = result.replace("$HH", &now.format("%H").to_string());
    result = result.replace("$mm", &now.format("%M").to_string());
    result = result.replace("$ss", &now.format("%S").to_string());
    
    Ok(result)
}

// ==================== USER DATA PATH ====================

#[tauri::command]
pub fn get_user_data_path(app: tauri::AppHandle) -> Result<String, String> {
    let path = app.path()
        .app_data_dir()
        .map_err(|e| format!("Cannot get app data dir: {}", e))?;

    fs::create_dir_all(&path).map_err(|e| e.to_string())?;

    Ok(path.to_string_lossy().to_string())
}

/// Путь к исходникам плагинов (`plugins-dev/` в корне репо) — для PluginBuilderWin.
/// В dev режиме CWD = корень проекта; для prod — поднимаемся вверх от `src-tauri`,
/// чтобы добраться до родительской папки с plugins-dev. Если ни тот, ни тот вариант
/// не подходит — вернёт ошибку.
#[tauri::command]
pub fn get_plugins_dev_path() -> Result<String, String> {
    let cwd = std::env::current_dir().map_err(|e| e.to_string())?;

    // Кандидаты: <cwd>/plugins-dev, <cwd>/../plugins-dev (когда CWD=src-tauri в dev).
    let candidates = [
        cwd.join("plugins-dev"),
        cwd.parent().map(|p| p.join("plugins-dev")).unwrap_or_default(),
    ];
    for c in &candidates {
        if c.is_dir() {
            return Ok(c.to_string_lossy().to_string());
        }
    }
    Err(format!(
        "plugins-dev folder not found. Looked in: {:?}",
        candidates,
    ))
}

// ==================== FONTS ====================

#[tauri::command]
pub fn fonts_get_list() -> Result<Vec<FontInfo>, String> {
    let platform = std::env::consts::OS;
    let mut font_dirs: Vec<PathBuf> = Vec::new();

    match platform {
        "macos" => {
            font_dirs.push(PathBuf::from("/System/Library/Fonts"));
            font_dirs.push(PathBuf::from("/Library/Fonts"));
            if let Some(home) = dirs::home_dir() {
                font_dirs.push(home.join("Library").join("Fonts"));
            }
        }
        "windows" => {
            font_dirs.push(PathBuf::from("C:\\Windows\\Fonts"));
            if let Some(home) = dirs::home_dir() {
                font_dirs.push(home.join("AppData").join("Local").join("Microsoft").join("Windows").join("Fonts"));
            }
        }
        _ => {
            font_dirs.push(PathBuf::from("/usr/share/fonts"));
            font_dirs.push(PathBuf::from("/usr/local/share/fonts"));
            if let Some(home) = dirs::home_dir() {
                font_dirs.push(home.join(".fonts"));
                font_dirs.push(home.join(".local").join("share").join("fonts"));
            }
        }
    }

    let loadable_exts = ["ttf", "otf", "woff", "woff2"];
    let all_exts = ["ttf", "otf", "woff", "woff2", "ttc"];
    
    let mut seen = std::collections::HashSet::new();
    let mut results: Vec<FontInfo> = Vec::new();

    for dir in &font_dirs {
        if dir.exists() {
            walk_fonts(dir, &all_exts, &loadable_exts, &mut seen, &mut results);
        }
    }

    results.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(results)
}

fn walk_fonts(
    dir: &Path,
    all_exts: &[&str],
    loadable_exts: &[&str],
    seen: &mut std::collections::HashSet<String>,
    results: &mut Vec<FontInfo>,
) {
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            
            if path.is_dir() {
                walk_fonts(&path, all_exts, loadable_exts, seen, results);
                continue;
            }
            
            let ext = path
                .extension()
                .map(|e| e.to_string_lossy().to_lowercase())
                .unwrap_or_default();
            
            if !all_exts.contains(&ext.as_str()) {
                continue;
            }
            
            let name = path
                .file_stem()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();
            
            if seen.contains(&name) {
                continue;
            }
            seen.insert(name.clone());
            
            let loadable = loadable_exts.contains(&ext.as_str());
            
            results.push(FontInfo {
                name,
                path: path.to_string_lossy().to_string(),
                loadable,
            });
        }
    }
}

#[tauri::command]
pub fn fonts_load_one(font_path: String) -> Result<Option<String>, String> {
    let path = Path::new(&font_path);
    
    if !path.exists() {
        return Ok(None);
    }

    let ext = path
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();

    // TTC не поддерживается FontFace
    if ext == "ttc" {
        return Ok(None);
    }

    let buffer = fs::read(path).map_err(|e| e.to_string())?;

    // Проверка OS/2 таблицы для TTF/OTF
    if ext == "ttf" || ext == "otf" {
        if !has_os2_table(&buffer) {
            return Ok(None);
        }
    }

    let mime = match ext.as_str() {
        "woff2" => "font/woff2",
        "woff" => "font/woff",
        "otf" => "font/otf",
        _ => "font/truetype",
    };

    let base64_str = base64_encode(&buffer);
    Ok(Some(format!("data:{};base64,{}", mime, base64_str)))
}

fn has_os2_table(buffer: &[u8]) -> bool {
    if buffer.len() < 12 {
        return false;
    }

    let num_tables = u16::from_be_bytes([buffer[4], buffer[5]]) as usize;
    let table_start = 12;

    for i in 0..num_tables {
        let record_offset = table_start + i * 16;
        if record_offset + 4 > buffer.len() {
            break;
        }

        let tag = String::from_utf8_lossy(&buffer[record_offset..record_offset + 4]);
        if tag == "OS/2" {
            return true;
        }
    }

    false
}

// ==================== SHELL:OPEN PATH ====================

#[tauri::command]
pub fn shell_open_path(folder_path: String) -> Result<(), String> {
    use std::process::Command;
    
    #[cfg(target_os = "macos")]
    {
        Command::new("open").arg(&folder_path).spawn()
            .map_err(|e| format!("Failed to open: {}", e))?;
    }
    
    #[cfg(target_os = "windows")]
    {
        Command::new("explorer").arg(&folder_path).spawn()
            .map_err(|e| format!("Failed to open: {}", e))?;
    }
    
    #[cfg(target_os = "linux")]
    {
        Command::new("xdg-open").arg(&folder_path).spawn()
            .map_err(|e| format!("Failed to open: {}", e))?;
    }
    
    println!("[Shell] Opened: {}", folder_path);
    Ok(())
}
