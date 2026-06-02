/// AE Commands — After Effects integration
/// Порт electron/main/processing/runScriptInAE.ts
///
/// Логика:
/// 1. Принимает путь к JSX-скрипту и объект аргументов (inObj).
/// 2. Создаёт временный JSX, подставляет inObj и добавляет обвязку для записи результата в JSON.
/// 3. Запускает AE с этим скриптом.
/// 4. Ждёт появления result-файла (polling) и возвращает его содержимое.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, Instant};

#[cfg(target_os = "windows")]
use super::process_utils::HiddenConsole;

#[derive(Debug, Serialize, Deserialize, specta::Type)]
pub struct AEResult {
    pub success: bool,
    pub data: Option<serde_json::Value>,
    pub error: Option<String>,
}

#[derive(Debug, Deserialize, specta::Type)]
pub struct RunScriptInAEArgs {
    /// Путь к исполняемому файлу AE (aerender или After Effects.app)
    pub ae_path: String,
    /// Путь к оригинальному JSX-скрипту
    pub script_path: String,
    /// Аргументы, которые попадут в `var inObj = {...}` внутри скрипта
    pub in_obj: serde_json::Value,
    /// Куда писать временные файлы (tmp dir). По умолчанию — системный temp.
    pub temp_dir: Option<String>,
    /// Не удалять временные файлы после выполнения
    pub keep_temp_files: Option<bool>,
    /// Таймаут ожидания результата в секундах (по умолчанию 120)
    pub timeout_sec: Option<u64>,
}

// ==================== COMMAND ====================

#[tauri::command]
#[specta::specta]
pub fn run_script_in_ae(args: RunScriptInAEArgs) -> Result<AEResult, String> {
    let temp_dir = args
        .temp_dir
        .as_deref()
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir);

    fs::create_dir_all(&temp_dir).map_err(|e| format!("Cannot create temp dir: {}", e))?;

    let uid = uuid_simple();
    let lock_path = temp_dir.join(format!("ae_{}.lock", uid));
    let result_path = temp_dir.join(format!("ae_{}.json", uid));
    let temp_script_path = temp_dir.join(format!("ae_{}.jsx", uid));

    // Читаем оригинальный скрипт
    let original_script =
        fs::read_to_string(&args.script_path).map_err(|e| format!("Cannot read script: {}", e))?;

    // Строим модифицированный JSX
    let script_content = build_script(
        &original_script,
        &args.in_obj,
        &lock_path,
        &result_path,
    );

    fs::write(&temp_script_path, &script_content)
        .map_err(|e| format!("Cannot write temp script: {}", e))?;

    // Запускаем AE
    launch_in_ae(&args.ae_path, &temp_script_path)?;

    // Ждём результата
    let timeout = Duration::from_secs(args.timeout_sec.unwrap_or(120));
    let result = wait_for_result(&result_path, &lock_path, timeout)?;

    // Убираем временные файлы
    if !args.keep_temp_files.unwrap_or(false) {
        let _ = fs::remove_file(&temp_script_path);
        let _ = fs::remove_file(&lock_path);
    }

    Ok(result)
}

/// Tauri-команда: просто запустить AE с готовым jsx-файлом (без ожидания результата)
#[tauri::command]
#[specta::specta]
pub fn launch_ae_with_script(ae_path: String, script_path: String) -> Result<(), String> {
    launch_in_ae(&ae_path, Path::new(&script_path))
}

// ==================== HELPERS ====================

/// Модифицирует JSX-скрипт: подставляет inObj и добавляет обвязку для записи результата.
fn build_script(
    original: &str,
    in_obj: &serde_json::Value,
    lock_path: &Path,
    result_path: &Path,
) -> String {
    // Заменяем `var inObj = {}` на реальный объект
    let in_obj_json = serde_json::to_string(in_obj).unwrap_or_else(|_| "{}".to_string());
    let with_args = original.replacen(
        "var inObj = {}",
        &format!("var inObj = {}", in_obj_json),
        1,
    );

    // Путь к файлам — слэши для JSX (AE использует POSIX-стиль внутри скрипта)
    let lock_str = lock_path.to_string_lossy().replace('\\', "/");
    let result_str = result_path.to_string_lossy().replace('\\', "/");

    // Билд (jsx-builder.js) помечает вызов entry-функции маркером AE_ENTRY_MARKER:
    //   /* @AE_ENTRY */
    //   myFn();
    // Находим этот вызов и заменяем его на lock/result-обвязку. Само выражение вызова
    // подставляется ДОСЛОВНО — по умолчанию `name()` (функция сама читает свой
    // локальный `var inObj`, который мы уже подменили выше), но если в вызове есть
    // аргументы — они сохраняются.
    let re_call = find_entry_call(&with_args);
    if let Some((call_expr, call_range)) = re_call {
        let wrapper = format!(
            r#"
var __lock__ = new File("{lock}");
__lock__.open("w");
__lock__.write("working");
__lock__.close();

try {{
    var __result__ = {call};
    var __rf__ = new File("{result}");
    __rf__.open("w");
    __rf__.write(JSON.stringify({{ success: true, data: __result__ }}));
    __rf__.close();
}} catch(e) {{
    var __rf__ = new File("{result}");
    __rf__.open("w");
    __rf__.write(JSON.stringify({{ success: false, error: e.message }}));
    __rf__.close();
}}

__lock__.remove();
"#,
            lock = lock_str,
            result = result_str,
            call = call_expr,
        );

        let mut result = with_args.clone();
        result.replace_range(call_range, &wrapper);
        return result;
    }

    // Если маркер не найден — добавляем обвязку в конец
    format!(
        "{}\n// [ae_commands.rs]: AE_ENTRY marker not found — script may not run\n",
        with_args
    )
}

