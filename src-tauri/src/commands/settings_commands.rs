// Команды для AppSettings и ColorTypes.
// Хранение: JSON-файлы в app_data_dir/settings.json и app_data_dir/colorTypes.json.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::Manager;

pub const APP_SETTINGS_VERSION: u32 = 1;
pub const COLOR_TYPES_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettingsState {
    pub settings: Value,
    pub color_types: Value,
    pub file_types: Value,
    pub program_paths: Value,
}

impl AppSettingsState {
    pub fn new() -> Self {
        Self {
            settings: default_app_settings(),
            color_types: default_color_types(),
            file_types: default_file_types(),
            program_paths: default_program_paths(),
        }
    }
}

fn default_app_settings() -> Value {
    json!({
        "version": APP_SETTINGS_VERSION,
        "processing": { "maxParallel": 3 },
        "scanSchedule": {
            "minScanWaitMin": 3,
            "maxScanWaitMin": 15,
            "foldersDelayMs": 200
        },
        "resourcePools": {},
        "storage": {
            // Пусто намеренно: архив статистики В ПАПКУ ПРОЕКТА
            // (`options/_stats/$YYYY.$MM.jsonl`) больше не настройка — он пишется всегда,
            // см. `PROJECT_STATS_SEGMENTS` в `db_analytics.rs`. Здесь живут только
            // ДОПОЛНИТЕЛЬНЫЕ архивы, которые человек завёл себе сам.
            // Держать синхронно с DEFAULT_APP_SETTINGS в src/types/appSettings.ts.
            "localArchives": []
        },
        "cleanup": { "retentionDays": null, "autoDisableDays": null },
        "logs": { "retentionDays": 2 },
        "logging": { "bufferSize": 5000 },
        "ui": { "showHints": false },
        "tgServer": {
            "enabled": false,
            "binPath": "",
            "apiId": "",
            "apiHash": "",
            "port": 8081
        }
    })
}

fn default_color_types() -> Value {
    json!({
        "version": COLOR_TYPES_VERSION,
        "types": [],
        "lastScannedAt": null
    })
}

fn default_file_types() -> Value {
    json!([
        {"id":"video","name":"video","path":["avi","mov","mp4","mpeg","mpg","m2v","m4v","ts","mxf","wmv","mkv","webm"],"color":"#0a84feff","inactivePath":[]},
        {"id":"audio","name":"audio","path":["wav","mp3","aac","m4a","flac","ogg","aiff","aif","opus","wma"],"color":"#ffae0cff","inactivePath":[]},
        {"id":"image","name":"image","path":["jpg","jpeg","png","tiff","tga","pdf","gif","pgf","bmp","webp","svg"],"color":"#00e308ff","inactivePath":[]},
        {"id":"text","name":"text","path":["txt","json","md","log","yaml","yml","xml","ini","toml","env"],"color":"#90bae5ff","inactivePath":[]},
        {"id":"title","name":"title","path":["vtt","lrc","srt"],"color":"#9be590ff","inactivePath":[]},
        {"id":"xlsx","name":"xlsx","path":["xlsx","tsv","csv"],"color":"rgb(99, 214, 81)","inactivePath":[]},
        {"id":"aep","name":"aep","path":["aep"],"color":"#9857ffff","inactivePath":[]},
        {"id":"moho","name":"moho","path":["moho"],"color":"#b20affff","inactivePath":[]},
        {"id":"ai","name":"ai","path":["ai","eps"],"color":null,"inactivePath":[]},
        {"id":"psd","name":"psd","path":["psd","psb"],"color":null,"inactivePath":[]},
        {"id":"scripts","name":"scripts","path":["js","jsx","lua"],"color":"rgb(0, 50, 200)","inactivePath":[]}
    ])
}

fn default_program_paths() -> Value {
    json!([
        {"id":"ffmpeg","name":"ffmpeg","path":[],"color":null,"inactivePath":[]},
        {"id":"ffprobe","name":"ffprobe","path":[],"color":null,"inactivePath":[]},
        {"id":"afterEffect","name":"afterEffect","path":[],"color":null,"inactivePath":[]},
        {"id":"moho","name":"moho","path":[],"color":null,"inactivePath":[]}
    ])
}

