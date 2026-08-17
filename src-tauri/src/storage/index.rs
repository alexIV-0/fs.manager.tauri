// Локальный индекс: копия каталога бэкенда + состояние ЭТОЙ машины.
//
// Две группы таблиц, и смешивать их нельзя (R2_SYNC_PLAN.md, раздел 5):
//   remote_*      — производное от бэкенда. Можно снести и пересобрать через /tree.
//   local_state, transfers, copied_files, media_probe
//                 — ТОЛЬКО эта машина. Никуда не уходит: что скачано на конкретном
//                   диске — дело только этого диска.
//
// Ключ везде `file_id` (UUID бэкенда): он СТАБИЛЕН через переименования и переносы.
// `s3_key` непрозрачный, локальный путь из него не выводится — только из
// `folder_path` + `name`.
//
// Живёт в app data, НЕ внутри синхронизируемой папки: иначе индекс начнёт
// синхронизировать сам себя.

use std::path::Path;

use rusqlite::{params, Connection, OptionalExtension};

use super::types::*;

/// Версия схемы. Растёт при каждом изменении; миграции идут по `user_version`.
const SCHEMA_VERSION: i64 = 4;

pub struct Index {
    conn: Connection,
}

// ─── Открытие и миграции ─────────────────────────────────────────────────────

impl Index {
    pub fn open(path: &Path) -> Result<Self, String> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("create_dir_all {}: {e}", parent.display()))?;
        }
        let conn = Connection::open(path).map_err(|e| format!("open {}: {e}", path.display()))?;
        let me = Self { conn };
        me.configure()?;
        me.migrate()?;
        Ok(me)
    }

    /// Для тестов и для проверки миграций без файла на диске.
    #[cfg(test)]
    pub fn open_in_memory() -> Result<Self, String> {
        let conn = Connection::open_in_memory().map_err(|e| e.to_string())?;
        let me = Self { conn };
        me.configure()?;
        me.migrate()?;
        Ok(me)
    }

    fn configure(&self) -> Result<(), String> {
        // WAL: читатели (UI рисует дерево) не блокируют писателя (поллинг дельт).
        // NORMAL: на записи не ждём fsync — индекс производный, потеря последних
        // событий лечится следующей дельтой.
        self.conn
            .execute_batch(
                "PRAGMA journal_mode = WAL;
                 PRAGMA synchronous = NORMAL;
                 PRAGMA foreign_keys = ON;",
            )
            .map_err(|e| format!("pragma: {e}"))
    }

    fn user_version(&self) -> Result<i64, String> {
        self.conn
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .map_err(|e| format!("user_version: {e}"))
    }

    fn migrate(&self) -> Result<(), String> {
        let from = self.user_version()?;
        if from >= SCHEMA_VERSION {
            return Ok(());
        }
        if from == 0 {
            self.conn
                .execute_batch(SCHEMA_V1)
                .map_err(|e| format!("миграция 0→1: {e}"))?;
        }
        if from <= 1 {
            // Владелец проекта = первый уровень зеркала. Индекс производный, но
            // ронять его ради одной колонки незачем: `ALTER TABLE` сохраняет и
            // дерево, и локальные копии, а значит не заставляет заново качать.
            self.conn
                .execute_batch(SCHEMA_V2)
                .map_err(|e| format!("миграция 1→2: {e}"))?;
        }
        if from <= 2 {
            self.conn
                .execute_batch(SCHEMA_V3)
                .map_err(|e| format!("миграция 2→3: {e}"))?;
        }
        if from <= 3 {
            self.conn
                .execute_batch(SCHEMA_V4)
                .map_err(|e| format!("миграция 3→4: {e}"))?;
        }
        self.conn
            .execute_batch(&format!("PRAGMA user_version = {SCHEMA_VERSION}"))
            .map_err(|e| format!("set user_version: {e}"))
    }
}

const SCHEMA_V1: &str = r#"
-- ══ Производное от бэкенда ══════════════════════════════════════════════════

CREATE TABLE remote_clients (
    id           TEXT PRIMARY KEY,
    display_name TEXT NOT NULL
);

CREATE TABLE remote_projects (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    client_id  TEXT,              -- NULL = проект вне клиента
    group_name TEXT NOT NULL DEFAULT '',
    is_active  INTEGER NOT NULL DEFAULT 1,
    is_paused  INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT
);
CREATE INDEX idx_rp_client ON remote_projects(client_id, name);

CREATE TABLE remote_entries (
    file_id      TEXT PRIMARY KEY,     -- стабилен через переименования и переносы
    project_id   TEXT NOT NULL,
    folder_path  TEXT NOT NULL,        -- 'IN', '' = корень проекта
    name         TEXT NOT NULL,        -- логическое имя; идёт в локальный путь
    is_folder    INTEGER NOT NULL,
    s3_key       TEXT,                 -- NULL у папок; непрозрачный у файлов
    size_bytes   INTEGER,
    content_type TEXT,
    etag         TEXT,
    content_hash TEXT,
    origin_mtime INTEGER,
    last_seq     INTEGER,
    deleted      INTEGER NOT NULL DEFAULT 0
);
-- Листинг папки: WHERE project_id, folder_path — мгновенно по индексу.
CREATE INDEX idx_re_folder ON remote_entries(project_id, folder_path, name);
-- Поиск по имени во всём дереве (модалка поиска по проектам).
CREATE INDEX idx_re_name   ON remote_entries(name);

CREATE TABLE project_cursors (
    project_id TEXT PRIMARY KEY,
    cursor     INTEGER NOT NULL DEFAULT 0,
    tree_at    INTEGER               -- unix sec последнего полного /tree
);

-- ══ ТОЛЬКО эта машина. В облако не уходит никогда ═══════════════════════════

CREATE TABLE local_state (
    file_id     TEXT PRIMARY KEY,
    state       TEXT NOT NULL,       -- Cloud|Downloading|Fresh|Stale|LocalOnly
                                     -- |LocalModified|Uploading|Conflict|Error
    local_path  TEXT,
    -- ВАЖНО: local_size и local_mtime — состояние на момент ПОСЛЕДНЕЙ УСПЕШНОЙ
    -- синхронизации, а НЕ текущее с диска. Текущее берётся stat-ом и сравнивается
    -- с ними: это baseline, без которого «в облаке новее» не отличить от
    -- «у меня новее» (R2_SYNC_PLAN.md, 6.3).
    local_size  INTEGER,
    local_mtime INTEGER,
    synced_etag TEXT,
    hydrated_at INTEGER,
    last_access INTEGER,
    pinned      INTEGER NOT NULL DEFAULT 0,
    error       TEXT
);
-- Кандидаты на вытеснение: незапиненные, свежие, давно не тронутые.
CREATE INDEX idx_ls_evict ON local_state(last_access)
    WHERE pinned = 0 AND state = 'Fresh';

CREATE TABLE transfers (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    file_id     TEXT,
    project_id  TEXT NOT NULL,
    direction   TEXT NOT NULL,       -- 'up' | 'down'
    local_path  TEXT NOT NULL,
    bytes_total INTEGER,
    bytes_done  INTEGER NOT NULL DEFAULT 0,
    strategy    TEXT NOT NULL DEFAULT 'single',   -- 'single' | 'multipart'
    upload_id   TEXT,                -- для multipart; пока всегда NULL
    parts_done  TEXT,                -- JSON [[partNumber, etag], …]; пока NULL
    attempts    INTEGER NOT NULL DEFAULT 0,
    state       TEXT NOT NULL,       -- queued|active|paused|error|done
    error       TEXT,
    updated_at  INTEGER NOT NULL
);
CREATE INDEX idx_tr_state ON transfers(state, id);

-- Что и куда копировали: чтобы нода «переписать устаревший» решала БЕЗ скачивания.
-- Сравнение по content_hash (иначе etag) — не по mtime: часы разъезжаются, а
-- правка локальной копии меняет её mtime, не меняя источник.
CREATE TABLE copied_files (
    dest_path TEXT PRIMARY KEY,
    file_id   TEXT NOT NULL,
    src_etag  TEXT,
    src_hash  TEXT,
    src_size  INTEGER,
    copied_at INTEGER NOT NULL
);

-- Медиа-характеристики облачных файлов: ffprobe по Range читает только заголовок
-- контейнера — сотни КБ вместо гигабайт. Инвалидация по etag.
CREATE TABLE media_probe (
    file_id   TEXT PRIMARY KEY,
    src_etag  TEXT NOT NULL,
    duration  REAL,
    width     INTEGER,
    height    INTEGER,
    codec     TEXT,
    fps       REAL,
    audio     TEXT,
    probed_at INTEGER NOT NULL
);

CREATE TABLE sync_meta (k TEXT PRIMARY KEY, v TEXT);
"#;

/// v2: владелец проекта — первый уровень зеркала (`projects/{userId}/{projectId}/…`).
///
/// `user_id` заполняется из ответа `/projects`, когда бэкенд его отдаёт, либо
/// добывается из `s3Key` — поэтому колонка обнуляемая, а не `NOT NULL`.
const SCHEMA_V2: &str = r#"
ALTER TABLE remote_projects ADD COLUMN user_id TEXT;
CREATE INDEX idx_rp_user ON remote_projects(user_id, name);

