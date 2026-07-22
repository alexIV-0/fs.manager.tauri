// db_analytics.rs — хранит записи об элементах обработки и пишет статистику в файлы.
//
// Аналог electron/main/dbExporter.ts + templates/*.ts, но реализован на Rust.
// Вызывается из settings_commands (db_register_found) и window_commands (log_window_emit_item_end).

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use chrono::{Datelike, Timelike, Utc};
use serde_json::{json, Value};
use tauri::Manager;

// ── Структура записи об item'е ────────────────────────────────────────────────

#[allow(dead_code)]
#[derive(Debug, Clone)]
pub struct DbItemRecord {
    pub item_id: String,
    pub registered_at: String,
    pub project_name: String,
    pub main_folder_name: String,
    pub project_path_gd: String,
    pub contact: Vec<String>,
    pub description: String,
    pub tags: Vec<String>,
    pub year: String,
    pub find_time: String,
    pub cur_item: String,
    pub size: i64,
    pub is_folder: bool,
}

// ── In-memory хранилище item'ов ───────────────────────────────────────────────

pub struct DbState {
    pub items: HashMap<String, DbItemRecord>,
}

impl DbState {
    pub fn new() -> Self {
        Self { items: HashMap::new() }
    }
}

// ── Хелперы для работы со временем ───────────────────────────────────────────

/// Парсит "HH:MM:SS", "MM:SS" или просто секунды → u64 секунд.
fn parse_duration_secs(s: &str) -> u64 {
    let s = s.trim();
    let parts: Vec<&str> = s.split(':').collect();
    match parts.as_slice() {
        [h, m, sec] => {
            let h: u64  = h.parse().unwrap_or(0);
            let m: u64  = m.parse().unwrap_or(0);
            let sc: u64 = sec.parse::<f64>().unwrap_or(0.0) as u64;
            h * 3600 + m * 60 + sc
        }
        [m, sec] => {
            let m: u64  = m.parse().unwrap_or(0);
            let sc: u64 = sec.parse::<f64>().unwrap_or(0.0) as u64;
            m * 60 + sc
        }
        [sec] => sec.parse::<f64>().unwrap_or(0.0) as u64,
        _ => 0,
    }
}

fn secs_to_hms(secs: u64) -> String {
    format!("{:02}:{:02}:{:02}", secs / 3600, (secs % 3600) / 60, secs % 60)
}

/// Считает разницу в секундах между двумя ISO-8601 строками (ended_at - registered_at).
fn render_secs(registered_at: &str, ended_at: &str) -> u64 {
    use chrono::DateTime;
    let parse = |s: &str| -> Option<i64> {
        DateTime::parse_from_rfc3339(s)
            .map(|d| d.timestamp())
            .ok()
    };
    let start = parse(registered_at).unwrap_or(0);
    let end   = parse(ended_at).unwrap_or(start);
    (end - start).max(0) as u64
}

/// Нормализует ISO-8601 строку к UTC "…Z" с миллисекундами.
/// registeredAt из Rust приходит как "+00:00" (микросекунды), а endedAt/startedAt из JS —
/// уже "Z" (мс). Приводим всё к единому виду, чтобы парсеры графиков не спотыкались.
fn iso_utc_z(s: &str) -> String {
    use chrono::{DateTime, SecondsFormat};
    DateTime::parse_from_rfc3339(s)
        .map(|d| d.with_timezone(&Utc).to_rfc3339_opts(SecondsFormat::Millis, true))
        .unwrap_or_else(|_| s.to_string())
}

/// Расширение файла в нижнем регистре ("clip.MP4" → "mp4"). Без точки → "".
fn file_ext(name: &str) -> String {
    match name.rfind('.') {
        Some(i) if i + 1 < name.len() => name[i + 1..].to_lowercase(),
        _ => String::new(),
    }
}

/// Путь относительно корня проекта: strip project_path_gd, разделители → "/".
/// Файл не под корнем (нетипично) → оставляем абсолютный путь как есть.
fn rel_to_project(abs: &str, project_root: &str) -> String {
    Path::new(abs)
        .strip_prefix(Path::new(project_root))
        .map(|rel| rel.to_string_lossy().replace('\\', "/"))
        .unwrap_or_else(|_| abs.to_string())
}

// ── Вспомогательные функции ───────────────────────────────────────────────────

fn month_name(month: u32) -> &'static str {
    match month {
        1 => "January", 2 => "February", 3 => "March",
        4 => "April", 5 => "May", 6 => "June",
        7 => "July", 8 => "August", 9 => "September",
        10 => "October", 11 => "November", 12 => "December",
        _ => "Unknown",
    }
}

