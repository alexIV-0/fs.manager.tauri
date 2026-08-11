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
use std::path::{Component, Path, PathBuf};
use tauri::http::{header, Response};
use tauri::{AppHandle, Manager};

/// Превращает путь из URI в БЕЗОПАСНЫЙ относительный путь или отказывает.
///
/// Здесь важен порядок. Раньше было `percent_decode(rel_path.trim_start_matches('/'))`
/// — то есть слэши срезались ДО декодирования, и запрос `/%2Fetc%2Fpasswd` давал
/// `rel = "/etc/passwd"`: проверку на `..` он проходит, а `PathBuf::join` с абсолютным
/// путём по контракту std ЗАМЕНЯЕТ базу целиком. Получалось чтение любого файла,
/// отданное в вебвью. На Windows то же самое достигалось `C:/...` вообще без кодирования.
///
/// Теперь: декодируем первым, затем разбираем путь по компонентам и пропускаем
/// только `Normal`. Так отсекаются `..`, корень и windows-префиксы (`C:`, UNC).
fn safe_relative(rel_path: &str) -> Option<PathBuf> {
    // Срезаем слэши, которые принадлежат самому URI (`plugin://host/<rel>`), — это
    // делается ДО декодирования и только здесь. После декодирования не трогаем ничего:
    // иначе закодированный абсолютный путь молча превратился бы в другой запрос
    // вместо отказа.
    sanitize_relative(&percent_decode(rel_path.trim_start_matches('/')))
}

/// Приводит внешнюю строку к безопасному ОТНОСИТЕЛЬНОМУ пути или отказывает.
///
/// Пропускает только `Normal`-компоненты. Отсекаются `..`, корень (то есть абсолютный
/// путь) и windows-префиксы (`C:`, UNC) — всё это `PathBuf::join` применил бы ВМЕСТО
/// базы, а не внутри неё.
///
/// Живёт здесь, но переиспользуется распаковкой архива плагина
/// (`plugin_manager_install`): опасность одна и та же — внешнее имя, попадающее в
/// `join`. Две копии такой проверки держать нельзя, одна неизбежно отстанет.
pub(crate) fn sanitize_relative(decoded: &str) -> Option<PathBuf> {
    if decoded.is_empty() {
        return None;
    }

    // Обратный слэш запрещён на ВСЕХ платформах, хотя опасен только на Windows
    // (там `\\server\share` — UNC-префикс, а на unix это просто символ в имени).
    // Иначе поведение резолвера расходится по платформам, и windows-дыра тихо
    // возвращается при любом рефакторинге. В путях плагинов (`<id>@<ver>/<файл>`)
    // обратного слэша быть не может.
    if decoded.contains('\\') {
        return None;
    }

    // Буква диска в начале (`C:/...`) — по той же причине, что и обратный слэш.
    // На Windows это `Prefix`-компонент и он отсекается разбором ниже, а на unix
    // это обычное имя, и путь остался бы внутри цели — вреда нет, но поведение
    // разъезжается по платформам. Одинаковый отказ везде надёжнее.
    let first = decoded.split(['/', '\\']).next().unwrap_or("");
    if first.len() == 2 && first.ends_with(':') && first.starts_with(|c: char| c.is_ascii_alphabetic()) {
        return None;
    }

    let mut safe = PathBuf::new();
    for component in Path::new(decoded).components() {
        match component {
            Component::Normal(part) => safe.push(part),
            Component::CurDir => {}
            // `..` — выход вверх; RootDir — раскодированный абсолютный путь
            // (`%2Fetc%2Fpasswd`); Prefix — windows-диск `C:` или UNC `\\server\share`.
            // Всё это `PathBuf::join` применил бы вместо базы, а не внутри неё.
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => return None,
        }
    }

    if safe.as_os_str().is_empty() {
        None
    } else {
        Some(safe)
    }
}

/// Файл существует И лежит ВНУТРИ базы. `canonicalize` разворачивает симлинки,
/// поэтому ссылка из папки плагинов наружу тоже не пройдёт.
fn file_under(base: &Path, candidate: &Path) -> bool {
    if !candidate.is_file() {
        return false;
    }
    match (base.canonicalize(), candidate.canonicalize()) {
        (Ok(b), Ok(c)) => c.starts_with(b),
        _ => false,
    }
}

