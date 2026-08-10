// Мок бэкенда: отдаёт заготовленные ответы вместо HTTP.
//
// Нужен не только на время ожидания доступов. Он позволяет разрабатывать и
// проверять всё, что выше HTTP-слоя, и остаётся полезным навсегда: тесты,
// воспроизведение багов, показ интерфейса без сети.
//
// Формы ответов сняты с реального кода роутов `innovation-hub`, не выдуманы, —
// иначе мок и живой бэкенд перестали бы быть взаимозаменяемыми.
//
// Умеет специально ломаться: пагинация журнала, `truncated`, отказ на следующем
// вызове. Без этого цикл догона дельт не проверить.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use super::types::*;

#[derive(Debug, Clone, Default)]
pub struct MockState {
    pub caps: Capabilities,
    pub projects: ProjectsResponse,
    /// project_id → полное дерево, как его отдал бы `/tree`.
    pub trees: HashMap<String, Vec<TreeEntry>>,
    /// project_id → журнал, упорядоченный по `seq`.
    pub journal: HashMap<String, Vec<Change>>,
    /// Сколько событий отдавать за один `/delta`. У бэкенда 5000; в тестах — 1–2,
    /// чтобы цикл догона реально прокручивался.
    pub page_size: usize,
    /// Если `since` меньше этого — отвечаем `truncated`, как бэкенд на курсоре
    /// старше окна хранения журнала (~90 дней).
    pub truncate_before: i64,
    /// Сработает один раз на следующем любом вызове и сбросится.
    pub fail_next: Option<StorageError>,
    /// Уронить именно `notify`, не задев presign. Нужно, чтобы проверить главное
    /// свойство заливки: байты уехали, а подтверждение не прошло — это НЕ успех.
    pub fail_notify: bool,
    /// Изображает баг на той стороне: страница с событиями, но курсор не растёт.
    /// Нужен, чтобы проверить защиту от бесконечного цикла догона — сам по себе
    /// корректный бэкенд такого не делает.
    pub freeze_cursor: bool,
    /// Куда указывать presigned-ссылкам. `None` — на несуществующий хост, чтобы
    /// случайная попытка реально что-то скачать в тесте падала явно.
    pub presign_base: Option<String>,
    /// Счётчики — чтобы тест мог убедиться, что лишних запросов нет.
    pub tree_calls: usize,
    pub delta_calls: usize,
    pub notify_calls: usize,
    /// Последний `notify`: ключ, content_hash, origin_mtime. Тест проверяет, что
    /// мы действительно присылаем хэш и время, а не молча их теряем.
    pub last_notify: Option<(String, Option<String>, Option<i64>)>,
}

#[derive(Debug, Clone)]
pub struct MockApi {
    state: Arc<Mutex<MockState>>,
}

impl Default for MockApi {
    fn default() -> Self {
        Self::new(MockState {
            page_size: 5000,
            ..Default::default()
        })
    }
}

impl MockApi {
    pub fn new(state: MockState) -> Self {
        let page_size = if state.page_size == 0 {
            5000
        } else {
            state.page_size
        };
        Self {
            state: Arc::new(Mutex::new(MockState { page_size, ..state })),
        }
    }

    /// Общий Arc состояния — нужен демо-серверу, чтобы отдавать файлы того же
    /// размера, что объявлены в каталоге.
    pub fn state_arc(&self) -> Arc<Mutex<MockState>> {
        self.state.clone()
    }

    /// Доступ к состоянию: тест настраивает мок и проверяет счётчики.
    pub fn with<R>(&self, f: impl FnOnce(&mut MockState) -> R) -> R {
        let mut g = self.state.lock().expect("mock state poisoned");
        f(&mut g)
    }

    fn take_failure(&self) -> Option<StorageError> {
        self.with(|s| s.fail_next.take())
    }

    // ─── Те же методы, что у StorageApi ──────────────────────────────────────

    pub async fn capabilities(&self) -> StorageResult<Capabilities> {
        if let Some(e) = self.take_failure() {
            return Err(e);
        }
        Ok(self.with(|s| s.caps.clone()))
    }

    pub async fn projects(&self) -> StorageResult<ProjectsResponse> {
        if let Some(e) = self.take_failure() {
            return Err(e);
        }
        Ok(self.with(|s| s.projects.clone()))
    }