/// Разворачивает шаблонные переменные в строке пути.
/// Поддерживаемые: $YYYY, $MM, $DD, $HH, $mm, $ss, $curMonthStr,
///                 $projectName, $mainFolderName, $projectPathGD, $localFolder,
///                 $curItem, $clearName, $findTime
///
/// $projectPathGD = корень GD-папки проекта (абсолютный путь). Позволяет писать
/// статистику ВНУТРЬ самого проекта, напр. ["$projectPathGD", "options", "__stat", "$YYYY.$MM"]
/// → {project}/options/__stat/2026.06.jsonl — децентрализованно, рядом с проектом.
fn apply_vars(s: &str, record: &DbItemRecord) -> String {
    let now = Utc::now();
    let clear_name = record.cur_item.rfind('.')
        .map(|i| &record.cur_item[..i])
        .unwrap_or(&record.cur_item);

    let mut result = s.to_string();
    result = result.replace("$YYYY",         &format!("{}", now.year()));
    result = result.replace("$MM",           &format!("{:02}", now.month()));
    result = result.replace("$DD",           &format!("{:02}", now.day()));
    result = result.replace("$HH",           &format!("{:02}", now.hour()));
    result = result.replace("$mm",           &format!("{:02}", now.minute()));
    result = result.replace("$ss",           &format!("{:02}", now.second()));
    result = result.replace("$curMonthStr",  month_name(now.month()));
    // $projectPathGD до $projectName: первый не содержит второй как подстроку,
    // но держим путь-переменные рядом для читаемости.
    result = result.replace("$projectPathGD", &record.project_path_gd);
    result = result.replace("$projectName",  &record.project_name);
    result = result.replace("$mainFolderName", &record.main_folder_name);
    result = result.replace("$clearName",    clear_name);
    result = result.replace("$curItem",      &record.cur_item);
    result = result.replace("$findTime",     &record.find_time);
    result = result.replace("$localFolder",  "");
    result
}

/// Склеивает сегменты пути в PathBuf и добавляет .json если нужно.
pub fn resolve_path(segments: &[String], record: &DbItemRecord) -> Option<PathBuf> {
    if segments.is_empty() { return None; }

    let resolved: Vec<String> = segments.iter()
        .map(|seg| apply_vars(seg, record))
        .filter(|s| !s.is_empty())
        .collect();

    if resolved.is_empty() { return None; }

    let mut path = PathBuf::from(&resolved[0]);
    for part in &resolved[1..] {
        path = path.join(part);
    }

    if path.extension().and_then(|e| e.to_str()) != Some("json") {
        let new_name = format!("{}.json",
            path.file_name().and_then(|n| n.to_str()).unwrap_or("stats"));
        path.set_file_name(new_name);
    }

    Some(path)
}

// ── Чтение / запись JSON-файлов ───────────────────────────────────────────────

fn read_json(path: &Path) -> Value {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or(json!({}))
}

fn write_json(path: &Path, value: &Value) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("mkdir {}: {}", parent.display(), e))?;
    }
    let content = serde_json::to_string_pretty(value)
        .map_err(|e| format!("serialize: {}", e))?;
    std::fs::write(path, content)
        .map_err(|e| format!("write {}: {}", path.display(), e))
}

// ── Period stats — ключи ─────────────────────────────────────────────────────

/// "05 (21 May)"
pub fn day_key() -> String {
    let now = Utc::now();
    format!("{:02} ({:02} {})", now.month(), now.day(), month_name(now.month()))
}

/// "05 May"
pub fn month_key() -> String {
    let now = Utc::now();
    format!("{:02} {}", now.month(), month_name(now.month()))
}

/// "2026"
pub fn year_key() -> String {
    format!("{}", Utc::now().year())
}

// ── Запись статистики ─────────────────────────────────────────────────────────

