// HTTP-команды для плагинов. Выполняются в Rust → нет CORS-ограничений WebView.
// fetch, upload (multipart/form-data с локальными файлами), download → файл.

use serde::{Deserialize, Serialize};
use tauri::Emitter;

// Клиенты и политика таймаутов — в общем `http_client`: там же ими пользуются
// vk_auth, youtube_*, tg_commands и deps. Две копии одной политики разъехались бы.
use super::http_client::{api as fetch_client, transfer as transfer_client};

#[derive(Debug, Serialize, specta::Type)]
pub struct HttpResponse {
    pub status: u16,
    pub ok: bool,
    pub body: String,
}

/// Потолок на ТЕКСТОВЫЙ ответ (`http_fetch`/`http_upload`).
///
/// Тело такого ответа целиком лежит в памяти, а потом ещё раз — уже как JS-строка
/// в вебвью, то есть фактический расход вдвое больше. Ответы этих двух команд по
/// природе маленькие: JSON от API, страница авторизации, ответ загрузчика. 32 МиБ
/// — это на три порядка больше любого законного случая и всё ещё безопасно для
/// памяти. Файлы качаются `http_download`, он пишет на диск потоком, и лимита у
/// него нет намеренно.
const MAX_RESPONSE_BYTES: usize = 32 * 1024 * 1024;

/// Решение по ОБЪЯВЛЕННОМУ серверу размеру: отказ до чтения тела.
///
/// Отдельной функцией только ради проверяемости: `reqwest::Response`, собранный в
/// тесте из `http::Response`, считает `content_length()` по телу и заголовок
/// игнорирует, так что внутри `read_capped_text` эта ветка недостижима для теста.
fn declared_too_big(declared: Option<u64>) -> Option<String> {
    match declared {
        Some(len) if len > MAX_RESPONSE_BYTES as u64 => Some(format!(
            "ответ слишком большой: {} байт при лимите {} МиБ (для файлов есть http_download)",
            len,
            MAX_RESPONSE_BYTES / (1024 * 1024)
        )),
        _ => None,
    }
}

/// Читает тело как текст, но не больше `MAX_RESPONSE_BYTES`.
///
/// Раньше здесь был `res.text()` — он читает СКОЛЬКО ПРИШЛЮТ. Достаточно было
/// опечатки в URL или отдающего поток адреса, чтобы плагин утянул гигабайты в
/// память процесса; на нашей стороне это не ошибка запроса, а падение всего
/// приложения, вместе с текущей обработкой.
async fn read_capped_text(mut res: reqwest::Response) -> Result<String, String> {
    let limit_mb = MAX_RESPONSE_BYTES / (1024 * 1024);

    // Если сервер честно прислал Content-Length — отказываем сразу, не качая тело.
    if let Some(err) = declared_too_big(res.content_length()) {
        return Err(err);
    }

    // Content-Length может отсутствовать (chunked) или врать — поэтому считаем и по
    // мере чтения, обрывая соединение на превышении.
    let mut buf: Vec<u8> = Vec::new();
    while let Some(chunk) = res
        .chunk()
        .await
        .map_err(|e| format!("Failed to read response body: {}", e.without_url()))?
    {
        if buf.len() + chunk.len() > MAX_RESPONSE_BYTES {
            return Err(format!(
                "ответ превысил лимит {} МиБ — чтение прервано (для файлов есть http_download)",
                limit_mb
            ));
        }
        buf.extend_from_slice(&chunk);
    }

    // Lossy, как и прежний `res.text()`: не-UTF-8 страница (VK умеет windows-1251)
    // должна отдаваться испорченной, но отдаваться, а не превращаться в ошибку.
    Ok(String::from_utf8_lossy(&buf).into_owned())
}

// ─── http_fetch ──────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize, specta::Type)]
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
#[specta::specta]
pub async fn http_fetch(args: HttpFetchArgs) -> Result<HttpResponse, String> {
    let client = fetch_client();

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

    // URL приходит от плагина и может содержать секрет (VK кладёт access_token
    // в query) — из текста ошибки его убираем: он попадёт в логи и архив.
    let res = req
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e.without_url()))?;
    let status = res.status().as_u16();
    let ok = res.status().is_success();
    let body = read_capped_text(res).await?;

    Ok(HttpResponse { status, ok, body })
}

// ─── http_upload ─────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize, specta::Type)]
pub struct UploadFile {
    pub field: String,
    pub path: String,
    #[serde(default)]
    pub mime: Option<String>,
    #[serde(default)]
    pub filename: Option<String>,
}

#[derive(Debug, Deserialize, specta::Type)]
pub struct UploadField {
    pub field: String,
    pub value: String,
}

