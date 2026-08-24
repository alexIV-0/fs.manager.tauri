// Диагностический лог log_win-проблем (зависание окна логов после нескольких циклов loop).
//
// Пишет в `app_data_dir/logs/diag.log` append-only с миллисекундным таймстампом.
// Независим от обычного архива логов и LogState — пережиёт даже полное зависание UI,
// потому что вся запись делается из Rust в файл напрямую.
//
// Использование:
//   - из Rust:    diag_log::write(&app, "msg");  diag_log::bump_item_log();
//   - из JS:      window.tauriAPI.invoke('diag:log', "msg");
//
// После воспроизведения зависания — открыть файл и прислать содержимое.

#![allow(dead_code)]

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};

use chrono::Local;
use tauri::Manager;

// Счётчики событий — чтобы не писать в файл на каждый item-log (их сотни в секунду
// при ffmpeg-выводе). Снапшот значения мы пишем из менее частых обработчиков
// (substep-batch, item-end, get-history).
static ITEM_LOG_COUNT: AtomicUsize = AtomicUsize::new(0);
static SUBSTEP_BATCH_COUNT: AtomicUsize = AtomicUsize::new(0);
static NODE_UPDATE_COUNT: AtomicUsize = AtomicUsize::new(0);
static ITEM_END_COUNT: AtomicUsize = AtomicUsize::new(0);
static ITEM_QUEUED_COUNT: AtomicUsize = AtomicUsize::new(0);
static PROCESSING_EVENT_COUNT: AtomicUsize = AtomicUsize::new(0);
static UPDATE_DATA_COUNT: AtomicUsize = AtomicUsize::new(0);

fn diag_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("logs");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("diag.log"))
}

pub fn write(app: &tauri::AppHandle, msg: &str) {
    let Ok(path) = diag_path(app) else { return };
    let ts = Local::now().format("%H:%M:%S%.3f");
    let _ = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .and_then(|mut f| writeln!(f, "[{}] {}", ts, msg));
}

pub fn bump_item_log() {
    ITEM_LOG_COUNT.fetch_add(1, Ordering::Relaxed);
}
pub fn bump_substep_batch() {
    SUBSTEP_BATCH_COUNT.fetch_add(1, Ordering::Relaxed);
}
pub fn bump_node_update() {
    NODE_UPDATE_COUNT.fetch_add(1, Ordering::Relaxed);
}
pub fn bump_item_end() {
    ITEM_END_COUNT.fetch_add(1, Ordering::Relaxed);
}
pub fn bump_item_queued() {
    ITEM_QUEUED_COUNT.fetch_add(1, Ordering::Relaxed);
}
pub fn bump_processing_event() {
    PROCESSING_EVENT_COUNT.fetch_add(1, Ordering::Relaxed);
}
pub fn bump_update_data() {
    UPDATE_DATA_COUNT.fetch_add(1, Ordering::Relaxed);
}

pub fn counters_snapshot() -> String {
    format!(
        "totals: item-log={} substep-batch={} node-update={} item-end={} item-queued={} proc-event={} update-data={}",
        ITEM_LOG_COUNT.load(Ordering::Relaxed),
        SUBSTEP_BATCH_COUNT.load(Ordering::Relaxed),
        NODE_UPDATE_COUNT.load(Ordering::Relaxed),
        ITEM_END_COUNT.load(Ordering::Relaxed),
        ITEM_QUEUED_COUNT.load(Ordering::Relaxed),
        PROCESSING_EVENT_COUNT.load(Ordering::Relaxed),
        UPDATE_DATA_COUNT.load(Ordering::Relaxed),
    )
}

/// Запускает фоновый heartbeat-поток: каждые 2 сек пишет строку в diag.log.
/// Если строки перестают идти — Rust runtime/Tokio полностью заблокирован.
/// Вызывается один раз из setup().
pub fn spawn_heartbeat(app: tauri::AppHandle) {
    std::thread::spawn(move || {
        write(&app, "=== heartbeat started ===");
        loop {
            std::thread::sleep(std::time::Duration::from_secs(2));
            write(&app, &format!("heartbeat | {}", counters_snapshot()));
        }
    });
}

#[tauri::command]
#[specta::specta]
pub fn diag_log_write(app: tauri::AppHandle, msg: String) -> Result<(), String> {
    write(&app, &msg);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn diag_log_path(app: tauri::AppHandle) -> Result<String, String> {
    diag_path(&app).map(|p| p.display().to_string())
}

#[tauri::command]
#[specta::specta]
pub fn diag_log_clear(app: tauri::AppHandle) -> Result<(), String> {
    let path = diag_path(&app)?;
    let _ = fs::remove_file(&path);
    // Сбросим счётчики, чтобы запуск был "с нуля".
    ITEM_LOG_COUNT.store(0, Ordering::Relaxed);
    SUBSTEP_BATCH_COUNT.store(0, Ordering::Relaxed);
    NODE_UPDATE_COUNT.store(0, Ordering::Relaxed);
    ITEM_END_COUNT.store(0, Ordering::Relaxed);
    write(&app, "=== diag log cleared ===");
    Ok(())
}
