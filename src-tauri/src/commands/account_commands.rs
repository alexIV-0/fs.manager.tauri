// Команды хранилища аккаунтов автопостинга (платформо-généric).
// Хранение: app_data_dir/accounts/<mainFolderName>/<platform>.json
//   — один файл на ПЛАТФОРМУ, внутри МАССИВ аккаунтов этой платформы.
//
// Решение (VK_AUTOPOST_PLAN.md, 2026-06-16): токен + метаданные хранятся НЕ в
// облачной главной папке, а в локальном app-data, сегментировано по главной папке
// (= человек) И по платформе (vk.json / instagram.json / ...). Плагин читает свой
// `<platform>.json` напрямую. Токен лежит plaintext (простота + переносимость:
// скопировал папку accounts/ → перенёс). Источник истины для TS — эти команды
// (за абстракцией TokenStore); бэкенд подменяемый (позже RemoteTokenStore/сайт).
//
// Безопасность: `list` отдаёт метаданные БЕЗ accessToken (токен не должен жить в
// UI/сторе); токен достаётся `account_get_token` только при постинге. Имена
// (главной папки, платформы, аккаунта) санитизируются от path-traversal.

use serde_json::{json, Value};
use std::fs;
use std::path::PathBuf;
use tauri::Manager;

/// Санитизация компонента пути в безопасное имя файла/папки.
/// Защита от path-traversal (`..`, `/`, `\`) и пустых имён.
fn sanitize_component(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("empty name".into());
    }
    let cleaned: String = trimmed
        .chars()
        .map(|c| match c {
            'a'..='z' | 'A'..='Z' | '0'..='9' | '-' | '_' | ' ' | '.' | '(' | ')' => c,
            _ => '_',
        })
        .collect();
    if cleaned.chars().all(|c| c == '.' || c == ' ') {
        return Err(format!("unsafe name: {}", raw));
    }
    Ok(cleaned)
}

/// Путь к `<platform>.json` для конкретной главной папки (каталог создаётся).
fn platform_file(
    app: &tauri::AppHandle,
    main_folder_name: &str,
    platform: &str,
) -> Result<PathBuf, String> {
    let safe_mf = sanitize_component(main_folder_name)?;
    let safe_pf = sanitize_component(platform)?;
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {}", e))?
        .join("accounts")
        .join(safe_mf);
    fs::create_dir_all(&dir).map_err(|e| format!("create_dir_all: {}", e))?;
    Ok(dir.join(format!("{}.json", safe_pf)))
}

/// Читает массив аккаунтов из файла платформы (битый/отсутствующий → пустой).
/// В выдачу попадают только объекты.
fn read_accounts(path: &PathBuf) -> Vec<Value> {
    match fs::read_to_string(path) {
        Ok(content) => match serde_json::from_str::<Value>(&content) {
            Ok(Value::Array(arr)) => arr.into_iter().filter(|v| v.is_object()).collect(),
            _ => Vec::new(),
        },
        Err(_) => Vec::new(),
    }
}

fn write_accounts(path: &PathBuf, accounts: &[Value]) -> Result<(), String> {
    let content = serde_json::to_string_pretty(&Value::Array(accounts.to_vec()))
        .map_err(|e| format!("to_string_pretty: {}", e))?;
    fs::write(path, content).map_err(|e| format!("write {}: {}", path.display(), e))
}

fn account_name(v: &Value) -> &str {
    v.get("name").and_then(|n| n.as_str()).unwrap_or("")
}

/// Сохранить/обновить аккаунт платформы (upsert по `name`, токен plaintext).
///
/// `account` — JSON-объект: name / tokenSource / accessToken / userId /
/// mainFolderName / mainFolderPath / targetType / targetId / groupName / addedAt.
/// Поля `platform`, `mainFolderName`, `addedAt` проставляются сервером при отсутствии.
#[tauri::command]
#[specta::specta]
pub fn account_save(
    app: tauri::AppHandle,
    main_folder_name: String,
    platform: String,
    account: Value,
) -> Result<Value, String> {
    let name = account
        .get("name")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "account.name is required".to_string())?;

    let mut account = account;
    match account.as_object_mut() {
        Some(obj) => {
            obj.entry("platform")
                .or_insert_with(|| Value::String(platform.clone()));
            obj.entry("mainFolderName")
                .or_insert_with(|| Value::String(main_folder_name.clone()));
            if obj.get("addedAt").and_then(|v| v.as_i64()).is_none() {
                obj.insert("addedAt".to_string(), json!(chrono::Utc::now().timestamp()));
            }
        }
        None => return Err("account must be a JSON object".into()),
    }

    let path = platform_file(&app, &main_folder_name, &platform)?;
    let mut accounts = read_accounts(&path);
    if let Some(slot) = accounts
        .iter_mut()
        .find(|a| account_name(a) == name.as_str())
    {
        *slot = account.clone();
    } else {
        accounts.push(account.clone());
    }
    write_accounts(&path, &accounts)?;
    Ok(account)
}

/// Список аккаунтов платформы БЕЗ токенов (для UI ноды / дропдауна).
#[tauri::command]
#[specta::specta]
pub fn account_list(
    app: tauri::AppHandle,
    main_folder_name: String,
    platform: String,
) -> Result<Value, String> {
    let path = platform_file(&app, &main_folder_name, &platform)?;
    let mut accounts = read_accounts(&path);
    for a in accounts.iter_mut() {
        if let Some(obj) = a.as_object_mut() {
            obj.remove("accessToken"); // токен не отдаём в список
        }
    }
    accounts.sort_by(|a, b| account_name(a).cmp(account_name(b)));
    Ok(Value::Array(accounts))
}