/// Маркер, которым jsx-builder.js помечает вызов entry-функции.
const AE_ENTRY_MARKER: &str = "/* @AE_ENTRY */";

/// Находит вызов entry-функции, помеченный маркером AE_ENTRY_MARKER, и возвращает
/// само выражение вызова (`name()` или `name(args...)` — как написал билд) и диапазон
/// ОТ маркера ДО `;` включительно. Весь диапазон заменяется на lock/result-обвязку,
/// а выражение вызова подставляется как есть — аргументы сохраняются.
/// (Ограничение: аргументы вызова не должны содержать `;`.)
fn find_entry_call(script: &str) -> Option<(String, std::ops::Range<usize>)> {
    let marker_pos = script.find(AE_ENTRY_MARKER)?;
    let after = marker_pos + AE_ENTRY_MARKER.len();

    // Начало выражения вызова — первый непробельный символ после маркера
    let rel_call_start = script[after..].find(|c: char| !c.is_whitespace())?;
    let call_start = after + rel_call_start;

    // Конец вызова — первая `;` после него
    let rel_semi = script[call_start..].find(';')?;
    let semi_pos = call_start + rel_semi;

    let call_expr = script[call_start..semi_pos].trim().to_string();
    if call_expr.is_empty() {
        return None;
    }

    Some((call_expr, marker_pos..(semi_pos + 1)))
}

/// Запускает After Effects с переданным jsx-скриптом.
fn launch_in_ae(ae_path: &str, script_path: &Path) -> Result<(), String> {
    let script_str = script_path.to_string_lossy();

    #[cfg(target_os = "macos")]
    {
        // Пробуем определить: это aerender или .app?
        if ae_path.ends_with("aerender") || ae_path.ends_with("aerender.exe") {
            Command::new(ae_path)
                .args(["-script", &script_str])
                .spawn()
                .map_err(|e| format!("Failed to launch aerender: {}", e))?;
        } else {
            // Запускаем через osascript
            let app_name = Path::new(ae_path)
                .file_stem()
                .unwrap_or_default()
                .to_string_lossy();
            let applescript = format!(
                r#"tell application "{}" to DoScriptFile "{}""#,
                app_name, script_str
            );
            Command::new("osascript")
                .args(["-e", &applescript])
                .spawn()
                .map_err(|e| format!("Failed to launch AE via osascript: {}", e))?;
        }
    }

    #[cfg(target_os = "windows")]
    {
        Command::new(ae_path)
            .args(["-r", &script_str])
            .hide_console()
            .spawn()
            .map_err(|e| format!("Failed to launch AE: {}", e))?;
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        return Err("After Effects integration is only supported on macOS and Windows".to_string());
    }

    Ok(())
}

/// Ждёт появления result-файла (polling каждые 200ms), читает и парсит его.
fn wait_for_result(
    result_path: &Path,
    lock_path: &Path,
    timeout: Duration,
) -> Result<AEResult, String> {
    let start = Instant::now();
    let poll = Duration::from_millis(200);

    loop {
        if start.elapsed() > timeout {
            return Err(format!(
                "Timeout waiting for AE result after {}s",
                timeout.as_secs()
            ));
        }

        // Результат появляется когда lock-файл удалён и result-файл существует
        let lock_gone = !lock_path.exists();
        let result_exists = result_path.exists();

        if lock_gone && result_exists {
            // Небольшая пауза на случай если файл ещё пишется
            std::thread::sleep(Duration::from_millis(50));

            match fs::read_to_string(result_path) {
                Ok(content) => {
                    let _ = fs::remove_file(result_path);
                    match serde_json::from_str::<AEResult>(&content) {
                        Ok(result) => return Ok(result),
                        Err(e) => {
                            return Ok(AEResult {
                                success: false,
                                data: None,
                                error: Some(format!("Failed to parse AE result JSON: {}", e)),
                            })
                        }
                    }
                }
                Err(e) => {
                    return Err(format!("Failed to read AE result file: {}", e));
                }
            }
        }

        std::thread::sleep(poll);
    }
}

/// Простой UUID v4 без внешней зависимости (8 hex chars достаточно для уникальности temp файлов)
fn uuid_simple() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let t = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .subsec_nanos();
    format!("{:08x}", t)
}
