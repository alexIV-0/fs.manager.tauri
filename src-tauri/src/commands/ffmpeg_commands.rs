use std::path::PathBuf;
use std::process::Command;
use std::sync::Mutex;
use super::settings_commands::AppSettingsState;
use super::process_utils::HiddenConsole;

// ==================== PATH RESOLUTION ====================

/// Ищет бинарник в стандартных местах и PATH (системный фолбэк).
fn find_binary(name: &str) -> String {
    #[cfg(target_os = "macos")]
    let candidates = vec![
        format!("/usr/local/bin/{}", name),
        format!("/opt/homebrew/bin/{}", name),
        format!("/usr/bin/{}", name),
    ];

    #[cfg(target_os = "windows")]
    let candidates = vec![
        format!("C:\\ffmpeg\\bin\\{}.exe", name),
        format!("C:\\Program Files\\ffmpeg\\bin\\{}.exe", name),
    ];

    #[cfg(target_os = "linux")]
    let candidates = vec![
        format!("/usr/bin/{}", name),
        format!("/usr/local/bin/{}", name),
    ];

    for path in &candidates {
        if PathBuf::from(path).exists() {
            return path.clone();
        }
    }

    #[cfg(not(target_os = "windows"))]
    let which_cmd = "which";
    #[cfg(target_os = "windows")]
    let which_cmd = "where";

    if let Ok(output) = Command::new(which_cmd).arg(name).hide_console().output() {
        let found = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !found.is_empty() && PathBuf::from(&found).exists() {
            return found;
        }
    }

    name.to_string()
}