fn file_types_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {}", e))?;
    fs::create_dir_all(&dir).map_err(|e| format!("create_dir_all: {}", e))?;
    Ok(dir.join("fileTypes.json"))
}

/// База трёхстороннего слияния словарей: снимок серверного документа на момент
/// последней успешной синхронизации.
///
/// Файлом, а не в localStorage: у webview localStorage чистится вместе с кэшем, а
/// без базы слияние теряет способность различать «я поменял» и «сервер поменял» —
/// и правки начинают молча затираться в одну из сторон.
fn settings_sync_base_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {}", e))?;
    fs::create_dir_all(&dir).map_err(|e| format!("create_dir_all: {}", e))?;
    Ok(dir.join("settingsSyncBase.json"))
}

fn program_paths_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {}", e))?;
    fs::create_dir_all(&dir).map_err(|e| format!("create_dir_all: {}", e))?;
    Ok(dir.join("programPaths.json"))
}

fn settings_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {}", e))?;
    fs::create_dir_all(&dir).map_err(|e| format!("create_dir_all: {}", e))?;
    Ok(dir.join("settings.json"))
}

fn color_types_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {}", e))?;
    fs::create_dir_all(&dir).map_err(|e| format!("create_dir_all: {}", e))?;
    Ok(dir.join("colorTypes.json"))
}

/// Читает JSON, при любой беде отдавая `fallback`.
///
/// Битый файл дополнительно сохраняется рядом как `<имя>.corrupt` — ОДИН раз, чтобы
/// не затирать первую (самую ценную) копию. Без этого потеря настроек была совершенно
/// молчаливой: файл не разобрался → пользователь получил дефолты и никакого следа,
/// почему исчезли пути к ffmpeg и лимиты пулов.
fn read_json(path: &PathBuf, fallback: Value) -> Value {
    let Ok(content) = fs::read_to_string(path) else {
        return fallback;
    };
    match serde_json::from_str(&content) {
        Ok(v) => v,
        Err(e) => {
            let backup = path.with_extension("corrupt");
            if !backup.exists() {
                let _ = fs::write(&backup, &content);
            }
            eprintln!(
                "[settings] {} не разобрался ({}), взяты значения по умолчанию. Копия: {}",
                path.display(),
                e,
                backup.display()
            );
            fallback
        }
    }
}

/// Пишет JSON АТОМАРНО: во временный файл рядом, затем переименование.
///
/// Раньше здесь был `fs::write`, который сначала обрезает файл, а потом наполняет.
/// Крах или потеря питания в этом окне оставляли `settings.json` пустым, а `read_json`
/// молча подставлял дефолты — то есть пользователь терял все настройки без следа.
/// Переименование внутри одного каталога атомарно, поэтому файл на диске всегда либо
/// прежний целиком, либо новый целиком.
fn write_json(path: &PathBuf, value: &Value) -> Result<(), String> {
    let content =
        serde_json::to_string_pretty(value).map_err(|e| format!("to_string_pretty: {}", e))?;

    super::fs_commands::write_atomic(path, content.as_bytes())
}

// ==================== App Settings ====================

#[tauri::command]
#[specta::specta]
pub fn app_settings_get(
    app: tauri::AppHandle,
    state: tauri::State<Mutex<AppSettingsState>>,
) -> Result<Value, String> {
    let path = settings_path(&app)?;
    let value = read_json(&path, default_app_settings());
    if let Ok(mut st) = state.lock() {
        st.settings = value.clone();
    }
    Ok(value)
}

#[tauri::command]
#[specta::specta]
pub fn app_settings_set(
    app: tauri::AppHandle,
    state: tauri::State<Mutex<AppSettingsState>>,
    settings: Value,
) -> Result<Value, String> {
    let path = settings_path(&app)?;
    write_json(&path, &settings)?;
    if let Ok(mut st) = state.lock() {
        st.settings = settings.clone();
    }
    Ok(settings)
}