fn resolve_plugin_path(app: &AppHandle, rel_path: &str) -> Option<PathBuf> {
    let rel = safe_relative(rel_path)?;

    // В dev distr-plugins имеет приоритет: иначе при наличии prod-установки
    // плагин с тем же id@version подтянулся бы из app_data, а не из папки проекта.
    // Это согласует резолвер с PluginManagerState, который в dev читает только distr-plugins.
    #[cfg(debug_assertions)]
    {
        let base = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("distr-plugins");
        let p = base.join(&rel);
        if file_under(&base, &p) {
            return Some(p);
        }
    }

    // User-installed plugins (prod)
    if let Ok(data_dir) = app.path().app_data_dir() {
        let base = data_dir.join("plugins");
        let p = base.join(&rel);
        if file_under(&base, &p) {
            return Some(p);
        }
    }

    // Bundled resources (prod)
    if let Ok(res_dir) = app.path().resource_dir() {
        let base = res_dir.join("plugins");
        let p = base.join(&rel);
        if file_under(&base, &p) {
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

#[cfg(test)]
mod tests {
    use super::{safe_relative, sanitize_relative};

    #[test]
    fn нормальные_пути_проходят() {
        assert_eq!(
            safe_relative("/copyFile@0.1/copyFile.js").unwrap().to_str().unwrap(),
            "copyFile@0.1/copyFile.js"
        );
        // ведущих слэшей может быть несколько, `./` — безвредно
        assert_eq!(safe_relative("///a/./b.js").unwrap().to_str().unwrap(), "a/b.js");
        // percent-decode работает: пробел в имени папки
        assert!(safe_relative("/my%20plugin@1.0/main.js").is_some());
    }

    /// Регрессия. Проверка `rel.contains("..")` стояла ПОСЛЕ обрезки слэшей, но ДО
    /// percent-decode, поэтому `%2Fetc%2Fpasswd` давал абсолютный `/etc/passwd`, а
    /// `PathBuf::join` с абсолютным путём заменяет базу — читался любой файл.
    #[test]
    fn закодированный_абсолютный_путь_не_проходит() {
        assert!(safe_relative("/%2Fetc%2Fpasswd").is_none());
        assert!(safe_relative("%2Fetc%2Fpasswd").is_none());
        assert!(safe_relative("/%2FUsers%2Fx%2F.ssh%2Fid_rsa").is_none());
    }

    #[test]
    fn traversal_не_проходит() {
        assert!(safe_relative("/../../etc/passwd").is_none());
        assert!(safe_relative("/a/../../b").is_none());
        assert!(safe_relative("/%2e%2e/%2e%2e/etc/passwd").is_none());
        // при этом точки внутри ИМЕНИ файла — это не traversal
        assert!(safe_relative("/plugin@1.0/my..name.js").is_some());
    }

    #[test]
    fn windows_абсолютные_и_unc_не_проходят() {
        // на unix `C:/...` — обычное относительное имя, но пускать его незачем;
        // на windows это Prefix и прямой выход из базы
        assert!(safe_relative("/%5C%5Cserver%5Cshare%5Cx.js").is_none());
        #[cfg(windows)]
        {
            assert!(safe_relative("/C:/Windows/System32/drivers/etc/hosts").is_none());
            assert!(safe_relative("C:%5CWindows%5Cwin.ini").is_none());
        }
    }

    #[test]
    fn пустое_и_только_разделители_не_проходят() {
        assert!(safe_relative("").is_none());
        assert!(safe_relative("/").is_none());
        assert!(safe_relative("///").is_none());
        assert!(safe_relative("/./").is_none());
    }

    /// ZIP SLIP. Те же имена приходят из записей zip-архива плагина: раньше они
    /// уходили в `dest_path.join(...)` без проверки, и запись `../../..` писалась куда
    /// угодно. Проверка теперь общая с протоколом — сторожим оба применения сразу.
    #[test]
    fn имена_из_архива_с_traversal_отвергаются() {
        for bad in [
            "../../../Library/LaunchAgents/evil.plist",
            "..",
            "a/../../b",
            "/etc/passwd",
            "C:/Windows/win.ini",
            "..\\..\\evil.dll",
            "",
        ] {
            assert!(sanitize_relative(bad).is_none(), "должно отвергаться: {bad:?}");
        }
    }

    #[test]
    fn обычные_имена_из_архива_проходят() {
        assert_eq!(sanitize_relative("copyFile.js").unwrap().to_str().unwrap(), "copyFile.js");
        assert_eq!(sanitize_relative("./ui.json").unwrap().to_str().unwrap(), "ui.json");
        assert!(sanitize_relative("bin/mac-arm64/whisper-cli").is_some());
    }
}