    pub async fn tree(
        &self,
        project_id: &str,
        prefix: Option<&str>,
    ) -> StorageResult<TreeResponse> {
        if let Some(e) = self.take_failure() {
            return Err(e);
        }
        self.with(|s| {
            s.tree_calls += 1;
            let all = s.trees.get(project_id).cloned().unwrap_or_default();
            let entries = match prefix {
                None | Some("") => all,
                Some(p) => all
                    .into_iter()
                    .filter(|e| e.folder_path == p || e.folder_path.starts_with(&format!("{p}/")))
                    .collect(),
            };
            // Курсор после bootstrap — последний seq журнала: ровно так ведёт себя
            // бэкенд, отдавая `cursor` вместе с деревом.
            let cursor = s
                .journal
                .get(project_id)
                .and_then(|j| j.last().map(|c| c.seq))
                .unwrap_or(0);
            Ok(TreeResponse { entries, cursor })
        })
    }

    pub async fn delta(&self, project_id: &str, since: i64) -> StorageResult<DeltaResponse> {
        if let Some(e) = self.take_failure() {
            return Err(e);
        }
        self.with(|s| {
            s.delta_calls += 1;

            if since > 0 && since < s.truncate_before {
                // Бэкенд в этом случае не отдаёт события: клиент обязан пойти в /tree.
                return Ok(DeltaResponse {
                    changes: vec![],
                    cursor: since,
                    truncated: true,
                });
            }

            let page = s.page_size;
            let all = s.journal.get(project_id).cloned().unwrap_or_default();
            let changes: Vec<Change> = all
                .into_iter()
                .filter(|c| c.seq > since)
                .take(page)
                .collect();
            let cursor = if s.freeze_cursor {
                since
            } else {
                changes.last().map(|c| c.seq).unwrap_or(since)
            };
            Ok(DeltaResponse {
                changes,
                cursor,
                truncated: false,
            })
        })
    }

    /// Регистрирует файл в дереве мока — как это делает бэкенд, добавляя строку
    /// в Postgres. Считает вызовы: тест проверяет, что заливка без `notify` не
    /// считается успешной.
    pub async fn notify(
        &self,
        args: super::client::NotifyArgs<'_>,
    ) -> StorageResult<ProjectFile> {
        if let Some(e) = self.take_failure() {
            return Err(e);
        }
        if self.with(|s| s.fail_notify) {
            return Err(StorageError::Other("notify упал".into()));
        }
        let file = ProjectFile {
            id: format!("mock-{}-{}", args.folder_path, args.file_name),
            project_id: args.project_id.to_string(),
            folder_path: args.folder_path.to_string(),
            name: args.file_name.to_string(),
            is_folder: false,
            s3_key: Some(args.s3_key.to_string()),
            size_bytes: args.size_bytes,
            content_type: args.content_type.map(|s| s.to_string()),
            created_at: None,
        };
        self.with(|s| {
            s.notify_calls += 1;
            s.last_notify = Some((
                args.s3_key.to_string(),
                args.content_hash.map(|s| s.to_string()),
                args.origin_mtime,
            ));
        });
        Ok(file)
    }

    pub async fn presign_get(
        &self,
        _project_id: &str,
        s3_key: &str,
        ttl_sec: Option<i64>,
    ) -> StorageResult<PresignResponse> {
        if let Some(e) = self.take_failure() {
            return Err(e);
        }
        let base = self.with(|s| s.presign_base.clone());
        let url = match base {
            Some(b) => format!("{}/{}", b.trim_end_matches('/'), s3_key),
            None => format!("https://mock.invalid/get/{s3_key}"),
        };
        Ok(PresignResponse {
            url,
            s3_key: s3_key.to_string(),
            file_name: None,
            folder_path: None,
            content_type: None,
            expires_in: ttl_sec.or(Some(3600)),
        })
    }

    pub async fn presign_put(
        &self,
        project_id: &str,
        folder_path: &str,
        file_name: &str,
        content_type: &str,
        ttl_sec: Option<i64>,
    ) -> StorageResult<PresignResponse> {
        if let Some(e) = self.take_failure() {
            return Err(e);
        }
        // Ключ назначает бэкенд и вставляет uuid — повторяем форму, чтобы код,
        // который случайно попытается вывести из ключа логический путь, сломался
        // на моке, а не в проде.
        let s3_key =
            format!("innohub/projects/{project_id}/{folder_path}/00000000-{file_name}");
        let base = self.with(|s| s.presign_base.clone());
        let url = match base {
            Some(b) => format!("{}/{}", b.trim_end_matches('/'), s3_key),
            None => format!("https://mock.invalid/put/{s3_key}"),
        };
        Ok(PresignResponse {
            url,
            s3_key,
            file_name: Some(file_name.to_string()),
            folder_path: Some(folder_path.to_string()),
            content_type: Some(content_type.to_string()),
            expires_in: ttl_sec.or(Some(3600)),
        })
    }
}