#[tauri::command]
#[specta::specta]
pub fn app_settings_patch(
    app: tauri::AppHandle,
    state: tauri::State<Mutex<AppSettingsState>>,
    patch: Value,
) -> Result<Value, String> {
    let path = settings_path(&app)?;
    let mut current = read_json(&path, default_app_settings());

    if let (Some(curr_obj), Some(patch_obj)) = (current.as_object_mut(), patch.as_object()) {
        for (k, v) in patch_obj {
            if let Some(curr_val) = curr_obj.get_mut(k) {
                if curr_val.is_object() && v.is_object() {
                    let curr_map = curr_val.as_object_mut().unwrap();
                    let patch_map = v.as_object().unwrap();
                    for (sub_k, sub_v) in patch_map {
                        curr_map.insert(sub_k.clone(), sub_v.clone());
                    }
                    continue;
                }
            }
            curr_obj.insert(k.clone(), v.clone());
        }
    }

    write_json(&path, &current)?;
    if let Ok(mut st) = state.lock() {
        st.settings = current.clone();
    }
    Ok(current)
}

// ==================== Cleanup ====================

/// Автоудаление старых результатов в локальной папке-зеркале.
///
/// Структура локальной папки строго фиксирована:
///   localFolder/mainFolderName/projectName/findTime/...
///
/// Правила:
/// - `findTime` (уровень 3) — удаляется целиком, если самый свежий файл в её
///   поддереве старше `cleanup.retentionDays`. Возраст считается по
///   max(mtime файлов в поддереве), а не по mtime самой папки — иначе удаление
///   соседей бампало бы mtime родителя.
/// - `projectName` (уровень 2) — удаляется, ТОЛЬКО если после чистки findTime
///   в ней не осталось ни файлов, ни поддиректорий. По возрасту НЕ удаляется.
/// - `mainFolderName` (уровень 1) — то же, что и `projectName`: только если
///   полностью пустая после прохода.
///
/// Сами пустые `projectName`/`mainFolderName` создадутся снова при следующем
/// скане, если в источнике появятся новые файлы.
///
/// Безопасность вызова: запускать ТОЛЬКО когда очередь обработки пуста и
/// новый скан ещё не стартовал (см. runProcessing.ts). Этот вызов конкурирует
/// с findAllFilesForProcess по тем же путям, и удаление их «из под ног»
/// процессинга и было причиной поломок в Electron-версии.
#[tauri::command]
#[specta::specta]
pub fn cleanup_auto_delete(
    app: tauri::AppHandle,
    local_folder: String,
) -> Result<Value, String> {
    if local_folder.is_empty() {
        return Ok(json!({ "deletedFindTime": 0, "deletedEmpty": 0 }));
    }

    let s_path = settings_path(&app)?;
    let settings = read_json(&s_path, default_app_settings());
    let retention_days = settings
        .get("cleanup")
        .and_then(|c| c.get("retentionDays"))
        .and_then(|v| v.as_u64());
    let Some(days) = retention_days else {
        return Ok(json!({ "deletedFindTime": 0, "deletedEmpty": 0 }));
    };
    if days == 0 {
        return Ok(json!({ "deletedFindTime": 0, "deletedEmpty": 0 }));
    }

    let cutoff = match std::time::SystemTime::now()
        .checked_sub(std::time::Duration::from_secs(days * 24 * 60 * 60))
    {
        Some(t) => t,
        None => return Ok(json!({ "deletedFindTime": 0, "deletedEmpty": 0 })),
    };

    let root = std::path::Path::new(&local_folder);
    if !root.is_absolute() || !root.exists() || !root.is_dir() {
        return Ok(json!({ "deletedFindTime": 0, "deletedEmpty": 0 }));
    }

    let (deleted_findtime, deleted_empty) = cleanup_local_tree(root, cutoff);
    if deleted_findtime > 0 || deleted_empty > 0 {
        println!(
            "[cleanup_auto_delete] {} — removed findTime: {}, empty parents: {} (retention {}d)",
            root.display(),
            deleted_findtime,
            deleted_empty,
            days
        );
    }
    Ok(json!({
        "deletedFindTime": deleted_findtime,
        "deletedEmpty": deleted_empty,
    }))
}

