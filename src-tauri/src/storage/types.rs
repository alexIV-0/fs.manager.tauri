// Типы контракта storage-бэкенда (`innovation-hub`, /api/storage/v1).
//
// Формы взяты из реального кода роутов, не из документации:
//   app/api/storage/v1/{tree,delta,presign,notify,projects,capabilities,rename,mkdir,object}/route.ts
//
// ВАЖНО про идентичность (см. ideasAndTest/R2_SYNC_PLAN.md, разделы 4–5):
//   • `id` (file_id) — СТАБИЛЕН через переименования и переносы. Это наш ключ везде.
//   • `s3_key` — НЕПРОЗРАЧНЫЙ (`{uuid}-{safeName}`), логический путь из него не выводится.
//     Локальный путь строим из `folder_path` + `name`, иначе на диске появятся папки
//     вида `a3f9c1-clip.mov`.
//   • Папки (`is_folder = true`) существуют только строками в Postgres, объекта в R2 нет.

use serde::{Deserialize, Serialize};

// ─── Capabilities ────────────────────────────────────────────────────────────

/// `GET /capabilities` — что бэкенд умеет прямо сейчас.
/// Хардкодить флаги нельзя: они меняются его релизами, а не нашими.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct Capabilities {
    pub api_version: i64,
    pub multipart: bool,
    pub rename: bool,
    pub copy: bool,
    pub sharing: bool,
    #[serde(default)]
    pub clients: bool,
    #[serde(default)]
    pub origin_mtime: bool,
    #[serde(default)]
    pub content_hash: bool,
}

impl Default for Capabilities {
    /// Пессимистичный дефолт: пока не спросили бэкенд — не умеем ничего.
    /// Так UI не покажет кнопку, которая упадёт.
    fn default() -> Self {
        Self {
            api_version: 1,
            multipart: false,
            rename: false,
            copy: false,
            sharing: false,
            clients: false,
            origin_mtime: false,
            content_hash: false,
        }
    }
}

// ─── Клиенты и проекты ───────────────────────────────────────────────────────

/// Клиент — верхний уровень иерархии. Живёт только в Postgres:
/// в раскладке ключей R2 его нет, поэтому переименование бесплатно.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RemoteClient {
    pub id: String,
    pub display_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RemoteProject {
    pub id: String,
    pub name: String,
    /// `None` — проект не привязан к клиенту (лежит в корне).
    pub client_id: Option<String>,
    /// Владелец проекта — **первый уровень зеркала**.
    ///
    /// Раскладка бакета `projects/{userId}/{projectId}/…`, то есть уровень
    /// пользователя в данных есть всегда. А вот в ответе `/projects` его пока нет
    /// (`serializeProject` не кладёт `userId`, хотя рядом им же проверяет права) —
    /// поэтому поле опциональное, и пока бэкенд молчит, владелец добывается из
    /// `s3Key` первого же файла проекта. Появится в ответе — возьмём оттуда, код
    /// менять не придётся.
    #[serde(default)]
    pub user_id: Option<String>,
    pub group_name: String,
    pub is_active: bool,
    pub is_paused: bool,
    /// Проект убран в архив на сайте — **обработку по нему запускать нельзя**.
    ///
    /// Три флага рядом, и путать их нельзя (`STORAGE_API.md`, «Processing flags»):
    /// `is_paused` — пользователь приостановил, `is_active` — legacy-зеркало
    /// `!is_paused`, `is_archived` — проект уехал в архив. Архивность живёт именно
    /// здесь, а не в `group_name`: группа отвечает только за раскладку интерфейса
    /// сайта.
    #[serde(default)]
    pub is_archived: bool,
    /// Когда заархивировали. ISO-8601; `None` — не архивный.
    #[serde(default)]
    pub archived_at: Option<String>,
    /// ISO-8601.
    pub updated_at: String,
}

/// Владелец проектов. Приходит из `/projects`, когда бэкенд научится отдавать; до
/// тех пор существует только как идентификатор, добытый из ключа.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RemoteUser {
    pub id: String,
    /// **Основное имя папки владельца.** Email узнаваем и уникален, в отличие от
    /// `full_name`, который бывает пустым и повторяется.
    #[serde(default)]
    pub email: String,
    #[serde(default)]
    pub full_name: String,
    /// Общий вариант, если бэкенд отдаёт одно готовое имя вместо полей.
    #[serde(default)]
    pub display_name: String,
}

