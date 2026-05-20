// HTTP-команды для плагинов. Выполняются в Rust → нет CORS-ограничений WebView.
// fetch, upload (multipart/form-data с локальными файлами), download → файл.

use serde::{Deserialize, Serialize};

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
pub struct HttpDownloadArgs {
    pub url: String,
    pub dest: String,
    #[serde(default)]
    pub headers: Option<Vec<[String; 2]>>,
}

/// Скачивает URL в локальный файл. Возвращает количество записанных байт.
#[tauri::command]
pub async fn http_download(args: HttpDownloadArgs) -> Result<u64, String> {
    let client = reqwest::Client::new();
    let mut req = client.get(&args.url);

    if let Some(headers) = args.headers {
        for pair in headers {
            req = req.header(&pair[0], &pair[1]);
        }
    }

    let res = req.send().await.map_err(|e| format!("Download request failed: {}", e))?;

    if !res.status().is_success() {
        return Err(format!("HTTP {} downloading {}", res.status(), args.url));
    }

    let bytes = res.bytes().await.map_err(|e| format!("Failed to read download bytes: {}", e))?;

    let path = std::path::Path::new(&args.dest);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(path, &bytes).map_err(|e| e.to_string())?;

    Ok(bytes.len() as u64)
}
