use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use tauri::Emitter;

// Не чаще одного processing-event на строку stdout/stderr раз в EMIT_THROTTLE_MS.
// Long-running CLI (whisper-cli и т.п.) выдают тысячи строк в секунду — без троттлинга
// они затапливают WebView2 message-pump и UI окон зависает ("Not Responding").
const EMIT_THROTTLE_MS: u64 = 150;

use super::process_utils::HiddenConsole;

/// Перед запуском бинарника-файла (плагинного whisper-cli, ffmpeg и т.п.) на unix
/// гарантируем exec-бит, а на macOS снимаем Gatekeeper-карантин. Иначе на ЧУЖОЙ
/// машине ad-hoc-подписанный (не нотаризованный) бинарь из плагина падает с
/// "operation not permitted": при переносе приложения (zip/AirDrop/Drive/DMG)
/// macOS вешает `com.apple.quarantine`, и Gatekeeper блокирует запуск. Дублирует
/// логику, которая уже есть для СКАЧИВАЕМЫХ зависимостей в deps_commands.rs, но
/// для ВСТРОЕННЫХ в плагин бинарников её не было.
///
/// Трогаем только реальные пути-файлы; bare-команды из PATH (sh, env) — пропускаем.
#[cfg(unix)]
fn ensure_launchable(cmd: &str) {
    use std::os::unix::fs::PermissionsExt;
    use std::path::Path;

    let path = Path::new(cmd);
    if !path.is_file() {
        return;
    }

    if let Ok(meta) = std::fs::metadata(path) {
        let mut perms = meta.permissions();
        if perms.mode() & 0o111 == 0 {
            perms.set_mode(0o755);
            let _ = std::fs::set_permissions(path, perms);
        }
    }

    #[cfg(target_os = "macos")]
    {
        // Тихо снимаем карантин с самого файла; если атрибута нет — xattr вернёт
        // ненулевой код, нам это неважно.
        let _ = Command::new("xattr")
            .arg("-d")
            .arg("com.apple.quarantine")
            .arg(path)
            .status();
    }
}

#[cfg(not(unix))]
fn ensure_launchable(_cmd: &str) {}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecCommandArgs {
    pub cmd: String,
    pub args: Vec<String>,
    #[serde(default)]
    pub cwd: Option<String>,
    #[serde(default)]
    pub node_id: Option<String>,
    #[serde(default)]
    pub env: Option<Vec<(String, String)>>,
}

#[derive(Debug, Serialize, Clone)]
pub struct ExecOutput {
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
    pub killed: bool,
}

// Глобальное состояние для активных процессов
pub struct ExecState {
    pub running: Arc<Mutex<Vec<RunningProcess>>>,
    pub abort_flag: Arc<AtomicBool>,
}

pub struct RunningProcess {
    #[allow(dead_code)]
    pub node_id: String,
    pub killed: bool,
    pub pid: Option<u32>,
}

impl ExecState {
    pub fn new(processing_abort: Arc<AtomicBool>) -> Self {
        Self {
            running: Arc::new(Mutex::new(Vec::new())),
            abort_flag: processing_abort,
        }
    }

    pub fn kill_all(&self) {
        // Устанавливаем глобальный флаг abort
        self.abort_flag.store(true, Ordering::Relaxed);
    }
}

#[tauri::command]
pub async fn exec_command(
    args: ExecCommandArgs,
    app: tauri::AppHandle,
    exec_state: tauri::State<'_, ExecState>,
    processing_state: tauri::State<'_, std::sync::Mutex<super::processing_commands::ProcessingState>>,
) -> Result<ExecOutput, String> {
    // Подготавливаем Send + 'static данные для блокирующей таски.
    // Sync-команды Tauri выполняются на главном потоке и блокируют WebView event-loop,
    // поэтому всю долгую работу (spawn процесса, чтение stdout/stderr, ожидание) —
    // в tokio::task::spawn_blocking.
    let running = exec_state.running.clone();
    let abort_flag = exec_state.abort_flag.clone();
    let processing_abort = processing_state
        .lock()
        .map_err(|e| format!("ProcessingState lock poisoned: {}", e))?
        .abort_signal
        .clone();

    tokio::task::spawn_blocking(move || {
        exec_command_blocking(args, app, running, abort_flag, processing_abort)
    })
    .await
    .map_err(|e| format!("exec task panicked: {}", e))?
}

