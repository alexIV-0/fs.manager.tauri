// HTTP-клиент storage-бэкенда. Тонкий слой: один метод — один эндпоинт.
//
// Намеренно НЕ делает: ретраев, пагинации дельт, кэширования, решений о том,
// что качать. Всё это выше — в слое синхронизации. Причина в том, что этот
// слой единственный, который может потребовать правок после первого реального
// запроса к живому бэкенду; чем он тоньше, тем меньше расползутся правки.
//
// Байты через этот клиент НЕ идут: он только получает подписанные ссылки.
// Скачивание и заливка — прямо в R2, см. transfer-слой.

use reqwest::{Method, StatusCode};
use serde::Serialize;
use serde_json::json;

use super::types::*;

/// Адрес и токен. Токен — machine token (`mch_…`), непривязанный к проекту:
/// у привязанного `scopedProjectId` проверяется РАНЬШЕ роли и не пустит даже админа.
#[derive(Debug, Clone)]
pub struct StorageConfig {
    pub base_url: String,
    pub token: String,
}

impl StorageConfig {
    pub fn is_configured(&self) -> bool {
        !self.base_url.trim().is_empty() && !self.token.trim().is_empty()
    }
}

#[derive(Debug, Clone)]
pub struct StorageApi {
    cfg: StorageConfig,
    http: reqwest::Client,
}

impl StorageApi {
    pub fn new(cfg: StorageConfig) -> Self {
        Self {
            cfg,
            http: reqwest::Client::new(),
        }
    }

    /// `https://host` → `https://host/api/storage/v1/<path>`
    fn url(&self, path: &str) -> String {
        format!(
            "{}/api/storage/v1/{}",
            self.cfg.base_url.trim_end_matches('/'),
            path.trim_start_matches('/')
        )
    }

    async fn send<T: serde::de::DeserializeOwned>(
        &self,
        method: Method,
        path: &str,
        query: &[(&str, String)],
        body: Option<serde_json::Value>,
    ) -> StorageResult<T> {
        if !self.cfg.is_configured() {
            return Err(StorageError::NotConfigured(
                "Не задан адрес сайта или machine token".into(),
            ));
        }

        let mut req = self
            .http
            .request(method, self.url(path))
            .bearer_auth(&self.cfg.token);

        if !query.is_empty() {
            req = req.query(query);
        }
        if let Some(b) = body {
            req = req.json(&b);
        }

        let res = req
            .send()
            .await
            .map_err(|e| StorageError::Network(e.to_string()))?;

        let status = res.status();
        let text = res
            .text()
            .await
            .map_err(|e| StorageError::Network(e.to_string()))?;

        if !status.is_success() {
            return Err(map_status(status, &text));
        }

        serde_json::from_str::<T>(&text).map_err(|e| {
            // Не сетевая ошибка и не отказ: контракт разошёлся с нашими типами.
            // Кусок тела в сообщении экономит час отладки.
            StorageError::Other(format!(
                "Не разобран ответ {}: {e}. Тело: {}",
                path,
                truncate(&text, 300)
            ))
        })
    }

    // ─── Чтение ──────────────────────────────────────────────────────────────

    /// Что бэкенд умеет прямо сейчас. Зовём при подключении; по флагам гасим UI.
    pub async fn capabilities(&self) -> StorageResult<Capabilities> {
        self.send(Method::GET, "capabilities", &[], None).await
    }

    /// Клиенты и проекты, видимые токену. Без этого вызова остальное бесполезно:
    /// `/tree` и `/delta` требуют `projectId`, а взять его больше неоткуда.
    pub async fn projects(&self) -> StorageResult<ProjectsResponse> {
        self.send(Method::GET, "projects", &[], None).await
    }

    /// Полное поддерево + курсор. Bootstrap индекса, а также фолбэк при `truncated`.
    pub async fn tree(&self, project_id: &str, prefix: Option<&str>) -> StorageResult<TreeResponse> {
        let mut q = vec![("projectId", project_id.to_string())];
        if let Some(p) = prefix {
            q.push(("prefix", p.to_string()));
        }
        self.send(Method::GET, "tree", &q, None).await
    }

    /// Одна страница журнала (до 5000 событий). Цикл до догона — уровнем выше.
    pub async fn delta(&self, project_id: &str, since: i64) -> StorageResult<DeltaResponse> {
        let q = [
            ("projectId", project_id.to_string()),
            ("since", since.to_string()),
        ];
        self.send(Method::GET, "delta", &q, None).await
    }

    // ─── Подписанные ссылки ──────────────────────────────────────────────────

    /// Ссылка на скачивание конкретного объекта.
    pub async fn presign_get(
        &self,
        project_id: &str,
        s3_key: &str,
        ttl_sec: Option<i64>,
    ) -> StorageResult<PresignResponse> {
        let mut body = json!({
            "projectId": project_id,
            "method": "GET",
            "s3Key": s3_key,
        });
        if let Some(ttl) = ttl_sec {
            body["ttlSec"] = json!(ttl);
        }
        self.send(Method::POST, "presign", &[], Some(body)).await
    }