impl RemoteUser {
    /// Чем подписывать папку. Пусто — значит про владельца известен только id.
    pub fn label(&self) -> &str {
        for candidate in [&self.email, &self.full_name, &self.display_name] {
            if !candidate.trim().is_empty() {
                return candidate;
            }
        }
        ""
    }
}

/// Ответ `GET /projects`. Под ADMIN-токеном — все клиенты и проекты,
/// под scoped-токеном — только его проект.
#[derive(Debug, Clone, Default, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ProjectsResponse {
    #[serde(default)]
    pub clients: Vec<RemoteClient>,
    /// Владельцы проектов. Бэкенд пока не присылает — тогда имена берём из
    /// идентификаторов, добытых из ключей.
    #[serde(default)]
    pub users: Vec<RemoteUser>,
    #[serde(default)]
    pub projects: Vec<RemoteProject>,
}

// ─── Записи дерева ───────────────────────────────────────────────────────────

/// Строка каталога: файл или логическая папка.
/// Приходит из `/tree`; поля `etag`/`content_hash`/`origin_mtime` — то, по чему
/// мы решаем «устарела ли локальная копия» (см. 6.2 плана).
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct TreeEntry {
    pub id: String,
    pub project_id: String,
    /// Логический путь папки-родителя: `"IN"`, `""` — корень проекта.
    pub folder_path: String,
    /// Логическое имя. Именно оно идёт в локальный путь, НЕ `s3_key`.
    pub name: String,
    pub is_folder: bool,
    /// `None` у папок.
    pub s3_key: Option<String>,
    #[serde(default)]
    pub size_bytes: Option<i64>,
    #[serde(default)]
    pub content_type: Option<String>,
    #[serde(default)]
    pub etag: Option<String>,
    #[serde(default)]
    pub content_hash: Option<String>,
    /// Unix seconds. Исходное время файла, если бэкенду его прислали.
    #[serde(default)]
    pub origin_mtime: Option<i64>,
    #[serde(default)]
    pub created_at: Option<String>,
    #[serde(default)]
    pub updated_at: Option<String>,
    #[serde(default)]
    pub last_seq: Option<i64>,
}

/// Ответ `GET /tree`. `cursor` — с него начинаем поллинг дельт.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct TreeResponse {
    #[serde(default)]
    pub entries: Vec<TreeEntry>,
    #[serde(default)]
    pub cursor: i64,
}

// ─── Журнал изменений ────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "lowercase")]
pub enum ChangeOp {
    Put,
    Delete,
}

/// Событие журнала. Переименование приходит парой delete+put с ОДНИМ `file_id` —
/// значит на нашей стороне это локальное переименование, без перекачивания.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct Change {
    pub seq: i64,
    pub op: ChangeOp,
    pub key: String,
    pub project_id: String,
    #[serde(default)]
    pub file_id: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub folder_path: Option<String>,
    #[serde(default)]
    pub is_folder: Option<bool>,
    #[serde(default)]
    pub size: Option<i64>,
    #[serde(default)]
    pub etag: Option<String>,
    #[serde(default)]
    pub content_hash: Option<String>,
    #[serde(default)]
    pub content_type: Option<String>,
    /// Unix seconds.
    #[serde(default)]
    pub event_time: Option<i64>,
}

/// Ответ `GET /delta`. Максимум 5000 событий за вызов — крутить в цикле,
/// пока `cursor` растёт. `truncated = true` → курсор старше окна хранения
/// журнала (~90 дней): выбросить локальный индекс и сделать полный `/tree`.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct DeltaResponse {
    #[serde(default)]
    pub changes: Vec<Change>,
    #[serde(default)]
    pub cursor: i64,
    #[serde(default)]
    pub truncated: bool,
}

// ─── Очередь задач ───────────────────────────────────────────────────────────

/// Задача из очереди сайта (`POST /api/storage/v1/queue`, action `claim`).
///
/// Ни путей, ни ссылок здесь нет намеренно: presigned URL живёт минуты, а задача
/// может простоять в очереди часы и переретраиться завтра. В `payload` лежит
/// идентичность файла — превращает её в локальный путь машина.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct QueueTask {
    pub id: String,
    pub project_id: String,
    #[serde(default)]
    pub project_name: String,
    #[serde(default)]
    pub owner_email: String,
    /// Собранный сайтом объект обработки: `processingQueue`, шаги, `description`.
    pub payload: serde_json::Value,
    #[serde(default)]
    pub attempts: i64,
    #[serde(default)]
    pub max_attempts: i64,
    /// До какого момента задача числится за этой машиной.
    #[serde(default)]
    pub lease_expires_at: Option<String>,
}

