// HTTP-команды для плагинов. Выполняются в Rust → нет CORS-ограничений WebView.
// fetch, upload (multipart/form-data с локальными файлами), download → файл.

use serde::{Deserialize, Serialize};
use tauri::Emitter;

#[derive(Debug, Serialize)]
pub struct HttpResponse {
    pub status: u16,
    pub ok: bool,
    pub body: String,
}

// ─── http_fetch ──────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct HttpFetchArgs {
    pub url: String,
    #[serde(default)]
    pub method: Option<String>,
    #[serde(default)]
    pub headers: Option<Vec<[String; 2]>>,
    #[serde(default)]
    pub body: Option<String>,
}

/// Универсальный HTTP-запрос (GET/POST/PUT/...) с опциональным строковым телом.
/// Возвращает { status, ok, body }. Не бросает при 4xx/5xx — отдаёт статус.
#[tauri::command]
pub async fn http_fetch(args: HttpFetchArgs) -> Result<HttpResponse, String> {
    let client = reqwest::Client::new();

    let method_str = args.method.as_deref().unwrap_or("GET").to_uppercase();
    let method = reqwest::Method::from_bytes(method_str.as_bytes())
        .map_err(|e| format!("Invalid HTTP method: {}", e))?;

    let mut req = client.request(method, &args.url);

    if let Some(headers) = args.headers {
        for pair in headers {
            req = req.header(&pair[0], &pair[1]);
        }
    }

    if let Some(body) = args.body {
        req = req.body(body);
    }

    let res = req.send().await.map_err(|e| format!("Request failed: {}", e))?;
    let status = res.status().as_u16();
    let ok = res.status().is_success();
    let body = res.text().await.map_err(|e| format!("Failed to read response body: {}", e))?;

    Ok(HttpResponse { status, ok, body })
}

// ─── http_upload ─────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct UploadFile {
    pub field: String,
    pub path: String,
    #[serde(default)]
    pub mime: Option<String>,
    #[serde(default)]
    pub filename: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UploadField {
    pub field: String,
    pub value: String,
}

#[derive(Debug, Deserialize)]
pub struct HttpUploadArgs {
    pub url: String,
    #[serde(default)]
    pub headers: Option<Vec<[String; 2]>>,
    #[serde(default)]
    pub files: Option<Vec<UploadFile>>,
    #[serde(default)]
    pub fields: Option<Vec<UploadField>>,
}

/// Multipart/form-data upload с локальными файлами (читает их в Rust → нет CORS).
/// files: [{ field, path, mime?, filename? }], fields: [{ field, value }].
#[tauri::command]
pub async fn http_upload(args: HttpUploadArgs) -> Result<HttpResponse, String> {
    let client = reqwest::Client::new();
    let mut form = reqwest::multipart::Form::new();

    // Текстовые поля
    if let Some(fields) = args.fields {
        for f in fields {
            form = form.text(f.field, f.value);
        }
    }

    // Файловые части — читаем файл в Rust, CORS не касается
    if let Some(files) = args.files {
        for f in files {
            let bytes = std::fs::read(&f.path)
                .map_err(|e| format!("Cannot read file {}: {}", f.path, e))?;

            let fname = f.filename.unwrap_or_else(|| {
                std::path::Path::new(&f.path)
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_else(|| "file".to_string())
            });

            let mime_str = f.mime.unwrap_or_else(|| "application/octet-stream".to_string());

            let part = reqwest::multipart::Part::bytes(bytes)
                .file_name(fname)
                .mime_str(&mime_str)
                .map_err(|e| format!("Invalid MIME type {}: {}", mime_str, e))?;

            form = form.part(f.field, part);
        }
    }

    let mut req = client.post(&args.url).multipart(form);

    if let Some(headers) = args.headers {
        for pair in headers {
            req = req.header(&pair[0], &pair[1]);
        }
    }

    let res = req.send().await.map_err(|e| format!("Upload failed: {}", e))?;
    let status = res.status().as_u16();
    let ok = res.status().is_success();
    let body = res.text().await.map_err(|e| format!("Failed to read response body: {}", e))?;

    Ok(HttpResponse { status, ok, body })
}