#[allow(unused_assignments)]
fn exec_command_blocking(
    args: ExecCommandArgs,
    app: tauri::AppHandle,
    running: Arc<Mutex<Vec<RunningProcess>>>,
    abort_flag: Arc<AtomicBool>,
    processing_abort: Arc<AtomicBool>,
) -> Result<ExecOutput, String> {
    let cmd = &args.cmd;
    let cmd_args = &args.args;

    println!("[Exec] Starting: {} {:?}", cmd, cmd_args);

    // Отправляем событие начала
    if let Some(ref node_id) = args.node_id {
        let _ = app.emit(
            "processing-event",
            serde_json::json!({
                "type": "log",
                "level": "info",
                "message": format!("Starting: {} {}", cmd, cmd_args.join(" ")),
                "nodeId": node_id,
            }),
        );
    }

    // Гарантируем, что бинарь запустится и на чужой машине (exec-бит + снятие
    // Gatekeeper-карантина для встроенных в плагин ad-hoc-подписанных бинарников).
    ensure_launchable(cmd);

    let mut command = Command::new(cmd);
    command
        .args(cmd_args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .hide_console();

    // Устанавливаем рабочую директорию
    if let Some(ref cwd) = args.cwd {
        command.current_dir(cwd);
    }

    // Устанавливаем переменные окружения
    if let Some(ref env_vars) = args.env {
        for (key, value) in env_vars {
            command.env(key, value);
        }
    }

    let mut child = command.spawn().map_err(|e| {
        let error = format!("Failed to spawn process '{}': {}", cmd, e);
        println!("[Exec] ERROR: {}", error);
        error
    })?;

    let child_pid = child.id();
    println!("[Exec] Process {} started with PID: {}", cmd, child_pid);

    // Регистрируем процесс
    {
        let mut processes = running.lock().unwrap();
        processes.push(RunningProcess {
            node_id: args.node_id.clone().unwrap_or_default(),
            killed: false,
            pid: Some(child_pid),
        });
    }

    // Читаем stdout и stderr построчно
    let stdout_reader = BufReader::new(child.stdout.take().unwrap());
    let stderr_reader = BufReader::new(child.stderr.take().unwrap());

    // Общий throttle-таймер на оба stream'а: ProcessingEventListener в nodeWin
    // дёргает setStatusText на каждом `log` событии → re-render. Без троттлинга
    // тысячи строк/сек подвешивают webview. Логи всё равно льются в logWindow
    // отдельным каналом (sendToMW из плагина → log-window:emit-item-log).
    let started = Instant::now();
    let last_emit_ms = Arc::new(AtomicU64::new(0));

    // Читаем stdout в отдельном потоке
    let app_clone = app.clone();
    let node_id_clone = args.node_id.clone();
    let last_emit_stdout = Arc::clone(&last_emit_ms);
    let stdout_handle = thread::spawn(move || {
        let mut output = String::new();
        for line in stdout_reader.lines() {
            match line {
                Ok(line) => {
                    println!("[Exec stdout] {}", line);
                    output.push_str(&line);
                    output.push('\n');

                    if let Some(ref node_id) = node_id_clone {
                        let now_ms = started.elapsed().as_millis() as u64;
                        let last = last_emit_stdout.load(Ordering::Relaxed);
                        if now_ms.saturating_sub(last) < EMIT_THROTTLE_MS {
                            continue;
                        }
                        last_emit_stdout.store(now_ms, Ordering::Relaxed);

                        // emit_to("nodeWin", ...) вместо broadcast: только nodeWin
                        // реально потребляет эти события (статусбар активной ноды).
                        // main/logWindow/previewWin не должны платить за каждый line.
                        let _ = app_clone.emit_to(
                            "nodeWin",
                            "processing-event",
                            serde_json::json!({
                                "type": "log",
                                "level": "info",
                                "message": line,
                                "nodeId": node_id,
                            }),
                        );
                    }
                }
                Err(e) => {
                    eprintln!("[Exec stdout] Error reading line: {}", e);
                    break;
                }
            }
        }
        output
    });

    // Читаем stderr в отдельном потоке
    let app_clone2 = app.clone();
    let node_id_clone2 = args.node_id.clone();
    let last_emit_stderr = Arc::clone(&last_emit_ms);
    let stderr_handle = thread::spawn(move || {
        let mut output = String::new();
        for line in stderr_reader.lines() {
            match line {
                Ok(line) => {
                    eprintln!("[Exec stderr] {}", line);
                    output.push_str(&line);
                    output.push('\n');

                    if let Some(ref node_id) = node_id_clone2 {
                        let is_error = line.to_lowercase().contains("error");
                        let now_ms = started.elapsed().as_millis() as u64;
                        let last = last_emit_stderr.load(Ordering::Relaxed);
                        // Ошибки пропускаем без троттлинга — их обычно мало и они важны.
                        if !is_error && now_ms.saturating_sub(last) < EMIT_THROTTLE_MS {
                            continue;
                        }
                        last_emit_stderr.store(now_ms, Ordering::Relaxed);

                        let level = if is_error { "error" } else { "warn" };
                        let _ = app_clone2.emit_to(
                            "nodeWin",
                            "processing-event",
                            serde_json::json!({
                                "type": "log",
                                "level": level,
                                "message": line,
                                "nodeId": node_id,
                            }),
                        );
                    }
                }
                Err(e) => {
                    eprintln!("[Exec stderr] Error reading line: {}", e);
                    break;
                }
            }
        }
        output
    });

    // Ждём завершения процесса с проверкой abort
    #[allow(unused_assignments)]
    let killed;
    loop {
        // Проверяем abort-флаги напрямую — без отдельного monitor-потока,
        // он создавал deadlock при normal completion (бесконечный loop без выхода).
        if abort_flag.load(Ordering::Relaxed) || processing_abort.load(Ordering::Relaxed) {
            println!("[Exec] Abort signal received, killing process {}", child_pid);

            // Отправляем событие отмены
            if let Some(ref node_id) = args.node_id {
                let _ = app.emit(
                    "processing-event",
                    serde_json::json!({
                        "type": "log",
                        "level": "warn",
                        "message": "Process aborted by user",
                        "nodeId": node_id,
                    }),
                );
            }

            let _ = child.kill();
            killed = true;
            break;
        }

        match child.try_wait() {
            Ok(Some(status)) => {
                killed = false;
                // Процесс завершился
                let exit_code = status.code().unwrap_or(-1);
                println!("[Exec] Process {} finished with exit code: {}", cmd, exit_code);

                // Собираем вывод
                let stdout_output = stdout_handle.join().unwrap_or_default();
                let stderr_output = stderr_handle.join().unwrap_or_default();

                // Отправляем событие завершения
                if let Some(ref node_id) = args.node_id {
                    let _ = app.emit(
                        "processing-event",
                        serde_json::json!({
                            "type": "log",
                            "level": "info",
                            "message": format!("Process finished with exit code: {}", exit_code),
                            "nodeId": node_id,
                        }),
                    );
                }

                return Ok(ExecOutput {
                    exit_code,
                    stdout: stdout_output,
                    stderr: stderr_output,
                    killed,
                });
            }
            Ok(None) => {
                // Ещё работает
                thread::sleep(Duration::from_millis(50));
            }
            Err(e) => {
                return Err(format!("Failed to wait for process '{}': {}", cmd, e));
            }
        }
    }

    // Если дошли сюда — процесс был убит
    let stdout_output = stdout_handle.join().unwrap_or_default();
    let stderr_output = stderr_handle.join().unwrap_or_default();

    // Убираем из списка запущенных
    {
        let mut processes = running.lock().unwrap();
        for proc in processes.iter_mut() {
            if proc.pid == Some(child_pid) {
                proc.killed = true;
            }
        }
        processes.retain(|p| !p.killed);
    }

    // Сбрасываем флаг abort
    abort_flag.store(false, Ordering::Relaxed);

    Ok(ExecOutput {
        exit_code: -1,
        stdout: stdout_output,
        stderr: stderr_output,
        killed: true,
    })
}

#[tauri::command]
pub fn kill_all_exec_processes(state: tauri::State<ExecState>) -> Result<bool, String> {
    println!("[Exec] Killing all running processes...");
    state.kill_all();
    Ok(true)
}
