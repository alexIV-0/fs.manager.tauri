// Архив логов обработки.
//
// Горячий слой логов живёт в памяти (LogState в window_commands.rs). Этот модуль —
// холодный слой: завершённые лог-группы (ProcessingItemGroup) дописываются на диск
// в файлы за день `app_data_dir/logs/YYYY-MM-DD.jsonl` (одна группа = одна JSONL-строка,
// тот же приём, что в db_analytics::write_local_archive).
//
// Файлы старше `settings.logs.retentionDays` (по умолчанию 2 дня) удаляются —
// механика повторяет cleanup_auto_delete для папок.

use std::fs;
use std::io::Write as IoWrite;
use std::path::PathBuf;

use chrono::{DateTime, Local, NaiveDate};
use serde::Serialize;
use serde_json::Value;
use tauri::Manager;

const DEFAULT_RETENTION_DAYS: i64 = 2;

/// Каталог архива логов: `app_data_dir/logs/`. Создаётся при первом обращении.
fn logs_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {}", e))?
        .join("logs");
    fs::create_dir_all(&dir).map_err(|e| format!("create_dir_all: {}", e))?;
    Ok(dir)
}

/// Ключ дня "YYYY-MM-DD" из ISO-8601 timestamp (в локальной зоне). При ошибке парсинга — сегодня.
fn day_key(iso: &str) -> String {
    DateTime::parse_from_rfc3339(iso)
        .map(|d| d.with_timezone(&Local).format("%Y-%m-%d").to_string())
        .unwrap_or_else(|_| Local::now().format("%Y-%m-%d").to_string())
}

/// Проверяет, что строка — корректная дата вида YYYY-MM-DD (защита от path traversal).
fn is_valid_day(date: &str) -> bool {
    NaiveDate::parse_from_str(date, "%Y-%m-%d").is_ok()
}

/// Срок хранения в днях из settings.json → logs.retentionDays. По умолчанию 2.
/// 0 трактуется как «не удалять».
fn retention_days(app: &tauri::AppHandle) -> i64 {
    let path = match app.path().app_data_dir() {
        Ok(d) => d.join("settings.json"),
        Err(_) => return DEFAULT_RETENTION_DAYS,
    };
    let val: Option<Value> = fs::read_to_string(&path)
        .ok()
        .and_then(|c| serde_json::from_str(&c).ok());
    val.as_ref()
        .and_then(|v| v.get("logs"))
        .and_then(|l| l.get("retentionDays"))
        .and_then(|v| v.as_i64())
        .unwrap_or(DEFAULT_RETENTION_DAYS)
}

/// Дописывает завершённую лог-группу в файл за день. Вызывается из log_window_emit_item_end.
/// Молча игнорирует ошибки — архив не должен ронять обработку.
pub fn append_item(app: &tauri::AppHandle, group: &Value) {
    let dir = match logs_dir(app) {
        Ok(d) => d,
        Err(e) => {
            eprintln!("[log_archive] logs_dir: {}", e);
            return;
        }
    };
    let day = group
        .get("endTime")
        .and_then(|v| v.as_str())
        .map(day_key)
        .unwrap_or_else(|| Local::now().format("%Y-%m-%d").to_string());
    let file_path = dir.join(format!("{}.jsonl", day));

    let line = match serde_json::to_string(group) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("[log_archive] serialize: {}", e);
            return;
        }
    };
    let result = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&file_path)
        .and_then(|mut f| writeln!(f, "{}", line));
    if let Err(e) = result {
        eprintln!("[log_archive] append {}: {}", file_path.display(), e);
    }
}

#[derive(Serialize)]
pub struct ArchiveDay {
    pub date: String,
    pub items: usize,
    pub bytes: u64,
}

/// Список доступных дней архива, отсортированный по убыванию даты (сначала свежие).
#[tauri::command]
pub fn log_archive_list_days(app: tauri::AppHandle) -> Result<Vec<ArchiveDay>, String> {
    let dir = logs_dir(&app)?;
    let mut days: Vec<ArchiveDay> = Vec::new();
    let Ok(entries) = fs::read_dir(&dir) else {
        return Ok(days);
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
            continue;
        }
        let Some(stem) = path.file_stem().and_then(|s| s.to_str()) else {
            continue;
        };
        if !is_valid_day(stem) {
            continue;
        }
        let bytes = entry.metadata().map(|m| m.len()).unwrap_or(0);
        let items = fs::read_to_string(&path)
            .map(|c| c.lines().filter(|l| !l.trim().is_empty()).count())
            .unwrap_or(0);
        days.push(ArchiveDay {
            date: stem.to_string(),
            items,
            bytes,
        });
    }
    days.sort_by(|a, b| b.date.cmp(&a.date));
    Ok(days)
}

/// Читает все лог-группы за указанный день. date — "YYYY-MM-DD".
#[tauri::command]
pub fn log_archive_get_day(app: tauri::AppHandle, date: String) -> Result<Vec<Value>, String> {
    if !is_valid_day(&date) {
        return Err(format!("invalid date: {}", date));
    }
    let path = logs_dir(&app)?.join(format!("{}.jsonl", date));
    let content = match fs::read_to_string(&path) {
        Ok(c) => c,
        Err(_) => return Ok(Vec::new()),
    };
    let items = content
        .lines()
        .filter(|l| !l.trim().is_empty())
        .filter_map(|l| serde_json::from_str::<Value>(l).ok())
        .collect();
    Ok(items)
}

/// Удаляет архивные файлы старше retentionDays. Возвращает число удалённых файлов.
#[tauri::command]
pub fn log_archive_cleanup(app: tauri::AppHandle) -> Result<usize, String> {
    let days = retention_days(&app);
    if days <= 0 {
        return Ok(0);
    }
    let cutoff = Local::now().date_naive() - chrono::Duration::days(days);
    let dir = logs_dir(&app)?;
    let mut deleted = 0usize;
    let Ok(entries) = fs::read_dir(&dir) else {
        return Ok(0);
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
            continue;
        }
        let Some(stem) = path.file_stem().and_then(|s| s.to_str()) else {
            continue;
        };
        let Ok(file_date) = NaiveDate::parse_from_str(stem, "%Y-%m-%d") else {
            continue;
        };
        if file_date < cutoff {
            if fs::remove_file(&path).is_ok() {
                println!("[log_archive] removed old log file: {}", path.display());
                deleted += 1;
            }
        }
    }
    Ok(deleted)
}

/// Полностью очищает архив логов (ручная кнопка). Возвращает число удалённых файлов.
#[tauri::command]
pub fn log_archive_clear(app: tauri::AppHandle) -> Result<usize, String> {
    let dir = logs_dir(&app)?;
    let mut deleted = 0usize;
    let Ok(entries) = fs::read_dir(&dir) else {
        return Ok(0);
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) == Some("jsonl") {
            if fs::remove_file(&path).is_ok() {
                deleted += 1;
            }
        }
    }
    Ok(deleted)
}
