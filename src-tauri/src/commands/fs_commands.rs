#![allow(dead_code)]

use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use tauri::Manager;

// ==================== TYPES ====================

#[derive(Debug, Serialize, specta::Type)]
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

/// Опции копирования/перемещения.
///
/// Поле `useHashCheck` убрано (2026-08-10): оно принималось, но НЕ читалось ни
/// `copy_item`, ни `move_item` — то есть API обещал проверку целостности, которой
/// не было. В Electron-версии проверка существовала и закрывала конкретный риск:
/// файлы лежали в папке Google-синхронизатора и могли быть скачаны не полностью.
/// Сейчас за «байты на месте» отвечает шов хранилища (`storage_ensure_local` /
/// `storage_copy_from_mirror`), то есть гарантия стала явной и переехала уровнем выше.
#[derive(Debug, Deserialize, specta::Type)]
pub struct CopyMoveOptions {
    #[serde(default)]
    pub overwrite: bool,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PreviewResizeOpts {
    pub width: f64,
    pub height: f64,
    #[serde(default)]
    pub aspect_ratio: Option<f64>,
    #[serde(default)]
    pub extra_height: Option<f64>,
}

#[derive(Debug, Serialize, specta::Type)]
pub struct FontInfo {
    pub name: String,
    pub path: String,
    pub loadable: bool,
}

// ==================== PATH UTILITIES ====================
// basename/dirname/extname/parse/relative УДАЛЕНЫ: это чистые строковые операции,
// приложение делает их в renderer (src/Utils/path.ts → src/PluginAPI/path.ts,
// кросс-платформенно), без IPC-round-trip'а. Осталась только path_join — её через IPC
// зовут ПЛАГИНЫ (_template/tauri.ts), поэтому она остаётся обычной #[tauri::command]
// (без specta-биндинга — типизированного потребителя нет). См. SPECTA_MIGRATION_PLAN.md.

#[tauri::command]
#[specta::specta]
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

// ==================== FILE INFO ====================

#[tauri::command]
#[specta::specta]
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
#[specta::specta]
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
#[specta::specta]
pub fn test_and_create_folder(path: String) -> Result<(), String> {
    fs::create_dir_all(&path).map_err(|e| e.to_string())
}

/// Возвращает метаданные файла (для полифила node:fs.stat).
#[derive(Debug, Serialize, specta::Type)]
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
#[specta::specta]
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
#[specta::specta]
pub fn os_tmpdir() -> String {
    std::env::temp_dir().to_string_lossy().to_string()
}

/// Считает хеш файла по алгоритму (sha256 | sha1 | md5). Возвращает hex.
/// Для полифила node:crypto.createHash, чтобы не таскать содержимое через IPC.
#[tauri::command]
#[specta::specta]
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
#[specta::specta]
pub fn test_and_create_folders(paths: Vec<String>) -> Result<Vec<String>, String> {
    for p in &paths {
        let pb = std::path::Path::new(p);
        if !pb.is_absolute() {
            return Err(format!("[test_and_create_folders] path is not absolute: {}", p));
        }
        fs::create_dir_all(p).map_err(|e| e.to_string())?;
    }
    Ok(paths)
}

/// Создаёт папку (если нет) и возвращает её содержимое в формате `{ folders: [], files: [] }`.
/// Аналог Electron'овского ensureAndReadDir.
#[tauri::command]
#[specta::specta]
pub fn ensure_and_read_dir(path: String) -> Result<serde_json::Value, String> {
    if !std::path::Path::new(&path).is_absolute() {
        return Err(format!("[ensure_and_read_dir] path is not absolute: {}", path));
    }
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
#[specta::specta]
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
#[specta::specta]
pub fn rename_folder(old_path: String, new_path: String) -> Result<(), String> {
    fs::rename(&old_path, &new_path).map_err(|e| e.to_string())
}

/// Устанавливает mtime файла/папки на указанный момент времени в миллисекундах от Unix epoch.
/// Используется в логике автоотключения: при ручном включении папки с устаревшим OUT
/// фронт двигает mtime, чтобы дать папке окно перед повторным auto-disable.
#[tauri::command]
#[specta::specta]
pub fn set_path_mtime(path: String, mtime_ms: f64) -> Result<(), String> {
    let p = Path::new(&path);
    if !p.exists() {
        return Err(format!("Path does not exist: {}", path));
    }
    let secs = (mtime_ms / 1000.0).floor() as i64;
    let nanos = (((mtime_ms - (secs as f64) * 1000.0).max(0.0)) * 1_000_000.0) as u32;
    let ft = filetime::FileTime::from_unix_time(secs, nanos);
    filetime::set_file_mtime(p, ft).map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn copy_item(
    source_path: String,
    destination_path: String,
    options: Option<CopyMoveOptions>,
) -> Result<(), String> {
    let opts = options.unwrap_or(CopyMoveOptions { overwrite: false });

    let source = Path::new(&source_path);
    let dest = Path::new(&destination_path);

    if !source.exists() {
        return Err(format!("Source path does not exist: {}", source_path));
    }

    if dest.exists() && !opts.overwrite {
        return Err(format!("Destination already exists: {}", destination_path));
    }

    if source.is_dir() && is_inside(source, dest) {
        return Err(format!(
            "Нельзя копировать папку внутрь себя: {} → {}",
            source_path, destination_path
        ));
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

/// `dst` лежит ВНУТРИ `src`? Тогда рекурсивное копирование бесконечно: обход
/// `read_dir` ленивый, поэтому он увидит только что созданную копию внутри
/// источника и полезет в неё, потом в копию копии — до заполнения диска.
///
/// Канонизирует путь, которого может ещё не существовать: поднимается до
/// ближайшего СУЩЕСТВУЮЩЕГО предка, канонизирует его и приклеивает обратно хвост.
///
/// Канонизировать обязательно: на macOS `/var` — симлинк на `/private/var`, и
/// сравнение «канонический источник против сырой цели» врёт. Одного уровня
/// родителя не хватает — цель может быть на несколько несуществующих уровней
/// глубже (`a/x/y`, где нет ни `x`, ни `y`).
fn canonical_ish(p: &Path) -> PathBuf {
    let mut tail: Vec<std::ffi::OsString> = Vec::new();
    let mut cur = p.to_path_buf();
    loop {
        if let Ok(existing) = cur.canonicalize() {
            let mut out = existing;
            for part in tail.iter().rev() {
                out.push(part);
            }
            return out;
        }
        let name = match cur.file_name() {
            Some(n) => n.to_os_string(),
            // Дошли до корня и он не канонизируется — сравнивать нечего, отдаём как есть.
            None => return p.to_path_buf(),
        };
        tail.push(name);
        if !cur.pop() {
            return p.to_path_buf();
        }
    }
}

fn is_inside(src: &Path, dst: &Path) -> bool {
    let s = canonical_ish(src);
    let d = canonical_ish(dst);
    // Совпадение путей — не вложенность: копирование «в себя же» отсекают более
    // ранние проверки (`dest.exists() && !overwrite`), рекурсии там нет.
    d != s && d.starts_with(&s)
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
#[specta::specta]
pub fn move_item(
    source_path: String,
    destination_path: String,
    options: Option<CopyMoveOptions>,
) -> Result<(), String> {
    let opts = options.unwrap_or(CopyMoveOptions { overwrite: false });

    let source = Path::new(&source_path);
    let dest = Path::new(&destination_path);

    if !source.exists() {
        return Err(format!("Source path does not exist: {}", source_path));
    }

    if dest.exists() && !opts.overwrite {
        return Err(format!("Destination already exists: {}", destination_path));
    }

    if source.is_dir() && is_inside(source, dest) {
        return Err(format!(
            "Нельзя переместить папку внутрь себя: {} → {}",
            source_path, destination_path
        ));
    }

    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    // Состояние фиксируем ДО любых изменений: ниже оно решает, можно ли откатываться.
    let src_is_dir = source.is_dir();
    let dest_existed = dest.exists();

    if fs::rename(source, dest).is_ok() {
        return Ok(());
    }

    // `rename` не работает между разными томами (локальный диск → внешний или
    // сетевой) — это штатный случай, а не сбой. Откат: скопировать, затем удалить
    // источник.
    if src_is_dir {
        copy_dir_all(source, dest).map_err(|e| format!("move: копирование не удалось: {}", e))?;
    } else {
        fs::copy(source, dest).map_err(|e| format!("move: копирование не удалось: {}", e))?;
    }

    let removed = if src_is_dir {
        fs::remove_dir_all(source)
    } else {
        fs::remove_file(source)
    };

    if let Err(remove_err) = removed {
        // Копия есть, источник остался — то есть файл сейчас в ДВУХ местах.
        //
        // Раньше здесь просто возвращалась ошибка, и вызывающий читал её как
        // «перемещение не удалось, ничего не произошло». Последствий два: повтор
        // упирался в «Destination already exists», а пайплайн с `afterPost: move`
        // находил файл в исходной папке на следующем витке и публиковал повторно.
        //
        // Восстанавливаем инвариант «либо целиком, либо ничего» — но только если
        // цели до нас НЕ БЫЛО. Если была (overwrite), мы её перезаписали, и удаление
        // уничтожило бы данные, которых мы не создавали: тогда меньшее зло — оставить
        // копию и честно сказать, что файл в двух местах.
        if dest_existed {
            return Err(format!(
                "move: источник не удалён ({}). Цель существовала и была перезаписана, \
                 поэтому откат не делаем — файл сейчас и там, и там: {} / {}",
                remove_err, source_path, destination_path
            ));
        }

        let rollback = if src_is_dir {
            fs::remove_dir_all(dest)
        } else {
            fs::remove_file(dest)
        };
        return match rollback {
            Ok(()) => Err(format!(
                "move: источник не удалён ({}), копия откачена — состояние не изменилось, \
                 можно повторить: {}",
                remove_err, source_path
            )),
            Err(rollback_err) => Err(format!(
                "move: источник не удалён ({}), и откат копии не удался ({}) — \
                 файл сейчас в ДВУХ местах: {} / {}",
                remove_err, rollback_err, source_path, destination_path
            )),
        };
    }

    Ok(())
}

#[tauri::command]
#[specta::specta]
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


/// Атомарная запись файла: во временный файл рядом, затем переименование.
///
/// Обычный `fs::write` сначала обрезает файл, а потом наполняет. Крах или потеря
/// питания в этом окне оставляют на диске обрезанный файл вместо прежнего целого.
/// Для файлов состояния это означает потерю: пустой `settings.json` молча
/// подменяется дефолтами, а обрезанный `options.json` — это потерянный граф нод,
/// то есть собственно работа пользователя.
///
/// Переименование внутри одного каталога атомарно, поэтому на диске всегда либо
/// прежнее содержимое целиком, либо новое целиком. Промежуточного состояния нет.
///
/// Применять к файлам, которые приложение перезаписывает ЦЕЛИКОМ. Для дозаписи
/// (jsonl-логи) есть `append_file` с настоящим `O_APPEND`.
pub(crate) fn write_atomic(path: &Path, content: &[u8]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("create_dir_all: {}", e))?;
    }

    let mut tmp = path.as_os_str().to_os_string();
    tmp.push(".tmp");
    let tmp = PathBuf::from(tmp);

    fs::write(&tmp, content).map_err(|e| format!("write tmp: {}", e))?;
    fs::rename(&tmp, path).map_err(|e| {
        // Незавершённый tmp не оставляем — иначе копится рядом с настоящими файлами.
        let _ = fs::remove_file(&tmp);
        format!("rename: {}", e)
    })
}

// ==================== READ/WRITE FILES ====================

#[tauri::command]
#[specta::specta]
pub fn read_file_sync(file_path: String) -> Result<String, String> {
    fs::read_to_string(&file_path).map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn read_media_preview(
    file_path: String,
    state: tauri::State<std::sync::Mutex<crate::commands::settings_commands::AppSettingsState>>,
    app: tauri::AppHandle,
) -> Result<String, String> {
    let path = Path::new(&file_path);

    if !path.exists() {
        crate::commands::diag_log::write(&app, &format!("[media_preview] NOT FOUND '{}'", file_path));
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

    // Видео: снимаем первый кадр через ffmpeg (декодирует prores/HDR/любой кодек,
    // который понимает ffmpeg, и отдаёт RGBA-PNG — alpha сохраняется для FG-слоёв).
    // Если ffmpeg не найден или кадр снять не удалось — отдаём пустую строку, как и
    // для неизвестных типов: UI просто покажет файл без превью, не падая.
    if video_exts.contains(&ext.as_str()) {
        let ffmpeg = crate::commands::ffmpeg_commands::resolve_program_path("ffmpeg", &state);
        match crate::commands::ffmpeg_commands::ffmpeg_get_video_thumbnail_with_path(
            file_path.clone(),
            Some(0.0),
            &ffmpeg,
        ) {
            Ok(url) => return Ok(url),
            Err(e) => {
                // Кадр снять не удалось — UI покажет файл без превью, не падая.
                // Причину пишем в diag.log, чтобы не молчать (см. историю с trc:reserved).
                crate::commands::diag_log::write(&app, &format!("[media_preview] FFMPEG ERR: {}", e));
                return Ok(String::new());
            }
        }
    }

    Ok("".to_string())
}

/// base64 через крейт `base64` (он уже в зависимостях и используется в
/// icon_commands/youtube_auth_commands).
///
/// Здесь была своя реализация на `write!` по одному символу — то есть четыре вызова
/// машинерии `fmt` на каждые три байта, да ещё без `with_capacity`. Замер на 10 МБ:
/// 109 мс против 10.9 мс у крейта при побайтово одинаковом результате. Путь горячий —
/// это превью картинок в списке файлов.
fn base64_encode(data: &[u8]) -> String {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.encode(data)
}

#[tauri::command]
#[specta::specta]
pub fn write_file(file_path: String, content: String) -> Result<serde_json::Value, String> {
    let path = Path::new(&file_path);

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    fs::write(path, content).map_err(|e| e.to_string())?;

    Ok(serde_json::json!({ "success": true }))
}

/// Атомарная перезапись файла целиком — для файлов СОСТОЯНИЯ приложения.
///
/// Отличие от `write_file`: тот пишет напрямую (`fs::write` обрезает файл, потом
/// наполняет), и крах в этом окне оставляет обрезанный файл. Здесь запись идёт через
/// временный файл рядом с переименованием, поэтому на диске всегда либо прежнее
/// содержимое целиком, либо новое целиком.
///
/// Почему отдельная команда, а не изменение `write_file`: тот универсальный и его
/// зовут ПЛАГИНЫ для произвольных файлов, а переименование меняет inode — это может
/// задеть вотчеры и жёсткие ссылки. Плагинам поведение оставлено прежним.
///
/// Применять к тому, что приложение перезаписывает целиком: `folderState.json`,
/// сайдкары `postSources.json`/`tgSearch.json`, пресеты, `plugin.json`/`ui.json`
/// из конструктора. Для дозаписи есть `append_file`.
#[tauri::command]
#[specta::specta]
pub fn write_file_atomic(file_path: String, content: String) -> Result<serde_json::Value, String> {
    write_atomic(Path::new(&file_path), content.as_bytes())?;
    Ok(serde_json::json!({ "success": true }))
}

/// Дописывает строку в конец файла настоящим append'ом (O_APPEND), не перезаписывая файл.
/// Для append-only логов вроде _post/$MM.$YYYY.jsonl: краш посреди записи в худшем случае
/// оставит оборванную последнюю строку (парсер её пропустит), а не потеряет весь файл.
/// Создаёт файл и родительские директории при необходимости.
#[tauri::command]
#[specta::specta]
pub fn append_file(file_path: String, content: String) -> Result<serde_json::Value, String> {
    use std::io::Write;
    let path = Path::new(&file_path);

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|e| e.to_string())?;
    file.write_all(content.as_bytes()).map_err(|e| e.to_string())?;

    Ok(serde_json::json!({ "success": true }))
}

/// Записывает бинарный файл из base64-строки.
/// Используется плагинами для сохранения скачанных через fetch результатов
/// (видео, аудио, изображения). Создаёт родительские директории при необходимости.
#[tauri::command]
#[specta::specta]
pub fn write_binary_file(file_path: String, data_b64: String) -> Result<u64, String> {
    let path = Path::new(&file_path);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let bytes = base64_decode(&data_b64).map_err(|e| format!("base64 decode: {}", e))?;
    fs::write(path, &bytes).map_err(|e| e.to_string())?;
    Ok(bytes.len() as u64)
}

/// Декод base64. Терпимость к пробелам и переносам сохранена намеренно: прежняя
/// самодельная реализация их игнорировала, и вход мог прийти «завёрнутым» (например
/// из HTTP-ответа). Крейт по умолчанию такое отвергает, поэтому чистим до вызова,
/// а к padding'у относимся безразлично — как раньше.
fn base64_decode(s: &str) -> Result<Vec<u8>, String> {
    use base64::engine::{DecodePaddingMode, GeneralPurpose, GeneralPurposeConfig};
    use base64::Engine;

    static ENGINE: GeneralPurpose = GeneralPurpose::new(
        &base64::alphabet::STANDARD,
        GeneralPurposeConfig::new().with_decode_padding_mode(DecodePaddingMode::Indifferent),
    );

    let cleaned: String = s.chars().filter(|c| !c.is_ascii_whitespace()).collect();
    ENGINE
        .decode(cleaned.as_bytes())
        .map_err(|e| format!("invalid base64: {}", e))
}

// ==================== PATH VALIDATION ====================

/// Возвращает путь до файла или '' если файл не существует или является папкой.
/// Совместимо с Electron: всегда возвращает строку, никогда не бросает ошибку.
#[tauri::command]
#[specta::specta]
pub fn check_file_path(path: String, name: Option<String>) -> Result<String, String> {
    let check_path = if let Some(n) = name {
        PathBuf::from(&path).join(n).to_string_lossy().to_string()
    } else {
        path
    };
    let p = Path::new(&check_path);
    if !p.exists() || !p.is_file() {
        return Ok(String::new());
    }
    Ok(check_path)
}

/// Возвращает путь до папки или '' если не существует.
/// Если передан путь до файла — возвращает родительскую директорию.
/// Совместимо с Electron: всегда возвращает строку, никогда не бросает ошибку.
#[tauri::command]
#[specta::specta]
pub fn check_folder_path(path: String, name: Option<String>) -> Result<String, String> {
    let check_path = if let Some(n) = name {
        PathBuf::from(&path).join(n).to_string_lossy().to_string()
    } else {
        path
    };
    let p = Path::new(&check_path);
    if !p.exists() {
        return Ok(String::new());
    }
    if p.is_file() {
        return Ok(p.parent().map(|d| d.to_string_lossy().to_string()).unwrap_or_default());
    }
    Ok(check_path)
}

// ==================== SEARCH IN FOLDER ====================

/// Один элемент паттерна поиска. Формат совместим с Electron:
/// `{ type: 'files'|'folders', ext: string[] }`.
/// Пустой массив `ext` означает «все расширения».
#[derive(Debug, Deserialize, Clone, specta::Type)]
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

/// Расширение файла в нижнем регистре, без точки. Пустая строка, если расширения нет.
fn ext_lower(path: &Path) -> String {
    path.extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default()
}

/// Файл/папка ли это, за один системный вызов вместо двух.
///
/// `entry.file_type()` на большинстве платформ берётся из уже прочитанной записи
/// каталога и не требует отдельного stat — в отличие от `path.is_file()` /
/// `path.is_dir()`, каждый из которых делает свой. На папках Google-диска (FUSE)
/// это заметно: там stat дорогой, а записей бывают тысячи.
///
/// Симлинки обрабатываем как раньше: `file_type()` сообщает про саму ссылку, поэтому
/// для неё (и только для неё) идём за `metadata()`, которая ссылку разворачивает.
/// Без этого симлинк на видеофайл перестал бы попадать в выдачу.
fn kind_of(entry: &fs::DirEntry) -> (bool, bool) {
    match entry.file_type() {
        Ok(ft) if ft.is_symlink() => match entry.path().metadata() {
            Ok(meta) => (meta.is_file(), meta.is_dir()),
            Err(_) => (false, false),
        },
        Ok(ft) => (ft.is_file(), ft.is_dir()),
        Err(_) => (false, false),
    }
}

/// Возвращает объект вида `{[type]: string[]}` — для каждого `{type, ext}` в search
/// собирает массив **имён** (не полных путей), соответствующих фильтру.
/// Совместимо с Electron Node-fallback'ом, который ожидают callers вроде
/// findFilesForSingleFolder и collectFilesFromFolderFunc.
#[tauri::command]
#[specta::specta]
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

    // Расширения приводим к нижнему регистру ОДИН раз. Раньше это делалось внутри
    // цикла по файлам: новая строка на каждое расширение на каждый файл.
    let normalized: Vec<Vec<String>> = search
        .iter()
        .map(|se| se.ext.iter().map(|e| e.trim_start_matches('.').to_lowercase()).collect())
        .collect();

    for entry in fs::read_dir(dir).map_err(|e| e.to_string())?.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        let (is_file, is_dir) = kind_of(&entry);
        if !is_file && !is_dir {
            continue;
        }
        // Расширение тоже считаем один раз на файл, а не на каждую запись фильтра.
        let ext = if is_file { ext_lower(&entry.path()) } else { String::new() };

        for (se, exts) in search.iter().zip(&normalized) {
            if se.kind == "folders" {
                if is_dir {
                    if let Some(arr) = by_type.get_mut("folders") {
                        if !arr.contains(&name) {
                            arr.push(name.clone());
                        }
                    }
                }
            } else if is_file && (exts.is_empty() || exts.iter().any(|e| *e == ext)) {
                if let Some(arr) = by_type.get_mut(&se.kind) {
                    // Дедуп как у папок: два фильтра одного типа (например `[]` и
                    // `[mp4]`) иначе положили бы один и тот же файл дважды.
                    if !arr.contains(&name) {
                        arr.push(name.clone());
                    }
                }
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
#[specta::specta]
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

/// Батч-чтение состояния вкл/выкл проектов из `<project>/options/folderState.json`.
/// Для главной папки читает каждую подпапку верхнего уровня и возвращает объект
/// `{ [projectName]: stateJson }` ТОЛЬКО для тех, где файл существует и парсится.
/// Отсутствующий/битый файл просто пропускается (ключа нет) — так TS-гидратор отличает
/// «есть состояние в папке» от «нужна ленивая миграция из legacy LS». Один IPC на всю
/// главную папку вместо N round-trip к Google Drive.
#[tauri::command]
#[specta::specta]
pub fn read_folder_states(main_folder_path: String) -> Result<serde_json::Value, String> {
    let dir = Path::new(&main_folder_path);
    let mut out = serde_json::Map::new();
    if !dir.is_dir() {
        return Ok(serde_json::Value::Object(out));
    }
    for entry in fs::read_dir(dir).map_err(|e| e.to_string())?.flatten() {
        let entry_path = entry.path();
        if !entry_path.is_dir() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        let state_file = entry_path.join("options").join("folderState.json");
        if !state_file.is_file() {
            continue;
        }
        // Битый JSON / нечитаемый файл — пропускаем: не даём мусору перезаписать кэш
        // и не блокируем гидрацию остальных проектов.
        if let Ok(content) = fs::read_to_string(&state_file) {
            if let Ok(val) = serde_json::from_str::<serde_json::Value>(&content) {
                out.insert(name, val);
            }
        }
    }
    Ok(serde_json::Value::Object(out))
}

/// Рекурсивный поиск. Возвращает `{[type]: string[]}` — относительные пути от `path`,
/// разбитые по типу (как в Electron'е). Папки тоже могут включаться если в search есть type=folders.
#[tauri::command]
#[specta::specta]
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
            let name = entry.file_name().to_string_lossy().to_string();
            let rel = rel_prefix.join(&name);
            let rel_str = rel.to_string_lossy().to_string();

            // Тип берём из записи каталога, а не двумя `is_file()`/`is_dir()`: обход
            // рекурсивный, и лишний stat на каждый элемент дерева на папках Google-диска
            // стоит дорого. Симлинки при этом разворачиваются, как и раньше.
            let (is_file, is_dir) = kind_of(&entry);
            let p = entry.path();

            if is_file {
                if let Some(f) = files_filter {
                    if ext_matches(&p, &f.ext) {
                        if let Some(arr) = by_type.get_mut("files") {
                            arr.push(rel_str);
                        }
                    }
                }
            } else if is_dir {
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

// ==================== USER DATA PATH ====================

#[tauri::command]
#[specta::specta]
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
#[specta::specta]
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

// ==================== PLATFORM TARGET ====================

/// Количество логических CPU ядер. Из WebView через navigator.hardwareConcurrency
/// получить нельзя — Safari/WebKit clamp'ит результат до 8 (anti-fingerprinting),
/// что мешает корректно настроить thread-pool для нативных бинарников (whisper, ffmpeg).
#[tauri::command]
#[specta::specta]
pub fn get_cpu_count() -> usize {
    std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4)
}

/// Возвращает сегмент платформы в формате, удобном для путей бинарников плагинов:
/// `mac-arm64`, `mac-x64`, `win-x64`, `linux-x64`, `linux-arm64`.
/// Из WebView архитектуру macOS определить нельзя (Apple отдаёт "Intel" в navigator
/// даже на Apple Silicon), поэтому источник правды — Rust runtime.
#[tauri::command]
#[specta::specta]
pub fn get_platform_target() -> String {
    let os = std::env::consts::OS;
    let arch = std::env::consts::ARCH;
    match (os, arch) {
        ("macos", "aarch64") => "mac-arm64".to_string(),
        ("macos", _) => "mac-x64".to_string(),
        ("windows", "aarch64") => "win-arm64".to_string(),
        ("windows", _) => "win-x64".to_string(),
        ("linux", "aarch64") => "linux-arm64".to_string(),
        ("linux", _) => "linux-x64".to_string(),
        _ => format!("{}-{}", os, arch),
    }
}

// ==================== FONTS ====================

#[tauri::command]
#[specta::specta]
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
#[specta::specta]
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

/// Открыть путь системным средством. Реализация — `tauri-plugin-opener`
/// (см. пояснение в `dialog_commands.rs`: рукописные `#[cfg]`-ветви убраны,
/// на Windows там был небезопасный `cmd /c start`).
///
/// Отличие от `show_in_folder`: та РАСКРЫВАЕТ папку и выделяет в ней элемент,
/// а эта просто открывает путь тем, что назначено в системе.
#[tauri::command]
#[specta::specta]
pub fn shell_open_path(folder_path: String) -> Result<(), String> {
    tauri_plugin_opener::open_path(&folder_path, None::<&str>)
        .map_err(|e| format!("Failed to open: {}", e))
}

#[cfg(test)]
mod tests {
    use super::{base64_decode, base64_encode, get_some_from_folder, is_inside, move_item, write_atomic, CopyMoveOptions};
    use std::fs;
    use std::path::PathBuf;

    /// Уникальный каталог под тест: имя из pid + метки, чтобы параллельные запуски
    /// не мешали друг другу.
    fn tmp(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("fsm-is-inside-{}-{}", std::process::id(), tag));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    /// Регрессия: `copy_dir_all` создаёт цель, а обход `read_dir` ленивый — он видит
    /// свежую копию внутри источника и лезет в неё, потом в копию копии, и так до
    /// заполнения диска. Проверка вложенности стоит до начала копирования.
    #[test]
    fn цель_внутри_источника() {
        let root = tmp("nested");
        let src = root.join("a");
        fs::create_dir_all(&src).unwrap();
        let dst = src.join("b");
        assert!(is_inside(&src, &dst), "b внутри a — копировать нельзя");

        // и на несколько уровней вглубь
        let deep = src.join("x").join("y");
        assert!(is_inside(&src, &deep));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn соседние_каталоги_разрешены() {
        let root = tmp("siblings");
        let src = root.join("a");
        let dst = root.join("b");
        fs::create_dir_all(&src).unwrap();
        assert!(!is_inside(&src, &dst));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn сам_в_себя_не_считается_вложенным() {
        // Это отдельный случай: копирование в себя же — не бесконечная рекурсия,
        // его отсекают более ранние проверки (`dest.exists() && !overwrite`).
        let root = tmp("same");
        let src = root.join("a");
        fs::create_dir_all(&src).unwrap();
        assert!(!is_inside(&src, &src));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn родитель_не_вложен_в_ребёнка() {
        let root = tmp("parent");
        let child = root.join("a").join("b");
        fs::create_dir_all(&child).unwrap();
        let parent = root.join("a");
        assert!(!is_inside(&child, &parent));
        let _ = fs::remove_dir_all(&root);
    }

    /// `/a` и `/a/../a` — один и тот же каталог; без canonicalize сравнение строк
    /// сочло бы их разными и пропустило бы вложенную цель.
    #[test]
    fn точки_в_пути_не_обманывают() {
        let root = tmp("dots");
        let src = root.join("a");
        fs::create_dir_all(&src).unwrap();
        let tricky = root.join("a").join("..").join("a").join("inside");
        assert!(is_inside(&src, &tricky));
        let _ = fs::remove_dir_all(&root);
    }

    /// Ключевой сценарий: `rename` не сработал (разные тома), копия удалась, а
    /// удаление источника — нет. Раньше возвращалась ошибка, но файл оставался
    /// В ДВУХ местах: повтор упирался в «Destination already exists», а пайплайн
    /// с `afterPost: move` публиковал файл повторно на следующем витке.
    ///
    /// Удаление файла на unix требует прав на ЗАПИСЬ В РОДИТЕЛЬСКИЙ каталог —
    /// этим и воспроизводим отказ, снимая с него write-бит.
    #[cfg(unix)]
    #[test]
    fn источник_не_удалился_копия_откачена() {
        use std::os::unix::fs::PermissionsExt;

        let root = tmp("move-rollback");
        let src_dir = root.join("ro");
        fs::create_dir_all(&src_dir).unwrap();
        let src = src_dir.join("file.txt");
        fs::write(&src, b"payload").unwrap();
        let dst = root.join("out").join("file.txt");

        // Родитель источника только для чтения → remove_file упадёт.
        let orig = fs::metadata(&src_dir).unwrap().permissions();
        let mut ro = orig.clone();
        ro.set_mode(0o555);
        fs::set_permissions(&src_dir, ro).unwrap();

        let res = move_item(
            src.to_string_lossy().to_string(),
            dst.to_string_lossy().to_string(),
            Some(CopyMoveOptions { overwrite: false }),
        );

        // Права возвращаем сразу, иначе не приберёмся.
        fs::set_permissions(&src_dir, orig).unwrap();

        let err = res.expect_err("перемещение обязано вернуть ошибку");
        assert!(err.contains("откачена"), "ожидали сообщение об откате, получили: {err}");
        assert!(src.exists(), "источник должен остаться на месте");
        assert!(!dst.exists(), "копия должна быть удалена — иначе файл в двух местах");

        let _ = fs::remove_dir_all(&root);
    }

    /// Если цель существовала до нас (overwrite), откат запрещён: удаление уничтожило
    /// бы данные, которых мы не создавали. Тогда честно сообщаем «файл в двух местах».
    #[cfg(unix)]
    #[test]
    fn перезаписанную_цель_не_откатываем() {
        use std::os::unix::fs::PermissionsExt;

        let root = tmp("move-no-rollback");
        let src_dir = root.join("ro");
        fs::create_dir_all(&src_dir).unwrap();
        let src = src_dir.join("file.txt");
        fs::write(&src, b"new").unwrap();

        let out = root.join("out");
        fs::create_dir_all(&out).unwrap();
        let dst = out.join("file.txt");
        fs::write(&dst, b"pre-existing").unwrap();

        let orig = fs::metadata(&src_dir).unwrap().permissions();
        let mut ro = orig.clone();
        ro.set_mode(0o555);
        fs::set_permissions(&src_dir, ro).unwrap();

        let res = move_item(
            src.to_string_lossy().to_string(),
            dst.to_string_lossy().to_string(),
            Some(CopyMoveOptions { overwrite: true }),
        );

        fs::set_permissions(&src_dir, orig).unwrap();

        let err = res.expect_err("перемещение обязано вернуть ошибку");
        assert!(err.contains("и там, и там"), "ожидали отказ от откатa, получили: {err}");
        assert!(dst.exists(), "перезаписанную цель удалять нельзя");

        let _ = fs::remove_dir_all(&root);
    }

    // ── base64 ───────────────────────────────────────────────────────────────
    // Реализация переехала на крейт; тесты фиксируют контракт, который был у
    // самодельной версии, чтобы он не потерялся при следующей правке.

    #[test]
    fn base64_туда_и_обратно() {
        for payload in [b"".as_ref(), b"a", b"ab", b"abc", b"abcd", b"\x00\xff\x7f binary"] {
            let enc = base64_encode(payload);
            let dec = base64_decode(&enc).expect("должно декодироваться");
            assert_eq!(dec, payload, "round-trip сломался на {:?}", payload);
        }
    }

    #[test]
    fn base64_совпадает_с_ожидаемой_строкой() {
        // Стандартный алфавит RFC 4648 с padding — как было.
        assert_eq!(base64_encode(b"a"), "YQ==");
        assert_eq!(base64_encode(b"ab"), "YWI=");
        assert_eq!(base64_encode(b"abc"), "YWJj");
    }

    /// Прежний декодер молча пропускал пробелы, \n, \r и \t — вход мог прийти
    /// «завёрнутым» (например из HTTP-ответа). Крейт такое отвергает, поэтому чистим
    /// до вызова. Тест сторожит именно это поведение.
    #[test]
    fn base64_терпит_пробелы_и_переносы() {
        let wrapped = "YWJj\nZGVm\r\n  Z2hp\t";
        let dec = base64_decode(wrapped).expect("завёрнутый base64 должен читаться");
        assert_eq!(dec, b"abcdefghi");
    }

    #[test]
    fn base64_терпит_отсутствие_padding() {
        assert_eq!(base64_decode("YQ").unwrap(), b"a");
        assert_eq!(base64_decode("YWI").unwrap(), b"ab");
    }

    #[test]
    fn base64_отвергает_мусор() {
        assert!(base64_decode("YQ!!").is_err());
        assert!(base64_decode("привет").is_err());
    }

    /// Тип элемента теперь берётся из записи каталога (`entry.file_type()`) вместо двух
    /// отдельных `is_file()`/`is_dir()`. Ловушка: `file_type()` сообщает про САМУ ссылку,
    /// поэтому без разворачивания симлинк на видеофайл выпал бы из выдачи. Тест сторожит
    /// именно это — что оптимизация не потеряла файлы.
    #[cfg(unix)]
    #[test]
    fn симлинк_на_файл_остаётся_файлом() {
        let root = tmp("symlink");
        let real = root.join("real.mp4");
        fs::write(&real, b"data").unwrap();
        let link = root.join("link.mp4");
        std::os::unix::fs::symlink(&real, &link).unwrap();

        let out = get_some_from_folder(root.to_string_lossy().to_string(), None).unwrap();
        let files = out.get("files").and_then(|v| v.as_array()).cloned().unwrap_or_default();
        let names: Vec<String> = files.iter().filter_map(|v| v.as_str().map(String::from)).collect();

        assert!(names.contains(&"real.mp4".to_string()), "обычный файл: {names:?}");
        assert!(names.contains(&"link.mp4".to_string()), "симлинк тоже файл: {names:?}");

        let _ = fs::remove_dir_all(&root);
    }

    /// Два фильтра одного типа (`[]` и `[mp4]`) раньше кладли один файл дважды:
    /// у папок дедуп был, у файлов — нет.
    #[test]
    fn файл_не_дублируется_при_двух_фильтрах() {
        use super::SearchEntry;
        let root = tmp("dedup");
        fs::write(root.join("clip.mp4"), b"x").unwrap();

        let search = vec![
            SearchEntry { kind: "files".to_string(), ext: vec![] },
            SearchEntry { kind: "files".to_string(), ext: vec!["mp4".to_string()] },
        ];
        let out = get_some_from_folder(root.to_string_lossy().to_string(), Some(search)).unwrap();
        let files = out.get("files").and_then(|v| v.as_array()).cloned().unwrap_or_default();
        assert_eq!(files.len(), 1, "файл должен попасть в выдачу один раз: {files:?}");

        let _ = fs::remove_dir_all(&root);
    }

    // ── write_atomic ─────────────────────────────────────────────────────────

    #[test]
    fn атомарная_запись_создаёт_файл_и_родителей() {
        let root = tmp("atomic-create");
        let p = root.join("deep").join("nested").join("state.json");
        write_atomic(&p, b"{\"a\":1}").unwrap();
        assert_eq!(fs::read_to_string(&p).unwrap(), "{\"a\":1}");
        let _ = fs::remove_dir_all(&root);
    }

    /// Регрессия: обычный `fs::write` обрезает файл перед наполнением, и крах в этом
    /// окне оставлял обрезанный `options.json` — потерянный граф нод. Проверяем, что
    /// временный файл не остаётся: значит запись прошла через rename, а не поверх.
    #[test]
    fn атомарная_запись_не_оставляет_временный_файл() {
        let root = tmp("atomic-tmp");
        let p = root.join("options.json");
        write_atomic(&p, b"first").unwrap();
        write_atomic(&p, b"second").unwrap();

        let leftovers: Vec<String> = fs::read_dir(&root)
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().to_string())
            .filter(|n| n.ends_with(".tmp"))
            .collect();

        assert!(leftovers.is_empty(), "временные файлы должны исчезать: {leftovers:?}");
        assert_eq!(fs::read_to_string(&p).unwrap(), "second");
        let _ = fs::remove_dir_all(&root);
    }
}