// ─── http_download ───────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpDownloadArgs {
    pub url: String,
    pub dest: String,
    #[serde(default)]
    pub headers: Option<Vec<[String; 2]>>,
    /// ID ноды — если передан, прогресс скачивания шлётся как processing-event
    /// с тем же payload-форматом, что у ffmpeg ({ type:"statusbar", payload:{text,progress} }).
    #[serde(default)]
    pub node_id: Option<String>,
    /// Префикс текста в статусбаре (напр. "⬇️ Скачивание result.mp3"). Само наличие
    /// nodeId ИЛИ statusText включает показ прогресса; без них — тихое скачивание как раньше.
    #[serde(default)]
    pub status_text: Option<String>,
}

/// Скачивает URL в локальный файл потоково (чанками). Возвращает количество записанных байт.
/// Если передан nodeId/statusText — эмитит прогресс в UI (статусбар/нода).
#[tauri::command]
pub async fn http_download(args: HttpDownloadArgs, app: tauri::AppHandle) -> Result<u64, String> {
    use std::io::Write;

    let client = reqwest::Client::new();
    let mut req = client.get(&args.url);

    if let Some(headers) = &args.headers {
        for pair in headers {
            req = req.header(&pair[0], &pair[1]);
        }
    }

    let mut res = req.send().await.map_err(|e| format!("Download request failed: {}", e))?;

    if !res.status().is_success() {
        return Err(format!("HTTP {} downloading {}", res.status(), args.url));
    }

    // Прогресс показываем только если вызывающий явно попросил — иначе служебные/мелкие
    // загрузки (updater и т.п.) качаются молча, как и раньше.
    let want_progress = args.node_id.is_some() || args.status_text.is_some();
    let total = res.content_length(); // None, если сервер не прислал Content-Length
    let label = args.status_text.clone().unwrap_or_else(|| "Download".to_string());

    let path = std::path::Path::new(&args.dest);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let mut file = std::fs::File::create(path).map_err(|e| e.to_string())?;

    let mut downloaded: u64 = 0;
    let mut last_emit = std::time::Instant::now();
    let mut emitted_once = false;

    while let Some(chunk) = res
        .chunk()
        .await
        .map_err(|e| format!("Download stream error: {}", e))?
    {
        file.write_all(&chunk).map_err(|e| e.to_string())?;
        downloaded += chunk.len() as u64;

        // throttle ~150мс (как exec/ffmpeg) — иначе тысячи emit'ов топят webview event-loop.
        if want_progress && (!emitted_once || last_emit.elapsed().as_millis() >= 150) {
            emitted_once = true;
            last_emit = std::time::Instant::now();
            emit_download_progress(&app, &label, downloaded, total, args.node_id.as_deref());
        }
    }

    file.flush().map_err(|e| e.to_string())?;

    // Финальный 100%-emit, чтобы UI не застрял на ~98%.
    if want_progress {
        emit_download_progress(
            &app,
            &label,
            downloaded,
            total.or(Some(downloaded)),
            args.node_id.as_deref(),
        );
    }

    Ok(downloaded)
}

/// Эмитит processing-event прогресса скачивания в том же формате, что ffmpeg_exec_with_progress.
fn emit_download_progress(
    app: &tauri::AppHandle,
    label: &str,
    downloaded: u64,
    total: Option<u64>,
    node_id: Option<&str>,
) {
    let (percent, text) = match total {
        Some(t) if t > 0 => {
            let p = (downloaded as f64 / t as f64 * 100.0).min(100.0);
            (
                p,
                format!(
                    "{}: {:.1}% ({} / {})",
                    label,
                    p,
                    human_bytes(downloaded),
                    human_bytes(t)
                ),
            )
        }
        // Нет Content-Length — показываем накопленный объём без процента.
        _ => (0.0, format!("{}: {}", label, human_bytes(downloaded))),
    };

    let _ = app.emit(
        "processing-event",
        serde_json::json!({
            "type": "statusbar",
            "payload": { "text": text, "progress": percent },
            "nodeId": node_id,
        }),
    );
}

fn human_bytes(b: u64) -> String {
    const KB: f64 = 1024.0;
    const MB: f64 = KB * 1024.0;
    const GB: f64 = MB * 1024.0;
    let f = b as f64;
    if f >= GB {
        format!("{:.2} GB", f / GB)
    } else if f >= MB {
        format!("{:.1} MB", f / MB)
    } else if f >= KB {
        format!("{:.0} KB", f / KB)
    } else {
        format!("{} B", b)
    }
}