/// Возвращает (удалённых findTime, удалённых пустых project/mainFolder).
fn cleanup_local_tree(root: &std::path::Path, cutoff: std::time::SystemTime) -> (usize, usize) {
    let mut deleted_findtime = 0usize;
    let mut deleted_empty = 0usize;

    let Ok(main_iter) = fs::read_dir(root) else {
        return (0, 0);
    };

    for mf_entry in main_iter.flatten() {
        if !is_real_dir(&mf_entry) {
            continue;
        }
        let main_folder = mf_entry.path();

        if let Ok(proj_iter) = fs::read_dir(&main_folder) {
            for p_entry in proj_iter.flatten() {
                if !is_real_dir(&p_entry) {
                    continue;
                }
                let project_folder = p_entry.path();

                if let Ok(ft_iter) = fs::read_dir(&project_folder) {
                    for ft_entry in ft_iter.flatten() {
                        if !is_real_dir(&ft_entry) {
                            continue;
                        }
                        let find_time = ft_entry.path();
                        let latest = max_mtime_in_subtree(&find_time);
                        if latest < cutoff {
                            match fs::remove_dir_all(&find_time) {
                                Ok(_) => {
                                    println!(
                                        "[cleanup_auto_delete] removed findTime: {}",
                                        find_time.display()
                                    );
                                    deleted_findtime += 1;
                                }
                                Err(e) => {
                                    eprintln!(
                                        "[cleanup_auto_delete] failed: {} — {}",
                                        find_time.display(),
                                        e
                                    );
                                }
                            }
                        }
                    }
                }

                if is_dir_empty(&project_folder) {
                    if fs::remove_dir(&project_folder).is_ok() {
                        println!(
                            "[cleanup_auto_delete] removed empty project: {}",
                            project_folder.display()
                        );
                        deleted_empty += 1;
                    }
                }
            }
        }

        if is_dir_empty(&main_folder) {
            if fs::remove_dir(&main_folder).is_ok() {
                println!(
                    "[cleanup_auto_delete] removed empty mainFolder: {}",
                    main_folder.display()
                );
                deleted_empty += 1;
            }
        }
    }

    (deleted_findtime, deleted_empty)
}

fn is_real_dir(entry: &fs::DirEntry) -> bool {
    match entry.file_type() {
        Ok(ft) => ft.is_dir() && !ft.is_symlink(),
        Err(_) => false,
    }
}

fn is_dir_empty(path: &std::path::Path) -> bool {
    match fs::read_dir(path) {
        Ok(mut it) => it.next().is_none(),
        Err(_) => false, // нет доступа — не удаляем
    }
}

/// max(mtime) по всем файлам в поддереве. Если файлов нет — mtime самой папки
/// (чтобы пустая findTime не выглядела как «возраст с 1970 года»).
fn max_mtime_in_subtree(dir: &std::path::Path) -> std::time::SystemTime {
    let mut latest = std::time::SystemTime::UNIX_EPOCH;
    let mut had_file = false;

    fn walk(
        dir: &std::path::Path,
        latest: &mut std::time::SystemTime,
        had_file: &mut bool,
    ) {
        let Ok(entries) = fs::read_dir(dir) else { return };
        for entry in entries.flatten() {
            let Ok(ft) = entry.file_type() else { continue };
            if ft.is_symlink() {
                continue;
            }
            if ft.is_dir() {
                walk(&entry.path(), latest, had_file);
            } else if ft.is_file() {
                *had_file = true;
                if let Ok(meta) = entry.metadata() {
                    if let Ok(mt) = meta.modified() {
                        if mt > *latest {
                            *latest = mt;
                        }
                    }
                }
            }
        }
    }

    walk(dir, &mut latest, &mut had_file);

    if !had_file {
        if let Ok(meta) = fs::metadata(dir) {
            if let Ok(mt) = meta.modified() {
                latest = mt;
            }
        }
    }
    latest
}