fn upsert_period(existing: &mut Value, key: &str, record: &DbItemRecord, status: &str, cost: f64, ended_at: &str, duration: &str) {
    let success: u64 = if status == "done" { 1 } else { 0 };
    let error:   u64 = if status == "error" { 1 } else { 0 };

    // duration — суммарная длительность выходных медиафайлов, переданная из processItem.
    let media_secs  = parse_duration_secs(duration);
    // renderTime — фактическое время обработки (конец − старт).
    let render_s    = render_secs(&record.registered_at, ended_at);

    match existing.get_mut(key).and_then(|e| e.as_object_mut()) {
        Some(obj) => {
            let files = obj.get("files").and_then(|v| v.as_u64()).unwrap_or(0) + 1;
            obj.insert("files".into(), json!(files));

            let mut projects: Vec<String> = obj.get("project")
                .and_then(|v| v.as_array())
                .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect())
                .unwrap_or_default();
            if !projects.contains(&record.project_name) {
                projects.push(record.project_name.clone());
            }
            obj.insert("project".into(), json!(projects));

            let sc = obj.get("successCount").and_then(|v| v.as_u64()).unwrap_or(0) + success;
            obj.insert("successCount".into(), json!(sc));
            let ec = obj.get("errorCount").and_then(|v| v.as_u64()).unwrap_or(0) + error;
            obj.insert("errorCount".into(), json!(ec));

            let tc = obj.get("totalCost").and_then(|v| v.as_f64()).unwrap_or(0.0) + cost;
            obj.insert("totalCost".into(), json!(tc));

            let dur = parse_duration_secs(obj.get("duration").and_then(|v| v.as_str()).unwrap_or("00:00:00"));
            obj.insert("duration".into(), json!(secs_to_hms(dur + media_secs)));

            let rt = parse_duration_secs(obj.get("renderTime").and_then(|v| v.as_str()).unwrap_or("00:00:00"));
            obj.insert("renderTime".into(), json!(secs_to_hms(rt + render_s)));
        }
        None => {
            existing[key] = json!({
                "files": 1,
                "project": [&record.project_name],
                "successCount": success,
                "errorCount": error,
                "totalCost": cost,
                "duration": secs_to_hms(media_secs),
                "renderTime": secs_to_hms(render_s),
            });
        }
    }
}

pub fn write_by_day(path: &Path, record: &DbItemRecord, status: &str, cost: f64, ended_at: &str, duration: &str) -> Result<(), String> {
    let mut data = read_json(path);
    upsert_period(&mut data, &day_key(), record, status, cost, ended_at, duration);
    write_json(path, &data)
}

pub fn write_by_month(path: &Path, record: &DbItemRecord, status: &str, cost: f64, ended_at: &str, duration: &str) -> Result<(), String> {
    let mut data = read_json(path);
    upsert_period(&mut data, &month_key(), record, status, cost, ended_at, duration);
    write_json(path, &data)
}

pub fn write_by_year(path: &Path, record: &DbItemRecord, status: &str, cost: f64, ended_at: &str, duration: &str) -> Result<(), String> {
    let mut data = read_json(path);
    upsert_period(&mut data, &year_key(), record, status, cost, ended_at, duration);
    write_json(path, &data)
}

pub fn write_total_by_project(path: &Path, record: &DbItemRecord, status: &str, cost: f64, ended_at: &str, duration: &str) -> Result<(), String> {
    let mut data = read_json(path);
    let success: u64 = if status == "done" { 1 } else { 0 };
    let error:   u64 = if status == "error" { 1 } else { 0 };

    let media_secs = parse_duration_secs(duration);
    let render_s   = render_secs(&record.registered_at, ended_at);

    if let Some(obj) = data.as_object_mut() {
        let files = obj.get("files").and_then(|v| v.as_u64()).unwrap_or(0) + 1;
        obj.insert("files".into(), json!(files));
        obj.insert("project".into(), json!(&record.project_name));

        let sc = obj.get("successCount").and_then(|v| v.as_u64()).unwrap_or(0) + success;
        obj.insert("successCount".into(), json!(sc));
        let ec = obj.get("errorCount").and_then(|v| v.as_u64()).unwrap_or(0) + error;
        obj.insert("errorCount".into(), json!(ec));

        let tc = obj.get("totalCost").and_then(|v| v.as_f64()).unwrap_or(0.0) + cost;
        obj.insert("totalCost".into(), json!(tc));

        let mut contacts: Vec<String> = obj.get("contact")
            .and_then(|v| v.as_array())
            .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect())
            .unwrap_or_default();
        for c in &record.contact {
            if !contacts.contains(c) { contacts.push(c.clone()); }
        }
        obj.insert("contact".into(), json!(contacts));

        let dur = parse_duration_secs(obj.get("duration").and_then(|v| v.as_str()).unwrap_or("00:00:00"));
        obj.insert("duration".into(), json!(secs_to_hms(dur + media_secs)));

        let rt = parse_duration_secs(obj.get("renderTime").and_then(|v| v.as_str()).unwrap_or("00:00:00"));
        obj.insert("renderTime".into(), json!(secs_to_hms(rt + render_s)));
    } else {
        data = json!({
            "project": &record.project_name,
            "contact": &record.contact,
            "files": 1,
            "successCount": success,
            "errorCount": error,
            "totalCost": cost,
            "duration": secs_to_hms(media_secs),
            "renderTime": secs_to_hms(render_s),
        });
    }
    write_json(path, &data)
}