/// Возвращает путь к программе: сначала из настроек пользователя, затем системный поиск.
pub(crate) fn resolve_program_path(name: &str, state: &tauri::State<Mutex<AppSettingsState>>) -> String {
    if let Ok(guard) = state.lock() {
        if let Some(arr) = guard.program_paths.as_array() {
            for entry in arr {
                if entry.get("name").and_then(|v| v.as_str()) == Some(name) {
                    if let Some(paths) = entry.get("path").and_then(|v| v.as_array()) {
                        if let Some(first) = paths.first() {
                            if let Some(s) = first.as_str() {
                                if !s.is_empty() {
                                    return s.to_string();
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    find_binary(name)
}

/// Tauri-команда: возвращает путь к ffmpeg (из настроек или системный поиск)
#[tauri::command]
#[specta::specta]
pub fn ffmpeg_get_path(state: tauri::State<Mutex<AppSettingsState>>) -> Result<String, String> {
    Ok(resolve_program_path("ffmpeg", &state))
}

/// Tauri-команда: возвращает путь к ffprobe (из настроек или системный поиск)
#[tauri::command]
#[specta::specta]
pub fn ffprobe_get_path(state: tauri::State<Mutex<AppSettingsState>>) -> Result<String, String> {
    Ok(resolve_program_path("ffprobe", &state))
}

// ==================== VIDEO INFO (ffprobe) ====================

/// Возвращает полную информацию о медиафайле через ffprobe (JSON-строку).
/// Async-обёртка нужна по той же причине что и у ffmpeg_exec_with_progress:
/// плагины дёргают ffprobe на каждом шаге, sync-команды быстро забивают
/// Tauri worker-pool и блокируют параллельные IPC.
#[tauri::command]
#[specta::specta]
pub async fn ffprobe_get_info(
    file_path: String,
    state: tauri::State<'_, Mutex<AppSettingsState>>,
) -> Result<String, String> {
    let ffprobe = resolve_program_path("ffprobe", &state);

    tokio::task::spawn_blocking(move || {
        let output = Command::new(&ffprobe)
            .args([
                "-v", "error",
                "-show_entries",
                "stream=codec_name,profile,level,pix_fmt,r_frame_rate,avg_frame_rate,time_base,\
                 width,height,color_range,color_space,color_primaries,color_transfer,\
                 sample_aspect_ratio,display_aspect_ratio,duration,duration_ts,start_pts,\
                 start_time,codec_type,sample_rate,channels,channel_layout,bit_rate",
                "-of", "json",
                &file_path,
            ])
            .hide_console()
            .output()
            .map_err(|e| format!("ffprobe not found or failed to start: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).to_string();
            return Err(format!("ffprobe error: {}", stderr));
        }

        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    })
    .await
    .map_err(|e| format!("ffprobe task join failed: {}", e))?
}

// ==================== VIDEO THUMBNAIL (ffmpeg) ====================

pub(crate) fn ffmpeg_get_video_thumbnail_with_path(file_path: String, timestamp_sec: Option<f64>, ffmpeg: &str) -> Result<String, String> {
    // Хэш пути в имени temp-файла: fg и bg превью открываются одновременно — без него
    // два процесса ffmpeg могли бы писать в один файл в пределах одной миллисекунды и
    // перетереть кадр друг друга.
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    file_path.hash(&mut hasher);
    let tmp_path = std::env::temp_dir().join(format!(
        "fs_manager_thumb_{:x}_{}.png",
        hasher.finish(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
    ));

    let ts = timestamp_sec.unwrap_or(0.0);
    let ts_str = ts.to_string();
    let tmp = tmp_path.to_str().unwrap_or("");

    // Фильтрграф:
    //  • thumbnail (только постер-кадр, ts<=0) — анализирует пачку кадров и выбирает
    //    репрезентативный, пропуская пустые/прозрачные/чёрные интро-кадры (важно для
    //    ProRes-4444 с альфой, который часто начинается с прозрачного кадра).
    //  • setparams=color_trc=bt709 — лечит падение swscale "Unsupported input
    //    (Operation not supported): ... trc:reserved -> rgba" на ProRes-4444 12-бит с
    //    GBR-матрицей и зарезервированным transfer'ом: без перетегирования trc
    //    автоскейлер отказывается конвертировать в RGBA. Для обычного видео безобидно
    //    (трансфер и так близок к bt709), colorspace/матрицу не трогаем — нет сдвига
    //    цвета на bt601/GBR-источниках.
    //  • format=rgba — сама конвертация (alpha сохраняется для FG-слоёв).
    // ts > 0 → точный кадр по таймлайну (скраб), без thumbnail.
    let vf = if ts > 0.0 {
        "setparams=color_trc=bt709,format=rgba"
    } else {
        "thumbnail,setparams=color_trc=bt709,format=rgba"
    };
    let mut cmd = Command::new(ffmpeg);
    cmd.arg("-y");
    if ts > 0.0 {
        cmd.args(["-ss", &ts_str, "-i", &file_path]);
    } else {
        cmd.args(["-i", &file_path]);
    }
    cmd.args(["-vf", vf, "-frames:v", "1", "-pix_fmt", "rgba", tmp]);

    let output = cmd
        .hide_console()
        .output()
        .map_err(|e| format!("ffmpeg not found or failed to start: {}", e))?;

    if !tmp_path.exists() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        return Err(format!("ffmpeg failed to produce thumbnail: {}", stderr));
    }

    let bytes = std::fs::read(&tmp_path).map_err(|e| e.to_string())?;
    let _ = std::fs::remove_file(&tmp_path);

    let b64 = base64_encode(&bytes);
    Ok(format!("data:image/png;base64,{}", b64))
}

/// Снимает кадр из видеофайла и возвращает его как base64 data URL (image/png).
#[tauri::command]
#[specta::specta]
pub fn ffmpeg_get_video_thumbnail(file_path: String, timestamp_sec: Option<f64>, state: tauri::State<Mutex<AppSettingsState>>) -> Result<String, String> {
    let ffmpeg = resolve_program_path("ffmpeg", &state);
    ffmpeg_get_video_thumbnail_with_path(file_path, timestamp_sec, &ffmpeg)
}

// ==================== EXEC WITH PROGRESS ====================

/// Запускает ffmpeg-команду с отслеживанием прогресса через stderr.
/// Эмитит "processing-event" со статусбаром, **дросселированно** (не чаще раза в 200мс),
/// чтобы не засорять event-bus и не блокировать UI thread.
///
/// Async-обёртка через `spawn_blocking` критична: иначе sync `child.wait()` забивает
/// Tauri worker-pool, и параллельные IPC (path_exists, get_stat и т.п.) встают в очередь
/// → UI замирает. С async-командой Tauri-runtime спокойно делит ресурсы.
#[tauri::command]
#[specta::specta]
pub async fn ffmpeg_exec_with_progress(
    args: Vec<String>,
    duration_sec: Option<f64>,
    node_id: Option<String>,
    status_text: Option<String>,
    run_lane: Option<String>,
    app: tauri::AppHandle,
    state: tauri::State<'_, Mutex<AppSettingsState>>,
    processing_state: tauri::State<'_, Mutex<super::processing_commands::ProcessingState>>,
) -> Result<serde_json::Value, String> {
    let ffmpeg = resolve_program_path("ffmpeg", &state);

    // ПРЕРЫВАНИЕ. До 2026-08-11 этой команды в цикле прерывания не было вовсе:
    // стоял блокирующий `child.wait()`, флаг никто не опрашивал, а в ответе
    // возвращался захардкоженный `killed: false`. То есть жёсткий стоп ffmpeg не
    // останавливал — сорокаминутный транскод доигрывал до конца, и снять его можно
    // было только убив приложение. Флаг берём СВОЕЙ полосы (обработка/постинг),
    // чтобы стоп одного раннера не убивал процессы другого.
    let abort_flag = processing_state
        .lock()
        .map_err(|e| format!("ProcessingState lock poisoned: {}", e))?
        .lane_flag(&super::processing_commands::lane_name(run_lane));

    let duration = duration_sec.unwrap_or(0.0);
    let text = status_text.unwrap_or_else(|| "Processing".to_string());

    // Вся блокирующая работа уезжает на отдельный поток. Sync child.wait() там не
    // мешает Tauri runtime'у.
    let app_for_blocking = app.clone();
    let node_id_for_blocking = node_id.clone();
    let result: Result<(i32, String, String, bool), String> = tokio::task::spawn_blocking(move || {
        use std::io::{BufRead, BufReader};
        use std::process::Stdio;
        use std::sync::Arc;
        use std::sync::atomic::{AtomicU64, Ordering};
        use std::time::{Instant, Duration};
        use tauri::Emitter;

        let mut child = Command::new(&ffmpeg)
            .args(&args)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .hide_console()
            .spawn()
            .map_err(|e| format!("ffmpeg not found or failed to start: {}", e))?;

        let stderr_reader = BufReader::new(child.stderr.take().unwrap());
        let stdout_reader = BufReader::new(child.stdout.take().unwrap());

        // Общий счётчик «последнего emit'а» (мс с момента старта) — для throttle.
        let started = Instant::now();
        let last_emit_ms = Arc::new(AtomicU64::new(0));
        const THROTTLE_MS: u64 = 200;

        let app_clone = app_for_blocking.clone();
        let node_id_clone = node_id_for_blocking.clone();
        let text_clone = text.clone();
        let last_emit_stderr = Arc::clone(&last_emit_ms);

        let stderr_handle = std::thread::spawn(move || {
            let mut full_stderr = String::new();
            for line in stderr_reader.lines() {
                if let Ok(line) = line {
                    full_stderr.push_str(&line);
                    full_stderr.push('\n');

                    if let Some(progress) = parse_ffmpeg_progress(&line, duration) {
                        let now_ms = started.elapsed().as_millis() as u64;
                        let last = last_emit_stderr.load(Ordering::Relaxed);
                        if now_ms.saturating_sub(last) < THROTTLE_MS {
                            continue;
                        }
                        last_emit_stderr.store(now_ms, Ordering::Relaxed);

                        let event_payload = serde_json::json!({
                            "type": "statusbar",
                            "payload": {
                                "text": format!("{}: {:.1}%", text_clone, progress),
                                "progress": progress,
                            },
                            "nodeId": node_id_clone,
                        });
                        let _ = app_clone.emit("processing-event", event_payload);
                    }
                }
            }
            full_stderr
        });

        let stdout_handle = std::thread::spawn(move || {
            let mut out = String::new();
            for line in stdout_reader.lines() {
                if let Ok(line) = line {
                    out.push_str(&line);
                    out.push('\n');
                }
            }
            out
        });

        // Ждём с опросом флага прерывания — шаг 50 мс, как в exec_command.
        // `try_wait` не блокирует, поэтому стоп доходит до нас за такт, а не после
        // завершения процесса.
        let mut killed = false;
        let exit_code = loop {
            if abort_flag.load(Ordering::Relaxed) {
                let _ = child.kill();
                // Забираем статус, чтобы не оставить зомби-процесс.
                let _ = child.wait();
                killed = true;
                break -1;
            }
            match child.try_wait() {
                Ok(Some(status)) => break status.code().unwrap_or(-1),
                Ok(None) => std::thread::sleep(Duration::from_millis(50)),
                Err(e) => return Err(e.to_string()),
            }
        };

        // Читающие потоки завершатся сами: после kill/выхода процесса их пайпы
        // закрываются, и BufReader доходит до EOF.
        let stderr_output = stderr_handle.join().unwrap_or_default();
        let stdout_output = stdout_handle.join().unwrap_or_default();

        // Подавляем неиспользуемый warning, last_emit_ms нужен внутри потока.
        let _ = last_emit_ms;

        // Финальное событие — без троттлинга, чтобы пользователь видел 100%.
        let _ = Duration::from_millis(0);
        Ok((exit_code, stdout_output, stderr_output, killed))
    })
    .await
    .map_err(|e| format!("ffmpeg task join failed: {}", e))?;

    let (exit_code, stdout_output, stderr_output, killed) = result?;

    // Финальный лог в окно — после завершения процесса.
    if let Some(ref nid) = node_id {
        use tauri::Emitter;
        let level = if killed {
            "warn"
        } else if exit_code == 0 {
            "info"
        } else {
            "error"
        };
        let message = if killed {
            "ffmpeg aborted by user".to_string()
        } else {
            format!("ffmpeg finished with exit code: {}", exit_code)
        };
        let _ = app.emit("processing-event", serde_json::json!({
            "type": "log",
            "level": level,
            "message": message,
            "nodeId": nid,
        }));
    }

    Ok(serde_json::json!({
        "exit_code": exit_code,
        "stdout": stdout_output,
        "stderr": stderr_output,
        "killed": killed,
    }))
}

/// Парсит строку вывода ffmpeg, извлекает time= и считает процент.
/// Возвращает None если прогресс не найден.
fn parse_ffmpeg_progress(line: &str, duration: f64) -> Option<f64> {
    // Ищем "time=HH:MM:SS.mm"
    let time_idx = line.find("time=")?;
    let time_str = &line[time_idx + 5..];
    let time_end = time_str.find(|c: char| !c.is_ascii_digit() && c != ':' && c != '.')?;
    let time_val = &time_str[..time_end];

    let parts: Vec<&str> = time_val.split(':').collect();
    if parts.len() != 3 {
        return None;
    }

    let hours: f64 = parts[0].parse().ok()?;
    let minutes: f64 = parts[1].parse().ok()?;
    let seconds: f64 = parts[2].parse().ok()?;
    let elapsed = hours * 3600.0 + minutes * 60.0 + seconds;

    if duration > 0.0 {
        Some((elapsed / duration * 100.0).min(100.0))
    } else {
        None
    }
}

// ==================== UPDATED read_media_preview ====================

/// Расширенная версия read_media_preview: для видео запускает ffmpeg и возвращает кадр.
/// Если ffmpeg не найден — возвращает пустую строку.
#[tauri::command]
#[specta::specta]
pub fn read_media_preview_with_ffmpeg(file_path: String, state: tauri::State<Mutex<AppSettingsState>>) -> Result<String, String> {
    use std::fs;
    use std::path::Path;

    let path = Path::new(&file_path);
    if !path.exists() {
        return Ok(String::new());
    }

    let ext = path
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();

    let image_exts = ["jpg", "jpeg", "png", "gif", "webp", "bmp", "tif", "tiff"];
    let video_exts = ["mp4", "mov", "avi", "mkv", "webm", "mts", "mxf", "m4v"];

    if image_exts.contains(&ext.as_str()) {
        let bytes = fs::read(path).map_err(|e| e.to_string())?;
        let b64 = base64_encode(&bytes);
        let mime = match ext.as_str() {
            "jpg" | "jpeg" => "image/jpeg",
            "png" => "image/png",
            "gif" => "image/gif",
            "webp" => "image/webp",
            _ => "image/bmp",
        };
        return Ok(format!("data:{};base64,{}", mime, b64));
    }

    if video_exts.contains(&ext.as_str()) {
        let ffmpeg = resolve_program_path("ffmpeg", &state);
        return ffmpeg_get_video_thumbnail_with_path(file_path, Some(0.0), &ffmpeg);
    }

    Ok(String::new())
}

// ==================== BASE64 ====================

/// base64 через крейт (см. пояснение в fs_commands.rs). Реализация здесь была
/// быстрее той — на `push` с предвыделением, — но дублировала стандартный кодек.
fn base64_encode(data: &[u8]) -> String {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.encode(data)
}