#[derive(Debug, Deserialize, specta::Type)]
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
#[specta::specta]
pub async fn http_upload(args: HttpUploadArgs) -> Result<HttpResponse, String> {
    let client = transfer_client();
    let mut form = reqwest::multipart::Form::new();

    // Текстовые поля
    if let Some(fields) = args.fields {
        for f in fields {
            form = form.text(f.field, f.value);
        }
    }

    // Файловые части — потоком с диска (CORS не касается: читает Rust).
    //
    // Раньше здесь стоял `std::fs::read(&f.path)`, то есть файл целиком в память.
    // Именно этим путём autoPostVK/autoPostTG/tgSend заливают ВИДЕО: двухгигабайтный
    // мастер означал два гигабайта RAM. Идиома та же, что в storage/service.rs:
    // ReaderStream по файлу → Body::wrap_stream.
    //
    // `stream_with_length` (а не `stream`) — чтобы у части был Content-Length: VK и
    // Telegram без него ругаются на multipart.
    if let Some(files) = args.files {
        for f in files {
            let size = tokio::fs::metadata(&f.path)
                .await
                .map_err(|e| format!("Cannot stat file {}: {}", f.path, e))?
                .len();

            let file = tokio::fs::File::open(&f.path)
                .await
                .map_err(|e| format!("Cannot read file {}: {}", f.path, e))?;

            let fname = f.filename.unwrap_or_else(|| {
                std::path::Path::new(&f.path)
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_else(|| "file".to_string())
            });

            let mime_str = f.mime.unwrap_or_else(|| "application/octet-stream".to_string());

            let body = reqwest::Body::wrap_stream(tokio_util::io::ReaderStream::new(file));
            let part = reqwest::multipart::Part::stream_with_length(body, size)
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

    let res = req.send().await.map_err(|e| format!("Upload failed: {}", e.without_url()))?;
    let status = res.status().as_u16();
    let ok = res.status().is_success();
    let body = read_capped_text(res).await?;

    Ok(HttpResponse { status, ok, body })
}

// ─── http_download ───────────────────────────────────────────────────────────

#[derive(Debug, Deserialize, specta::Type)]
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
#[specta::specta]
pub async fn http_download(args: HttpDownloadArgs, app: tauri::AppHandle) -> Result<u64, String> {
    use std::io::Write;

    let client = transfer_client();
    let mut req = client.get(&args.url);

    if let Some(headers) = &args.headers {
        for pair in headers {
            req = req.header(&pair[0], &pair[1]);
        }
    }

    let mut res = req.send().await.map_err(|e| format!("Download request failed: {}", e.without_url()))?;

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

#[cfg(test)]
mod tests {
    use super::{read_capped_text, MAX_RESPONSE_BYTES};

    /// Собирает `reqwest::Response` из готовых байт, без сети.
    fn ответ(bytes: Vec<u8>) -> reqwest::Response {
        reqwest::Response::from(tauri::http::Response::<reqwest::Body>::new(bytes.into()))
    }

    #[tokio::test]
    async fn нормальный_ответ_читается_целиком() {
        let body = read_capped_text(ответ(b"{\"ok\":1}".to_vec())).await.unwrap();
        assert_eq!(body, "{\"ok\":1}");
    }

    /// Регрессия: тут стоял `res.text()`, читавший сколько пришлют. Плагин с
    /// опечаткой в URL мог утянуть в память гигабайты и уронить всё приложение
    /// вместе с текущей обработкой.
    #[tokio::test]
    async fn ответ_больше_лимита_отвергается() {
        let big = vec![b'x'; MAX_RESPONSE_BYTES + 1];
        let err = read_capped_text(ответ(big)).await.unwrap_err();
        assert!(err.contains("лимит"), "ошибка должна называть лимит: {err}");
        assert!(err.contains("http_download"), "ошибка должна подсказывать выход: {err}");
    }

    /// Вторая, независимая линия обороны: сервер САМ объявил размер — отказываем
    /// не начав читать. Мутационная проверка показала, что тест выше ловится
    /// потоковым счётчиком, то есть без этого теста ранний отказ не покрыт ничем.
    #[test]
    fn объявленный_размер_сверх_лимита_отвергается() {
        assert!(super::declared_too_big(Some(MAX_RESPONSE_BYTES as u64 + 1))
            .unwrap()
            .contains("слишком большой"));
        assert!(super::declared_too_big(Some(MAX_RESPONSE_BYTES as u64)).is_none());
        // Сервер не сказал размер (chunked) — не повод отказывать: дальше считает
        // потоковый счётчик.
        assert!(super::declared_too_big(None).is_none());
    }

    #[tokio::test]
    async fn ровно_на_границе_проходит() {
        let edge = vec![b'y'; MAX_RESPONSE_BYTES];
        assert_eq!(read_capped_text(ответ(edge)).await.unwrap().len(), MAX_RESPONSE_BYTES);
    }

    /// Не-UTF-8 (VK умеет windows-1251) должен отдаваться испорченным, но
    /// отдаваться — прежний `res.text()` вёл себя так же, ошибкой это не было.
    #[tokio::test]
    async fn не_utf8_не_становится_ошибкой() {
        let body = read_capped_text(ответ(vec![0xff, 0xfe, b'a'])).await.unwrap();
        assert!(body.contains('a'));
    }
}