// Версия схемы JSONL-строки. Растёт при добавлении/переименовании ключей.
// Читатели статистики должны ветвиться по этому полю (v1: см. ideasAndTest/STATS_SCHEMA_PLAN.md).
const LOCAL_ARCHIVE_SCHEMA_VERSION: u32 = 1;

/// Пофайловая запись статистики (пресет "Локальный архив (JSONL)").
/// Атомарные факты по одному item'у; агрегаты (за период / по проекту / платные-бесплатные)
/// считаются на чтении. Схема заморожена в v1.
///
/// - `started_at` — реальный старт обработки (из лог-группы), НЕ registeredAt (= время находки).
/// - `duration`   — хронометраж ВЫХОДНЫХ медиафайлов ("HH:MM:SS"), считается ffprobe на фронте.
/// - `out_files`  — абсолютные пути финальных файлов; здесь режутся до пути от корня проекта.
pub fn write_local_archive(
    path: &Path,
    record: &DbItemRecord,
    status: &str,
    cost: f64,
    ended_at: &str,
    started_at: &str,
    duration: &str,
    out_files: &[String],
) -> Result<(), String> {
    // local-archive пишет в .jsonl (одна JSON-строка на item)
    let jsonl_path = path.with_extension("jsonl");
    if let Some(parent) = jsonl_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("mkdir: {}", e))?;
    }

    // Пути финальных файлов — относительно корня проекта (projectPathGD не пишем: на разных
    // машинах он разный, корень восстанавливается из расположения самого .jsonl).
    let out_rel: Vec<String> = out_files
        .iter()
        .map(|f| rel_to_project(f, &record.project_path_gd))
        .collect();
    let out_type = out_rel.first().map(|f| file_ext(f)).unwrap_or_default();

    let entry = json!({
        "schemaVersion":  LOCAL_ARCHIVE_SCHEMA_VERSION,
        "itemId":         &record.item_id,
        "status":         status,
        "project":        &record.project_name,
        "mainFolder":     &record.main_folder_name,
        "curItem":        &record.cur_item,
        "inType":         file_ext(&record.cur_item),
        "outType":        out_type,
        "registeredAt":   iso_utc_z(&record.registered_at),  // нашли файл
        "startedAt":      iso_utc_z(started_at),              // старт обработки
        "endedAt":        iso_utc_z(ended_at),                // конец
        "outSec":         parse_duration_secs(duration),      // хронометраж результата, сек
        "renderSec":      render_secs(started_at, ended_at),  // честный рендер без очереди
        "out":            out_rel,
        "totalCost":      cost,
    });

    use std::io::Write as IoWrite;
    // Собираем строку с переносом ЗАРАНЕЕ и пишем одним write_all → один syscall.
    // O_APPEND на локальной ФС делает такой write атомарным, поэтому параллельная
    // обработка нескольких item'ов не переплетает строки в середине (в отличие от
    // writeln!, который мог дробить вывод на data + '\n').
    let line = format!("{}\n", serde_json::to_string(&entry).map_err(|e| e.to_string())?);
    let mut file = std::fs::OpenOptions::new()
        .create(true).append(true)
        .open(&jsonl_path)
        .map_err(|e| format!("open {}: {}", jsonl_path.display(), e))?;
    file.write_all(line.as_bytes())
        .map_err(|e| format!("write: {}", e))
}

// ── Главная точка входа ───────────────────────────────────────────────────────