// ==================== Database ====================

/// Стаб для db:registerFound. Реальный online-DB sync не реализован,
/// но фронту нужен **строковый** dbItemId для трекинга item'а в LogWindow и processItem.
/// Возвращаем детерминированный ID на основе pathForDelete + findTime — так чтобы
/// повторный вызов на тот же item дал тот же ID (как и должно быть при идемпотентной регистрации).
#[tauri::command]
#[specta::specta]
pub fn db_register_found(
    payload: Value,
    db_state: tauri::State<Mutex<super::db_analytics::DbState>>,
) -> Result<String, String> {
    let desc = payload.get("description").cloned().unwrap_or(Value::Null);
    let path_for_delete = desc
        .get("pathForDelete")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let find_time = desc.get("findTime").and_then(|v| v.as_str()).unwrap_or("");

    // Идентификатор, назначенный сайтом (задача из очереди), — в приоритете.
    //
    // Локальный id считается из `pathForDelete`, а это путь на ЭТОЙ машине: один и тот
    // же файл, обработанный на двух машинах, получил бы два разных `itemId`, и склейка
    // архивов на сайте увидела бы одну работу как две. Кто владеет жизненным циклом
    // задачи, тот и владеет её идентичностью (`SITE_STATS_LINK_PLAN.md`).
    let site_id = desc
        .get("dbItemId")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();

    let id = if !site_id.is_empty() {
        site_id
    } else if !path_for_delete.is_empty() && !find_time.is_empty() {
        format!("{}:{}", path_for_delete, find_time)
    } else if !path_for_delete.is_empty() {
        path_for_delete.to_string()
    } else {
        format!(
            "{}-{}",
            chrono::Utc::now().timestamp_millis(),
            uuid::Uuid::new_v4().simple().to_string().chars().take(8).collect::<String>()
        )
    };

    let contact: Vec<String> = desc.get("contact")
        .and_then(|v| v.as_array())
        .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect())
        .unwrap_or_default();
    let tags: Vec<String> = desc.get("tags")
        .and_then(|v| v.as_array())
        .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect())
        .unwrap_or_default();

    let record = super::db_analytics::DbItemRecord {
        item_id:          id.clone(),
        registered_at:    chrono::Utc::now().to_rfc3339(),
        project_name:     desc.get("projectName").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        main_folder_name: desc.get("mainFolderName").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        project_path_gd:  desc.get("projectPathGD").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        contact,
        description:      desc.get("description").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        tags,
        year:             desc.get("year").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        find_time:        find_time.to_string(),
        cur_item:         desc.get("curItem").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        size:             desc.get("size").and_then(|v| v.as_i64()).unwrap_or(0),
        is_folder:        desc.get("isFolder").and_then(|v| v.as_bool()).unwrap_or(false),
    };

    if let Ok(mut db) = db_state.lock() {
        db.items.insert(id.clone(), record);
    }
    println!("[db_register_found] registered item_id={}", id);
    Ok(id)
}

// ==================== Color Types ====================

#[tauri::command]
#[specta::specta]
pub fn color_types_get(
    app: tauri::AppHandle,
    state: tauri::State<Mutex<AppSettingsState>>,
) -> Result<Value, String> {
    let path = color_types_path(&app)?;
    let value = read_json(&path, default_color_types());
    if let Ok(mut st) = state.lock() {
        st.color_types = value.clone();
    }
    Ok(value)
}

#[tauri::command]
#[specta::specta]
pub fn color_types_set(
    app: tauri::AppHandle,
    state: tauri::State<Mutex<AppSettingsState>>,
    types: Value,
) -> Result<Value, String> {
    let path = color_types_path(&app)?;
    write_json(&path, &types)?;
    if let Ok(mut st) = state.lock() {
        st.color_types = types.clone();
    }
    Ok(types)
}

