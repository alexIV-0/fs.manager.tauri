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
    pub group_name: String,
    pub is_active: bool,
    pub is_paused: bool,
    /// ISO-8601.
    pub updated_at: String,
}

/// Ответ `GET /projects`. Под ADMIN-токеном — все клиенты и проекты,
/// под scoped-токеном — только его проект.
#[derive(Debug, Clone, Default, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ProjectsResponse {
    #[serde(default)]
    pub clients: Vec<RemoteClient>,
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
