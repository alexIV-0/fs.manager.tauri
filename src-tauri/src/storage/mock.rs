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
    /// Сайдкары: `"<project_id>/<api_name>"` → тело. В отличие от файлов, у них нет
    /// ни строки в каталоге, ни ключа — только содержимое по фиксированному адресу,
    /// поэтому и в моке это просто карта строк.
    pub sidecars: HashMap<String, String>,
    /// Общие словари: домен → записи, плюс глобальная ревизия. Ведёт себя как
    /// бэкенд: ревизия растёт на КАЖДУЮ запись, даже если содержимое то же —
    /// это счётчик версии для оптимистической блокировки, а не хеш состояния.
    pub settings: HashMap<String, Vec<SettingsEntry>>,
    pub settings_revision: i64,
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

    // ─── Сайдкары ────────────────────────────────────────────────────────────

    pub async fn sidecar_get(
        &self,
        project_id: &str,
        which: Sidecar,
    ) -> StorageResult<Option<String>> {
        if let Some(e) = self.take_failure() {
            return Err(e);
        }
        let key = sidecar_key(project_id, which);
        Ok(self.with(|s| s.sidecars.get(&key).cloned()))
    }

    pub async fn sidecar_put(
        &self,
        project_id: &str,
        which: Sidecar,
        body: &str,
        _if_match: Option<&str>,
    ) -> StorageResult<Option<String>> {
        if let Some(e) = self.take_failure() {
            return Err(e);
        }
        let key = sidecar_key(project_id, which);
        let body = body.to_string();
        // etag изображаем длиной: сравнение «то же самое или нет» на нём работает,
        // а больше от него в моке ничего не требуется.
        let etag = format!("mock-{}", body.len());
        self.with(|s| s.sidecars.insert(key, body));
        Ok(Some(etag))
    }

    // ─── Очередь задач ───────────────────────────────────────────────────────
    //
    // У демо-режима очереди нет и быть не должно: фикстуры изображают ХРАНИЛИЩЕ, а
    // очередь — это состояние сайта, живущее в его базе. Поэтому `claim` всегда
    // отвечает «пусто», а отчёты молча принимаются: воркер на моке крутится вхолостую
    // и ничего не ломает, вместо того чтобы падать на каждом запросе.

    pub async fn queue_ping(&self, _machine: &super::client::MachineRef<'_>) -> StorageResult<i64> {
        // Ревизия сейфа всегда 0: сейфа у демо-режима нет, и «она не менялась» —
        // единственный честный ответ. Иначе мок гонял бы клиента за ключами.
        Ok(0)
    }

    /// Сейфа в демо-режиме нет: все запрошенные сервисы недоступны.
    ///
    /// Не пустой ответ, а именно `unavailable` — пустой означал бы «спросили ни о
    /// чём», и гейт пропустил бы задачу без ключей дальше.
    pub async fn vault_keys(
        &self,
        services: &[String],
        _known: &std::collections::BTreeMap<String, VendorKnownKey>,
        _accounts: &std::collections::BTreeMap<String, String>,
        _task_id: Option<&str>,
    ) -> StorageResult<VendorKeysResponse> {
        Ok(VendorKeysResponse {
            unavailable: services.to_vec(),
            ..Default::default()
        })
    }

    pub async fn vault_usage(
        &self,
        _task_id: &str,
        _project_id: Option<&str>,
        _entries: &[VendorUsageEntry],
    ) -> StorageResult<VendorUsageResult> {
        Ok(VendorUsageResult::default())
    }

    pub async fn queue_claim(
        &self,
        _machine: &super::client::MachineRef<'_>,
    ) -> StorageResult<Option<QueueTask>> {
        Ok(None)
    }

    pub async fn queue_progress(
        &self,
        _machine: &super::client::MachineRef<'_>,
        _task_id: &str,
        _step_id: &str,
        _status: QueueStepStatus,
        _message: Option<&str>,
    ) -> StorageResult<()> {
        Ok(())
    }

    pub async fn queue_done(
        &self,
        _machine: &super::client::MachineRef<'_>,
        _task_id: &str,
        _out_files: Vec<String>,
        _total_cost: f64,
    ) -> StorageResult<()> {
        Ok(())
    }

    pub async fn queue_failed(
        &self,
        _machine: &super::client::MachineRef<'_>,
        _task_id: &str,
        _error: &str,
    ) -> StorageResult<()> {
        Ok(())
    }

    pub async fn queue_release(
        &self,
        _machine: &super::client::MachineRef<'_>,
        _task_id: &str,
    ) -> StorageResult<()> {
        Ok(())
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
                    settings_revision: Some(s.settings_revision),
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
                settings_revision: Some(s.settings_revision),
            })
        })
    }

    /// Общие словари. Пустой список доменов — все.
    pub async fn settings_get(&self, domains: &[String]) -> StorageResult<SettingsDocument> {
        if let Some(e) = self.take_failure() {
            return Err(e);
        }
        self.with(|s| {
            let out: HashMap<String, Vec<SettingsEntry>> = if domains.is_empty() {
                s.settings.clone()
            } else {
                domains
                    .iter()
                    .filter_map(|d| s.settings.get(d).map(|v| (d.clone(), v.clone())))
                    .collect()
            };
            Ok(SettingsDocument {
                revision: s.settings_revision,
                domains: out,
            })
        })
    }

    /// Запись словарей. Мок повторяет главное свойство бэкенда — проверку ревизии:
    /// не совпала, значит между чтением и записью кто-то успел записать, и клиент
    /// обязан слить три стороны. Без этого 409-ветку клиента нечем проверить.
    pub async fn settings_put(
        &self,
        base_revision: i64,
        domains: serde_json::Value,
    ) -> StorageResult<SettingsPutResult> {
        if let Some(e) = self.take_failure() {
            return Err(e);
        }
        self.with(|s| {
            if base_revision != s.settings_revision {
                return Ok(SettingsPutResult {
                    conflict: true,
                    document: SettingsDocument {
                        revision: s.settings_revision,
                        domains: s.settings.clone(),
                    },
                });
            }

            let parsed: HashMap<String, Vec<SettingsEntry>> =
                serde_json::from_value(domains).map_err(|e| {
                    StorageError::Other(format!("мок: не разобраны домены настроек: {e}"))
                })?;
            for (domain, entries) in parsed {
                s.settings.insert(domain, entries);
            }
            s.settings_revision += 1;

            Ok(SettingsPutResult {
                conflict: false,
                document: SettingsDocument {
                    revision: s.settings_revision,
                    domains: s.settings.clone(),
                },
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
        // Бэкенд ищет строку по `s3_key` (`writeNotifyUpload`) и при совпадении
        // ОБНОВЛЯЕТ её, сохраняя `file_id`. Мок обязан вести себя так же: иначе он
        // прячет главное свойство перезаливки — что перерендер не плодит дубль и
        // не рвёт историю файла.
        let existing_id = self.with(|s| {
            s.trees
                .get(args.project_id)
                .and_then(|entries| {
                    entries
                        .iter()
                        .find(|e| e.s3_key.as_deref() == Some(args.s3_key))
                })
                .map(|e| e.id.clone())
        });
        let file = ProjectFile {
            id: existing_id
                .unwrap_or_else(|| format!("mock-{}-{}", args.folder_path, args.file_name)),
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
        if let Some(e) = self.take_failure() {
            return Err(e);
        }
        // Ключ назначает бэкенд и вставляет uuid — повторяем форму, чтобы код,
        // который случайно попытается вывести из ключа логический путь, сломался
        // на моке, а не в проде.
        //
        // Присланный ключ уважаем так же, как настоящий бэкенд: перезаливка
        // известного файла обязана идти в ТОТ ЖЕ объект, иначе в каталоге
        // появляется дубль с тем же именем.
        let s3_key = match s3_key {
            Some(k) => k.to_string(),
            // С сегментом владельца, как настоящий бэкенд
            // (`projectUploadObjectKey(access.ownerId, …)`). Из этого ключа
            // определяется владелец проекта — в том числе у пустого проекта, где
            // других ключей взять негде. Без сегмента мок прятал бы весь механизм.
            None => format!(
                "innohub/projects/{}/{project_id}/{folder_path}/00000000-{file_name}",
                owner_of(project_id)
            ),
        };
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

fn sidecar_key(project_id: &str, which: Sidecar) -> String {
    format!("{project_id}/{}", which.api_name())
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
        projects: ProjectsResponse {
            clients,
            // Имя есть только у одного владельца — чтобы демо показывало ОБА случая:
            // папку с человеческим именем и папку, названную идентификатором (так
            // будет выглядеть жизнь, пока бэкенд имён не отдаёт).
            users: vec![RemoteUser {
                id: owner_of("p1").to_string(),
                // Папка подписывается ИМЕННО email'ом — так же будет в жизни.
                email: "anya@studio.example".into(),
                full_name: "Аня Смирнова".into(),
                display_name: String::new(),
            }],
            projects,
        },
        trees,
        ..Default::default()
    }
}

fn proj(id: &str, name: &str, client: Option<&str>) -> RemoteProject {
    RemoteProject {
        id: id.into(),
        name: name.into(),
        client_id: client.map(|s| s.to_string()),
        // `None` намеренно: настоящий бэкенд `userId` в `/projects` не отдаёт, и
        // демо обязано проигрывать тот же путь — владелец добывается из ключа.
        // Иначе мок «работал» бы через поле, которого в жизни нет.
        user_id: None,
        group_name: "personal".into(),
        is_active: true,
        is_paused: false,
        // Демо показывает и архивный проект: значок в колонке проектов и пропуск
        // обработки иначе не проверить глазами.
        is_archived: id == "p3",
        archived_at: if id == "p3" { Some("2026-08-01T10:00:00.000Z".into()) } else { None },
        updated_at: "2026-08-07T09:00:00.000Z".into(),
    }
}

/// Кто владеет проектом в фикстурах: `p1`/`p2` — один, `p3` — другой.
fn owner_of(project: &str) -> &'static str {
    match project {
        "p3" => "8f14e45f-ceea-467a-9c4c-6b2f0a1d9e77",
        _ => "3fa85f64-5717-4562-b3fc-2c963f66afa6",
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
        // Раскладка как у бэкенда — С сегментом владельца: `projects/{userId}/{projectId}/…`.
        // Без него мок прятал бы весь путь определения владельца, а именно он сейчас
        // строит первый уровень зеркала.
        s3_key: Some(format!(
            "innohub/projects/{}/{project}/{folder}/uuid-{name}",
            owner_of(project)
        )),
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
