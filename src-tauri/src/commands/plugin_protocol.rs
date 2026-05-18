// Кастомный URI-протокол `plugin://` для загрузки плагинов из renderer'а через `import()`.
//
// Resolver ищет файл по приоритету:
//   1. <app_data_dir>/plugins/<rest>          — user-installed плагины
//   2. <resource_dir>/plugins/<rest>          — встроенные (в prod)
//   3. <CARGO_MANIFEST_DIR>/../distr-plugins/<rest> — dev fallback
//
// Для .js файлов выполняется runtime rewrite:
//   from "node:fs" → from "@plugin-api/fs"
//   from "node:path" → from "@plugin-api/path"
//   и т.д.
//
// Это позволяет плагинам, собранным под Node.js, работать в renderer'е через полифилы.

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

    // 1. User-installed plugins
    if let Ok(data_dir) = app.path().app_data_dir() {
        let p = data_dir.join("plugins").join(rel);
        if p.is_file() {
            return Some(p);
        }
    }

    // 2. Bundled resources (prod)
    if let Ok(res_dir) = app.path().resource_dir() {
        let p = res_dir.join("plugins").join(rel);
        if p.is_file() {
            return Some(p);
        }
    }

    // 3. Dev path: <project_root>/distr-plugins/<rel>
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

/// Заменяет Node-импорты на полные URL'ы наших полифилов.
/// В dev — это Vite-dev-сервер (`http://localhost:1420/src/PluginAPI/*.ts`).
/// Бровсер не знает про bare-specifiers вроде `@plugin-api/fs` без importmap,
/// поэтому подставляем сразу абсолютный URL.
fn rewrite_node_imports(src: &str) -> String {
    // В dev — Vite-сервер. В prod URL'ы будут другие; пока поддерживаем только dev.
    #[cfg(debug_assertions)]
    let base = "http://localhost:1420/src/PluginAPI";
    #[cfg(not(debug_assertions))]
    let base = "/assets/PluginAPI"; // placeholder — для prod надо настроить отдельно

    // Порядок важен: сначала более длинные ("node:fs/promises") до коротких ("node:fs"),
    // чтобы не схватить часть длинной подстроки.
    let modules: &[(&str, &str)] = &[
        ("node:fs/promises", "fs-promises.ts"),
        ("node:fs", "fs.ts"),
        ("node:path", "path.ts"),
        ("node:os", "os.ts"),
        ("node:child_process", "child_process.ts"),
        ("node:crypto", "crypto.ts"),
        ("node:events", "events.ts"),
        ("node:stream", "stream.ts"),
        ("node:url", "url.ts"),
        ("node:util", "util.ts"),
    ];

    let mut out = src.to_string();
    for (from_mod, to_file) in modules {
        let target = format!("{}/{}", base, to_file);
        let from_dq = format!("\"{}\"", from_mod);
        let to_dq = format!("\"{}\"", target);
        let from_sq = format!("'{}'", from_mod);
        let to_sq = format!("'{}'", target);
        if out.contains(&from_dq) {
            out = out.replace(&from_dq, &to_dq);
        }
        if out.contains(&from_sq) {
            out = out.replace(&from_sq, &to_sq);
        }
    }
    out
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

    // Rewrite только для JS-файлов; .json/.map оставляем как есть.
    let body = if ext == "js" || ext == "mjs" {
        let text = String::from_utf8_lossy(&bytes);
        rewrite_node_imports(&text).into_bytes()
    } else {
        bytes
    };

    Response::builder()
        .header(header::CONTENT_TYPE, mime)
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(header::CACHE_CONTROL, "no-cache")
        .body(body)
        .unwrap()
}