-- Имена владельцев. Пока бэкенд их не отдаёт, таблица пустует, и в интерфейсе
-- показывается идентификатор — как в бакете.
CREATE TABLE remote_users (
    id           TEXT PRIMARY KEY,
    display_name TEXT NOT NULL
);
"#;

/// v3: имя папки владельца — это **email**.
///
/// `display_name` одного поля не хватило: в БД бэкенда лежат и `email`, и
/// `full_name`, и подписывать папку надо именно email — он уникален и узнаваем, а
/// `full_name` бывает пустым и повторяется. Храним что прислали, а выбор имени
/// оставляем раскладке.
const SCHEMA_V3: &str = r#"
ALTER TABLE remote_users ADD COLUMN email TEXT NOT NULL DEFAULT '';
ALTER TABLE remote_users ADD COLUMN full_name TEXT NOT NULL DEFAULT '';
"#;

/// v4: архивный проект. Обработку по нему запускать нельзя, и человек обязан видеть
/// это в колонке проектов — иначе «почему проект не обрабатывается» неотлаживаемо.
const SCHEMA_V4: &str = r#"
ALTER TABLE remote_projects ADD COLUMN is_archived INTEGER NOT NULL DEFAULT 0;
ALTER TABLE remote_projects ADD COLUMN archived_at TEXT;
"#;

// ─── Клиенты и проекты ───────────────────────────────────────────────────────