/// Пересканит установленные плагины и обновит список colorTypes:
/// — добавляет новые colorType (которые встречаются в `ui.json#data.colorType`)
/// — помечает orphan: true тем, что больше не используются ни одним плагином
/// — ничего не удаляет (юзер может вернуть плагин обратно)
///
/// Порт `electron/main/settings/colorTypes.ts#rescanColorTypes`.
#[tauri::command]
#[specta::specta]
pub fn color_types_rescan(
    app: tauri::AppHandle,
    state: tauri::State<Mutex<AppSettingsState>>,
    plugin_state: tauri::State<Mutex<super::plugin_commands::PluginManagerState>>,
) -> Result<Value, String> {
    let path = color_types_path(&app)?;
    let mut current = read_json(&path, default_color_types());

    // Системные типы — всегда присутствуют, их defaultLimit задан жёстко.
    // ffplay исключён полностью.
    let system_types: &[(&str, i64)] = &[
        ("afterEffect", 1),
        ("moho", 1),
        ("ffmpeg", 2),
        ("ffprobe", 4),
        ("ai", 1),
        ("helpers", 10),
        ("main", 5),
        ("posting", 5),
    ];
    let excluded: std::collections::HashSet<&str> = ["ffplay"].iter().copied().collect();

    // Собираем уникальные colorType из ui.json всех загруженных плагинов.
    let mut used: std::collections::HashSet<String> = std::collections::HashSet::new();
    // Системные типы всегда считаются "используемыми" (не orphan).
    for (name, _) in system_types {
        used.insert(name.to_string());
    }
    if let Ok(pm) = plugin_state.lock() {
        for plugin in pm.plugins.values() {
            let ui_file = plugin
                .manifest
                .ui
                .as_ref()
                .and_then(|v| v.as_str())
                .filter(|s| !s.trim().is_empty());
            let Some(ui_file) = ui_file else { continue };

            let ui_path = std::path::Path::new(&plugin.path).join(ui_file);
            if !ui_path.exists() {
                continue;
            }
            let Ok(raw) = fs::read_to_string(&ui_path) else { continue };
            let Ok(json) = serde_json::from_str::<Value>(&raw) else { continue };

            if let Some(ct) = json
                .get("data")
                .and_then(|d| d.get("colorType"))
                .and_then(|c| c.as_str())
            {
                let trimmed = ct.trim();
                if !trimmed.is_empty() && !excluded.contains(trimmed) {
                    used.insert(trimmed.to_string());
                }
            }
        }
    }

    // Берём существующие записи, обновляем orphan-флаг. ffplay пропускаем.
    let mut merged: Vec<Value> = Vec::new();
    let mut existing_names: std::collections::HashSet<String> = std::collections::HashSet::new();
    if let Some(types_arr) = current.get("types").and_then(|t| t.as_array()) {
        for entry in types_arr {
            let name = entry
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            if name.is_empty() || excluded.contains(name.as_str()) {
                continue;
            }
            let mut e = entry.clone();
            if let Some(obj) = e.as_object_mut() {
                obj.insert("orphan".to_string(), json!(!used.contains(&name)));
            }
            existing_names.insert(name);
            merged.push(e);
        }
    }

    // Добавляем системные типы, которых ещё нет в файле.
    for (name, default_limit) in system_types {
        if !existing_names.contains(*name) {
            merged.push(json!({
                "name": name,
                "defaultLimit": default_limit,
                "orphan": false,
            }));
            existing_names.insert(name.to_string());
        }
    }

    // Добавляем новые colorType из плагинов (не системные и не существующие).
    for name in &used {
        if !existing_names.contains(name) {
            merged.push(json!({
                "name": name,
                "defaultLimit": 1,
                "orphan": false,
            }));
        }
    }

    // Сортируем: сначала активные (по имени), потом orphan.
    merged.sort_by(|a, b| {
        let a_orphan = a.get("orphan").and_then(|v| v.as_bool()).unwrap_or(false);
        let b_orphan = b.get("orphan").and_then(|v| v.as_bool()).unwrap_or(false);
        if a_orphan != b_orphan {
            return if a_orphan {
                std::cmp::Ordering::Greater
            } else {
                std::cmp::Ordering::Less
            };
        }
        let a_name = a.get("name").and_then(|v| v.as_str()).unwrap_or("");
        let b_name = b.get("name").and_then(|v| v.as_str()).unwrap_or("");
        a_name.cmp(b_name)
    });

    if let Some(obj) = current.as_object_mut() {
        obj.insert("types".to_string(), Value::Array(merged));
        obj.insert(
            "lastScannedAt".to_string(),
            json!(chrono::Utc::now().to_rfc3339()),
        );
    }

    write_json(&path, &current)?;
    if let Ok(mut st) = state.lock() {
        st.color_types = current.clone();
    }
    Ok(current)
}