/// Ответ `claim`. `task: None` — очередь пуста; это штатный ответ, а не ошибка:
/// машина спрашивает на каждом пульсе и почти всегда получает именно его.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct QueueClaimResponse {
    #[serde(default)]
    pub task: Option<QueueTask>,
}

/// Статус шага в `progress`.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "lowercase")]
pub enum QueueStepStatus {
    Running,
    Done,
    Error,
}

// ─── Presign ─────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "UPPERCASE")]
#[allow(dead_code)]
pub enum PresignMethod {
    Put,
    Get,
}

/// Ответ `POST /presign`. Ссылка живёт `expires_in` секунд (по умолчанию час),
/// поэтому запрашивать её надо В МОМЕНТ старта передачи, а не пачкой заранее.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PresignResponse {
    pub url: String,
    pub s3_key: String,
    #[serde(default)]
    pub file_name: Option<String>,
    #[serde(default)]
    pub folder_path: Option<String>,
    #[serde(default)]
    pub content_type: Option<String>,
    #[serde(default)]
    pub expires_in: Option<i64>,
}

// ─── Файл после мутации ──────────────────────────────────────────────────────

/// Что возвращают `/notify`, `/mkdir`, `/rename`.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ProjectFile {
    pub id: String,
    pub project_id: String,
    pub folder_path: String,
    pub name: String,
    pub is_folder: bool,
    #[serde(default)]
    pub s3_key: Option<String>,
    #[serde(default)]
    pub size_bytes: Option<i64>,
    #[serde(default)]
    pub content_type: Option<String>,
    #[serde(default)]
    pub created_at: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub(crate) struct FileEnvelope {
    pub file: ProjectFile,
}

// ─── Сайдкары: служебные JSON-ы проекта ──────────────────────────────────────

/// Три служебных файла в `options/`, которые живут НЕ по правилам обычных файлов.
///
/// Разница принципиальная, и на ней мы один раз обожглись (см. раздел 12
/// `STORAGE_CLIENT_REQUESTS.md`). Обычный файл едет `presign` → `PUT` → `notify`, и
/// ключ ему выписывает бэкенд — физический, с uuid: `options/{uuid}-folderState.json`.
/// А сайт читает эти три файла по ФИКСИРОВАННОМУ ключу (`projectFolderStateKey`,
/// `projectOptionsKey`, `projectDescriptionKey`). То есть залитый обычным путём
/// `folderState.json` ложился рядом с тем, который сайт читает, и **сайт наших
/// настроек не видел никогда**, а мы не видели его правок.
///
/// Поэтому здесь отдельный канал — `PUT/GET /sidecars`: он пишет ровно в
/// канонический ключ. Строки в каталоге (`project_files`) у сайдкаров нет, значит
/// нет ни `file_id`, ни значка синхронизации, ни дельт с `fileId` — событие в
/// журнале приходит без него, и это наш сигнал «сайт тронул сайдкар, подтяни».
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Sidecar {
    /// `options/folderState.json` — вкл/выкл проекта и дата активности.
    FolderState,
    /// `options/options.json` — снимок настроек пайплайна.
    Options,
    /// `options/description.md` — описание проекта.
    Description,
}

impl Sidecar {
    /// Имя в API (`?name=` и поле `sidecar`).
    pub fn api_name(self) -> &'static str {
        match self {
            Self::FolderState => "folder-state",
            Self::Options => "options",
            Self::Description => "description",
        }
    }

    /// Имя файла на диске и в логическом пути.
    pub fn file_name(self) -> &'static str {
        match self {
            Self::FolderState => "folderState.json",
            Self::Options => "options.json",
            Self::Description => "description.md",
        }
    }

    /// Все сайдкары — для обхода при подтягивании.
    pub const ALL: [Sidecar; 3] = [Self::FolderState, Self::Options, Self::Description];

    /// Разряд в маске «что тронули» (`ApplyStats::sidecars_dirty`).
    pub fn bit(self) -> u8 {
        match self {
            Self::FolderState => 1,
            Self::Options => 2,
            Self::Description => 4,
        }
    }

    /// Разобрать маску обратно в сайдкары.
    pub fn from_mask(mask: u8) -> impl Iterator<Item = Sidecar> {
        Self::ALL.into_iter().filter(move |s| mask & s.bit() != 0)
    }

    /// Сайдкар ли это по логическому пути внутри проекта.
    ///
    /// Требуем ровно `options/<имя>`: файл с тем же именем в любой другой папке —
    /// обычный файл, и подменять ему канал нельзя.
    pub fn from_logical(folder_path: &str, name: &str) -> Option<Self> {
        if folder_path.trim_matches('/') != SIDECAR_FOLDER {
            return None;
        }
        Self::ALL.into_iter().find(|s| s.file_name() == name)
    }
}