    /// Ссылка на заливку. Ключ назначает бэкенд — мы его не выбираем и не угадываем.
    ///
    /// ВНИМАНИЕ: ссылка живёт ~час. Запрашивать в момент старта передачи, иначе
    /// на длинной очереди хвост протухнет.
    /// Подписанный PUT.
    ///
    /// `s3_key` — ключ УЖЕ существующего объекта, если мы перезаливаем известный
    /// файл. Это не оптимизация, а обязательное условие: без него бэкенд каждый раз
    /// выписывает НОВЫЙ ключ `{uuid}-{имя}`, и перерендер в тот же логический путь
    /// даёт вторую строку в каталоге с тем же именем плюс осиротевший объект в R2.
    /// С ключом `/notify` находит строку по `s3_key` и обновляет её — `file_id`
    /// сохраняется, история файла не рвётся.
    #[allow(clippy::too_many_arguments)]
    pub async fn presign_put(
        &self,
        project_id: &str,
        folder_path: &str,
        file_name: &str,
        content_type: &str,
        ttl_sec: Option<i64>,
        s3_key: Option<&str>,
    ) -> StorageResult<PresignResponse> {
        let mut body = json!({
            "projectId": project_id,
            "method": "PUT",
            "folderPath": folder_path,
            "fileName": file_name,
            "contentType": content_type,
        });
        if let Some(ttl) = ttl_sec {
            body["ttlSec"] = json!(ttl);
        }
        if let Some(key) = s3_key {
            body["s3Key"] = json!(key);
        }
        self.send(Method::POST, "presign", &[], Some(body)).await
    }

    // ─── Мутации ─────────────────────────────────────────────────────────────

    /// Подтверждение заливки. **Обязательно после успешного PUT** — без него
    /// бэкенд про файл не знает, и сайт его не увидит.
    #[allow(clippy::too_many_arguments)]
    pub async fn notify(&self, args: NotifyArgs<'_>) -> StorageResult<ProjectFile> {
        let mut body = json!({
            "projectId": args.project_id,
            "s3Key": args.s3_key,
            "fileName": args.file_name,
            "folderPath": args.folder_path,
        });
        if let Some(v) = args.size_bytes {
            body["sizeBytes"] = json!(v);
        }
        if let Some(v) = args.content_type {
            body["contentType"] = json!(v);
        }
        if let Some(v) = args.origin_mtime {
            body["originMtime"] = json!(v);
        }
        if let Some(v) = args.content_hash {
            body["contentHash"] = json!(v);
        }
        if let Some(v) = args.event_id {
            body["eventId"] = json!(v);
        }
        let env: FileEnvelope = self.send(Method::POST, "notify", &[], Some(body)).await?;
        Ok(env.file)
    }

    /// Создать логическую папку. Объекта в R2 не появится — папки живут в Postgres.
    /// Имя `options` зарезервировано бэкендом (403).
    // Ниже — эндпоинты контракта, которые реализованы, но интерфейсом пока не
    // вызываются (создание папки на сервере, переименование, удаление, реиндекс).
    // Удалять их значит писать заново при первом же обращении к бэкенду.
    #[allow(dead_code)]
    pub async fn mkdir(
        &self,
        project_id: &str,
        folder_path: &str,
        name: &str,
        event_id: Option<&str>,
    ) -> StorageResult<ProjectFile> {
        let mut body = json!({
            "projectId": project_id,
            "folderPath": folder_path,
            "name": name,
        });
        if let Some(v) = event_id {
            body["eventId"] = json!(v);
        }
        let env: FileEnvelope = self.send(Method::POST, "mkdir", &[], Some(body)).await?;
        Ok(env.file)
    }

    /// Переименование и перенос — одна операция.
    ///
    /// Дёшево до неприличия: `s3_key` не трогается, файл это `UPDATE name/folder_path`,
    /// папка — один `UPDATE` со `substr` по всем потомкам. Переименовать папку с
    /// 500 ГБ внутри = один SQL-запрос, ноль операций в R2.
    #[allow(dead_code)]
    pub async fn rename(
        &self,
        project_id: &str,
        file_id: &str,
        new_name: Option<&str>,
        new_folder_path: Option<&str>,
        event_id: Option<&str>,
    ) -> StorageResult<ProjectFile> {
        let mut body = json!({ "projectId": project_id, "fileId": file_id });
        if let Some(v) = new_name {
            body["name"] = json!(v);
        }
        if let Some(v) = new_folder_path {
            body["folderPath"] = json!(v);
        }
        if let Some(v) = event_id {
            body["eventId"] = json!(v);
        }
        let env: FileEnvelope = self.send(Method::POST, "rename", &[], Some(body)).await?;
        Ok(env.file)
    }

