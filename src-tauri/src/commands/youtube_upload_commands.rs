// YouTube upload (videos.insert, resumable) — Модель B.
//
// access_token приходит свежим (youtube_get_access_token). Метаданные — из ноды autoPostYT.
// privacyStatus всегда шлём 'public' (по умолчанию из ноды); до аудита проекта пользователя
// Google молча залочит видео в private (см. ideasAndTest/YOUTUBE_AUTOPOST_PLAN.md).
//
// MVP: файл читается целиком и отправляется одним PUT. Для больших файлов позже — чанки/резюм.

use serde_json::{json, Value};

const INIT_ENDPOINT: &str =
    "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status";

/// Метаданные видео из ноды. camelCase — как в TS-биндингах.
#[derive(serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct YtVideoMeta {
    pub title: String,
    pub description: Option<String>,
    pub tags: Option<Vec<String>>,
    pub category_id: Option<String>,
    pub privacy_status: Option<String>,
    pub made_for_kids: Option<bool>,
}

/// Загрузить видео на канал (resumable). Возвращает `{ videoId, url }`.
#[tauri::command]
#[specta::specta]
pub async fn youtube_upload_video(
    access_token: String,
    file_path: String,
    meta: YtVideoMeta,
) -> Result<Value, String> {
    // Читаем файл (MVP: целиком в память — для короткого видео ок).
    let bytes = tokio::fs::read(&file_path)
        .await
        .map_err(|e| format!("read {}: {}", file_path, e))?;
    let size = bytes.len();

    let snippet_status = json!({
        "snippet": {
            "title": meta.title,
            "description": meta.description.unwrap_or_default(),
            "tags": meta.tags.unwrap_or_default(),
            "categoryId": meta.category_id.unwrap_or_else(|| "22".into()),
        },
        "status": {
            "privacyStatus": meta.privacy_status.unwrap_or_else(|| "public".into()),
            "selfDeclaredMadeForKids": meta.made_for_kids.unwrap_or(false),
        }
    });

    // Заливка видео: профиль transfer — многогигабайтный файл едет долго и законно,
    // полный таймаут его бы обрубил. Ограничиваем простой, а не общее время.
    let client = super::http_client::transfer();

    // 1) Инициировать resumable-сессию → upload URL в заголовке Location.
    let init = client
        .post(INIT_ENDPOINT)
        .bearer_auth(&access_token)
        .header("X-Upload-Content-Type", "video/*")
        .header("X-Upload-Content-Length", size.to_string())
        .json(&snippet_status)
        .send()
        .await
        .map_err(|e| format!("init upload: {}", e))?;
    if !init.status().is_success() {
        let st = init.status();
        let t = init.text().await.unwrap_or_default();
        return Err(format!("init upload {}: {}", st, t));
    }
    let upload_url = init
        .headers()
        .get("location")
        .and_then(|v| v.to_str().ok())
        .ok_or("нет Location (upload URL) в ответе инициализации")?
        .to_string();

    // 2) Залить байты одним PUT.
    let put = client
        .put(&upload_url)
        .bearer_auth(&access_token)
        .header("Content-Type", "video/*")
        .body(bytes)
        .send()
        .await
        .map_err(|e| format!("upload bytes: {}", e))?;
    let st = put.status();
    let text = put.text().await.map_err(|e| format!("read upload resp: {}", e))?;
    if !st.is_success() {
        return Err(format!("upload {}: {}", st, text));
    }

    let v: Value = serde_json::from_str(&text)
        .map_err(|e| format!("parse upload resp: {} ({})", e, text))?;
    let video_id = v.get("id").and_then(|x| x.as_str()).unwrap_or("").to_string();
    if video_id.is_empty() {
        return Err(format!("нет id видео в ответе: {}", text));
    }
    Ok(json!({ "videoId": video_id, "url": format!("https://youtu.be/{}", video_id) }))
}

/// Поставить кастомную обложку на видео (`thumbnails.set`, scope youtube.upload). Вызывается
/// ПОСЛЕ загрузки (нужен video_id). Требование YouTube: канал должен быть подтверждён по
/// телефону, иначе метод вернёт ошибку (обложка не поставится, но само видео уже залито).
#[tauri::command]
#[specta::specta]
pub async fn youtube_set_thumbnail(
    access_token: String,
    video_id: String,
    image_path: String,
) -> Result<Value, String> {
    let bytes = tokio::fs::read(&image_path)
        .await
        .map_err(|e| format!("read image {}: {}", image_path, e))?;
    let lower = image_path.to_lowercase();
    let content_type = if lower.ends_with(".png") { "image/png" } else { "image/jpeg" };

    let url = format!(
        "https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId={}",
        video_id
    );
    let res = super::http_client::transfer()
        .post(&url)
        .bearer_auth(&access_token)
        .header("Content-Type", content_type)
        .body(bytes)
        .send()
        .await
        .map_err(|e| format!("thumbnail request: {}", e))?;
    let st = res.status();
    let text = res.text().await.map_err(|e| format!("read thumbnail resp: {}", e))?;
    if !st.is_success() {
        return Err(format!("set thumbnail {}: {}", st, text));
    }
    Ok(json!({ "ok": true }))
}