/// Единственная папка, где живут сайдкары. Бэкенд её имя резервирует (403 на `mkdir`).
pub const SIDECAR_FOLDER: &str = "options";

/// Ответ `GET /sidecars`.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SidecarBody {
    /// Канонический ключ в R2 — для логов, решений на нём не принимаем.
    #[allow(dead_code)]
    pub key: String,
    pub body: String,
}

/// Ответ `PUT /sidecars` с `kind: "raw"`.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SidecarPutResult {
    #[serde(default)]
    pub etag: Option<String>,
}

// ─── Ошибки ──────────────────────────────────────────────────────────────────

/// Тело ошибки бэкенда: `{ "message": "…" }`.
#[derive(Debug, Clone, Deserialize)]
pub(crate) struct ApiErrorBody {
    #[serde(default)]
    pub message: Option<String>,
}

/// Ошибка обращения к бэкенду.
///
/// `Forbidden` выделен намеренно: «нет прав» надо показывать пользователю именно
/// так, а не как сетевой сбой. Программа обычно ходит под ADMIN-токеном, но
/// закладываться на это нельзя — у клиента токен может быть уже.
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(tag = "kind", content = "message", rename_all = "camelCase")]
pub enum StorageError {
    /// Не настроено подключение: нет адреса или токена.
    NotConfigured(String),
    /// Сеть, DNS, таймаут — то, что имеет смысл повторить.
    Network(String),
    /// 401 — токен невалиден или отозван.
    Unauthorized(String),
    /// 403 — прав нет (или токен привязан к другому проекту).
    Forbidden(String),
    /// 404 — проект или файл не найден.
    NotFound(String),
    /// 409 — конфликт: дубль имени, объект отсутствует в R2, несовпадение ETag.
    Conflict(String),
    /// Операция не поддерживается бэкендом (см. `Capabilities`).
    Unsupported(String),
    /// Прочее, включая 5xx и неразобранный ответ.
    Other(String),
}

impl std::fmt::Display for StorageError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let (tag, msg) = match self {
            Self::NotConfigured(m) => ("not_configured", m),
            Self::Network(m) => ("network", m),
            Self::Unauthorized(m) => ("unauthorized", m),
            Self::Forbidden(m) => ("forbidden", m),
            Self::NotFound(m) => ("not_found", m),
            Self::Conflict(m) => ("conflict", m),
            Self::Unsupported(m) => ("unsupported", m),
            Self::Other(m) => ("other", m),
        };
        write!(f, "{tag}: {msg}")
    }
}

impl std::error::Error for StorageError {}

pub type StorageResult<T> = Result<T, StorageError>;

// ─── Передачи ────────────────────────────────────────────────────────────────

/// Строка панели передач.
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct TransferRow {
    pub id: i64,
    pub file_id: Option<String>,
    pub project_id: String,
    /// `"down"` | `"up"`.
    pub direction: String,
    pub name: String,
    pub bytes_total: Option<i64>,
    pub bytes_done: i64,
    /// `queued` | `active` | `paused` | `error` | `done`.
    pub state: String,
    pub error: Option<String>,
    pub updated_at: i64,
}

// ─── Статистика поддерева ────────────────────────────────────────────────────

/// Прямой ребёнок папки с ГЛУБОКИМИ итогами по своему поддереву.
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SubtreeChild {
    /// `""` — файлы, лежащие прямо в этой папке (не в подпапке).
    pub name: String,
    pub is_folder: bool,
    pub files: i64,
    pub bytes: i64,
    pub local_files: i64,
    pub local_bytes: i64,
    /// `options`, `_stats`, `_post` — служебное. Не скрываем, но приглушаем:
    /// «проект 52 ГБ» включает логи, и это надо отличать от контента.
    pub internal: bool,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SubtreeStats {
    pub project_id: String,
    pub folder_path: String,
    /// `false` — полного `/tree` по проекту ещё не делали. Это НЕ то же самое,
    /// что «пусто»: показать «0 файлов» там, где мы просто не спрашивали, —
    /// худший вид вранья в интерфейсе.
    pub known: bool,
    pub files: i64,
    pub bytes: i64,
    pub local_files: i64,
    pub local_bytes: i64,
    pub children: Vec<SubtreeChild>,
}