impl Index {
    /// Ответ `/projects` целиком заменяет кэш: бэкенд отдаёт полный видимый список,
    /// значит исчезнувшее оттуда исчезло и у нас.
    pub fn replace_projects(&mut self, resp: &ProjectsResponse) -> Result<(), String> {
        // Владельцев, добытых из ключей, запоминаем ДО удаления: бэкенд их не
        // присылает, а потеря означала бы повторный обход деревьев на каждое
        // обновление списка проектов.
        let known_owners: std::collections::HashMap<String, String> = {
            let mut st = self
                .conn
                .prepare("SELECT id, user_id FROM remote_projects WHERE user_id IS NOT NULL")
                .map_err(|e| e.to_string())?;
            let rows = st
                .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
                .map_err(|e| e.to_string())?;
            rows.collect::<Result<_, _>>().map_err(|e| e.to_string())?
        };

        let tx = self.conn.transaction().map_err(|e| e.to_string())?;
        tx.execute("DELETE FROM remote_clients", [])
            .map_err(|e| e.to_string())?;
        tx.execute("DELETE FROM remote_projects", [])
            .map_err(|e| e.to_string())?;

        for c in &resp.clients {
            tx.execute(
                "INSERT INTO remote_clients (id, display_name) VALUES (?1, ?2)",
                params![c.id, c.display_name],
            )
            .map_err(|e| format!("insert client {}: {e}", c.id))?;
        }
        for u in &resp.users {
            tx.execute(
                "INSERT INTO remote_users (id, display_name, email, full_name)
                 VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT(id) DO UPDATE SET
                    display_name = ?2, email = ?3, full_name = ?4",
                params![u.id, u.display_name, u.email, u.full_name],
            )
            .map_err(|e| format!("insert user {}: {e}", u.id))?;
        }
        for p in &resp.projects {
            tx.execute(
                "INSERT INTO remote_projects
                    (id, name, client_id, group_name, is_active, is_paused, updated_at,
                     user_id, is_archived, archived_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                params![
                    p.id,
                    p.name,
                    p.client_id,
                    p.group_name,
                    p.is_active as i64,
                    p.is_paused as i64,
                    p.updated_at,
                    // Ответ бэкенда важнее: он источник истины. Своё добытое
                    // значение — только когда бэкенд молчит.
                    p.user_id.clone().or_else(|| known_owners.get(&p.id).cloned()),
                    p.is_archived as i64,
                    p.archived_at.clone()
                ],
            )
            .map_err(|e| format!("insert project {}: {e}", p.id))?;
        }
        tx.commit().map_err(|e| e.to_string())
    }

    pub fn clients(&self) -> Result<Vec<RemoteClient>, String> {
        let mut st = self
            .conn
            .prepare("SELECT id, display_name FROM remote_clients ORDER BY display_name")
            .map_err(|e| e.to_string())?;
        let rows = st
            .query_map([], |r| {
                Ok(RemoteClient {
                    id: r.get(0)?,
                    display_name: r.get(1)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<_, _>>().map_err(|e| e.to_string())
    }

    /// `client_id = None` → все проекты; `Some(id)` → проекты этого клиента.
    pub fn projects(&self, client_id: Option<&str>) -> Result<Vec<RemoteProject>, String> {
        let sql = "SELECT id, name, client_id, group_name, is_active, is_paused, updated_at,
                            user_id, is_archived, archived_at
                     FROM remote_projects
                    WHERE (?1 IS NULL OR client_id = ?1)
                    ORDER BY name";
        let mut st = self.conn.prepare(sql).map_err(|e| e.to_string())?;
        let rows = st
            .query_map(params![client_id], |r| {
                Ok(RemoteProject {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    client_id: r.get(2)?,
                    group_name: r.get(3)?,
                    is_active: r.get::<_, i64>(4)? != 0,
                    is_paused: r.get::<_, i64>(5)? != 0,
                    updated_at: r.get::<_, Option<String>>(6)?.unwrap_or_default(),
                    user_id: r.get(7)?,
                    is_archived: r.get::<_, i64>(8)? != 0,
                    archived_at: r.get(9)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<_, _>>().map_err(|e| e.to_string())
    }

    /// Владельцы с человеческими именами. Пусто — бэкенд их пока не отдаёт, и
    /// папка будет названа идентификатором, как в бакете.
    pub fn users(&self) -> Result<Vec<RemoteUser>, String> {
        let mut st = self
            .conn
            .prepare(
                "SELECT id, display_name, email, full_name FROM remote_users
                  ORDER BY email, display_name",
            )
            .map_err(|e| e.to_string())?;
        let rows = st
            .query_map([], |r| {
                Ok(RemoteUser {
                    id: r.get(0)?,
                    display_name: r.get(1)?,
                    email: r.get(2)?,
                    full_name: r.get(3)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<_, _>>().map_err(|e| e.to_string())
    }

    /// Проекты, владелец которых неизвестен — их и надо разбирать по ключам.
    pub fn projects_without_owner(&self) -> Result<Vec<String>, String> {
        let mut st = self
            .conn
            .prepare("SELECT id FROM remote_projects WHERE user_id IS NULL")
            .map_err(|e| e.to_string())?;
        let rows = st
            .query_map([], |r| r.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<_, _>>().map_err(|e| e.to_string())
    }

    /// Отметить проект приостановленным/активным.
    ///
    /// Правим локально сразу после успешного ответа бэкенда: иначе следующий
    /// `reloadFolders` вернёт галочку обратно из ещё не обновлённого каталога, и
    /// выключение «отскочит» на глазах у человека.
    pub fn set_project_paused(&self, project_id: &str, paused: bool) -> Result<(), String> {
        self.conn
            .execute(
                "UPDATE remote_projects SET is_paused = ?2, is_active = ?3 WHERE id = ?1",
                params![project_id, paused as i64, !paused as i64],
            )
            .map(|_| ())
            .map_err(|e| format!("set_project_paused {project_id}: {e}"))
    }

    /// Запомнить владельца, добытого из ключа.
    pub fn set_project_owner(&self, project_id: &str, user_id: &str) -> Result<(), String> {
        self.conn
            .execute(
                "UPDATE remote_projects SET user_id = ?2 WHERE id = ?1",
                params![project_id, user_id],
            )
            .map(|_| ())
            .map_err(|e| format!("set_project_owner {project_id}: {e}"))
    }

    /// Любой непустой `s3_key` проекта — из него выводится владелец.
    ///
    /// Папки ключей не имеют, поэтому берём именно файл; пустой проект владельца
    /// не выдаст, и это ограничение обходного пути, а не ошибка.
    pub fn any_s3_key(&self, project_id: &str) -> Result<Option<String>, String> {
        self.conn
            .query_row(
                "SELECT s3_key FROM remote_entries
                  WHERE project_id = ?1 AND s3_key IS NOT NULL AND deleted = 0
                  LIMIT 1",
                params![project_id],
                |r| r.get::<_, String>(0),
            )
            .optional()
            .map_err(|e| e.to_string())
    }
}

// ─── Дерево: bootstrap и дельты ───────────────────────────────────────────────

/// Что сделала дельта. `needs_resync` — сигнал, что применить не удалось и нужен
/// полный `/tree`: молча продолжать с дырой в индексе нельзя.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct ApplyStats {
    pub upserted: usize,
    pub deleted: usize,
    pub skipped: usize,
    pub needs_resync: bool,
    /// Битовая маска сайдкаров, которые кто-то тронул (см. `Sidecar::bit`).
    ///
    /// Маска, а не список: `ApplyStats` и `SyncReport` — `Copy`-структуры, их
    /// передают по значению, а сайдкаров всего три.
    pub sidecars_dirty: u8,
}

impl Index {
    /// Bootstrap: `/tree` отдаёт ПОЛНОЕ поддерево, поэтому старые строки проекта
    /// удаляем — иначе исчезнувшее на бэкенде останется у нас навсегда.
    ///
    /// `local_state` при этом НЕ трогаем: скачанные файлы принадлежат машине, а не
    /// каталогу, и их судьбу решает вытеснение.
    pub fn apply_tree(
        &mut self,
        project_id: &str,
        entries: &[TreeEntry],
        cursor: i64,
    ) -> Result<ApplyStats, String> {
        let tx = self.conn.transaction().map_err(|e| e.to_string())?;
        tx.execute(
            "DELETE FROM remote_entries WHERE project_id = ?1",
            params![project_id],
        )
        .map_err(|e| e.to_string())?;

        let mut n = 0usize;
        for e in entries {
            tx.execute(
                "INSERT INTO remote_entries
                    (file_id, project_id, folder_path, name, is_folder, s3_key,
                     size_bytes, content_type, etag, content_hash, origin_mtime,
                     last_seq, deleted)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,0)",
                params![
                    e.id,
                    e.project_id,
                    e.folder_path,
                    e.name,
                    e.is_folder as i64,
                    e.s3_key,
                    e.size_bytes,
                    e.content_type,
                    e.etag,
                    e.content_hash,
                    e.origin_mtime,
                    e.last_seq,
                ],
            )
            .map_err(|e2| format!("insert entry {}: {e2}", e.id))?;
            n += 1;
        }

        tx.execute(
            "INSERT INTO project_cursors (project_id, cursor, tree_at)
                  VALUES (?1, ?2, ?3)
             ON CONFLICT(project_id) DO UPDATE SET cursor = ?2, tree_at = ?3",
            params![project_id, cursor, now_sec()],
        )
        .map_err(|e| e.to_string())?;

        tx.commit().map_err(|e| e.to_string())?;
        Ok(ApplyStats {
            upserted: n,
            ..Default::default()
        })
    }

    /// Инкрементальное применение журнала.
    ///
    /// Переименование приходит парой delete+put с ОДНИМ `file_id`. Поэтому delete
    /// ставит `deleted = 1` (tombstone), а не удаляет строку: следующий put тем же
    /// `file_id` её оживит с новым именем. Удали мы строку — потеряли бы связь с
    /// `local_state`, и файл на диске пришлось бы перекачивать вместо переименования.
    pub fn apply_delta(
        &mut self,
        project_id: &str,
        changes: &[Change],
        cursor: i64,
    ) -> Result<ApplyStats, String> {
        let tx = self.conn.transaction().map_err(|e| e.to_string())?;
        let mut st = ApplyStats::default();

        for c in changes {
            let Some(file_id) = c.file_id.as_deref() else {
                // Событие про САЙДКАР приходит без `file_id` всегда и по устройству:
                // строки в `project_files` у служебных JSON-ов нет, поэтому и ссылаться
                // событию не на что (`setProjectPaused` → `journalStorageEvent`).
                // Это не дыра в индексе, а сигнал «сайт тронул настройки — подтяни
                // сайдкар». Считать его неприменимым значило бы гонять полный `/tree`
                // на каждое переключение тумблера на сайте.
                if let Some(which) = sidecar_of_change(c) {
                    st.sidecars_dirty |= which.bit();
                    continue;
                }
                // Всё остальное без `file_id` действительно неприменимо: ключ у нас он.
                st.skipped += 1;
                st.needs_resync = true;
                continue;
            };

            match c.op {
                ChangeOp::Delete => {
                    let n = tx
                        .execute(
                            "UPDATE remote_entries SET deleted = 1, last_seq = ?2
                              WHERE file_id = ?1",
                            params![file_id, c.seq],
                        )
                        .map_err(|e| e.to_string())?;
                    if n == 0 {
                        // Удалили то, чего мы и не знали — не ошибка, просто нечего гасить.
                        st.skipped += 1;
                    } else {
                        st.deleted += 1;
                    }
                }
                ChangeOp::Put => {
                    let (Some(name), Some(folder_path)) =
                        (c.name.as_deref(), c.folder_path.as_deref())
                    else {
                        // Put без логического пути применить нельзя: локальный путь
                        // строится именно из folder_path + name.
                        st.skipped += 1;
                        st.needs_resync = true;
                        continue;
                    };

                    tx.execute(
                        "INSERT INTO remote_entries
                            (file_id, project_id, folder_path, name, is_folder, s3_key,
                             size_bytes, content_type, etag, content_hash, last_seq, deleted)
                         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,0)
                         ON CONFLICT(file_id) DO UPDATE SET
                            project_id   = ?2,
                            folder_path  = ?3,
                            name         = ?4,
                            is_folder    = ?5,
                            s3_key       = COALESCE(?6, remote_entries.s3_key),
                            size_bytes   = COALESCE(?7, remote_entries.size_bytes),
                            content_type = COALESCE(?8, remote_entries.content_type),
                            etag         = COALESCE(?9, remote_entries.etag),
                            content_hash = COALESCE(?10, remote_entries.content_hash),
                            last_seq     = ?11,
                            deleted      = 0",
                        params![
                            file_id,
                            project_id,
                            folder_path,
                            name,
                            c.is_folder.unwrap_or(false) as i64,
                            // `key` в журнале — это НАСТОЯЩИЙ s3-ключ, но только у
                            // файлов: бэкенд журналит `key: s3Key` (`writeFilePut`,
                            // `writeNotifyUpload`). У папок ключа не существует, и
                            // там журналится логический путь (`logicalKeyForFile`) —
                            // записать его в `s3_key` нельзя.
                            //
                            // Раньше мы не брали ключ вообще, и это стоило дорого:
                            // строка, впервые узнанная из дельты, оставалась без
                            // `s3_key`; при следующей заливке в тот же путь передать
                            // существующий ключ было нечем, `/presign` выписывал
                            // новый `{uuid}-имя`, а прежний объект оставался в бакете
                            // сиротой навсегда.
                            delta_s3_key(c),
                            c.size,
                            c.content_type,
                            c.etag,
                            c.content_hash,
                            c.seq,
                        ],
                    )
                    .map_err(|e| format!("upsert {file_id}: {e}"))?;
                    st.upserted += 1;
                }
            }
        }

        tx.execute(
            "INSERT INTO project_cursors (project_id, cursor) VALUES (?1, ?2)
             ON CONFLICT(project_id) DO UPDATE SET cursor = ?2",
            params![project_id, cursor],
        )
        .map_err(|e| e.to_string())?;

        tx.commit().map_err(|e| e.to_string())?;
        Ok(st)
    }

    /// Вписать запись из ответа мутации (`notify`, `mkdir`, `rename`).
    ///
    /// Нужно, чтобы только что залитый файл появился в дереве СРАЗУ, а не ждал
    /// следующей дельты: иначе после заливки он на секунды исчезает из интерфейса.
    pub fn upsert_from_file(&self, f: &ProjectFile) -> Result<(), String> {
        self.conn
            .execute(
                "INSERT INTO remote_entries
                    (file_id, project_id, folder_path, name, is_folder, s3_key,
                     size_bytes, content_type, deleted)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,0)
                 ON CONFLICT(file_id) DO UPDATE SET
                    folder_path  = ?3,
                    name         = ?4,
                    is_folder    = ?5,
                    s3_key       = COALESCE(?6, remote_entries.s3_key),
                    size_bytes   = COALESCE(?7, remote_entries.size_bytes),
                    content_type = COALESCE(?8, remote_entries.content_type),
                    deleted      = 0",
                params![
                    f.id,
                    f.project_id,
                    f.folder_path,
                    f.name,
                    f.is_folder as i64,
                    f.s3_key,
                    f.size_bytes,
                    f.content_type,
                ],
            )
            .map(|_| ())
            .map_err(|e| format!("upsert_from_file {}: {e}", f.id))
    }

    /// Переименовали ПАПКУ — переписать логический путь всему, что внутри.
    ///
    /// Бэкенд делает то же самое одним `UPDATE` (`writeRename`), но **не журналит
    /// потомков**: в `/delta` приходит событие только на саму папку. Значит принять
    /// каскад в индекс обязаны мы сами, иначе дети останутся по старому пути, и
    /// локальные пути для них соберутся неправильно — файл «пропадёт» из проекта.
    ///
    /// Возвращает, сколько записей поехало.
    pub fn reprefix_children(
        &self,
        project_id: &str,
        old_prefix: &str,
        new_prefix: &str,
    ) -> Result<usize, String> {
        self.conn
            .execute(
                "UPDATE remote_entries
                    SET folder_path = CASE
                          WHEN folder_path = ?2 THEN ?3
                          ELSE ?3 || substr(folder_path, length(?2) + 1)
                        END
                  WHERE project_id = ?1
                    AND (folder_path = ?2 OR folder_path LIKE ?2 || '/%')",
                params![project_id, old_prefix, new_prefix],
            )
            .map_err(|e| format!("reprefix_children {old_prefix} → {new_prefix}: {e}"))
    }

    /// Локальные копии переехали вместе с переименованной папкой на диске.
    ///
    /// `local_path` — абсолютный путь; после `fs::rename` папки все файлы внутри
    /// лежат по новому пути, и запись обязана это отражать. Иначе сверка не найдёт
    /// файл, решит «удалён руками» и обнулит baseline: свежая копия превратится в
    /// «только в облаке», хотя лежит на диске.
    pub fn rebase_local_paths(&self, old_prefix: &str, new_prefix: &str) -> Result<usize, String> {
        self.conn
            .execute(
                "UPDATE local_state
                    SET local_path = ?2 || substr(local_path, length(?1) + 1)
                  WHERE local_path = ?1 OR local_path LIKE ?1 || '/%'",
                params![old_prefix, new_prefix],
            )
            .map_err(|e| format!("rebase_local_paths {old_prefix} → {new_prefix}: {e}"))
    }

    pub fn cursor(&self, project_id: &str) -> Result<i64, String> {
        self.conn
            .query_row(
                "SELECT cursor FROM project_cursors WHERE project_id = ?1",
                params![project_id],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())
            .map(|v| v.unwrap_or(0))
    }

    /// `None` — полного `/tree` по этому проекту ещё не делали. Отличать от
    /// «сделали, и там пусто» обязательно: иначе пустая папка и неизвестная папка
    /// выглядят одинаково.
    pub fn tree_at(&self, project_id: &str) -> Result<Option<i64>, String> {
        self.conn
            .query_row(
                "SELECT tree_at FROM project_cursors WHERE project_id = ?1",
                params![project_id],
                |r| r.get::<_, Option<i64>>(0),
            )
            .optional()
            .map_err(|e| e.to_string())
            .map(|v| v.flatten())
    }

    /// Содержимое папки: папки сначала, потом файлы, внутри — по имени.
    pub fn list_dir(&self, project_id: &str, folder_path: &str) -> Result<Vec<TreeEntry>, String> {
        let mut st = self
            .conn
            .prepare(
                "SELECT file_id, project_id, folder_path, name, is_folder, s3_key,
                        size_bytes, content_type, etag, content_hash, origin_mtime, last_seq
                   FROM remote_entries
                  WHERE project_id = ?1 AND folder_path = ?2 AND deleted = 0
                  ORDER BY is_folder DESC, name COLLATE NOCASE",
            )
            .map_err(|e| e.to_string())?;
        let rows = st
            .query_map(params![project_id, folder_path], |r| {
                Ok(TreeEntry {
                    id: r.get(0)?,
                    project_id: r.get(1)?,
                    folder_path: r.get(2)?,
                    name: r.get(3)?,
                    is_folder: r.get::<_, i64>(4)? != 0,
                    s3_key: r.get(5)?,
                    size_bytes: r.get(6)?,
                    content_type: r.get(7)?,
                    etag: r.get(8)?,
                    content_hash: r.get(9)?,
                    origin_mtime: r.get(10)?,
                    created_at: None,
                    updated_at: None,
                    last_seq: r.get(11)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<_, _>>().map_err(|e| e.to_string())
    }

    /// ВСЕ записи проекта — для операций «по всему проекту» (выжигание).
    ///
    /// Отдельно от `list_dir`: тот перечисляет одну папку и опирается на записи-папки,
    /// а здесь нужны и файлы, у чьей папки записи в каталоге нет. Каталог такое
    /// допускает: заливка создаёт запись файла (`/notify`), а записи папок приезжают
    /// деревом — и обход «сверху вниз» такой файл не нашёл бы вообще.
    ///
    /// Порядок: файлы раньше папок, глубокие раньше поверхностных. Удалять папку
    /// осмысленно после её содержимого — иначе бэкенд может отказать «папка не пуста».
    pub fn project_entries(&self, project_id: &str) -> Result<Vec<TreeEntry>, String> {
        let mut st = self
            .conn
            .prepare(
                "SELECT file_id, project_id, folder_path, name, is_folder, s3_key,
                        size_bytes, content_type, etag, content_hash, origin_mtime, last_seq
                   FROM remote_entries
                  WHERE project_id = ?1 AND deleted = 0
                  ORDER BY is_folder ASC, LENGTH(folder_path) DESC, name COLLATE NOCASE",
            )
            .map_err(|e| e.to_string())?;
        let rows = st
            .query_map(params![project_id], |r| {
                Ok(TreeEntry {
                    id: r.get(0)?,
                    project_id: r.get(1)?,
                    folder_path: r.get(2)?,
                    name: r.get(3)?,
                    is_folder: r.get::<_, i64>(4)? != 0,
                    s3_key: r.get(5)?,
                    size_bytes: r.get(6)?,
                    content_type: r.get(7)?,
                    etag: r.get(8)?,
                    content_hash: r.get(9)?,
                    origin_mtime: r.get(10)?,
                    created_at: None,
                    updated_at: None,
                    last_seq: r.get(11)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<_, _>>().map_err(|e| e.to_string())
    }

    /// Логические пути всех папок проекта — для создания их на диске.
    ///
    /// Папка в каталоге лежит отдельной записью, поэтому её путь — это
    /// `folder_path` + `name`, а не путь какого-то файла внутри.
    pub fn folder_paths(&self, project_id: &str) -> Result<Vec<String>, String> {
        let mut st = self
            .conn
            .prepare(
                "SELECT folder_path, name FROM remote_entries
                  WHERE project_id = ?1 AND is_folder = 1 AND deleted = 0",
            )
            .map_err(|e| e.to_string())?;
        let rows = st
            .query_map(params![project_id], |r| {
                let folder: String = r.get(0)?;
                let name: String = r.get(1)?;
                Ok(if folder.is_empty() {
                    name
                } else {
                    format!("{folder}/{name}")
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<_, _>>().map_err(|e| e.to_string())
    }

    /// Одна запись по `file_id` (включая tombstone — вызывающий решает сам).
    pub fn entry(&self, file_id: &str) -> Result<Option<TreeEntry>, String> {
        let mut st = self
            .conn
            .prepare(
                "SELECT file_id, project_id, folder_path, name, is_folder, s3_key,
                        size_bytes, content_type, etag, content_hash, origin_mtime, last_seq
                   FROM remote_entries WHERE file_id = ?1",
            )
            .map_err(|e| e.to_string())?;
        st.query_row(params![file_id], |r| {
            Ok(TreeEntry {
                id: r.get(0)?,
                project_id: r.get(1)?,
                folder_path: r.get(2)?,
                name: r.get(3)?,
                is_folder: r.get::<_, i64>(4)? != 0,
                s3_key: r.get(5)?,
                size_bytes: r.get(6)?,
                content_type: r.get(7)?,
                etag: r.get(8)?,
                content_hash: r.get(9)?,
                origin_mtime: r.get(10)?,
                created_at: None,
                updated_at: None,
                last_seq: r.get(11)?,
            })
        })
        .optional()
        .map_err(|e| e.to_string())
    }

    /// Обратное отображение «логический путь → запись». Нужно шву гидрации:
    /// код приходит с путём, а не с `file_id`.
    pub fn entry_by_path(
        &self,
        project_id: &str,
        folder_path: &str,
        name: &str,
    ) -> Result<Option<TreeEntry>, String> {
        let id: Option<String> = self
            .conn
            .query_row(
                "SELECT file_id FROM remote_entries
                  WHERE project_id = ?1 AND folder_path = ?2 AND name = ?3 AND deleted = 0",
                params![project_id, folder_path, name],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        match id {
            Some(id) => self.entry(&id),
            None => Ok(None),
        }
    }
}

// ─── Состояние локальных копий ───────────────────────────────────────────────

impl Index {
    /// Доступ к соединению для соседних модулей (`state.rs` считает по нему значки).
    pub(super) fn conn(&self) -> &Connection {
        &self.conn
    }

    #[cfg(test)]
    pub fn conn_for_test(&self) -> &Connection {
        &self.conn
    }

    /// Зафиксировать успешную синхронизацию: файл лёг на диск и соответствует
    /// версии `synced_etag`.
    ///
    /// `size`/`mtime` пишем как **baseline** — состояние на этот момент, а не
    /// «текущее с диска». Без этого «в облаке новее» не отличить от «у меня новее»
    /// (см. 6.3 плана).
    #[allow(clippy::too_many_arguments)]
    pub fn mark_synced(
        &self,
        file_id: &str,
        state: &str,
        local_path: &str,
        size: i64,
        mtime: i64,
        synced_etag: Option<&str>,
    ) -> Result<(), String> {
        let now = now_sec();
        self.conn
            .execute(
                "INSERT INTO local_state
                    (file_id, state, local_path, local_size, local_mtime,
                     synced_etag, hydrated_at, last_access, pinned, error)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?7,0,NULL)
                 ON CONFLICT(file_id) DO UPDATE SET
                    state       = ?2,
                    local_path  = ?3,
                    local_size  = ?4,
                    local_mtime = ?5,
                    synced_etag = ?6,
                    hydrated_at = ?7,
                    last_access = ?7,
                    error       = NULL",
                params![file_id, state, local_path, size, mtime, synced_etag, now],
            )
            .map(|_| ())
            .map_err(|e| format!("mark_synced {file_id}: {e}"))
    }

    /// Записать версию, которая теперь лежит в облаке, — после НАШЕЙ заливки.
    ///
    /// Без этого значок врёт сразу после успешной заливки, и врёт неприятно: baseline
    /// локальной копии стал новым (`mark_synced` пишет свежий sha), а `content_hash`
    /// каталога остался прежним — и `derive_state` честно выводит «в облаке новее».
    /// Файл, который мы только что сами отдали в облако, просил обновиться из облака.
    ///
    /// Взять версию из ответа `/notify` нельзя: он не возвращает ни `etag`, ни
    /// `contentHash` (`FILE_FIELDS`, просьба 12.3 бэкенду). Но и угадывать нечего —
    /// в облаке лежит ровно то содержимое, которое мы отправили, а его sha посчитан
    /// перед заливкой. До правки расхождение чинилось само, но лишь до следующей
    /// дельты, то есть значок «обновись» жил у файла минутами.
    pub fn set_remote_version(&self, file_id: &str, content_hash: &str) -> Result<(), String> {
        self.conn
            .execute(
                "UPDATE remote_entries SET content_hash = ?2 WHERE file_id = ?1",
                params![file_id, content_hash],
            )
            .map(|_| ())
            .map_err(|e| format!("set_remote_version {file_id}: {e}"))
    }

    /// Сменить состояние, не трогая baseline (переходы вида Fresh → Downloading,
    /// Fresh → LocalModified, что угодно → Error).
    pub fn set_state(&self, file_id: &str, state: &str, error: Option<&str>) -> Result<(), String> {
        self.conn
            .execute(
                "INSERT INTO local_state (file_id, state, error, last_access)
                      VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT(file_id) DO UPDATE SET state = ?2, error = ?3",
                params![file_id, state, error, now_sec()],
            )
            .map(|_| ())
            .map_err(|e| format!("set_state {file_id}: {e}"))
    }

    /// «Оставить оффлайн»: файл не вытесняется по таймеру. Локальный флаг —
    /// в облако не уходит, у каждой машины свой.
    pub fn set_pinned(&self, file_id: &str, pinned: bool) -> Result<(), String> {
        self.conn
            .execute(
                "INSERT INTO local_state (file_id, state, pinned)
                      VALUES (?1, 'Cloud', ?2)
                 ON CONFLICT(file_id) DO UPDATE SET pinned = ?2",
                params![file_id, pinned as i64],
            )
            .map(|_| ())
            .map_err(|e| format!("set_pinned {file_id}: {e}"))
    }

    /// Отметить обращение — по этому полю работает вытеснение по TTL.
    pub fn touch_access(&self, file_id: &str) -> Result<(), String> {
        self.conn
            .execute(
                "UPDATE local_state SET last_access = ?2 WHERE file_id = ?1",
                params![file_id, now_sec()],
            )
            .map(|_| ())
            .map_err(|e| format!("touch_access {file_id}: {e}"))
    }

    /// Состояние, путь и baseline одной записи — всё, что нужно для сверки с диском.
    pub fn local_baseline(
        &self,
        file_id: &str,
    ) -> Result<Option<(String, String, Option<i64>, Option<i64>)>, String> {
        self.conn
            .query_row(
                "SELECT state, local_path, local_size, local_mtime
                   FROM local_state WHERE file_id = ?1 AND local_path IS NOT NULL",
                params![file_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .optional()
            .map_err(|e| e.to_string())
    }

    /// Все записи, у которых есть локальная копия.
    pub fn local_file_ids(&self) -> Result<Vec<String>, String> {
        let mut st = self
            .conn
            .prepare("SELECT file_id FROM local_state WHERE local_path IS NOT NULL")
            .map_err(|e| e.to_string())?;
        let rows = st
            .query_map([], |r| r.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<_, _>>().map_err(|e| e.to_string())
    }

    /// Локальные пути передач, которые идут прямо сейчас.
    ///
    /// Нужно для живого прогресса: проценты пишутся в `transfers` раз в 4 МБ, но сами
    /// себя интерфейсу не показывают. Пока передача идёт, строку колонки надо
    /// перечитывать — иначе значок «скачивается 47 %» не появится никогда, и на экране
    /// будет казаться, что программа висит.
    pub fn active_transfer_paths(&self) -> Result<Vec<String>, String> {
        let mut st = self
            .conn
            .prepare(
                "SELECT DISTINCT local_path FROM transfers
                  WHERE state IN ('queued','active')",
            )
            .map_err(|e| e.to_string())?;
        let rows = st
            .query_map([], |r| r.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<_, _>>().map_err(|e| e.to_string())
    }

    /// Активные передачи, ключ — локальный путь.
    ///
    /// Нужно для файлов, которых В КАТАЛОГЕ ЕЩЁ НЕТ: у новой заливки `file_id`
    /// появляется только из ответа `/notify`, поэтому связать её строку с передачей
    /// можно лишь по пути. Без этого свежий файл на 200 МБ показывал статичную
    /// стрелку «надо залить» и ни одного процента — заливка шла, а на экране ничего
    /// не двигалось.
    pub fn active_transfers_by_path(&self) -> Result<Vec<(String, String, Option<f64>)>, String> {
        let mut st = self
            .conn
            .prepare(
                "SELECT local_path, direction,
                        CASE WHEN IFNULL(bytes_total,0) > 0
                             THEN CAST(bytes_done AS REAL) / bytes_total
                             ELSE NULL END
                   FROM transfers
                  WHERE state IN ('queued','active')",
            )
            .map_err(|e| e.to_string())?;
        let rows = st
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, Option<f64>>(2)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<_, _>>().map_err(|e| e.to_string())
    }

    /// Локальные пути записей в заданном состоянии.
    ///
    /// Нужно демону: `detect_local_changes` только ставит метку `LocalModified`, а
    /// заливать по ней некому — очередь кандидатов работает с путями, не с
    /// состояниями. Без этого запроса перерендеренный файл получал значок
    /// «надо залить» и ждал, пока человек нажмёт заливку руками.
    pub fn paths_in_state(&self, state: &str) -> Result<Vec<String>, String> {
        let mut st = self
            .conn
            .prepare(
                "SELECT local_path FROM local_state
                  WHERE state = ?1 AND local_path IS NOT NULL",
            )
            .map_err(|e| e.to_string())?;
        let rows = st
            .query_map(params![state], |r| r.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<_, _>>().map_err(|e| e.to_string())
    }

    #[cfg(test)]
    pub fn local_state(&self, file_id: &str) -> Result<Option<(String, Option<String>)>, String> {
        self.conn
            .query_row(
                "SELECT state, local_path FROM local_state WHERE file_id = ?1",
                params![file_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .map_err(|e| e.to_string())
    }

    /// Кандидаты на вытеснение: всё, у чего есть локальная копия. Самые давно не
    /// тронутые — первыми, чтобы давление по размеру снимало сначала холодное.
    pub fn eviction_candidates(&self) -> Result<Vec<super::evict::Candidate>, String> {
        let mut st = self
            .conn
            .prepare(
                "SELECT ls.file_id, re.folder_path, re.name, ls.local_path,
                        IFNULL(ls.local_size, 0), IFNULL(ls.last_access, 0),
                        ls.state, ls.pinned, re.etag, re.content_hash, ls.synced_etag
                   FROM local_state ls
                   JOIN remote_entries re ON re.file_id = ls.file_id
                  WHERE ls.local_path IS NOT NULL
                  ORDER BY IFNULL(ls.last_access, 0) ASC",
            )
            .map_err(|e| e.to_string())?;

        let rows = st
            .query_map([], |r| {
                let stored: String = r.get(6)?;
                let synced_etag: Option<String> = r.get(10)?;
                let etag: Option<String> = r.get(8)?;
                let hash: Option<String> = r.get(9)?;
                // Состояние выводим тем же движком, что и значки: иначе вытеснение
                // и интерфейс разойдутся в оценке одного и того же файла.
                let state = super::state::derive_state_pub(
                    Some(&stored),
                    synced_etag.as_deref(),
                    etag.as_deref(),
                    hash.as_deref(),
                    false,
                );
                Ok(super::evict::Candidate {
                    file_id: r.get(0)?,
                    folder_path: r.get(1)?,
                    name: r.get(2)?,
                    local_path: r.get::<_, Option<String>>(3)?.unwrap_or_default(),
                    local_size: r.get(4)?,
                    last_access: r.get(5)?,
                    state,
                    pinned: r.get::<_, i64>(7)? != 0,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<_, _>>().map_err(|e| e.to_string())
    }

    /// Сколько байт занимают локальные копии сейчас.
    pub fn mirror_bytes(&self) -> Result<i64, String> {
        self.conn
            .query_row(
                "SELECT IFNULL(SUM(IFNULL(local_size,0)),0) FROM local_state
                  WHERE local_path IS NOT NULL",
                [],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())
    }

    /// Локальной копии больше нет — файл снова только в облаке.
    ///
    /// Baseline (`local_size`/`local_mtime`/`synced_etag`) обнуляем: иначе после
    /// повторного скачивания сравнение версий возьмёт старое значение и решит, что
    /// файл «локально изменён».
    /// Забыть записи целиком — файл удалён из каталога, а не вытеснен с диска.
    ///
    /// Отличать от `mark_evicted` обязательно: вытеснение оставляет строку каталога
    /// (файл в облаке есть, копии нет), а удаление убирает и её. Оставить строку —
    /// значит показывать в колонке файл, которого больше нет нигде.
    ///
    /// Папка удаляется каскадом, поэтому принимаем список.
    pub fn forget_files(&self, file_ids: &[String]) -> Result<usize, String> {
        let mut n = 0;
        for id in file_ids {
            self.conn
                .execute("DELETE FROM local_state WHERE file_id = ?1", params![id])
                .map_err(|e| format!("forget local_state {id}: {e}"))?;
            n += self
                .conn
                .execute("DELETE FROM remote_entries WHERE file_id = ?1", params![id])
                .map_err(|e| format!("forget entry {id}: {e}"))?;
        }
        Ok(n)
    }

    /// Всё поддерево папки: сама папка и её потомки. Для удаления каскадом — нам
    /// нужно вычистить у себя ровно то же, что бэкенд вычистит у себя.
    pub fn subtree_ids(
        &self,
        project_id: &str,
        folder_prefix: &str,
    ) -> Result<Vec<(String, Option<String>)>, String> {
        let mut st = self
            .conn
            .prepare(
                "SELECT re.file_id, ls.local_path
                   FROM remote_entries re
                   LEFT JOIN local_state ls ON ls.file_id = re.file_id
                  WHERE re.project_id = ?1
                    AND (re.folder_path = ?2 OR re.folder_path LIKE ?2 || '/%')",
            )
            .map_err(|e| e.to_string())?;
        let rows = st
            .query_map(params![project_id, folder_prefix], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?))
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<_, _>>().map_err(|e| e.to_string())
    }

    pub fn mark_evicted(&self, file_id: &str) -> Result<(), String> {
        self.conn
            .execute(
                "UPDATE local_state
                    SET state = 'Cloud', local_path = NULL, local_size = NULL,
                        local_mtime = NULL, synced_etag = NULL, hydrated_at = NULL,
                        error = NULL
                  WHERE file_id = ?1",
                params![file_id],
            )
            .map(|_| ())
            .map_err(|e| format!("mark_evicted {file_id}: {e}"))
    }

    /// Из какой версии сделана копия по этому пути. `None` — записи нет.
    /// Прямые дети папки с глубокими итогами — данные для модалки «Информация».
    ///
    /// Один агрегирующий запрос на уровень: диапазон по логическому пути плюс
    /// `GROUP BY` первого сегмента. Рекурсивный CTE тут не нужен, а
    /// материализованные `n_bytes_deep` пришлось бы пересчитывать вверх по всей
    /// цепочке предков на каждый файл — и однажды пропустить обновление, получив
    /// навсегда врущие цифры без всякого сигнала.
    pub fn subtree_stats(
        &self,
        project_id: &str,
        folder_path: &str,
    ) -> Result<super::SubtreeStats, String> {
        let known = self.tree_at(project_id)?.is_some();

        // Файлы поддерева: сам путь плюс всё, что под ним.
        let (where_sql, like) = if folder_path.is_empty() {
            ("1 = 1".to_string(), String::new())
        } else {
            (
                "(re.folder_path = ?2 OR re.folder_path LIKE ?3)".to_string(),
                format!("{folder_path}/%"),
            )
        };

        // Относительный путь внутри поддерева → первый сегмент = имя ребёнка.
        let rel_sql = if folder_path.is_empty() {
            "re.folder_path".to_string()
        } else {
            "CASE WHEN re.folder_path = ?2 THEN '' \
                  ELSE substr(re.folder_path, length(?2) + 2) END".to_string()
        };

        let sql = format!(
            "SELECT
               CASE WHEN rel = '' THEN ''
                    WHEN instr(rel, '/') > 0 THEN substr(rel, 1, instr(rel, '/') - 1)
                    ELSE rel END AS child,
               COUNT(*),
               IFNULL(SUM(size), 0),
               IFNULL(SUM(is_local), 0),
               IFNULL(SUM(CASE WHEN is_local = 1 THEN size ELSE 0 END), 0)
             FROM (
               SELECT {rel_sql} AS rel,
                      IFNULL(re.size_bytes, 0) AS size,
                      CASE WHEN ls.local_path IS NOT NULL
                            AND ls.state IN ('Fresh','Stale','LocalModified','Conflict')
                           THEN 1 ELSE 0 END AS is_local
                 FROM remote_entries re
                 LEFT JOIN local_state ls ON ls.file_id = re.file_id
                WHERE re.project_id = ?1 AND re.deleted = 0 AND re.is_folder = 0
                  AND {where_sql}
             )
             GROUP BY child
             ORDER BY child"
        );

        let mut st = self.conn.prepare(&sql).map_err(|e| e.to_string())?;
        let map = |r: &rusqlite::Row| -> rusqlite::Result<super::SubtreeChild> {
            let name: String = r.get(0)?;
            Ok(super::SubtreeChild {
                internal: is_internal(&name),
                is_folder: !name.is_empty(),
                name,
                files: r.get(1)?,
                bytes: r.get(2)?,
                local_files: r.get(3)?,
                local_bytes: r.get(4)?,
            })
        };

        let children: Vec<super::SubtreeChild> = if folder_path.is_empty() {
            st.query_map(params![project_id], map)
        } else {
            st.query_map(params![project_id, folder_path, like], map)
        }
        .map_err(|e| e.to_string())?
        .collect::<Result<_, _>>()
        .map_err(|e| e.to_string())?;

        // Пустые папки в группировке не появятся (в них нет файлов), но человек
        // должен их видеть: иначе созданная папка выглядит как несуществующая.
        let mut children = children;
        for e in self.list_dir(project_id, folder_path)? {
            if e.is_folder && !children.iter().any(|c| c.name == e.name) {
                children.push(super::SubtreeChild {
                    internal: is_internal(&e.name),
                    name: e.name,
                    is_folder: true,
                    files: 0,
                    bytes: 0,
                    local_files: 0,
                    local_bytes: 0,
                });
            }
        }
        children.sort_by(|a, b| {
            b.is_folder
                .cmp(&a.is_folder)
                .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
        });

        let files = children.iter().map(|c| c.files).sum();
        let bytes = children.iter().map(|c| c.bytes).sum();
        let local_files = children.iter().map(|c| c.local_files).sum();
        let local_bytes = children.iter().map(|c| c.local_bytes).sum();

        Ok(super::SubtreeStats {
            project_id: project_id.to_string(),
            folder_path: folder_path.to_string(),
            known,
            files,
            bytes,
            local_files,
            local_bytes,
            children,
        })
    }

    pub fn copy_record(
        &self,
        dest_path: &str,
    ) -> Result<Option<(String, Option<String>, Option<String>, Option<i64>)>, String> {
        self.conn
            .query_row(
                "SELECT file_id, src_etag, src_hash, src_size FROM copied_files
                  WHERE dest_path = ?1",
                params![dest_path],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .optional()
            .map_err(|e| e.to_string())
    }

    /// Запомнить, из какой версии скопировали. Без этой записи следующий виток
    /// перекопирует файл заново — то есть вся экономия исчезнет.
    pub fn record_copy(
        &self,
        dest_path: &str,
        file_id: &str,
        src_etag: Option<&str>,
        src_hash: Option<&str>,
        src_size: Option<i64>,
    ) -> Result<(), String> {
        self.conn
            .execute(
                "INSERT INTO copied_files
                    (dest_path, file_id, src_etag, src_hash, src_size, copied_at)
                 VALUES (?1,?2,?3,?4,?5,?6)
                 ON CONFLICT(dest_path) DO UPDATE SET
                    file_id = ?2, src_etag = ?3, src_hash = ?4,
                    src_size = ?5, copied_at = ?6",
                params![dest_path, file_id, src_etag, src_hash, src_size, now_sec()],
            )
            .map(|_| ())
            .map_err(|e| format!("record_copy {dest_path}: {e}"))
    }

    /// Поставить передачу в очередь. Возвращает её id.
    ///
    /// `strategy` = `single` пока: multipart-эндпоинтов на бэкенде нет, но поля
    /// `upload_id`/`parts_done` в схеме уже есть, чтобы потом не менять её.
    pub fn enqueue_transfer(
        &self,
        file_id: Option<&str>,
        project_id: &str,
        direction: &str,
        local_path: &str,
        bytes_total: Option<i64>,
    ) -> Result<i64, String> {
        self.conn
            .execute(
                "INSERT INTO transfers
                    (file_id, project_id, direction, local_path, bytes_total,
                     bytes_done, strategy, state, updated_at)
                 VALUES (?1,?2,?3,?4,?5,0,'single','queued',?6)",
                params![file_id, project_id, direction, local_path, bytes_total, now_sec()],
            )
            .map_err(|e| format!("enqueue_transfer: {e}"))?;
        Ok(self.conn.last_insert_rowid())
    }

    /// Что едет прямо сейчас и что упало. Успешно завершённое НЕ показываем.
    ///
    /// Список — это «что происходит», а не журнал: файл синхронизировался, вопрос
    /// закрыт, и держать его в списке значит закапывать в истории то, что едет
    /// сейчас. Ошибки при этом остаются — ошибка, о которой никто не узнал, это
    /// ошибка, которая повторится (особенно случай «байты уехали, а подтверждение не
    /// прошло»: он требует человека).
    ///
    /// Правило живёт здесь, в запросе, а не в интерфейсе: у списка два потребителя,
    /// и фильтр, скопированный в оба, однажды разъедется.
    pub fn list_transfers(&self, limit: i64) -> Result<Vec<super::TransferRow>, String> {
        let mut st = self
            .conn
            .prepare(
                "SELECT t.id, t.file_id, t.project_id, t.direction, t.local_path,
                        t.bytes_total, t.bytes_done, t.state, t.error, t.updated_at,
                        re.name
                   FROM transfers t
                   LEFT JOIN remote_entries re ON re.file_id = t.file_id
                  WHERE t.state <> 'done'
                  ORDER BY
                    CASE t.state WHEN 'active' THEN 0 WHEN 'queued' THEN 1
                                 WHEN 'error' THEN 2 ELSE 3 END,
                    t.id DESC
                  LIMIT ?1",
            )
            .map_err(|e| e.to_string())?;
        let rows = st
            .query_map(params![limit], |r| {
                let local_path: String = r.get(4)?;
                let name: Option<String> = r.get(10)?;
                Ok(super::TransferRow {
                    id: r.get(0)?,
                    file_id: r.get(1)?,
                    project_id: r.get(2)?,
                    direction: r.get(3)?,
                    // Имя берём из каталога, а если файла там ещё нет (заливка
                    // нового) — из пути на диске.
                    name: name.unwrap_or_else(|| {
                        std::path::Path::new(&local_path)
                            .file_name()
                            .map(|s| s.to_string_lossy().to_string())
                            .unwrap_or_else(|| local_path.clone())
                    }),
                    bytes_total: r.get(5)?,
                    bytes_done: r.get(6)?,
                    state: r.get(7)?,
                    error: r.get(8)?,
                    updated_at: r.get(9)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<_, _>>().map_err(|e| e.to_string())
    }

    /// Одна строка передачи — для повтора и снятия задачи.
    pub fn transfer_row(&self, id: i64) -> Result<Option<(String, String, String)>, String> {
        self.conn
            .query_row(
                "SELECT direction, local_path, state FROM transfers WHERE id = ?1",
                params![id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .optional()
            .map_err(|e| format!("transfer_row {id}: {e}"))
    }

    /// Убрать одну задачу из списка.
    ///
    /// Нужно ровно для упавших: пока строка висит, человек не может отличить «эта
    /// ошибка ещё актуальна» от «я про неё уже знаю». Строка передачи — не архив, её
    /// незачем хранить после того, как с ней разобрались.
    pub fn delete_transfer(&self, id: i64) -> Result<(), String> {
        self.conn
            .execute("DELETE FROM transfers WHERE id = ?1", params![id])
            .map(|_| ())
            .map_err(|e| format!("delete_transfer {id}: {e}"))
    }

    /// Убрать из истории всё завершённое — кнопка «очистить».
    pub fn clear_finished_transfers(&self) -> Result<i64, String> {
        self.conn
            .execute("DELETE FROM transfers WHERE state IN ('done','error')", [])
            .map(|n| n as i64)
            .map_err(|e| e.to_string())
    }

    pub fn set_transfer_progress(&self, id: i64, bytes_done: i64) -> Result<(), String> {
        self.conn
            .execute(
                "UPDATE transfers SET bytes_done = ?2, state = 'active', updated_at = ?3
                  WHERE id = ?1",
                params![id, bytes_done, now_sec()],
            )
            .map(|_| ())
            .map_err(|e| format!("set_transfer_progress {id}: {e}"))
    }

    pub fn finish_transfer(&self, id: i64, error: Option<&str>) -> Result<(), String> {
        let state = if error.is_some() { "error" } else { "done" };
        self.conn
            .execute(
                "UPDATE transfers SET state = ?2, error = ?3, updated_at = ?4 WHERE id = ?1",
                params![id, state, error, now_sec()],
            )
            .map(|_| ())
            .map_err(|e| format!("finish_transfer {id}: {e}"))
    }
}

/// Какой сайдкар описывает событие журнала. `None` — обычный файл или папка.
///
/// Смотрим на логические `name`/`folder_path` события, а не на `key`: у сайдкара
/// ключ канонический, но полагаться на его форму незачем — логическая пара точнее.
fn sidecar_of_change(c: &Change) -> Option<Sidecar> {
    if c.is_folder.unwrap_or(false) {
        return None;
    }
    Sidecar::from_logical(c.folder_path.as_deref()?, c.name.as_deref()?)
}

/// s3-ключ из события журнала — только у файлов (см. вызов в `apply_delta`).
fn delta_s3_key(c: &Change) -> Option<String> {
    if c.is_folder.unwrap_or(false) || c.key.trim().is_empty() {
        return None;
    }
    Some(c.key.clone())
}

/// `options` и всё с подчёркиванием — служебное. Правило по существующей
/// конвенции проекта (`_stats`, `_post`, `_collect_pending.json`), одно на
/// программу и бэкенд.
pub fn is_internal(name: &str) -> bool {
    name.starts_with('_') || name == "options"
}

fn now_sec() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

// ─── Тесты ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    /// В списке передач нет места тому, что уже синхронизировалось, — но ошибка
    /// остаётся: иначе про неудачную заливку человек не узнает никогда.
    #[test]
    fn список_передач_без_завершённых_но_с_ошибками() {
        let idx = Index::open_in_memory().unwrap();

        let едет = idx
            .enqueue_transfer(None, "p1", "up", "/m/везёт.mp4", Some(100))
            .unwrap();
        let готово = idx
            .enqueue_transfer(None, "p1", "up", "/m/доехал.mp4", Some(100))
            .unwrap();
        let упало = idx
            .enqueue_transfer(None, "p1", "down", "/m/сломался.mp4", Some(100))
            .unwrap();

        idx.finish_transfer(готово, None).unwrap();
        idx.finish_transfer(упало, Some("PUT вернул 403")).unwrap();

        let ids: Vec<i64> = idx.list_transfers(50).unwrap().into_iter().map(|t| t.id).collect();

        assert!(ids.contains(&едет), "то, что едет, обязано быть в списке");
        assert!(ids.contains(&упало), "ошибку скрывать нельзя — она повторится");
        assert!(
            !ids.contains(&готово),
            "успешно завершённое в списке не держим: он про то, что происходит сейчас"
        );
    }

    fn entry(id: &str, folder: &str, name: &str, is_folder: bool, size: i64) -> TreeEntry {
        TreeEntry {
            id: id.into(),
            project_id: "p1".into(),
            folder_path: folder.into(),
            name: name.into(),
            is_folder,
            s3_key: if is_folder {
                None
            } else {
                Some(format!("innohub/projects/p1/{folder}/uuid-{name}"))
            },
            size_bytes: Some(size),
            content_type: Some("video/mp4".into()),
            etag: Some("e1".into()),
            content_hash: None,
            origin_mtime: None,
            created_at: None,
            updated_at: None,
            last_seq: Some(1),
        }
    }

    fn change(seq: i64, op: ChangeOp, file_id: &str, folder: &str, name: &str) -> Change {
        Change {
            seq,
            op,
            key: format!("innohub/projects/p1/{folder}/{name}"),
            project_id: "p1".into(),
            file_id: Some(file_id.into()),
            name: Some(name.into()),
            folder_path: Some(folder.into()),
            is_folder: Some(false),
            size: Some(10),
            etag: Some("e2".into()),
            content_hash: None,
            content_type: None,
            event_time: None,
        }
    }

    #[test]
    fn миграция_идемпотентна() {
        let idx = Index::open_in_memory().unwrap();
        assert_eq!(idx.user_version().unwrap(), SCHEMA_VERSION);
        // Повторный прогон не должен падать на «table already exists».
        idx.migrate().unwrap();
        assert_eq!(idx.user_version().unwrap(), SCHEMA_VERSION);
    }

    #[test]
    fn tree_заменяет_проект_целиком() {
        let mut idx = Index::open_in_memory().unwrap();
        idx.apply_tree("p1", &[entry("f1", "IN", "a.mov", false, 100)], 10)
            .unwrap();
        assert_eq!(idx.list_dir("p1", "IN").unwrap().len(), 1);

        // Во втором /tree файла больше нет → он должен исчезнуть и у нас.
        idx.apply_tree("p1", &[entry("f2", "IN", "b.mov", false, 200)], 20)
            .unwrap();
        let list = idx.list_dir("p1", "IN").unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].name, "b.mov");
        assert_eq!(idx.cursor("p1").unwrap(), 20);
    }

    #[test]
    fn папки_идут_перед_файлами() {
        let mut idx = Index::open_in_memory().unwrap();
        idx.apply_tree(
            "p1",
            &[
                entry("f1", "", "zzz.mov", false, 1),
                entry("d1", "", "OUT", true, 0),
                entry("f2", "", "aaa.mov", false, 1),
            ],
            1,
        )
        .unwrap();
        let names: Vec<_> = idx
            .list_dir("p1", "")
            .unwrap()
            .into_iter()
            .map(|e| e.name)
            .collect();
        assert_eq!(names, vec!["OUT", "aaa.mov", "zzz.mov"]);
    }

    #[test]
    fn переименование_сохраняет_file_id() {
        let mut idx = Index::open_in_memory().unwrap();
        idx.apply_tree("p1", &[entry("f1", "IN", "old.mov", false, 100)], 1)
            .unwrap();

        // Так это приходит от бэкенда: delete старого ключа + put нового, ОДИН file_id.
        let st = idx
            .apply_delta(
                "p1",
                &[
                    change(2, ChangeOp::Delete, "f1", "IN", "old.mov"),
                    change(3, ChangeOp::Put, "f1", "OUT", "new.mov"),
                ],
                3,
            )
            .unwrap();
        assert!(!st.needs_resync);

        // Файл переехал, но это ТА ЖЕ запись — значит на диске переименование,
        // а не перекачивание.
        assert!(idx.list_dir("p1", "IN").unwrap().is_empty());
        let out = idx.list_dir("p1", "OUT").unwrap();
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].id, "f1");
        assert_eq!(out[0].name, "new.mov");
    }

    /// Ключ из журнала обязан попадать в `s3_key` — иначе плодим сирот в бакете.
    ///
    /// Стоимость потери ключа не абстрактная: без него следующая заливка в тот же
    /// путь не может передать существующий ключ, бэкенд выписывает новый
    /// `{uuid}-имя`, и прежний объект остаётся в R2 навсегда.
    #[test]
    fn ключ_из_дельты_попадает_в_s3_key() {
        let mut idx = Index::open_in_memory().unwrap();
        let c = change(2, ChangeOp::Put, "f7", "IN", "новый.mov");
        let expected = c.key.clone();
        idx.apply_delta("p1", &[c], 2).unwrap();

        assert_eq!(
            idx.entry("f7").unwrap().unwrap().s3_key.as_deref(),
            Some(expected.as_str()),
            "ключ файла из журнала — настоящий s3_key, его надо запоминать"
        );
    }

    /// У ПАПКИ ключа не существует: в журнале там логический путь, и записать его
    /// в `s3_key` значило бы соврать — по нему потом попытаются скачать объект.
    #[test]
    fn у_папки_из_дельты_ключа_не_появляется() {
        let mut idx = Index::open_in_memory().unwrap();
        let mut c = change(2, ChangeOp::Put, "d7", "", "IN");
        c.is_folder = Some(true);
        idx.apply_delta("p1", &[c], 2).unwrap();

        assert_eq!(
            idx.entry("d7").unwrap().unwrap().s3_key,
            None,
            "у логической папки объекта в R2 нет, значит и ключа быть не должно"
        );
    }

    /// Событие сайдкара приходит без `file_id` ВСЕГДА — строки в каталоге у него нет.
    ///
    /// Раньше такое событие считалось неприменимым и вызывало полный `/tree`: каждое
    /// переключение тумблера на сайте стоило нам обхода всего проекта.
    #[test]
    fn событие_сайдкара_не_требует_полного_обхода() {
        let mut idx = Index::open_in_memory().unwrap();
        let mut c = change(2, ChangeOp::Put, "unused", "options", "folderState.json");
        c.file_id = None;

        let st = idx.apply_delta("p1", &[c], 2).unwrap();

        assert!(
            !st.needs_resync,
            "сайдкар без file_id — это норма контракта, а не дыра в индексе"
        );
        assert_eq!(st.sidecars_dirty, Sidecar::FolderState.bit());
        assert_eq!(
            Sidecar::from_mask(st.sidecars_dirty).collect::<Vec<_>>(),
            vec![Sidecar::FolderState]
        );
    }

    #[test]
    fn put_без_логического_пути_требует_resync() {
        let mut idx = Index::open_in_memory().unwrap();
        let mut c = change(2, ChangeOp::Put, "f9", "IN", "x.mov");
        c.folder_path = None;
        let st = idx.apply_delta("p1", &[c], 2).unwrap();
        assert!(st.needs_resync, "молча пропускать такое нельзя");
        assert_eq!(st.upserted, 0);
        // Курсор всё равно продвинулся — иначе будем крутить одну и ту же страницу.
        assert_eq!(idx.cursor("p1").unwrap(), 2);
    }

    #[test]
    fn удаление_ставит_tombstone_а_не_рвёт_строку() {
        let mut idx = Index::open_in_memory().unwrap();
        idx.apply_tree("p1", &[entry("f1", "IN", "a.mov", false, 1)], 1)
            .unwrap();
        idx.apply_delta("p1", &[change(2, ChangeOp::Delete, "f1", "IN", "a.mov")], 2)
            .unwrap();

        assert!(idx.list_dir("p1", "IN").unwrap().is_empty());
        // Строка на месте: связь с local_state не потеряна.
        assert!(idx.entry("f1").unwrap().is_some());
    }

    #[test]
    fn пустой_индекс_отличим_от_несинхронизированного() {
        let mut idx = Index::open_in_memory().unwrap();
        assert_eq!(idx.tree_at("p1").unwrap(), None, "ещё не синхронизировали");

        idx.apply_tree("p1", &[], 0).unwrap();
        assert!(
            idx.tree_at("p1").unwrap().is_some(),
            "синхронизировали, и там правда пусто"
        );
    }

    #[test]
    fn поиск_записи_по_логическому_пути() {
        let mut idx = Index::open_in_memory().unwrap();
        idx.apply_tree("p1", &[entry("f1", "IN", "a.mov", false, 1)], 1)
            .unwrap();
        let found = idx.entry_by_path("p1", "IN", "a.mov").unwrap();
        assert_eq!(found.map(|e| e.id), Some("f1".into()));
        assert!(idx.entry_by_path("p1", "IN", "нет.mov").unwrap().is_none());
    }

    /// Архивность обязана доезжать до индекса и обратно.
    ///
    /// По ней принимаются два решения: раннер пропускает проект, интерфейс рисует
    /// значок. Потеряется в `replace_projects` — архивный проект молча пойдёт в
    /// обработку, а это прямое нарушение контракта storage-API.
    #[test]
    fn архивность_проекта_доезжает_до_индекса() {
        let mut idx = Index::open_in_memory().unwrap();
        let mut resp = ProjectsResponse::default();
        resp.projects = vec![
            RemoteProject {
                id: "p1".into(),
                name: "Живой".into(),
                client_id: None,
                user_id: None,
                group_name: "personal".into(),
                is_active: true,
                is_paused: false,
                is_archived: false,
                archived_at: None,
                updated_at: "2026-08-11T00:00:00.000Z".into(),
            },
            RemoteProject {
                id: "p2".into(),
                name: "Архивный".into(),
                client_id: None,
                user_id: None,
                // Архив НЕ выводится из `group_name`: группа отвечает только за
                // раскладку интерфейса сайта, а статус живёт в своём поле.
                group_name: "personal".into(),
                is_active: true,
                is_paused: false,
                is_archived: true,
                archived_at: Some("2026-08-01T10:00:00.000Z".into()),
                updated_at: "2026-08-11T00:00:00.000Z".into(),
            },
        ];
        idx.replace_projects(&resp).unwrap();

        let got = idx.projects(None).unwrap();
        let alive = got.iter().find(|p| p.id == "p1").unwrap();
        let archived = got.iter().find(|p| p.id == "p2").unwrap();
        assert!(!alive.is_archived);
        assert!(archived.is_archived);
        assert_eq!(archived.archived_at.as_deref(), Some("2026-08-01T10:00:00.000Z"));
    }

    #[test]
    fn проекты_фильтруются_по_клиенту() {
        let mut idx = Index::open_in_memory().unwrap();
        idx.replace_projects(&ProjectsResponse {
            clients: vec![RemoteClient {
                id: "c1".into(),
                display_name: "Мегафон".into(),
            }],
            users: vec![],
            projects: vec![
                RemoteProject {
                    id: "p1".into(),
                    name: "Реклама Q3".into(),
                    client_id: Some("c1".into()),
                    user_id: None,
                    group_name: "personal".into(),
                    is_active: true,
                    is_paused: false,
                    is_archived: false,
                    archived_at: None,
                    updated_at: "2026-08-07T00:00:00.000Z".into(),
                },
                RemoteProject {
                    id: "p2".into(),
                    name: "Без клиента".into(),
                    client_id: None,
                    user_id: None,
                    group_name: "personal".into(),
                    is_active: true,
                    is_paused: false,
                    is_archived: false,
                    archived_at: None,
                    updated_at: "2026-08-07T00:00:00.000Z".into(),
                },
            ],
        })
        .unwrap();

        assert_eq!(idx.clients().unwrap().len(), 1);
        assert_eq!(idx.projects(None).unwrap().len(), 2);
        let of_c1 = idx.projects(Some("c1")).unwrap();
        assert_eq!(of_c1.len(), 1);
        assert_eq!(of_c1[0].id, "p1");
    }
}
