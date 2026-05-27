// Кастомный URI-протокол `plugin://` для загрузки плагинов из renderer'а через `import()`.
//
// Resolver ищет файл по приоритету:
//   1. <CARGO_MANIFEST_DIR>/../distr-plugins/<rest> — dev (только debug, имеет приоритет)
//   2. <app_data_dir>/plugins/<rest>          — user-installed плагины (prod)
//   3. <resource_dir>/plugins/<rest>          — встроенные (prod)
//
// `node:*` импорты внутри плагинов резолвятся через <script type="importmap"> в HTML
// главного документа (см. pluginApiImportmap в vite.config.ts). Здесь Rust отдаёт JS
// как есть, ничего не переписывая.

use std::fs;
use std::path::PathBuf;
use tauri::http::{header, Response};
use tauri::{AppHandle, Manager};

fn resolve_plugin_path(app: &AppHandle, rel_path: &str) -> Option<PathBuf> {
    // Убираем ведущий слэш и percent-decode'им.
    let decoded = percent_decode(rel_path.trim_start_matches('/'));
    let rel = decoded.as_str();

    // Защита от path traversal.
    if rel.is_empty() || rel.contains("..") {
        return None;
    }

    // В dev distr-plugins имеет приоритет: иначе при наличии prod-установки
    // плагин с тем же id@version подтянулся бы из app_data, а не из папки проекта.
    // Это согласует резолвер с PluginManagerState, который в dev читает только distr-plugins.
    #[cfg(debug_assertions)]
    {
        let manifest_dir = env!("CARGO_MANIFEST_DIR");
        let p = PathBuf::from(manifest_dir)
            .join("..")
            .join("distr-plugins")
            .join(rel);
        if p.is_file() {
            return Some(p);
        }
    }

    // User-installed plugins (prod)
    if let Ok(data_dir) = app.path().app_data_dir() {
        let p = data_dir.join("plugins").join(rel);
        if p.is_file() {
            return Some(p);
        }
    }

    // Bundled resources (prod)
    if let Ok(res_dir) = app.path().resource_dir() {
        let p = res_dir.join("plugins").join(rel);
        if p.is_file() {
            return Some(p);
        }
    }

    None
}

/// Простой percent-decode без зависимостей: обрабатывает %XX-последовательности.
fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(h), Some(l)) = (hex_digit(bytes[i + 1]), hex_digit(bytes[i + 2])) {
                out.push((h << 4) | l);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn hex_digit(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(10 + b - b'a'),
        b'A'..=b'F' => Some(10 + b - b'A'),
        _ => None,
    }
}

pub fn handle_plugin_request(
    app: &AppHandle,
    uri_path: &str,
) -> Response<Vec<u8>> {
    let path = match resolve_plugin_path(app, uri_path) {
        Some(p) => p,
        None => {
            eprintln!("[plugin://] 404 — not found: {}", uri_path);
            return Response::builder()
                .status(404)
                .header(header::CONTENT_TYPE, "text/plain")
                .body(format!("Plugin file not found: {}", uri_path).into_bytes())
                .unwrap();
        }
    };

    let bytes = match fs::read(&path) {
        Ok(b) => b,
        Err(e) => {
            eprintln!("[plugin://] read error for {}: {}", path.display(), e);
            return Response::builder()
                .status(500)
                .header(header::CONTENT_TYPE, "text/plain")
                .body(format!("Read error: {}", e).into_bytes())
                .unwrap();
        }
    };

    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    let mime = match ext.as_str() {
        "js" | "mjs" => "text/javascript",
        "json" | "map" => "application/json",
        "css" => "text/css",
        "html" | "htm" => "text/html",
        _ => "application/octet-stream",
    };

    Response::builder()
        .header(header::CONTENT_TYPE, mime)
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(header::CACHE_CONTROL, "no-cache")
        .body(bytes)
        .unwrap()
}