/// Читает localArchives из settings.json и пишет все сконфигурированные шаблоны.
pub fn write_analytics(
    app: &tauri::AppHandle,
    item_id: &str,
    status: &str,
    total_cost: f64,
    ended_at: &str,
    started_at: &str,
    duration: &str,
    out_files: &[String],
    db_state: &DbState,
) {
    let record = match db_state.items.get(item_id) {
        Some(r) => r.clone(),
        None => {
            println!("[db_analytics] itemId={} not found in DbState (registerFound was not called or failed)", item_id);
            return;
        }
    };

    // Читаем settings.json
    let settings_file = match app.path().app_data_dir() {
        Ok(dir) => dir.join::<&str>("settings.json"),
        Err(e) => {
            println!("[db_analytics] app_data_dir error: {}", e);
            return;
        }
    };

    let settings: Value = std::fs::read_to_string(&settings_file)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or(json!({}));

    let archives = match settings
        .get("storage")
        .and_then(|s| s.get("localArchives"))
        .and_then(|a| a.as_array())
    {
        Some(arr) => arr.clone(),
        None => {
            println!("[db_analytics] settings.storage.localArchives not found or empty (file={})", settings_file.display());
            return;
        }
    };

    println!("[db_analytics] {} archives, item={} project={} status={}",
        archives.len(), item_id, record.project_name, status);

    for archive in &archives {
        let enabled = archive.get("enabled").and_then(|v| v.as_bool()).unwrap_or(false);
        if !enabled { continue; }

        let template_id = archive.get("templateId").and_then(|v| v.as_str()).unwrap_or("");

        let path_segments: Vec<String> = archive.get("path")
            .and_then(|v| v.as_array())
            .map(|arr| arr.iter().filter_map(|v| v.as_str().map(String::from)).collect())
            .unwrap_or_default();

        if path_segments.is_empty() {
            println!("[db_analytics] template={} has empty path, skip", template_id);
            continue;
        }

        let resolved = match resolve_path(&path_segments, &record) {
            Some(p) => p,
            None => {
                println!("[db_analytics] template={} path resolution failed: {:?}", template_id, path_segments);
                continue;
            }
        };

        println!("[db_analytics] template={} → {}", template_id, resolved.display());

        let result = match template_id {
            "by-day"            => write_by_day(&resolved, &record, status, total_cost, ended_at, duration),
            "by-month"          => write_by_month(&resolved, &record, status, total_cost, ended_at, duration),
            "by-year"           => write_by_year(&resolved, &record, status, total_cost, ended_at, duration),
            "total-by-project"  => write_total_by_project(&resolved, &record, status, total_cost, ended_at, duration),
            "local-archive"     => write_local_archive(&resolved, &record, status, total_cost, ended_at, started_at, duration, out_files),
            other => {
                println!("[db_analytics] unknown template: {}", other);
                continue;
            }
        };

        match result {
            Ok(()) => println!("[db_analytics] ✓ {}", resolved.display()),
            Err(e) => println!("[db_analytics] ✗ template={} err={}", template_id, e),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn iso_utc_z_normalizes_rust_and_js_timestamps() {
        // registeredAt из Rust: "+00:00" с микросекундами → "…Z" с мс
        assert_eq!(
            iso_utc_z("2026-07-08T13:44:54.816390+00:00"),
            "2026-07-08T13:44:54.816Z"
        );
        // endedAt из JS: уже "…Z" (мс) → идемпотентно
        assert_eq!(
            iso_utc_z("2026-07-08T13:55:54.011Z"),
            "2026-07-08T13:55:54.011Z"
        );
        // смещение приводится к UTC
        assert_eq!(iso_utc_z("2026-07-08T16:44:54.000+03:00"), "2026-07-08T13:44:54.000Z");
        // мусор — оставляем как есть, без паники
        assert_eq!(iso_utc_z(""), "");
        assert_eq!(iso_utc_z("not-a-date"), "not-a-date");
    }

    #[test]
    fn file_ext_extracts_lowercase_extension() {
        assert_eq!(file_ext("clip.MP4"), "mp4");
        // реальный curItem с двойной точкой перед расширением
        assert_eq!(file_ext("1 - Открытие. Слово..mp4"), "mp4");
        assert_eq!(file_ext("noext"), "");
        assert_eq!(file_ext("trailingdot."), "");
        assert_eq!(file_ext("a.b.mov"), "mov");
    }

    #[test]
    fn rel_to_project_strips_root() {
        let root = "/Users/x/newMainFolder/reels from vid";
        assert_eq!(
            rel_to_project("/Users/x/newMainFolder/reels from vid/OUT/shorts/clip_01.mp4", root),
            "OUT/shorts/clip_01.mp4"
        );
        // файл не под корнем — оставляем абсолютный путь
        assert_eq!(rel_to_project("/tmp/other.mp4", root), "/tmp/other.mp4");
    }

    #[test]
    fn render_secs_uses_started_not_registered() {
        // старт 13:50:12 → конец 13:55:54 = 342 c (очередь до старта НЕ входит)
        assert_eq!(
            render_secs("2026-07-08T13:50:12.000Z", "2026-07-08T13:55:54.000Z"),
            342
        );
    }
}
