// Фоновый синхронизатор: то, что делает зеркало зеркалом, а не просто списком.
//
// Без него всё в клиенте — ручное: скачать по двойному клику, залить кнопкой,
// вытеснить из настроек. Человек же ждёт от папки поведения гуглдиска: положил
// файл — уехал, не трогал четыре часа — освободилось место.
//
// Дисциплина цикла:
//   • тик короткий и не держит лок каталога дольше одной операции;
//   • за тик заливаем ограниченное число файлов — иначе один большой архив
//     заблокирует очередь на часы и «синхронизация» станет незаметной;
//   • вытеснение реже заливки: оно трогает диск и спешить ему некуда.

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use tauri::Manager;

use super::config;
use super::evict::EvictionPolicy;
use super::StorageService;

/// Как часто искать, что залить.
const SCAN_EVERY: Duration = Duration::from_secs(15);
/// Раз во столько тиков — вытеснение (15с × 20 = 5 минут).
const EVICT_EVERY_TICKS: u32 = 20;
/// Сколько файлов заливаем за один тик.
const UPLOADS_PER_TICK: usize = 4;

/// Запустить цикл один раз на всё приложение.
///
/// Повторный вызов (переподключение, демо после живого) ничего не делает: цикл
/// сам смотрит на текущее состояние сервиса и просто простаивает, пока хранилище
/// не подключено.
pub fn start(app: tauri::AppHandle) {
    static STARTED: AtomicBool = AtomicBool::new(false);
    if STARTED.swap(true, Ordering::SeqCst) {
        return;
    }

    tauri::async_runtime::spawn(async move {
        let mut tick: u32 = 0;
        loop {
            tokio::time::sleep(SCAN_EVERY).await;
            tick = tick.wrapping_add(1);

            let svc: tauri::State<'_, StorageService> = app.state();
            if !svc.is_attached().await {
                continue;
            }

            if let Err(e) = upload_round(&svc).await {
                eprintln!("[storage] заливка: {e}");
            }

            if tick % EVICT_EVERY_TICKS == 0 {
                if let Err(e) = evict_round(&app, &svc).await {
                    eprintln!("[storage] вытеснение: {e}");
                }
            }
        }
    });
}

/// Найти и залить то, что появилось или изменилось локально.
async fn upload_round(svc: &StorageService) -> Result<(), String> {
    // Сначала правки уже известных файлов: они помечаются `LocalModified`,
    // и без этого значок «локально новее» никогда бы не появился сам.
    svc.detect_local_changes().await?;

    for path in svc.pending_uploads(UPLOADS_PER_TICK).await? {
        // Ошибка одного файла не должна останавливать остальные: битые права или
        // занятый файл — обычное дело, а очередь идёт дальше.
        if let Err(e) = svc.upload_local(&path).await {
            eprintln!("[storage] не залит {}: {e}", path.display());
        }
    }
    Ok(())
}

async fn evict_round(app: &tauri::AppHandle, svc: &StorageService) -> Result<(), String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {e}"))?;
    let cfg = config::load(&dir);

    // Настройки могли поменяться между тиками — читаем их каждый раз, а не
    // запоминаем при старте.
    let policy = EvictionPolicy {
        ttl_hours: cfg.keep_hours_or_default(),
        max_bytes: Some(cfg.max_mirror_gb_or_default() as i64 * 1024 * 1024 * 1024),
        hot_patterns: cfg.hot_patterns_or_default(),
    };
    let report = svc.run_eviction(policy).await?;
    if report.evicted > 0 {
        println!(
            "[storage] вытеснено файлов: {}, освобождено байт: {}",
            report.evicted, report.freed_bytes
        );
    }
    Ok(())
}