/// Достать ТОЛЬКО accessToken аккаунта (для публикатора).
#[tauri::command]
#[specta::specta]
pub fn account_get_token(
    app: tauri::AppHandle,
    main_folder_name: String,
    platform: String,
    name: String,
) -> Result<String, String> {
    let path = platform_file(&app, &main_folder_name, &platform)?;
    let accounts = read_accounts(&path);
    accounts
        .iter()
        .find(|a| account_name(a) == name.as_str())
        .and_then(|a| a.get("accessToken"))
        .and_then(|t| t.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| format!("no token for account '{}' on platform '{}'", name, platform))
}

/// Добавить/обновить канал в каталоге аккаунта (upsert по `id`, иначе по `username`).
///
/// Telegram: Bot API не умеет перечислять каналы бота, поэтому каждый канал добавляется
/// вручную и хранится в `channels[]` аккаунта. Эта команда делает read-modify-write
/// ТОЛЬКО поля `channels` — `accessToken` и прочие поля остаются нетронутыми (в отличие
/// от `account_save`, который заменяет запись целиком). Возвращает обновлённый `channels`.
#[tauri::command]
#[specta::specta]
pub fn account_add_channel(
    app: tauri::AppHandle,
    main_folder_name: String,
    platform: String,
    name: String,
    channel: Value,
) -> Result<Value, String> {
    if !channel.is_object() {
        return Err("channel must be a JSON object".into());
    }
    let new_id = channel.get("id").cloned();
    let new_user = channel.get("username").and_then(|v| v.as_str()).map(str::to_string);

    let path = platform_file(&app, &main_folder_name, &platform)?;
    let mut accounts = read_accounts(&path);
    let acc = accounts
        .iter_mut()
        .find(|a| account_name(a) == name.as_str())
        .ok_or_else(|| format!("no account '{}' on platform '{}'", name, platform))?;

    let obj = acc.as_object_mut().ok_or("account is not an object")?;
    let channels = obj
        .entry("channels")
        .or_insert_with(|| Value::Array(Vec::new()));
    let arr = channels.as_array_mut().ok_or("channels is not an array")?;

    // upsert: совпадение по id (если задан) или по username
    let pos = arr.iter().position(|c| {
        let same_id = new_id.is_some() && c.get("id") == new_id.as_ref();
        let same_user = new_user.is_some()
            && c.get("username").and_then(|v| v.as_str()).map(str::to_string) == new_user;
        same_id || same_user
    });
    match pos {
        Some(i) => arr[i] = channel,
        None => arr.push(channel),
    }
    let result = channels.clone();
    write_accounts(&path, &accounts)?;
    Ok(result)
}

/// Удалить из каталога аккаунта канал/чат (по `chat_id`) ИЛИ тему форума
/// (по `chat_id` + `thread_id`). `thread_id = None` → удаляем сам канал/чат целиком;
/// `Some` → удаляем только тему из его `topics[]`. read-modify-write ТОЛЬКО поля
/// `channels` (токен не трогаем). Возвращает обновлённый `channels`. Идемпотентна.
#[tauri::command]
#[specta::specta]
pub fn account_remove_channel(
    app: tauri::AppHandle,
    main_folder_name: String,
    platform: String,
    name: String,
    chat_id: i64,
    thread_id: Option<i64>,
) -> Result<Value, String> {
    let path = platform_file(&app, &main_folder_name, &platform)?;
    let mut accounts = read_accounts(&path);
    let acc = accounts
        .iter_mut()
        .find(|a| account_name(a) == name.as_str())
        .ok_or_else(|| format!("no account '{}' on platform '{}'", name, platform))?;

    let obj = acc.as_object_mut().ok_or("account is not an object")?;
    let channels = obj
        .entry("channels")
        .or_insert_with(|| Value::Array(Vec::new()));
    let arr = channels.as_array_mut().ok_or("channels is not an array")?;

    match thread_id {
        None => {
            // удалить канал/чат целиком по id
            arr.retain(|c| c.get("id").and_then(|v| v.as_i64()) != Some(chat_id));
        }
        Some(tid) => {
            // удалить тему из topics[] нужного чата
            if let Some(c) = arr
                .iter_mut()
                .find(|c| c.get("id").and_then(|v| v.as_i64()) == Some(chat_id))
            {
                if let Some(topics) = c.get_mut("topics").and_then(|t| t.as_array_mut()) {
                    topics.retain(|t| t.get("threadId").and_then(|v| v.as_i64()) != Some(tid));
                }
            }
        }
    }

    let result = channels.clone();
    write_accounts(&path, &accounts)?;
    Ok(result)
}

/// Удалить аккаунт платформы (idempotent).
#[tauri::command]
#[specta::specta]
pub fn account_delete(
    app: tauri::AppHandle,
    main_folder_name: String,
    platform: String,
    name: String,
) -> Result<(), String> {
    let path = platform_file(&app, &main_folder_name, &platform)?;
    let mut accounts = read_accounts(&path);
    let before = accounts.len();
    accounts.retain(|a| account_name(a) != name.as_str());
    if accounts.len() != before {
        write_accounts(&path, &accounts)?;
    }
    Ok(())
}
