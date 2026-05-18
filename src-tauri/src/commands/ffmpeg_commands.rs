use std::path::PathBuf;
use std::process::Command;

// ==================== PATH RESOLUTION ====================

/// Ищет ffmpeg/ffprobe в стандартных местах и PATH.
/// Возвращает абсолютный путь или "ffmpeg"/"ffprobe" если найдено в PATH.
fn find_binary(name: &str) -> String {
    // Стандартные места на macOS / Linux / Windows
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

    // Ищем в системном PATH через `which` / `where`
    #[cfg(not(target_os = "windows"))]
    let which_cmd = "which";
    #[cfg(target_os = "windows")]
    let which_cmd = "where";

    if let Ok(output) = Command::new(which_cmd).arg(name).output() {
        let found = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !found.is_empty() && PathBuf::from(&found).exists() {
            return found;
        }
    }

    // Возвращаем просто имя — пусть ОС ищет в PATH
    name.to_string()
}

/// Tauri-команда: возвращает путь к ffmpeg на этой машине
#[tauri::command]
pub fn ffmpeg_get_path() -> Result<String, String> {
    let path = find_binary("ffmpeg");
    Ok(path)
}

/// Tauri-команда: возвращает путь к ffprobe на этой машине
#[tauri::command]
pub fn ffprobe_get_path() -> Result<String, String> {
    let path = find_binary("ffprobe");
    Ok(path)
}

// ==================== VIDEO INFO (ffprobe) ====================

/// Возвращает полную информацию о медиафайле через ffprobe (JSON-строку)
#[tauri::command]
pub fn ffprobe_get_info(file_path: String) -> Result<String, String> {
    let ffprobe = find_binary("ffprobe");

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
        .output()
        .map_err(|e| format!("ffprobe not found or failed to start: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        return Err(format!("ffprobe error: {}", stderr));
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

// ==================== VIDEO THUMBNAIL (ffmpeg) ====================

/// Снимает кадр из видеофайла и возвращает его как base64 data URL (image/png).
/// Используется для превью видео в главном окне.
#[tauri::command]
pub fn ffmpeg_get_video_thumbnail(file_path: String, timestamp_sec: Option<f64>) -> Result<String, String> {
    let ffmpeg = find_binary("ffmpeg");

    // Временный файл для кадра
    let tmp_path = std::env::temp_dir().join(format!(
        "fs_manager_thumb_{}.png",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
    ));

    let ts = timestamp_sec.unwrap_or(0.0).to_string();

    let output = Command::new(&ffmpeg)
        .args([
            "-y",
            "-ss", &ts,
            "-i", &file_path,
            "-vframes", "1",
            "-pix_fmt", "rgba",
            tmp_path.to_str().unwrap_or(""),
        ])
        .output()
        .map_err(|e| format!("ffmpeg not found or failed to start: {}", e))?;

    if !tmp_path.exists() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        return Err(format!("ffmpeg failed to produce thumbnail: {}", stderr));
    }

    // Читаем файл и кодируем в base64
    let bytes = std::fs::read(&tmp_path).map_err(|e| e.to_string())?;
    let _ = std::fs::remove_file(&tmp_path);

    let b64 = base64_encode(&bytes);
    Ok(format!("data:image/png;base64,{}", b64))
}

// ==================== EXEC WITH PROGRESS ====================

/// Запускает ffmpeg-команду с отслеживанием прогресса через stderr.
/// Эмитит события "ffmpeg-progress" с полями { progress, time, text }.
#[tauri::command]
pub fn ffmpeg_exec_with_progress(
    args: Vec<String>,
    duration_sec: Option<f64>,
    node_id: Option<String>,
    status_text: Option<String>,
    app: tauri::AppHandle,
) -> Result<serde_json::Value, String> {
    use std::io::{BufRead, BufReader};
    use std::process::Stdio;
    use tauri::Emitter;

    let ffmpeg = find_binary("ffmpeg");
    let duration = duration_sec.unwrap_or(0.0);
    let text = status_text.unwrap_or_else(|| "Processing".to_string());

    let mut child = Command::new(&ffmpeg)
        .args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("ffmpeg not found or failed to start: {}", e))?;

    let stderr_reader = BufReader::new(child.stderr.take().unwrap());
    let stdout_reader = BufReader::new(child.stdout.take().unwrap());

    let app_clone = app.clone();
    let node_id_clone = node_id.clone();
    let text_clone = text.clone();

    // Читаем stderr построчно, парсим прогресс
    let stderr_handle = std::thread::spawn(move || {
        let mut full_stderr = String::new();
        for line in stderr_reader.lines() {
            if let Ok(line) = line {
                full_stderr.push_str(&line);
                full_stderr.push('\n');

                // Парсим time= из вывода ffmpeg
                if let Some(progress) = parse_ffmpeg_progress(&line, duration) {
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

    // Читаем stdout (обычно пустой у ffmpeg)
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

    let status = child.wait().map_err(|e| e.to_string())?;
    let exit_code = status.code().unwrap_or(-1);

    let stderr_output = stderr_handle.join().unwrap_or_default();
    let stdout_output = stdout_handle.join().unwrap_or_default();

    // Финальное событие
    if let Some(ref nid) = node_id {
        let level = if exit_code == 0 { "info" } else { "error" };
        let _ = app.emit("processing-event", serde_json::json!({
            "type": "log",
            "level": level,
            "message": format!("ffmpeg finished with exit code: {}", exit_code),
            "nodeId": nid,
        }));
    }

    Ok(serde_json::json!({
        "exit_code": exit_code,
        "stdout": stdout_output,
        "stderr": stderr_output,
        "killed": false,
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
pub fn read_media_preview_with_ffmpeg(file_path: String) -> Result<String, String> {
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
        // Пробуем получить превью через ffmpeg
        return ffmpeg_get_video_thumbnail(file_path, Some(0.0));
    }

    Ok(String::new())
}

// ==================== BASE64 ====================

fn base64_encode(data: &[u8]) -> String {
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut result = String::with_capacity((data.len() + 2) / 3 * 4);

    for chunk in data.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = if chunk.len() > 1 { chunk[1] as u32 } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] as u32 } else { 0 };
        let triple = (b0 << 16) | (b1 << 8) | b2;

        result.push(CHARS[((triple >> 18) & 0x3F) as usize] as char);
        result.push(CHARS[((triple >> 12) & 0x3F) as usize] as char);
        result.push(if chunk.len() > 1 { CHARS[((triple >> 6) & 0x3F) as usize] as char } else { '=' });
        result.push(if chunk.len() > 2 { CHARS[(triple & 0x3F) as usize] as char } else { '=' });
    }

    result
}