    /// Переименовать ПРОЕКТ. Имя живёт в `projects.name`, ключи в бакете от него не
    /// зависят — для бэкенда это один `UPDATE`.
    ///
    /// Эндпоинта под machine token пока нет (просьба 5): клиент готов заранее, чтобы
    /// после правки бэкенда ничего не переписывать. До тех пор вернётся 404, и
    /// интерфейс покажет его как понятную ошибку.
    pub async fn rename_project(&self, project_id: &str, name: &str) -> StorageResult<()> {
        let body = json!({ "projectId": project_id, "name": name });
        let _: serde_json::Value = self
            .send(Method::POST, "project-rename", &[], Some(body))
            .await?;
        Ok(())
    }

    /// Включить/выключить проект (`projects.is_paused`).
    ///
    /// Колонка в БД уже есть — её пишет сайт, и она приезжает в каждом `/projects`.
    /// Не хватает только эндпоинта под machine token (просьба 5.1): без него
    /// направление «выключил в программе → выключилось на сайте» не работает, хотя
    /// обратное работает уже сегодня.
    pub async fn set_project_paused(&self, project_id: &str, paused: bool) -> StorageResult<()> {
        let body = json!({ "projectId": project_id, "paused": paused });
        let _: serde_json::Value = self
            .send(Method::POST, "project-state", &[], Some(body))
            .await?;
        Ok(())
    }

    /// Удаление файла или папки (каскадом). `options` — 403.
    #[allow(dead_code)]
    pub async fn delete(
        &self,
        project_id: &str,
        file_id: &str,
        event_id: Option<&str>,
    ) -> StorageResult<Vec<String>> {
        let mut body = json!({ "projectId": project_id, "fileId": file_id });
        if let Some(v) = event_id {
            body["eventId"] = json!(v);
        }

        #[derive(serde::Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Resp {
            #[serde(default)]
            deleted_s3_keys: Vec<String>,
        }

        let r: Resp = self.send(Method::DELETE, "object", &[], Some(body)).await?;
        Ok(r.deleted_s3_keys)
    }

    /// Полная сверка каталога с бакетом. Owner-only, до 120 с — зовём вручную,
    /// не по расписанию.
    #[allow(dead_code)]
    pub async fn reindex(&self, project_id: &str) -> StorageResult<serde_json::Value> {
        let body = json!({ "projectId": project_id });
        self.send(Method::POST, "reindex", &[], Some(body)).await
    }
}

/// Аргументы `/notify` — их много, и позиционные легко перепутать местами.
#[derive(Debug, Clone, Serialize)]
pub struct NotifyArgs<'a> {
    pub project_id: &'a str,
    pub s3_key: &'a str,
    pub file_name: &'a str,
    pub folder_path: &'a str,
    pub size_bytes: Option<i64>,
    pub content_type: Option<&'a str>,
    /// Unix seconds. Бэкенд принимает с 2026-08-07.
    pub origin_mtime: Option<i64>,
    /// sha256. Надёжнее `etag`: у multipart-объектов etag перестаёт быть хэшем.
    pub content_hash: Option<&'a str>,
    pub event_id: Option<&'a str>,
}

// ─── Вспомогательное ─────────────────────────────────────────────────────────

fn map_status(status: StatusCode, body: &str) -> StorageError {
    let msg = serde_json::from_str::<ApiErrorBody>(body)
        .ok()
        .and_then(|b| b.message)
        .unwrap_or_else(|| truncate(body, 300));

    match status {
        StatusCode::UNAUTHORIZED => StorageError::Unauthorized(msg),
        StatusCode::FORBIDDEN => StorageError::Forbidden(msg),
        StatusCode::NOT_FOUND => StorageError::NotFound(msg),
        StatusCode::CONFLICT => StorageError::Conflict(msg),
        s => StorageError::Other(format!("HTTP {}: {msg}", s.as_u16())),
    }
}

fn truncate(s: &str, max: usize) -> String {
    let t = s.trim();
    if t.chars().count() <= max {
        return t.to_string();
    }
    t.chars().take(max).collect::<String>() + "…"
}

#[cfg(test)]
mod tests {
    use super::*;

    fn api() -> StorageApi {
        StorageApi::new(StorageConfig {
            base_url: "https://example.test/".into(),
            token: "mch_x".into(),
        })
    }

    #[test]
    fn url_склеивается_без_двойных_слэшей() {
        assert_eq!(
            api().url("tree"),
            "https://example.test/api/storage/v1/tree"
        );
        assert_eq!(
            api().url("/tree"),
            "https://example.test/api/storage/v1/tree"
        );
    }

    #[test]
    fn ненастроенный_конфиг_виден_сразу() {
        let cfg = StorageConfig {
            base_url: "".into(),
            token: "".into(),
        };
        assert!(!cfg.is_configured());
    }

    #[test]
    fn статусы_раскладываются_по_смыслу() {
        let e = map_status(StatusCode::FORBIDDEN, r#"{"message":"Reserved name."}"#);
        assert!(matches!(e, StorageError::Forbidden(m) if m == "Reserved name."));

        // Тело не JSON — сообщение всё равно должно быть человекочитаемым.
        let e = map_status(StatusCode::INTERNAL_SERVER_ERROR, "<html>oops</html>");
        assert!(matches!(e, StorageError::Other(m) if m.contains("500")));
    }
}
