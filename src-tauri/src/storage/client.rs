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

/// Кто спрашивает очередь. Ссылками, а не владением: зовётся часто, а строки
/// живут в `crate::machine` весь процесс.
#[derive(Debug, Clone, Copy)]
pub struct MachineRef<'a> {
    pub uuid: &'a str,
    pub hostname: &'a str,
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

    /// Сырой запрос: статус и тело без разбора.
    ///
    /// Отдельно от `send`, потому что у одного эндпоинта неуспешный статус — часть
    /// протокола, а не сбой: `PUT /settings` отвечает 409 с ТЕЛОМ (текущий документ),
    /// и это тело нужно для слияния. Всем остальным достаточно `send`.
    async fn request_text(
        &self,
        method: Method,
        path: &str,
        query: &[(&str, String)],
        body: Option<serde_json::Value>,
    ) -> StorageResult<(StatusCode, String)> {
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

        Ok((status, text))
    }

    async fn send<T: serde::de::DeserializeOwned>(
        &self,
        method: Method,
        path: &str,
        query: &[(&str, String)],
        body: Option<serde_json::Value>,
    ) -> StorageResult<T> {
        let (status, text) = self.request_text(method, path, query, body).await?;

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

    /// Прочитать сайдкар. `Ok(None)` — файла ещё нет, это нормальное состояние:
    /// нетронутый проект `options/` не имеет вовсе.
    pub async fn sidecar_get(
        &self,
        project_id: &str,
        which: Sidecar,
    ) -> StorageResult<Option<String>> {
        let q = [
            ("projectId", project_id.to_string()),
            ("name", which.api_name().to_string()),
        ];
        match self
            .send::<SidecarBody>(Method::GET, "sidecars", &q, None)
            .await
        {
            Ok(r) => Ok(Some(r.body)),
            // 404 — «ещё не создан», а не отказ. Отличать обязательно: иначе первый
            // же нетронутый проект выглядел бы как сломанная связь с бэкендом.
            Err(StorageError::NotFound(_)) => Ok(None),
            Err(e) => Err(e),
        }
    }

    /// Записать сайдкар целиком (`kind: "raw"`).
    ///
    /// Именно этот вызов кладёт файл по каноническому ключу, который читает сайт.
    /// Обычная заливка (`presign` → `PUT` → `notify`) для этих трёх имён не годится:
    /// бэкенд выпишет физический ключ с uuid, и сайт файла не увидит.
    ///
    /// `if_match` — оптимистичная блокировка по etag предыдущей версии. `None` =
    /// «пишу поверх», бэкенд ответит 409 только если сам этого захочет.
    pub async fn sidecar_put(
        &self,
        project_id: &str,
        which: Sidecar,
        body: &str,
        if_match: Option<&str>,
    ) -> StorageResult<Option<String>> {
        let mut payload = json!({
            "kind": "raw",
            "projectId": project_id,
            "sidecar": which.api_name(),
            "body": body,
        });
        if let Some(tag) = if_match {
            payload["ifMatch"] = json!(tag);
        }
        let r: SidecarPutResult = self
            .send(Method::PUT, "sidecars", &[], Some(payload))
            .await?;
        Ok(r.etag)
    }

    /// Одна страница журнала (до 5000 событий). Цикл до догона — уровнем выше.
    pub async fn delta(&self, project_id: &str, since: i64) -> StorageResult<DeltaResponse> {
        let q = [
            ("projectId", project_id.to_string()),
            ("since", since.to_string()),
        ];
        self.send(Method::GET, "delta", &q, None).await
    }

    // ─── Общие словари ───────────────────────────────────────────────────────

    /// Прочитать словари. Пустой список доменов — все.
    pub async fn settings_get(&self, domains: &[String]) -> StorageResult<SettingsDocument> {
        let q: Vec<(&str, String)> = if domains.is_empty() {
            vec![]
        } else {
            vec![("domains", domains.join(","))]
        };
        self.send(Method::GET, "settings", &q, None).await
    }

    /// Записать словари от известной ревизии.
    ///
    /// 409 сюда доезжает результатом, а не ошибкой: в теле лежит текущий документ
    /// сервера, и без него клиенту пришлось бы делать ещё один запрос — и сливать
    /// уже с третьей, снова успевшей устареть версией.
    pub async fn settings_put(
        &self,
        base_revision: i64,
        domains: serde_json::Value,
    ) -> StorageResult<SettingsPutResult> {
        let body = json!({ "baseRevision": base_revision, "domains": domains });
        let (status, text) = self
            .request_text(Method::PUT, "settings", &[], Some(body))
            .await?;

        if status == StatusCode::CONFLICT {
            let document: SettingsDocument = serde_json::from_str(&text).map_err(|e| {
                StorageError::Other(format!(
                    "Не разобран 409 settings: {e}. Тело: {}",
                    truncate(&text, 300)
                ))
            })?;
            return Ok(SettingsPutResult {
                conflict: true,
                document,
            });
        }

        if !status.is_success() {
            return Err(map_status(status, &text));
        }

        let document: SettingsDocument = serde_json::from_str(&text).map_err(|e| {
            StorageError::Other(format!(
                "Не разобран ответ settings: {e}. Тело: {}",
                truncate(&text, 300)
            ))
        })?;
        Ok(SettingsPutResult {
            conflict: false,
            document,
        })
    }

    // ─── Очередь задач ───────────────────────────────────────────────────────
    //
    // Одна ручка `queue` с полем `action`, а не пять путей — так сделано на сайте.
    // Идентичность машины едет в каждом запросе (`machineUuid` + `hostname`): наш
    // токен не привязан к компьютеру, и сайт по этому uuid сам заводит машине строку.
    // Второй токен (`rc_…`) поэтому не нужен.
    //
    // Транспорт живёт здесь, а не в плагине, по одной причине: токен хранится в Rust
    // и в renderer не отдаётся (`ConnectionConfig::redacted`). Плагин зовёт эти
    // команды через `ctx.invoke`.

    async fn queue_call<T: serde::de::DeserializeOwned>(
        &self,
        action: &str,
        machine: &MachineRef<'_>,
        mut props: serde_json::Value,
    ) -> StorageResult<T> {
        props["action"] = json!(action);
        props["machineUuid"] = json!(machine.uuid);
        props["hostname"] = json!(machine.hostname);
        self.send(Method::POST, "queue", &[], Some(props)).await
    }

    /// «Я на связи» без запроса задачи. Возвращает ревизию сейфа вендорских ключей.
    ///
    /// Нужен отдельно от `claim`, иначе состояние «машина включена, воркер выключен»
    /// сайту не видно вовсе: он слышит нас только когда воркер спрашивает задачу.
    ///
    /// Ревизия едет попутным полем каждого удара сердца — по тому же приёму, что
    /// `settingsRevision` в `/delta`: отдельный опрос сейфа по расписанию стоил бы
    /// запроса на каждую машину каждые полминуты ради числа, которое почти никогда
    /// не меняется.
    pub async fn queue_ping(&self, machine: &MachineRef<'_>) -> StorageResult<i64> {
        let r: QueuePingResponse = self.queue_call("ping", machine, json!({})).await?;
        Ok(r.vault_revision)
    }

    /// Взять следующую задачу. `None` — очередь пуста, это норма.
    pub async fn queue_claim(&self, machine: &MachineRef<'_>) -> StorageResult<Option<QueueTask>> {
        let r: QueueClaimResponse = self.queue_call("claim", machine, json!({})).await?;
        Ok(r.task)
    }

    /// Двинуть шаг и продлить аренду.
    pub async fn queue_progress(
        &self,
        machine: &MachineRef<'_>,
        task_id: &str,
        step_id: &str,
        status: QueueStepStatus,
        message: Option<&str>,
    ) -> StorageResult<()> {
        let _: serde_json::Value = self
            .queue_call(
                "progress",
                machine,
                json!({ "taskId": task_id, "stepId": step_id, "status": status, "message": message }),
            )
            .await?;
        Ok(())
    }

    pub async fn queue_done(
        &self,
        machine: &MachineRef<'_>,
        task_id: &str,
        out_files: Vec<String>,
        total_cost: f64,
    ) -> StorageResult<()> {
        let _: serde_json::Value = self
            .queue_call(
                "done",
                machine,
                json!({ "taskId": task_id, "outFiles": out_files, "totalCost": total_cost }),
            )
            .await?;
        Ok(())
    }

    pub async fn queue_failed(
        &self,
        machine: &MachineRef<'_>,
        task_id: &str,
        error: &str,
    ) -> StorageResult<()> {
        let _: serde_json::Value = self
            .queue_call("failed", machine, json!({ "taskId": task_id, "error": error }))
            .await?;
        Ok(())
    }

    // ─── Сейф вендорских ключей ──────────────────────────────────────────────
    //
    // Одна ручка `vault` с полем `action`, как у очереди. Токен тот же (`mch_…`):
    // машина и есть устройство, второй заводить не надо.

    /// Ключи под текущие задачи.
    ///
    /// `known` — что уже лежит в сейфе: ключ `слаг/метка` (или просто `слаг`) →
    /// пара «учётка + версия». Не одна версия на сервис: у каждой учётки нумерация
    /// своя, и `v3` у `main` совпал бы с `v3` у `test`, подтвердив чужой ключ.
    ///
    /// Метку в запросе не называем: сайт присылает ВСЕ доступные машине учётки
    /// сервиса (наши плюс учётку владельца задачи), а какую взять — решает метка в
    /// поле проекта. Иначе не собрать флоу: прогнать локально тестовым ключом и
    /// отправить в работу основным.
    ///
    /// `task_id` нужен, чтобы выдали учётку ВЛАДЕЛЬЦА задачи: проект пользователя А
    /// на воркере парка должен работать ключом А, а не нашим.
    pub async fn vault_keys(
        &self,
        services: &[String],
        known: &std::collections::BTreeMap<String, VendorKnownKey>,
        task_id: Option<&str>,
    ) -> StorageResult<VendorKeysResponse> {
        let mut body = json!({ "action": "keys", "services": services, "known": known });
        if let Some(id) = task_id {
            body["taskId"] = json!(id);
        }
        self.send(Method::POST, "vault", &[], Some(body)).await
    }

    /// Отчёт о потреблении в ЕДИНИЦАХ.
    ///
    /// Шлётся сразу после ответа вендора, не дожидаясь конца задачи: вендор уже
    /// получил свои деньги, и упади машина следом — расход всё равно должен быть
    /// учтён.
    pub async fn vault_usage(
        &self,
        task_id: &str,
        project_id: Option<&str>,
        entries: &[VendorUsageEntry],
    ) -> StorageResult<VendorUsageResult> {
        self.send(
            Method::POST,
            "vault",
            &[],
            Some(json!({
                "action": "usage",
                "taskId": task_id,
                "projectId": project_id,
                "entries": entries,
            })),
        )
        .await
    }

    /// Вернуть задачу в очередь — аварийный стоп, не дожидаясь протухания аренды.
    pub async fn queue_release(&self, machine: &MachineRef<'_>, task_id: &str) -> StorageResult<()> {
        let _: serde_json::Value = self
            .queue_call("release", machine, json!({ "taskId": task_id }))
            .await?;
        Ok(())
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
    /// Колонка в БД есть, её пишет сайт, и она приезжает в каждом `/projects`.
    ///
    /// Эндпоинт `project-state` (просьба 5.1) на проде, судя по данным, уже появился:
    /// после локального переключения `projects.updated_at` в каталоге сдвигается через
    /// доли секунды после нашей записи. Если он всё же ответит 404/405, переключение
    /// упадёт с ошибкой — молча в индекс мы её не пишем (порядок: сперва бэкенд).
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