#[tauri::command]
#[specta::specta]
pub fn color_types_add(
    app: tauri::AppHandle,
    state: tauri::State<Mutex<AppSettingsState>>,
    name: String,
    default_limit: Option<i64>,
) -> Result<Value, String> {
    let limit = default_limit.unwrap_or(1);
    let path = color_types_path(&app)?;
    let mut current = read_json(&path, default_color_types());

    if let Some(types) = current.get_mut("types").and_then(|t| t.as_array_mut()) {
        if !types
            .iter()
            .any(|t| t.get("name").and_then(|n| n.as_str()) == Some(&name))
        {
            types.push(json!({
                "name": name,
                "defaultLimit": limit,
                "orphan": false
            }));
        }
    }

    write_json(&path, &current)?;
    if let Ok(mut st) = state.lock() {
        st.color_types = current.clone();
    }
    Ok(current)
}

#[tauri::command]
#[specta::specta]
pub fn color_types_remove(
    app: tauri::AppHandle,
    state: tauri::State<Mutex<AppSettingsState>>,
    name: String,
) -> Result<Value, String> {
    let path = color_types_path(&app)?;
    let mut current = read_json(&path, default_color_types());

    if let Some(types) = current.get_mut("types").and_then(|t| t.as_array_mut()) {
        types.retain(|t| t.get("name").and_then(|n| n.as_str()) != Some(&name));
    }

    write_json(&path, &current)?;
    if let Ok(mut st) = state.lock() {
        st.color_types = current.clone();
    }
    Ok(current)
}

// ==================== Settings sync base ====================

/// Снимок словарей на момент последней успешной синхронизации.
///
/// `null` (первый запуск, файла нет) — база неизвестна, и слияние обязано вести
/// себя осторожно: считать местные записи «своими правками», а не «удалёнными на
/// сервере». Логика в `src/Utils/settingsSync.ts`.
#[tauri::command]
#[specta::specta]
pub fn settings_sync_base_get(app: tauri::AppHandle) -> Result<Value, String> {
    let path = settings_sync_base_path(&app)?;
    Ok(read_json(&path, Value::Null))
}

#[tauri::command]
#[specta::specta]
pub fn settings_sync_base_set(app: tauri::AppHandle, base: Value) -> Result<(), String> {
    let path = settings_sync_base_path(&app)?;
    write_json(&path, &base)
}

// ==================== File Types ====================

#[tauri::command]
#[specta::specta]
pub fn file_types_get(
    app: tauri::AppHandle,
    state: tauri::State<Mutex<AppSettingsState>>,
) -> Result<Value, String> {
    let path = file_types_path(&app)?;
    let value = read_json(&path, default_file_types());
    if let Ok(mut st) = state.lock() {
        st.file_types = value.clone();
    }
    Ok(value)
}