// ─── Демо-данные ─────────────────────────────────────────────────────────────

/// Небольшой правдоподобный набор: два клиента, три проекта, дерево с файлами.
///
/// Размеры намеренно десятки мегабайт, а не гигабайты: демо-сервер отдаёт ровно
/// столько байт, сколько объявлено, и гигабайтная демо-загрузка была бы мучением.
/// Прогресс при этом виден — на десятках мегабайт он успевает отрисоваться.
///
/// Нужен, чтобы интерфейс можно было строить и показывать до появления живого
/// бэкенда. Данные ненастоящие, и `status.mock = true` обязан быть виден в UI —
/// иначе легко принять фикстуры за настоящее хранилище.
pub fn demo_state() -> MockState {
    let clients = vec![
        RemoteClient { id: "c1".into(), display_name: "Мегафон".into() },
        RemoteClient { id: "c2".into(), display_name: "Внутренние".into() },
    ];
    let projects = vec![
        proj("p1", "Реклама Q3", Some("c1")),
        proj("p2", "Ролики для соцсетей", Some("c1")),
        proj("p3", "Шоурил студии", Some("c2")),
    ];

    let mut trees = HashMap::new();
    trees.insert(
        "p1".to_string(),
        vec![
            dir("p1", "d-in", "", "IN"),
            dir("p1", "d-out", "", "OUT"),
            dir("p1", "d-opt", "", "options"),
            dir("p1", "d-mus", "", "music"),
            file("p1", "f-opt", "options", "options.json", 4_096, "text/plain"),
            file("p1", "f-st", "options", "folderState.json", 512, "application/json"),
            file("p1", "f-in1", "IN", "исходник_01.mov", 48_000_000, "video/quicktime"),
            file("p1", "f-in2", "IN", "исходник_02.mov", 31_500_000, "video/quicktime"),
            file("p1", "f-out1", "OUT", "ролик_финал.mp4", 12_800_000, "video/mp4"),
            file("p1", "f-mus1", "music", "трек.mp3", 8_400_000, "audio/mpeg"),
        ],
    );
    trees.insert(
        "p2".to_string(),
        vec![
            dir("p2", "d2-in", "", "IN"),
            dir("p2", "d2-out", "", "OUT"),
            file("p2", "f2-1", "IN", "сырец.mp4", 22_000_000, "video/mp4"),
        ],
    );
    // p3 намеренно пустой: интерфейс должен различать «пусто» и «ещё не смотрели».
    trees.insert("p3".to_string(), vec![]);

    MockState {
        caps: Capabilities {
            api_version: 1,
            rename: true,
            clients: true,
            origin_mtime: true,
            content_hash: true,
            ..Default::default()
        },
        projects: ProjectsResponse { clients, projects },
        trees,
        ..Default::default()
    }
}

fn proj(id: &str, name: &str, client: Option<&str>) -> RemoteProject {
    RemoteProject {
        id: id.into(),
        name: name.into(),
        client_id: client.map(|s| s.to_string()),
        group_name: "personal".into(),
        is_active: true,
        is_paused: false,
        updated_at: "2026-08-07T09:00:00.000Z".into(),
    }
}

fn dir(project: &str, id: &str, folder: &str, name: &str) -> TreeEntry {
    TreeEntry {
        id: id.into(),
        project_id: project.into(),
        folder_path: folder.into(),
        name: name.into(),
        is_folder: true,
        s3_key: None,
        size_bytes: None,
        content_type: None,
        etag: None,
        content_hash: None,
        origin_mtime: None,
        created_at: None,
        updated_at: None,
        last_seq: None,
    }
}

fn file(
    project: &str,
    id: &str,
    folder: &str,
    name: &str,
    size: i64,
    ct: &str,
) -> TreeEntry {
    TreeEntry {
        id: id.into(),
        project_id: project.into(),
        folder_path: folder.into(),
        name: name.into(),
        is_folder: false,
        s3_key: Some(format!("innohub/projects/{project}/{folder}/uuid-{name}")),
        size_bytes: Some(size),
        content_type: Some(ct.into()),
        etag: Some(format!("etag-{id}")),
        content_hash: None,
        origin_mtime: Some(1_754_000_000),
        created_at: None,
        updated_at: None,
        last_seq: None,
    }
}