#[tauri::command]
#[specta::specta]
pub fn file_types_set(
    app: tauri::AppHandle,
    state: tauri::State<Mutex<AppSettingsState>>,
    types: Value,
) -> Result<Value, String> {
    let path = file_types_path(&app)?;
    write_json(&path, &types)?;
    if let Ok(mut st) = state.lock() {
        st.file_types = types.clone();
    }
    Ok(types)
}

// ==================== Program Paths ====================

#[tauri::command]
#[specta::specta]
pub fn program_paths_get(
    app: tauri::AppHandle,
    state: tauri::State<Mutex<AppSettingsState>>,
) -> Result<Value, String> {
    let path = program_paths_path(&app)?;
    let value = read_json(&path, default_program_paths());
    if let Ok(mut st) = state.lock() {
        st.program_paths = value.clone();
    }
    Ok(value)
}

#[tauri::command]
#[specta::specta]
pub fn program_paths_set(
    app: tauri::AppHandle,
    state: tauri::State<Mutex<AppSettingsState>>,
    paths: Value,
) -> Result<Value, String> {
    let path = program_paths_path(&app)?;
    write_json(&path, &paths)?;
    if let Ok(mut st) = state.lock() {
        st.program_paths = paths.clone();
    }
    Ok(paths)
}

#[cfg(test)]
mod json_io_tests {
    use super::{read_json, write_json};
    use serde_json::json;
    use std::path::PathBuf;

    fn tmpdir(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("fsm-settings-{}-{}", std::process::id(), tag));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn запись_и_чтение_туда_обратно() {
        let dir = tmpdir("roundtrip");
        let p = dir.join("settings.json");
        write_json(&p, &json!({"limit": 3})).unwrap();
        assert_eq!(read_json(&p, json!({})), json!({"limit": 3}));
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Регрессия: `fs::write` сначала обрезает файл, потом наполняет. Крах в этом окне
    /// оставлял пустой settings.json, а чтение молча отдавало дефолты — пользователь
    /// терял пути к ffmpeg и лимиты пулов без следа. Теперь запись идёт через `.tmp`
    /// с переименованием, поэтому временных остатков после успеха быть не должно.
    #[test]
    fn после_записи_не_остаётся_временного_файла() {
        let dir = tmpdir("no-tmp");
        let p = dir.join("settings.json");
        write_json(&p, &json!({"a": 1})).unwrap();
        let tmp = dir.join("settings.json.tmp");
        assert!(p.exists(), "целевой файл должен появиться");
        assert!(!tmp.exists(), "временный файл обязан быть переименован, а не остаться");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn перезапись_не_теряет_прежнее_при_успехе() {
        let dir = tmpdir("overwrite");
        let p = dir.join("settings.json");
        write_json(&p, &json!({"v": 1})).unwrap();
        write_json(&p, &json!({"v": 2})).unwrap();
        assert_eq!(read_json(&p, json!({})), json!({"v": 2}));
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Битый файл больше не исчезает молча: рядом остаётся `.corrupt`, по которому
    /// видно, что дефолты подставлены не просто так.
    #[test]
    fn битый_json_сохраняется_рядом_и_отдаёт_дефолты() {
        let dir = tmpdir("corrupt");
        let p = dir.join("settings.json");
        std::fs::write(&p, "{ это не json").unwrap();

        let got = read_json(&p, json!({"default": true}));
        assert_eq!(got, json!({"default": true}));

        let backup = p.with_extension("corrupt");
        assert!(backup.exists(), "копия битого файла должна сохраниться");
        assert_eq!(std::fs::read_to_string(&backup).unwrap(), "{ это не json");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn первая_копия_битого_файла_не_затирается() {
        let dir = tmpdir("corrupt-once");
        let p = dir.join("settings.json");
        let backup = p.with_extension("corrupt");

        std::fs::write(&p, "первая порча").unwrap();
        read_json(&p, json!({}));
        std::fs::write(&p, "вторая порча").unwrap();
        read_json(&p, json!({}));

        assert_eq!(
            std::fs::read_to_string(&backup).unwrap(),
            "первая порча",
            "сохранять надо ПЕРВУЮ порчу — она ближе к причине"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }
}
