// Сервис хранилища: владеет состоянием и следит за дисциплиной блокировок.
//
// ── Почему это отдельный слой, а не команды ──────────────────────────────────
// Скачивание гигабайта не должно держать глобальный лок: иначе на время закачки
// встанет весь интерфейс. Поэтому здесь строгое правило:
//
//     глобальный лок берём КОРОТКИМИ порциями — прочитать решение, записать итог.
//     Между ними (presign, передача байтов) он ОТПУЩЕН.
//
// Провайдер и корень зеркала лежат отдельными полями именно ради этого: передача
// не трогает `sync` вообще.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex as StdMutex};

use serde::Serialize;
use sha2::{Digest, Sha256};

use super::paths::{self, parse_mirror_path, under_mirror};
#[cfg(test)]
use super::index::Index;
use super::provider::Provider;
use super::state::FileState;
use super::sync::Sync;
use super::types::*;

/// Итог освобождения диска от копий одного владельца.
#[derive(Debug, Clone, Default, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct DropOwnerReport {
    pub removed: i64,
    pub freed_bytes: i64,
    /// Сколько копий оставили: в них работа, которой в облаке ещё нет.
    pub kept_unsafe: i64,
}

/// Итог выжигания проекта: что ушло, что бэкенд не отдал.
///
/// Считается по каталогу «до минус после», а не сложением удалённых записей: папка
/// удаляется одним запросом с каскадом на стороне бэкенда, и сколько файлов внутри
/// него ушло, из ответа не видно.
#[derive(Debug, Clone, Default, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PurgeReport {
    pub files_deleted: i64,
    pub freed_bytes: i64,
    /// Осталось в облаке. `0` — проект пуст, и в нём осталась только запись самого
    /// проекта (её программа удалить не может, эндпоинта нет).
    pub files_left: i64,
    /// Локальную папку проекта убрали с диска.
    pub local_removed: bool,
    /// Почему папку оставили. `None` — убрали, или её на диске и не было.
    pub local_kept: Option<String>,
    /// Что бэкенд не отдал — с его же текстом отказа. Догадка о причине здесь хуже
    /// цитаты: `options` защищён 403 по контракту, а сеть отваливается своими словами.
    pub skipped: Vec<PurgeSkipped>,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PurgeSkipped {
    /// Логический путь внутри проекта (`IN/a.mov`, `options`).
    pub path: String,
    pub error: String,
}

/// Что сделало (или сделает) удаление. Интерфейсу нужно различать: после первой
/// ступени файл остаётся в облаке, после второй — нет.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum DeleteStage {
    /// Убрали только локальную копию. Файл остался в облаке.
    LocalCopy,
    /// Копии не было — удалили в облаке.
    Online,
    /// В каталоге записи нет: файл жил только на диске, в облаке удалять нечего.
    LocalOnly,
    /// Вторая ступень требует подтверждения: пока у бэкенда нет корзины, удаление
    /// в облаке необратимо.
    NeedsConfirm,
}

/// Итог переименования в облаке — для интерфейса и логов.
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RenameReport {
    pub file_id: String,
    pub old_path: String,
    pub new_path: String,
    pub is_folder: bool,
}

/// Сведения о проекте для прикладного кода: обрабатывать его или нет.
///
/// Три флага рядом, и путать их нельзя (`STORAGE_API.md`, «Processing flags»):
/// `paused` — человек приостановил, `archived` — проект уехал в архив на сайте.
/// Архивность живёт в своём поле, а не в `group_name`: группа отвечает только за
/// раскладку интерфейса сайта.
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ProjectInfo {
    pub project_id: String,
    pub name: String,
    pub archived: bool,
    pub archived_at: Option<String>,
    pub paused: bool,
}

/// Имя файла в запросе подписи, которым спрашивают владельца проекта.
///
/// Файл с этим именем НЕ создаётся: подпись — это подпись, объект появляется от PUT.
/// Имя всё равно говорящее — если оно однажды всплывёт в логах бэкенда, должно быть
/// сразу понятно, откуда оно.
const OWNER_PROBE_NAME: &str = "owner-probe.tmp";

/// Как часто опрашивать счётчик отправленных байтов во время заливки.
///
/// Полсекунды — это заметно человеку и почти бесплатно для базы: одна запись за
/// тик, и только когда счётчик реально сдвинулся. У скачивания порог свой (4 МБ) и
/// живёт в цикле чтения чанков: там события идут от сети, а не от таймера.
const PROGRESS_TICK: std::time::Duration = std::time::Duration::from_millis(500);

// ─── Результат гидрации ──────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum EnsureOutcome {
    /// Путь не под зеркалом — вернули как есть. Это самый частый исход и он
    /// бесплатный: локальная рабочая папка, абсолютные пути, режим без облака.
    NotInMirror,
    /// Локальная копия уже актуальна. Ни одного запроса в сеть.
    AlreadyFresh,
    /// Скачали.
    Downloaded,
    /// Файл есть на диске, но в каталоге его нет — значит положили руками.
    /// Его надо ЗАЛИТЬ, а не качать; путь возвращаем как есть.
    LocalOnly,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct EnsureResult {
    pub path: String,
    pub outcome: EnsureOutcome,
    pub bytes: Option<i64>,
}

/// Одна строка листинга по ФАЙЛОВОМУ пути — то, чем колонки рисуют зеркало.
///
/// Отличие от `StorageDirEntry`: здесь есть `path`, потому что колонкам нужен путь,
/// а не логические координаты. Имя и путь — РАЗНЫЕ поля не случайно: на уровнях
/// клиента и проекта имя человеческое, а путь — реальное место на диске.
#[derive(Debug, Clone, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct BrowseEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size_bytes: Option<i64>,
    /// Идентификатор записи: для файла и папки внутри проекта — `file_id` каталога,
    /// для строки клиента — `client_id`, для строки проекта — `project_id`.
    /// Интерфейсу нужен именно он, чтобы связать строку с сущностью каталога.
    pub file_id: Option<String>,
    pub state: Option<super::FileState>,
    pub aggregate: Option<super::FolderAggregate>,
    pub pinned: bool,
    pub progress: Option<f64>,
    pub error: Option<String>,
    /// Только у строки проекта: проект приостановлен на сайте (`is_paused`).
    ///
    /// Чекбокс во второй колонке обязан это отражать: если человек выключил проект на
    /// сайте, программа не должна его обрабатывать и показывать включённым.
    pub paused: bool,
    /// Только у строки проекта: проект убран в архив на сайте.
    ///
    /// Обработку по нему запускать нельзя, и человек обязан видеть это в колонке —
    /// иначе «почему проект не обрабатывается» отлаживается только чтением БД.
    pub archived: bool,
}

impl StorageService {
    /// Содержимое папки в зеркале. `None` — путь не под зеркалом, читайте диск.
    ///
    /// Это и есть ответ на «почему онлайн-папка выглядит как обычная»: колонки зовут
    /// одну и ту же функцию, а откуда пришёл список — их не касается. Файл, которого
    /// ещё нет на диске, здесь ЕСТЬ: он существует, просто пока не здесь.
    pub async fn browse(&self, path: &str) -> Result<Option<Vec<BrowseEntry>>, String> {
    let state = self;
    let root = std::path::PathBuf::from(state.mirror_root_str());
    if root.as_os_str().is_empty() {
        return Ok(None);
    }
    let p = std::path::PathBuf::from(path);
    let dirs = state.dirs();
    let Some(node) = super::classify(&root, &dirs, &p) else {
        return Ok(None);
    };

    match node {
        super::MirrorNode::Root => Ok(Some(
            dirs.clients()
                .iter()
                .map(|c| BrowseEntry {
                    name: c.display_name.clone(),
                    path: root.join(&c.dir).to_string_lossy().to_string(),
                    is_dir: true,
                    size_bytes: None,
                    file_id: Some(c.id.clone()),
                    state: None,
                    aggregate: None,
                    pinned: false,
                    progress: None,
                    error: None,
                    archived: false,
                    paused: false,
                })
                .collect(),
        )),

        super::MirrorNode::Client { client_id } => {
            let client_dir = dirs
                .client_dir_of(&client_id)
                .ok_or_else(|| format!("Клиент {client_id} пропал из раскладки"))?
                .to_string();
            let list = dirs.projects_of_client_dir(&client_dir);
            let base = root.join(&client_dir);
            state
                .with_sync(|s| {
                    // Архивность читаем одним запросом на всю колонку, а не на строку:
                    // проектов немного, а N запросов на листинг — привычная ловушка.
                    let flags: std::collections::HashMap<String, (bool, bool)> = s
                        .index
                        .projects(None)?
                        .into_iter()
                        .map(|p| (p.id, (p.is_archived, p.is_paused)))
                        .collect();
                    let mut out = Vec::with_capacity(list.len());
                    for (project_dir, project_id) in &list {
                        let agg = s.index.folder_badge(project_id, "")?;
                        out.push(BrowseEntry {
                            name: project_dir.clone(),
                            path: base.join(project_dir).to_string_lossy().to_string(),
                            is_dir: true,
                            size_bytes: Some(agg.bytes),
                            file_id: Some(project_id.clone()),
                            state: None,
                            aggregate: Some(agg.aggregate),
                            pinned: false,
                            progress: None,
                            error: None,
                            archived: flags.get(project_id).map(|f| f.0).unwrap_or(false),
                            paused: flags.get(project_id).map(|f| f.1).unwrap_or(false),
                        });
                    }
                    Ok(Some(out))
                })
                .await
        }

        super::MirrorNode::Folder {
            project_id,
            folder_path,
        } => {
            // Дерево проекта тянем при первом обращении. Раньше это делала отдельная
            // онлайн-колонка; она удалена, и без этого каталог по проекту пуст —
            // папка выглядела бы пустой, хотя в хранилище файлы есть.
            //
            // Через `ensure_catalog`, а не здесь же: там single-flight по проекту
            // (открыли три папки подряд — обход один) и лок каталога не держится на
            // всё время `/tree`.
            state.ensure_catalog(&project_id).await?;

            let entries = state
                .with_sync(|s| {
                    let list = s.index.list_dir(&project_id, &folder_path)?;
                    let mut out = Vec::with_capacity(list.len());
                    for e in list {
                        if e.is_folder {
                            let sub = if e.folder_path.is_empty() {
                                e.name.clone()
                            } else {
                                format!("{}/{}", e.folder_path, e.name)
                            };
                            let agg = s.index.folder_badge(&project_id, &sub)?;
                            out.push(BrowseEntry {
                                name: e.name.clone(),
                                path: p.join(&e.name).to_string_lossy().to_string(),
                                is_dir: true,
                                size_bytes: Some(agg.bytes),
                                file_id: Some(e.id),
                                state: None,
                                aggregate: Some(agg.aggregate),
                                pinned: false,
                                progress: None,
                                error: None,
                                archived: false,
                                paused: false,
                            });
                        } else {
                            let b = s.index.badge_state(&e.id)?;
                            out.push(BrowseEntry {
                                name: e.name.clone(),
                                path: p.join(&e.name).to_string_lossy().to_string(),
                                is_dir: false,
                                size_bytes: e.size_bytes,
                                file_id: Some(e.id),
                                state: Some(
                                    b.as_ref().map(|b| b.state).unwrap_or(super::FileState::Cloud),
                                ),
                                aggregate: None,
                                pinned: b.as_ref().map(|b| b.pinned).unwrap_or(false),
                                progress: b.as_ref().and_then(|b| b.progress),
                                error: b.and_then(|b| b.error),
                                archived: false,
                                paused: false,
                            });
                        }
                    }
                    Ok(out)
                })
                .await?;

            let active: HashMap<String, (String, Option<f64>)> = state
                .with_sync(|s| {
                    Ok(s.index
                        .active_transfers_by_path()?
                        .into_iter()
                        .map(|(path, dir, pct)| (path, (dir, pct)))
                        .collect())
                })
                .await?;
            Ok(Some(merge_local_only(&p, entries, &active)))
        }

        // Под зеркалом, но каталог о таком не знает. Пустой список соврал бы
        // («здесь ничего нет»), поэтому говорим правду.
        super::MirrorNode::Unknown => Err(format!(
            "Папка не найдена в каталоге: {path}. Обновите список проектов."
        )),
    }
}

}

/// Добавить к списку из каталога то, что лежит на диске, но каталогу неизвестно.
///
/// Без этого результаты обработки (папка OUT) были бы не видны до заливки — то
/// есть человек не увидел бы собственный только что созданный файл.
fn merge_local_only(
    dir: &std::path::Path,
    mut entries: Vec<BrowseEntry>,
    active: &HashMap<String, (String, Option<f64>)>,
) -> Vec<BrowseEntry> {
    let known: std::collections::HashSet<String> =
        entries.iter().map(|e| e.name.to_lowercase()).collect();

    if let Ok(rd) = std::fs::read_dir(dir) {
        for de in rd.flatten() {
            let name = de.file_name().to_string_lossy().to_string();
            // `.part` — недокачанный огрызок, показывать его нельзя.
            if name.starts_with('.') || name.ends_with(".part") || known.contains(&name.to_lowercase())
            {
                continue;
            }
            let is_dir = de.file_type().map(|t| t.is_dir()).unwrap_or(false);
            let path_s = de.path().to_string_lossy().to_string();
            // Идёт ли по этому пути передача. Связываем по пути, а не по `file_id`:
            // у файла, которого нет в каталоге, идентификатора ещё не существует.
            let live = active.get(&path_s);
            entries.push(BrowseEntry {
                name,
                path: path_s.clone(),
                is_dir,
                size_bytes: de.metadata().ok().map(|m| m.len() as i64),
                file_id: None,
                // Файла нет в каталоге — значит он только здесь и его надо залить.
                // Но если прямо сейчас идёт заливка, показываем именно её: иначе
                // большой файл выглядит как «ничего не происходит».
                state: if is_dir {
                    None
                } else if let Some((dir, _)) = live {
                    Some(if dir == "down" {
                        super::FileState::Downloading
                    } else {
                        super::FileState::Uploading
                    })
                } else {
                    Some(super::FileState::LocalOnly)
                },
                aggregate: None,
                pinned: false,
                progress: live.and_then(|(_, p)| *p),
                error: None,
                archived: false,
                paused: false,
            });
        }
    }

    entries.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });
    entries
}

/// Строка вкладки «Не в облаке»: файл есть здесь, а в хранилище его нет.
///
/// Зачем отдельный список: значок такого файла видно только в той папке, куда
/// человек зашёл, а вопрос «всё ли я отправил» — про зеркало целиком. Особенно
/// после ручной остановки: такой файл не поедет сам никогда (см. `Pending::decline`),
/// и без списка он остаётся незамеченным навсегда.
#[derive(Debug, Clone, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct NotUploadedRow {
    pub path: String,
    pub name: String,
    /// Папка относительно корня зеркала — чтобы понять, чей это файл, не читая путь.
    pub folder: String,
    pub size_bytes: i64,
    /// Unix-секунды mtime: по нему сортируется список.
    pub mtime: i64,
    /// `new` — в облаке нет вовсе; `modified` — правили здесь; `stopped` — заливку
    /// остановили вручную, сама она не возобновится.
    pub reason: String,
}

/// Строка вкладки «локальные копии»: файл, который синхронизирован И лежит на диске.
#[derive(Debug, Clone, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct LocalFileRow {
    pub file_id: String,
    pub name: String,
    pub path: String,
    /// Клиент/проект — чтобы понимать, откуда файл, не читая длинный путь.
    pub project: String,
    pub size_bytes: i64,
    /// Unix-секунды последнего обращения: по нему считается вытеснение.
    pub last_access: i64,
    pub pinned: bool,
}

// ─── Сервис ──────────────────────────────────────────────────────────────────

pub struct StorageService {
    /// Каталог: индекс + провайдер. Лок берём короткими порциями.
    sync: tokio::sync::Mutex<Option<Sync>>,
    /// Копия провайдера для передач — чтобы не трогать `sync` во время скачивания.
    provider: StdMutex<Option<Provider>>,
    mirror_root: StdMutex<PathBuf>,
    /// Выше этого размера выгоднее multipart. Из настроек; в тестах занижаем,
    /// чтобы проверить, что гейт срабатывает ДО передачи байтов.
    multipart_threshold: StdMutex<i64>,
    /// Single-flight: два запроса одного файла качают его один раз, второй ждёт.
    inflight: StdMutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>,
    /// Отменённые передачи. Цикл чтения смотрит сюда между кусками — иначе
    /// «отмена» означала бы «дождаться конца и сделать вид».
    cancelled: StdMutex<std::collections::HashSet<i64>>,
    /// Соответствие «project_id ↔ папки клиента/проекта». Кэш: раскладка нужна
    /// на каждый путь, а меняется только вместе со списком проектов.
    dirs: StdMutex<super::layout::MirrorDirs>,
    /// Кандидаты на заливку: кто сказал «посмотри сюда». Наполняется вотчером и
    /// явными вызовами раннера, разгружается демоном. `Arc` — потому что ту же
    /// очередь держит вотчер в своём потоке.
    pending: Arc<StdMutex<super::pending::Pending>>,
    /// Живой вотчер зеркала. `None` — хранилище не подключено либо слежка не
    /// поднялась (тогда работает редкий полный обход).
    watcher: StdMutex<Option<super::watcher::MirrorWatcher>>,
    /// До каких проектов дотрагивались и когда. **Это и есть охват синхронизации.**
    ///
    /// Режимов («ленивый»/«активный») нет и не нужно: правило одно — синхронизируется
    /// то, с чем работают. Дотронулись рукой (открыли папку пользователя, зашли в
    /// проект) или кодом (раннер взял проект в виток) — проект становится тёплым и
    /// живёт в опросе дельт. Не трогали `WARM_WINDOW` — выпадает сам.
    ///
    /// Отсюда же и обе картины, которые описывал человек: оператор лазает по папкам,
    /// и тёплым оказывается то, что он открывал; машина обработки трогает один проект
    /// задачи, и только он и синхронизируется — не вся папка пользователя.
    warm: StdMutex<HashMap<String, std::time::Instant>>,
    /// Хэндл приложения — только чтобы сообщать интерфейсу об изменившихся файлах.
    ///
    /// Без этого значок менялся лишь тогда, когда действие начал сам интерфейс:
    /// фоновая передача (префетч, заливка демоном, вытеснение) оставляла на экране
    /// прежнюю картинку — файл уже на диске, а нарисовано «только в облаке».
    app: StdMutex<Option<tauri::AppHandle>>,
    http: reqwest::Client,
}

impl Default for StorageService {
    fn default() -> Self {
        Self::new()
    }
}

impl StorageService {
    pub fn new() -> Self {
        Self {
            sync: tokio::sync::Mutex::new(None),
            provider: StdMutex::new(None),
            mirror_root: StdMutex::new(PathBuf::new()),
            multipart_threshold: StdMutex::new(96 * 1024 * 1024),
            inflight: StdMutex::new(HashMap::new()),
            cancelled: StdMutex::new(std::collections::HashSet::new()),
            dirs: StdMutex::new(Default::default()),
            pending: Arc::new(StdMutex::new(super::pending::Pending::new())),
            watcher: StdMutex::new(None),
            warm: StdMutex::new(HashMap::new()),
            app: StdMutex::new(None),
            http: reqwest::Client::new(),
        }
    }

    /// Отметить, что с проектом работают. Зовётся из каждой точки касания.
    pub fn touch_project(&self, project_id: &str) {
        self.warm
            .lock()
            .unwrap()
            .insert(project_id.to_string(), std::time::Instant::now());
    }

    /// Проекты, которых касались не позже `window` назад. Остывшие выкидываем тут же:
    /// иначе список рос бы вечно и «ленивое» превратилось бы в «всё подряд».
    pub fn warm_projects(&self, window: std::time::Duration) -> Vec<String> {
        let mut g = self.warm.lock().unwrap();
        let now = std::time::Instant::now();
        g.retain(|_, at| now.duration_since(*at) <= window);
        g.keys().cloned().collect()
    }

    /// Запомнить хэндл приложения — источник события `storage-changed`.
    pub fn set_app(&self, app: tauri::AppHandle) {
        *self.app.lock().unwrap() = Some(app);
    }

    /// Сообщить интерфейсу, что по этим путям изменилось состояние файла.
    ///
    /// Broadcast'ом, без адресата: событие нужно каждому окну, которое рисует
    /// колонки, а `emit_to` в чужое окно до слушателя не дойдёт.
    ///
    /// Тихо ничего не делает, если хэндла нет (тесты, ещё не подключились): значок
    /// не обновится, но операция обязана завершиться нормально.
    pub(super) fn emit_changed(&self, paths: &[String]) {
        if paths.is_empty() {
            return;
        }
        let guard = self.app.lock().unwrap();
        if let Some(app) = guard.as_ref() {
            use tauri::Emitter;
            let _ = app.emit("storage-changed", paths);
        }
    }

    pub async fn attach(&self, sync: Sync, mirror_root: PathBuf) {
        *self.provider.lock().unwrap() = Some(sync.provider.clone());
        *self.mirror_root.lock().unwrap() = mirror_root.clone();
        // Карту строим ДО передачи `sync` внутрь: без неё ни один путь в зеркале
        // не разберётся, и первое же обращение ушло бы мимо каталога.
        Self::build_dirs_into(&self.dirs, &sync);
        *self.sync.lock().await = Some(sync);
        // Статистика спрашивает корень зеркала глобально: ей надо знать, уедет ли
        // её файл в облако.
        paths::set_global_mirror_root(Some(mirror_root.clone()));
        self.restart_watcher(&mirror_root);
    }

    /// Поднять слежку за зеркалом заново (подключение, смена папки зеркала).
    ///
    /// Не роняем подключение, если слежка не встала: без вотчера программа
    /// работает, просто новые файлы находятся редким полным обходом, а не сразу.
    /// Молча это оставлять тоже нельзя — иначе «почему файл не залился» станет
    /// неотлаживаемым.
    fn restart_watcher(&self, root: &Path) {
        let mut slot = self.watcher.lock().unwrap();
        *slot = None; // старый снимаем ДО поднятия нового: две слежки за одним деревом не нужны
        match super::watcher::start(root, self.pending.clone()) {
            Ok(w) => *slot = Some(w),
            Err(e) => eprintln!("[storage] {e}; заливка будет находить файлы полным обходом"),
        }
    }

    /// Сообщить об изменившихся путях. `ready` — «файл готов, ждать затишья не надо».
    ///
    /// Вне зеркала пути отбрасываются: явный вызов стоит по всему коду, и
    /// разбираться «а это точно облачный путь?» на стороне вызывающего не нужно.
    /// Возвращает, сколько путей принято.
    /// Убрать задачу из списка передач.
    ///
    /// Для упавшей передачи это единственный способ закрыть вопрос: пока строка
    /// висит, список врёт, что что-то ещё не в порядке.
    pub async fn dismiss_transfer(&self, id: i64) -> Result<(), String> {
        self.with_sync(move |s| s.index.delete_transfer(id)).await
    }

    /// Повторить упавшую передачу.
    ///
    /// Заливка ставится обратно в очередь кандидатов сразу (`ready`), без ожидания
    /// «затишья»: файл лежит на диске давно, ждать его дописывания незачем.
    /// Скачивание запускаем задачей — оно может идти минутами, и команда не должна
    /// держать интерфейс.
    ///
    /// Если файла на диске больше нет — это не ошибка передачи, а исчезнувший
    /// источник; задачу тогда просто снимаем и говорим об этом прямо.
    pub async fn retry_transfer(&self, id: i64) -> Result<String, String> {
        let Some((direction, local_path, _)) = self.with_sync(move |s| s.index.transfer_row(id)).await? else {
            return Err(format!("Передача {id} не найдена"));
        };
        let path = PathBuf::from(&local_path);
        let name = path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| local_path.clone());

        if direction == "up" {
            if !path.exists() {
                self.dismiss_transfer(id).await?;
                return Ok(format!("«{name}»: файла больше нет на диске — задача снята"));
            }
            // Спрашиваем ДО постановки в очередь: файл мог доехать в облако с
            // прошлой попытки, и тогда повтор не сделает ничего. Задача при этом
            // исчезнет из списка — а человек так и не узнает, почему. Молчаливое
            // исчезновение хуже отказа.
            if !self.needs_upload(&path).await? {
                self.dismiss_transfer(id).await?;
                return Ok(format!("«{name}» уже синхронизирован — задача снята"));
            }
            // Явное решение человека снимает прошлую остановку.
            self.allow_upload(&path);
            self.mark_dirty(&[path], true);
            self.dismiss_transfer(id).await?;
            return Ok(format!("«{name}» поставлен в очередь заливки"));
        }

        // Скачивание — своей задачей: гидрация большого файла идёт минутами, и
        // команда, которая её дожидается, повесила бы интерфейс.
        let app = self.app.lock().unwrap().clone();
        self.dismiss_transfer(id).await?;
        let Some(app) = app else {
            return Err("Приложение не готово — повтор скачивания недоступен".into());
        };
        tauri::async_runtime::spawn(async move {
            use tauri::Manager;
            let svc: tauri::State<'_, StorageService> = app.state();
            if let Err(e) = svc.ensure_local(&path).await {
                eprintln!("[storage] повтор скачивания не удался: {e}");
            }
        });
        Ok(format!("«{name}»: скачивание перезапущено"))
    }

    /// Снять запрет на автозаливку — по явной команде человека.
    pub fn allow_upload(&self, path: &Path) {
        self.pending.lock().unwrap().allow(path);
    }

    /// Остановлена ли заливка вручную.
    pub fn is_upload_declined(&self, path: &Path) -> bool {
        self.pending.lock().unwrap().is_declined(path)
    }

    pub fn mark_dirty(&self, paths: &[PathBuf], ready: bool) -> usize {
        let root = self.mirror_root();
        if root.as_os_str().is_empty() {
            return 0;
        }
        let mut q = self.pending.lock().unwrap();
        let mut accepted = 0;
        for p in paths {
            if !under_mirror(&root, p) {
                continue;
            }
            if ready {
                q.mark_ready(p.clone());
            } else {
                q.touch(p.clone());
            }
            accepted += 1;
        }
        accepted
    }

    /// Объявить готовыми всех накопившихся кандидатов. Конец витка обработки:
    /// писать больше некому, ждать затишья незачем.
    pub fn flush_pending(&self) -> usize {
        self.pending.lock().unwrap().mark_all_ready()
    }

    /// Забрать кандидатов, которых пора заливать.
    pub fn take_upload_candidates(&self, quiet_pulses: u32, limit: usize) -> Vec<PathBuf> {
        self.pending
            .lock()
            .unwrap()
            .collect_ready(stat_for_pending, quiet_pulses, limit)
    }

    /// Очередь потеряла картину (было слишком много событий разом) — нужен
    /// полный обход. Флаг снимается тем же вызовом: обход всё подберёт.
    pub fn take_pending_overflow(&self) -> bool {
        let mut q = self.pending.lock().unwrap();
        let over = q.overflowed();
        if over {
            q.clear_overflow();
        }
        over
    }

    pub fn pending_len(&self) -> usize {
        self.pending.lock().unwrap().len()
    }

    /// Поднята ли слежка за зеркалом и за тем ли корнем.
    ///
    /// Второе не придирка: корень зеркала меняется в настройках, а вотчер живёт с
    /// того момента, когда его подняли. Слежка за прошлой папкой выглядит как
    /// работающая, но не увидит ни одного файла.
    pub fn is_watching(&self) -> bool {
        let root = self.mirror_root();
        match self.watcher.lock().unwrap().as_ref() {
            Some(w) => w.root() == root,
            None => false,
        }
    }

    /// Отпустить хранилище: клиент больше не поднят.
    ///
    /// Локальные копии и индекс НЕ трогаем: файлы на диске принадлежат человеку, а
    /// индекс пригодится при следующем подключении. Отключение — это про «клиент
    /// больше не работает», а не про «сотри всё».
    pub async fn detach(&self) {
        *self.sync.lock().await = None;
        *self.provider.lock().unwrap() = None;
        *self.mirror_root.lock().unwrap() = PathBuf::new();
        *self.dirs.lock().unwrap() = Default::default();
        // Незавершённые передачи брошены вместе с провайдером — чистим отметки,
        // иначе следующая передача с тем же id считалась бы отменённой.
        self.cancelled.lock().unwrap().clear();
        self.inflight.lock().unwrap().clear();
        // Слежку снимаем и очередь чистим: путь без подключения залить некуда, а
        // остаться она может только мусором к следующему подключению — где корень
        // зеркала уже может быть другим.
        *self.watcher.lock().unwrap() = None;
        self.pending.lock().unwrap().clear();
        paths::set_global_mirror_root(None);
    }

    fn build_dirs_into(slot: &StdMutex<super::layout::MirrorDirs>, sync: &Sync) {
        // Первый уровень зеркала — ВЛАДЕЛЕЦ проекта, не клиент: `client_id` в живых
        // данных не заполнен, а раскладка бакета `projects/{userId}/{projectId}/…`
        // даёт пользователя всегда. Имена владельцев бэкенд пока не отдаёт — тогда
        // папка называется идентификатором.
        let users = sync.index.users().unwrap_or_default();
        let projects = sync.index.projects(None).unwrap_or_default();
        *slot.lock().unwrap() = super::layout::MirrorDirs::build(&users, &projects);
    }

    /// Узнать владельцев проектов, о которых бэкенд умолчал.
    ///
    /// Пока `/projects` не отдаёт `userId`, владелец берётся из ключа
    /// (`projects/{userId}/{projectId}/…`) — двумя способами, и порядок важен:
    ///
    /// 1. **ключ из индекса** — бесплатно, если дерево проекта уже загружено;
    /// 2. **`/presign` на PUT** — один запрос, ноль байт. Ключ бэкенд строит сам из
    ///    владельца проекта (`projectUploadObjectKey(access.ownerId, …)`), а объекта
    ///    при этом НЕ создаёт: подписанная ссылка — это только подпись, файл в
    ///    хранилище появляется от PUT, а строка в каталоге — от `/notify`. Ни того,
    ///    ни другого мы не делаем.
    ///
    /// Второй способ и есть настоящий: он работает у **пустого** проекта, где ключей
    /// нет вообще. Первая версия умела только первый способ — и у человека
    /// определились владельцы лишь двух проектов из пяти: у двух каталог пуст, а у
    /// третьего в нём лежали только папки, а у папок ключей не бывает.
    ///
    /// Возвращает, сколько владельцев определили.
    pub async fn discover_owners(&self) -> Result<usize, String> {
        let unknown = self
            .with_sync(|s| s.index.projects_without_owner())
            .await?;
        if unknown.is_empty() {
            return Ok(0);
        }

        let mut found = 0;
        for pid in unknown {
            match self.owner_of_project(&pid).await {
                Ok(Some(owner)) => {
                    let pid2 = pid.clone();
                    self.with_sync(move |s| s.index.set_project_owner(&pid2, &owner))
                        .await?;
                    found += 1;
                }
                Ok(None) => {}
                // Один недоступный проект не должен ронять раскладку остальных:
                // права могли не дать именно на него.
                Err(e) => eprintln!("[storage] владелец {pid} не определён: {e}"),
            }
        }

        if found > 0 {
            // Карта строится из владельцев — без пересборки новые папки не появятся.
            self.refresh_dirs().await;
        }
        Ok(found)
    }

    async fn owner_of_project(&self, project_id: &str) -> Result<Option<String>, String> {
        // Дешёвый путь: ключ уже лежит в индексе.
        let key = self
            .with_sync({
                let pid = project_id.to_string();
                move |s| s.index.any_s3_key(&pid)
            })
            .await?;
        if let Some(owner) = key
            .as_deref()
            .and_then(|k| super::layout::owner_from_s3_key(k, project_id))
        {
            return Ok(Some(owner));
        }

        // Спрашиваем бэкенд: он выпишет ключ, из которого владелец и виден.
        let provider = self
            .provider()
            .ok_or_else(|| "Хранилище не подключено".to_string())?;
        let resp = provider
            .presign_put(
                project_id,
                "",
                OWNER_PROBE_NAME,
                "application/octet-stream",
                Some(60),
                None,
            )
            .await
            .map_err(|e| e.to_string())?;
        Ok(super::layout::owner_from_s3_key(&resp.s3_key, project_id))
    }

    /// Пересобрать раскладку — после обновления списка проектов. Переименовали
    /// проект на сайте: имя папки обязано поехать следом, иначе пути перестанут
    /// разбираться и файлы «пропадут» из колонок.
    pub async fn refresh_dirs(&self) {
        let g = self.sync.lock().await;
        if let Some(s) = g.as_ref() {
            Self::build_dirs_into(&self.dirs, s);
        }
    }

    pub fn dirs(&self) -> super::layout::MirrorDirs {
        self.dirs.lock().unwrap().clone()
    }

    pub async fn is_attached(&self) -> bool {
        self.sync.lock().await.is_some()
    }

    #[cfg(test)]
    pub fn set_multipart_threshold(&self, bytes: i64) {
        *self.multipart_threshold.lock().unwrap() = bytes;
    }

    pub fn mirror_root_str(&self) -> String {
        self.mirror_root.lock().unwrap().to_string_lossy().to_string()
    }

    fn mirror_root(&self) -> PathBuf {
        self.mirror_root.lock().unwrap().clone()
    }

    fn provider(&self) -> Option<Provider> {
        self.provider.lock().unwrap().clone()
    }

    // ─── Очередь задач ───────────────────────────────────────────────────────
    //
    // Очередь к синхронизации каталога отношения не имеет и через `Sync` не идёт: там
    // лок держится на время обхода дерева, а очередь дёргается на каждом пульсе и
    // должна отвечать мгновенно. Поэтому — прямо через провайдера.
    //
    // Идентичность машины подставляется здесь, а не приходит от вызывающего: она одна
    // на процесс, и давать renderer'у возможность прислать чужой uuid незачем.

    fn require_provider(&self) -> Result<Provider, String> {
        self.provider()
            .ok_or_else(|| "Хранилище не подключено".to_string())
    }

    fn machine(&self) -> (&'static str, &'static str) {
        let id = crate::machine::identity();
        (id.uuid.as_str(), id.label.as_str())
    }

    pub async fn queue_ping(&self) -> Result<(), String> {
        let p = self.require_provider()?;
        let (uuid, hostname) = self.machine();
        p.queue_ping(&super::client::MachineRef { uuid, hostname })
            .await
            .map_err(|e| e.to_string())
    }

    pub async fn queue_claim(&self) -> Result<Option<QueueTask>, String> {
        let p = self.require_provider()?;
        let (uuid, hostname) = self.machine();
        p.queue_claim(&super::client::MachineRef { uuid, hostname })
            .await
            .map_err(|e| e.to_string())
    }

    pub async fn queue_progress(
        &self,
        task_id: &str,
        step_id: &str,
        status: QueueStepStatus,
        message: Option<&str>,
    ) -> Result<(), String> {
        let p = self.require_provider()?;
        let (uuid, hostname) = self.machine();
        p.queue_progress(
            &super::client::MachineRef { uuid, hostname },
            task_id,
            step_id,
            status,
            message,
        )
        .await
        .map_err(|e| e.to_string())
    }

    pub async fn queue_done(
        &self,
        task_id: &str,
        out_files: Vec<String>,
        total_cost: f64,
    ) -> Result<(), String> {
        let p = self.require_provider()?;
        let (uuid, hostname) = self.machine();
        p.queue_done(
            &super::client::MachineRef { uuid, hostname },
            task_id,
            out_files,
            total_cost,
        )
        .await
        .map_err(|e| e.to_string())
    }

    pub async fn queue_failed(&self, task_id: &str, error: &str) -> Result<(), String> {
        let p = self.require_provider()?;
        let (uuid, hostname) = self.machine();
        p.queue_failed(&super::client::MachineRef { uuid, hostname }, task_id, error)
            .await
            .map_err(|e| e.to_string())
    }

    pub async fn queue_release(&self, task_id: &str) -> Result<(), String> {
        let p = self.require_provider()?;
        let (uuid, hostname) = self.machine();
        p.queue_release(&super::client::MachineRef { uuid, hostname }, task_id)
            .await
            .map_err(|e| e.to_string())
    }

    /// Короткий доступ к каталогу. Внутри замыкания `.await` быть не должно —
    /// в этом весь смысл дисциплины.
    pub async fn with_sync<T>(
        &self,
        f: impl FnOnce(&mut Sync) -> Result<T, String>,
    ) -> Result<T, String> {
        let mut g = self.sync.lock().await;
        let s = g
            .as_mut()
            .ok_or_else(|| "Хранилище не подключено".to_string())?;
        f(s)
    }

    /// Асинхронная работа с каталогом (обход дерева, дельты). Здесь лок держится
    /// дольше — это осознанно: сетевые вызовы каталога короткие, а гонок с ними
    /// быть не должно.
    pub async fn sync_mut(&self) -> tokio::sync::MutexGuard<'_, Option<Sync>> {
        self.sync.lock().await
    }

    /// Только для тестов: достать мок, чтобы проверить, что и как мы ему прислали.
    #[cfg(test)]
    pub async fn mock_handle(&self) -> Option<super::mock::MockApi> {
        match self.provider()? {
            Provider::Mock(m) => Some(m),
            _ => None,
        }
    }

    /// Только для тестов: изобразить бэкенд с multipart, чтобы проверить гейт.
    #[cfg(test)]
    pub async fn force_caps_multipart(&self, on: bool) {
        if let Some(Provider::Mock(m)) = self.provider() {
            m.with(|s| s.caps.multipart = on);
        }
        let mut g = self.sync.lock().await;
        if let Some(s) = g.as_mut() {
            let _ = s.refresh_capabilities().await;
        }
    }

    /// Путь в зеркале для записи каталога. Строится из ЛОГИЧЕСКОГО пути
    /// (`folder_path` + `name`), не из `s3_key`: ключ непрозрачный, и по нему на
    /// диске появились бы папки вида `a3f9c1-clip.mov`.
    pub async fn mirror_path_for(&self, file_id: &str) -> Result<String, String> {
        let root = self.mirror_root();
        if root.as_os_str().is_empty() {
            return Err("Папка зеркала не настроена".into());
        }
        let id = file_id.to_string();
        let e = self
            .with_sync(move |s| s.index.entry(&id))
            .await?
            .ok_or_else(|| format!("Нет такой записи: {file_id}"))?;
        paths::mirror_path(&root, &self.dirs(), &e.project_id, &e.folder_path, &e.name)
            .map(|p| p.to_string_lossy().to_string())
            .ok_or_else(|| format!("Проект {} не найден в раскладке зеркала", e.project_id))
    }

    /// Отменить передачу. Само прерывание происходит в цикле чтения: он проверяет
    /// флаг между кусками и бросает недокачанный `.part`.
    pub async fn cancel_transfer(&self, id: i64) -> Result<(), String> {
        self.cancelled.lock().unwrap().insert(id);

        // Остановленную ЗАЛИВКУ нельзя молча начинать заново. Полный обход зеркала
        // (страховка раз в 10 минут) видит «файл на диске есть, в облаке нет» и
        // ставит его в очередь снова — то есть через несколько минут программа
        // спорила бы с человеком, который только что нажал «Остановить».
        // Запрет снимается изменением файла или явной командой, см. `Pending::decline`.
        if let Ok(Some((direction, local_path, _))) =
            self.with_sync(move |s| s.index.transfer_row(id)).await
        {
            if direction == "up" {
                let path = PathBuf::from(local_path);
                let seen = std::fs::metadata(&path).ok().map(|m| super::pending::Seen {
                    size: m.len(),
                    mtime: m
                        .modified()
                        .ok()
                        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                        .map(|d| d.as_secs() as i64)
                        .unwrap_or(0),
                });
                self.pending.lock().unwrap().decline(path, seen);
            }
        }

        self.with_sync(move |s| s.index.finish_transfer(id, Some("отменено")))
            .await
    }

    fn is_cancelled(&self, id: i64) -> bool {
        self.cancelled.lock().unwrap().contains(&id)
    }

    fn forget_cancel(&self, id: i64) {
        self.cancelled.lock().unwrap().remove(&id);
    }

    pub async fn transfers(&self, limit: i64) -> Result<Vec<super::TransferRow>, String> {
        self.with_sync(move |s| s.index.list_transfers(limit)).await
    }

    /// Пути идущих передач — чтобы обновлять их строки, пока они качаются.
    pub async fn active_transfer_paths(&self) -> Result<Vec<String>, String> {
        self.with_sync(|s| s.index.active_transfer_paths()).await
    }

    pub async fn clear_finished_transfers(&self) -> Result<i64, String> {
        self.with_sync(|s| s.index.clear_finished_transfers()).await
    }

    fn file_lock(&self, file_id: &str) -> Arc<tokio::sync::Mutex<()>> {
        let mut m = self.inflight.lock().unwrap();
        m.entry(file_id.to_string())
            .or_insert_with(|| Arc::new(tokio::sync::Mutex::new(())))
            .clone()
    }

    fn drop_file_lock(&self, file_id: &str) {
        let mut m = self.inflight.lock().unwrap();
        if let Some(l) = m.get(file_id) {
            // Убираем только если на него больше никто не держится: иначе
            // следующий ждущий возьмёт уже другой мьютекс и single-flight сломается.
            if Arc::strong_count(l) == 1 {
                m.remove(file_id);
            }
        }
    }
}

// ─── Гидрация ────────────────────────────────────────────────────────────────

/// Что решили делать после осмотра индекса. Считается под коротким локом,
/// исполняется без него.
#[derive(Debug, Clone)]
enum Plan {
    NoOp(EnsureOutcome),
    Download {
        file_id: String,
        project_id: String,
        s3_key: String,
        expected_etag: Option<String>,
        size: Option<i64>,
    },
}

impl StorageService {
    /// Сделать так, чтобы по этому пути лежал актуальный файл.
    ///
    /// Принимает путь, который у вызывающего кода УЖЕ есть, — не `file_id`. Это
    /// осознанно: шов встраивается в существующий код заменой
    /// `readFile(p)` → `readFile(ensureLocal(p))`, без переписывания.
    ///
    /// Создать папку зеркала на диске — по требованию, вместе с её подпапками.
    ///
    /// Структуру целиком материализовать не нужно: она видна из каталога и без
    /// диска. Папка нужна физически ровно в двух случаях — её открыли в Finder и
    /// в неё кладут файл. Оба случая зовут это.
    ///
    /// Подпапки создаём тоже: «открыть папку» человек понимает как «увидеть в
    /// Finder её структуру», а не одну пустую директорию.
    ///
    /// `false` — путь не под зеркалом (создавать нечего, это не наша забота).
    pub async fn ensure_dir(&self, path: &Path) -> Result<bool, String> {
        let root = self.mirror_root();
        if !under_mirror(&root, path) {
            return Ok(false);
        }

        // Проверяем, что путь вообще осмыслен: класть папку по опечатке внутрь
        // зеркала — значит намусорить там, где мусор потом примут за данные.
        let node = match paths::classify(&root, &self.dirs(), path) {
            Some(super::MirrorNode::Unknown) | None => {
                return Err(format!("Папка не найдена в каталоге: {}", path.display()))
            }
            Some(n) => n,
        };

        std::fs::create_dir_all(path)
            .map_err(|e| format!("create_dir_all {}: {e}", path.display()))?;

        // Внутри проекта достраиваем подпапки, известные каталогу.
        if let super::MirrorNode::Folder {
            project_id,
            folder_path,
        } = node
        {
            let pid = project_id.clone();
            let known = self.with_sync(move |s| s.index.folder_paths(&pid)).await?;
            let prefix = if folder_path.is_empty() {
                String::new()
            } else {
                format!("{folder_path}/")
            };
            for rel in known {
                // Только то, что лежит ВНУТРИ запрошенной папки.
                let Some(tail) = rel.strip_prefix(&prefix) else { continue };
                if tail.is_empty() || (prefix.is_empty() && rel.is_empty()) {
                    continue;
                }
                let mut p = path.to_path_buf();
                for seg in tail.split('/').filter(|s| !s.is_empty()) {
                    p.push(seg);
                }
                let _ = std::fs::create_dir_all(&p);
            }
        }
        Ok(true)
    }

    /// Локальные копии, которые можно освободить.
    ///
    /// Только состояние `Fresh`: копия совпадает с облаком, и удалить её
    /// безопасно. Изменённое локально или ещё не залитое сюда НЕ попадает —
    /// иначе кнопка «удалить копию» стала бы кнопкой «потерять работу».
    pub async fn local_files(&self) -> Result<Vec<LocalFileRow>, String> {
        let candidates = self.with_sync(|s| s.index.eviction_candidates()).await?;
        let root = self.mirror_root();
        let dirs = self.dirs();

        let mut out: Vec<LocalFileRow> = candidates
            .into_iter()
            .filter(|c| c.state == super::FileState::Fresh)
            .map(|c| {
                let path = std::path::PathBuf::from(&c.local_path);
                // Имя клиента и проекта берём из раскладки, а не из пути: путь
                // человеку читать долго, а раскладка уже знает эти имена.
                let project = parse_mirror_path(&root, &dirs, &path)
                    .and_then(|loc| dirs.dirs_of(&loc.project_id).cloned())
                    .map(|(client, proj)| format!("{client} / {proj}"))
                    .unwrap_or_default();
                LocalFileRow {
                    file_id: c.file_id,
                    name: c.name,
                    path: c.local_path,
                    project,
                    size_bytes: c.local_size,
                    last_access: c.last_access,
                    pinned: c.pinned,
                }
            })
            .collect();

        // Самые крупные сверху: освобождают место они.
        out.sort_by(|a, b| b.size_bytes.cmp(&a.size_bytes));
        Ok(out)
    }

    /// Удалить локальную копию одного файла, оставив его в облаке.
    ///
    /// Отказываемся, если копия не `Fresh`: незалитые байты существуют только
    /// здесь, и удаление означало бы их потерю.
    pub async fn drop_local(&self, file_id: &str) -> Result<i64, String> {
        let id = file_id.to_string();
        let st = self
            .with_sync({
                let id = id.clone();
                move |s| s.index.badge_state(&id)
            })
            .await?
            .ok_or_else(|| format!("Нет локальной копии: {file_id}"))?;

        if st.state != super::FileState::Fresh {
            return Err(format!(
                "Копия не синхронизирована ({:?}) — сначала дождитесь заливки",
                st.state
            ));
        }

        let path = self.mirror_path_for(&id).await?;
        let freed = std::fs::metadata(&path).map(|m| m.len() as i64).unwrap_or(0);
        // Файла может не быть — удалили мимо программы. Это не ошибка, состояние
        // всё равно надо привести в порядок.
        let _ = std::fs::remove_file(&path);
        self.with_sync(move |s| s.index.mark_evicted(&id)).await?;
        Ok(freed)
    }

    /// Файлы в зеркале, которые надо залить: положенные человеком и изменённые им.
    ///
    /// `detect_local_changes` находит только правки того, что УЖЕ есть в каталоге.
    /// Новый файл, брошенный в папку через Finder, каталогу неизвестен, и без
    /// отдельного обхода он остался бы лежать локально навсегда.
    /// Всё, что лежит здесь и не уехало в облако.
    ///
    /// Два источника, и оба нужны: обход зеркала находит файлы, которых в каталоге
    /// нет вовсе, а `local_modified_paths` — те, что в каталоге есть, но здесь их
    /// правили. Ни один из двух списков сам по себе на вопрос «всё ли отправлено»
    /// не отвечает.
    pub async fn not_uploaded(&self, limit: usize) -> Result<Vec<NotUploadedRow>, String> {
        let root = self.mirror_root();
        let новые = self.pending_uploads(limit).await?;
        let правленые = self.local_modified_paths().await?;

        let mut rows = Vec::new();
        let mut seen = std::collections::HashSet::new();
        for (path, base) in новые
            .into_iter()
            .map(|p| (p, "new"))
            .chain(правленые.into_iter().map(|p| (p, "modified")))
        {
            if !seen.insert(path.clone()) {
                continue;
            }
            let md = std::fs::metadata(&path).ok();
            // Ручная остановка важнее причины появления: она объясняет, почему файл
            // стоит, и её человек ищет в этом списке в первую очередь.
            let reason = if self.is_upload_declined(&path) {
                "stopped"
            } else {
                base
            };
            let folder = path
                .parent()
                .and_then(|d| d.strip_prefix(&root).ok())
                .map(|r| r.to_string_lossy().to_string())
                .unwrap_or_default();
            rows.push(NotUploadedRow {
                name: path
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_default(),
                path: path.to_string_lossy().to_string(),
                folder,
                size_bytes: md.as_ref().map(|m| m.len() as i64).unwrap_or(0),
                mtime: md
                    .as_ref()
                    .and_then(|m| m.modified().ok())
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_secs() as i64)
                    .unwrap_or(0),
                reason: reason.to_string(),
            });
        }
        Ok(rows)
    }

    pub async fn pending_uploads(&self, limit: usize) -> Result<Vec<PathBuf>, String> {
        let root = self.mirror_root();
        if root.as_os_str().is_empty() {
            return Ok(Vec::new());
        }

        let mut out = Vec::new();
        let mut stack = vec![root.clone()];
        while let Some(dir) = stack.pop() {
            if out.len() >= limit {
                break;
            }
            let Ok(rd) = std::fs::read_dir(&dir) else { continue };
            for de in rd.flatten() {
                let path = de.path();
                let name = de.file_name().to_string_lossy().to_string();
                // Скрытые и огрызки недокачанных файлов не наши.
                if name.starts_with('.') || name.ends_with(".part") {
                    continue;
                }
                if de.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                    stack.push(path);
                    continue;
                }
                if out.len() >= limit {
                    break;
                }
                // Файл вне логической структуры (например, брошен в корень зеркала)
                // заливать некуда — пропускаем молча.
                let Some(loc) = parse_mirror_path(&root, &self.dirs(), &path) else {
                    continue;
                };
                let known = self
                    .with_sync({
                        let loc = loc.clone();
                        move |s| s.index.entry_by_path(&loc.project_id, &loc.folder_path, &loc.name)
                    })
                    .await?;
                if known.is_none() {
                    out.push(path);
                }
            }
        }
        Ok(out)
    }

    /// Разобрать путь в зеркале, отличая «это не файл» от «карта устарела».
    ///
    /// Обе ситуации выглядят одинаково — `parse_mirror_path` вернул `None`, — но
    /// значат противоположное. Первая нормальна (папка проекта, папка клиента).
    /// Вторая означает, что клиента или проект переименовали, и путь больше не
    /// узнаётся. Если ответить «не в зеркале», файл молча не скачается, а
    /// обработка получит путь к несуществующему файлу — худший вид ошибки.
    /// Поэтому на неизвестном пути сначала пересобираем карту, а потом ругаемся.
    async fn resolve_file(
        &self,
        root: &Path,
        path: &Path,
    ) -> Result<Option<super::MirrorLocation>, String> {
        if let Some(loc) = parse_mirror_path(root, &self.dirs(), path) {
            return Ok(Some(loc));
        }
        if !matches!(
            paths::classify(root, &self.dirs(), path),
            Some(super::MirrorNode::Unknown)
        ) {
            return Ok(None); // Честно не файл: корень, клиент или папка проекта.
        }

        self.refresh_dirs().await;
        if let Some(loc) = parse_mirror_path(root, &self.dirs(), path) {
            return Ok(Some(loc));
        }
        if matches!(
            paths::classify(root, &self.dirs(), path),
            Some(super::MirrorNode::Unknown)
        ) {
            return Err(format!(
                "Путь в зеркале не опознан: {}. Обновите список проектов — клиента или проект могли переименовать.",
                path.display()
            ));
        }
        Ok(None)
    }

    /// **Вне зеркала — no-op.** Поэтому вызов можно ставить везде, где путь
    /// превращается в файл, не разбираясь «здесь надо или нет».
    pub async fn ensure_local(&self, path: &Path) -> Result<EnsureResult, String> {
        let root = self.mirror_root();
        if !under_mirror(&root, path) {
            return Ok(EnsureResult {
                path: path.to_string_lossy().to_string(),
                outcome: EnsureOutcome::NotInMirror,
                bytes: None,
            });
        }

        let Some(loc) = self.resolve_file(&root, path).await? else {
            // Под зеркалом, но не файл (например, сама папка проекта).
            return Ok(EnsureResult {
                path: path.to_string_lossy().to_string(),
                outcome: EnsureOutcome::NotInMirror,
                bytes: None,
            });
        };

        // Перед решением сверяемся с диском: без этого `ensure_local` спокойно
        // затрёт файл, который правили руками, — состояние `LocalModified` просто
        // никогда бы не появилось.
        if let Some(e) = self
            .with_sync({
                let loc = loc.clone();
                move |s| s.index.entry_by_path(&loc.project_id, &loc.folder_path, &loc.name)
            })
            .await?
        {
            self.detect_local_change(&e.id).await?;
        }

        let plan = self.plan_for(&loc, path).await?;

        let (file_id, project_id, s3_key, expected_etag, size) = match plan {
            Plan::NoOp(outcome) => {
                return Ok(EnsureResult {
                    path: path.to_string_lossy().to_string(),
                    outcome,
                    bytes: None,
                })
            }
            Plan::Download {
                file_id,
                project_id,
                s3_key,
                expected_etag,
                size,
            } => (file_id, project_id, s3_key, expected_etag, size),
        };

        // Single-flight: пока один качает, остальные ждут здесь.
        let lock = self.file_lock(&file_id);
        let _guard = lock.lock().await;

        // Перепроверка под локом: пока ждали, файл мог уже скачаться.
        let recheck = self.plan_for(&loc, path).await?;
        if let Plan::NoOp(outcome) = recheck {
            self.drop_file_lock(&file_id);
            return Ok(EnsureResult {
                path: path.to_string_lossy().to_string(),
                outcome,
                bytes: None,
            });
        }

        let res = self
            .download(&file_id, &project_id, &s3_key, expected_etag.as_deref(), size, path)
            .await;
        self.drop_file_lock(&file_id);
        res
    }

    /// Дерево решений из R2_SYNC_PLAN.md, 6.1. Только БД и один `exists` —
    /// в сеть здесь не ходим.
    async fn plan_for(&self, loc: &super::paths::MirrorLocation, path: &Path) -> Result<Plan, String> {
        let loc = loc.clone();
        let target = path.to_path_buf();
        self.with_sync(move |s| {
            let entry = s
                .index
                .entry_by_path(&loc.project_id, &loc.folder_path, &loc.name)?;

            let Some(e) = entry else {
                // В индексе нет. Если файл на диске есть — его положили руками:
                // это LocalOnly, его надо залить, а не качать. Перепутать нельзя:
                // попытка скачать несуществующее в облаке падает непонятно.
                return Ok(if target.exists() {
                    Plan::NoOp(EnsureOutcome::LocalOnly)
                } else {
                    Plan::NoOp(EnsureOutcome::NotInMirror)
                });
            };

            let Some(s3_key) = e.s3_key.clone() else {
                // Логическая папка: качать нечего, но каталог на диске создадим.
                std::fs::create_dir_all(&target)
                    .map_err(|err| format!("create_dir_all {}: {err}", target.display()))?;
                return Ok(Plan::NoOp(EnsureOutcome::AlreadyFresh));
            };

            let badge = s.index.badge_state(&e.id)?;
            let state = badge.map(|b| b.state).unwrap_or(FileState::Cloud);

            // Быстрый путь: копия есть и совпадает с облаком — ни одного запроса.
            let fresh_on_disk = matches!(state, FileState::Fresh) && target.exists();
            if fresh_on_disk {
                s.index.touch_access(&e.id)?;
                return Ok(Plan::NoOp(EnsureOutcome::AlreadyFresh));
            }

            // Локально правили и не заливали — качать нельзя, затрём работу.
            if matches!(state, FileState::LocalModified | FileState::Conflict) && target.exists() {
                return Ok(Plan::NoOp(EnsureOutcome::LocalOnly));
            }

            Ok(Plan::Download {
                file_id: e.id.clone(),
                project_id: e.project_id.clone(),
                s3_key,
                expected_etag: e.content_hash.clone().or(e.etag.clone()),
                size: e.size_bytes,
            })
        })
        .await
    }

    /// Скачивание. Глобальный лок здесь НЕ держится.
    async fn download(
        &self,
        file_id: &str,
        project_id: &str,
        s3_key: &str,
        expected_version: Option<&str>,
        expected_size: Option<i64>,
        target: &Path,
    ) -> Result<EnsureResult, String> {
        let provider = self
            .provider()
            .ok_or_else(|| "Хранилище не подключено".to_string())?;

        // Ссылка запрашивается ЗДЕСЬ, а не заранее пачкой: TTL по умолчанию час,
        // и на длинной очереди заранее выписанные ссылки протухнут.
        let presigned = provider
            .presign_get(project_id, s3_key, Some(3600))
            .await
            .map_err(|e| e.to_string())?;

        let transfer_id = self
            .with_sync(|s| {
                s.index.set_state(file_id, "Downloading", None)?;
                s.index.enqueue_transfer(
                    Some(file_id),
                    project_id,
                    "down",
                    &target.to_string_lossy(),
                    expected_size,
                )
            })
            .await?;

        let result = self.stream_to_file(&presigned.url, target, transfer_id).await;

        match result {
            Ok((bytes, sha)) => {
                let mtime = file_mtime(target).unwrap_or(0);
                let version = expected_version.map(|s| s.to_string());
                let sha_for_db = sha.clone();
                self.with_sync(move |s| {
                    s.index.finish_transfer(transfer_id, None)?;
                    // baseline: размер и mtime НА МОМЕНТ синхронизации, а не
                    // «текущие с диска». Без этого «в облаке новее» не отличить
                    // от «у меня новее».
                    s.index.mark_synced(
                        file_id,
                        "Fresh",
                        &target.to_string_lossy(),
                        bytes,
                        mtime,
                        version.as_deref().or(Some(&sha_for_db)),
                    )
                })
                .await?;
                // Значок обязан смениться сразу: скачивание могло начаться не из
                // интерфейса (префетч, гидрация перед обработкой), и тогда обновить
                // строку больше некому.
                self.emit_changed(&[target.to_string_lossy().to_string()]);
                Ok(EnsureResult {
                    path: target.to_string_lossy().to_string(),
                    outcome: EnsureOutcome::Downloaded,
                    bytes: Some(bytes),
                })
            }
            Err(e) => {
                let msg = e.clone();
                self.with_sync(move |s| {
                    s.index.finish_transfer(transfer_id, Some(&msg))?;
                    s.index.set_state(file_id, "Error", Some(&msg))
                })
                .await?;
                Err(e)
            }
        }
    }

    /// Поток в `.part` и атомарное переименование.
    ///
    /// Писать сразу в целевой файл нельзя: обрыв оставит обрезанный файл, который
    /// по всем признакам выглядит целым, и следующий запуск примет его за готовый.
    async fn stream_to_file(
        &self,
        url: &str,
        target: &Path,
        transfer_id: i64,
    ) -> Result<(i64, String), String> {
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("create_dir_all {}: {e}", parent.display()))?;
        }
        let part = paths::part_path(target);

        let mut res = self
            .http
            .get(url)
            .send()
            .await
            .map_err(|e| format!("GET: {e}"))?;
        if !res.status().is_success() {
            return Err(format!("GET вернул {}", res.status().as_u16()));
        }

        let mut file = std::fs::File::create(&part)
            .map_err(|e| format!("create {}: {e}", part.display()))?;
        let mut hasher = Sha256::new();
        let mut total: i64 = 0;
        let mut last_reported: i64 = 0;

        use std::io::Write;
        while let Some(chunk) = res.chunk().await.map_err(|e| format!("chunk: {e}"))? {
            if self.is_cancelled(transfer_id) {
                drop(file);
                let _ = std::fs::remove_file(&part);
                self.forget_cancel(transfer_id);
                return Err("Передача отменена".into());
            }
            file.write_all(&chunk)
                .map_err(|e| format!("write {}: {e}", part.display()))?;
            hasher.update(&chunk);
            total += chunk.len() as i64;

            // Прогресс пишем не на каждый чанк: иначе на большом файле получим
            // десятки тысяч записей в БД вместо полезной работы.
            if total - last_reported >= 4 * 1024 * 1024 {
                last_reported = total;
                let _ = self
                    .with_sync(|s| s.index.set_transfer_progress(transfer_id, total))
                    .await;
            }
        }
        file.flush().map_err(|e| format!("flush: {e}"))?;
        drop(file);

        std::fs::rename(&part, target).map_err(|e| {
            let _ = std::fs::remove_file(&part);
            format!("rename {} → {}: {e}", part.display(), target.display())
        })?;

        Ok((total, format!("{:x}", hasher.finalize())))
    }
}

// ─── Заливка ─────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct UploadResult {
    /// Пусто у сайдкара: строки в каталоге у служебных JSON-ов нет вовсе.
    pub file_id: String,
    /// Пусто у сайдкара: ключ ему назначает бэкенд, и он канонический, не физический.
    pub s3_key: String,
    pub bytes: i64,
    pub strategy: super::upload::UploadStrategy,
    /// Ушло каналом сайдкаров (`PUT /sidecars`), а не `presign` + `notify`.
    #[serde(default)]
    pub sidecar: bool,
}

impl StorageService {
    /// Залить файл из зеркала в облако.
    ///
    /// Три шага, и третий обязателен: `presign` → `PUT` → **`notify`**. Без
    /// подтверждения объект в бакете есть, а бэкенд про него не знает — сайт файла
    /// не увидит, пока кто-нибудь вручную не запустит `/reindex`.
    pub async fn upload_local(&self, path: &Path) -> Result<UploadResult, String> {
        let root = self.mirror_root();
        if !under_mirror(&root, path) {
            return Err(format!(
                "Файл вне зеркала, заливать нечего: {}",
                path.display()
            ));
        }
        let loc = parse_mirror_path(&root, &self.dirs(), path)
            .ok_or_else(|| format!("Не разобран зеркальный путь: {}", path.display()))?;

        // Служебные JSON-ы уходят ДРУГИМ каналом, и это не оптимизация: сайт читает
        // их по фиксированному ключу, а `presign` выписал бы физический `{uuid}-имя`.
        // Залитый обычным путём `folderState.json` лёг бы рядом с тем, который читает
        // сайт, — то есть настройки уехали бы в никуда. См. `Sidecar`.
        if let Some(which) = Sidecar::from_logical(&loc.folder_path, &loc.name) {
            return self.upload_sidecar(&loc, which, path).await;
        }

        // Имя проверяем ДО байтов: его валидирует `/notify`, то есть уже после PUT —
        // объект оказался бы в бакете без строки в каталоге и без способа его удалить.
        super::upload::check_logical_name(&loc.name).map_err(|e| e.to_string())?;

        let meta = std::fs::metadata(path)
            .map_err(|e| format!("Нет файла {}: {e}", path.display()))?;
        let size = meta.len() as i64;

        // Стратегия и отказ — ДО передачи байтов. Если файл больше 5 ГиБ, а
        // multipart бэкендом не поддерживается, узнать об этом надо здесь, а не
        // на четвёртом гигабайте.
        let caps = self.with_sync(|s| Ok(s.caps().clone())).await?;
        let threshold = *self.multipart_threshold.lock().unwrap();
        let strategy = super::upload::choose_strategy(size, threshold, &caps)
            .map_err(|e| e.to_string())?;
        if strategy == super::upload::UploadStrategy::Multipart {
            return Err(
                "Multipart-загрузка ещё не реализована на нашей стороне (эндпоинты \
                 бэкенда появились, стратегия — следующий шаг)"
                    .into(),
            );
        }

        // Single-flight по пути: file_id у нового файла ещё нет.
        let key = path.to_string_lossy().to_string();
        let lock = self.file_lock(&key);
        let _guard = lock.lock().await;

        let res = self.do_single_put(&loc, path, size).await;
        self.drop_file_lock(&key);
        if res.is_ok() {
            // Заливку почти всегда начинает демон, а не человек: без события
            // строка осталась бы со значком «надо залить» после успешной заливки.
            self.emit_changed(&[key.clone()]);
        }
        res
    }

    async fn do_single_put(
        &self,
        loc: &super::paths::MirrorLocation,
        path: &Path,
        size: i64,
    ) -> Result<UploadResult, String> {
        let provider = self
            .provider()
            .ok_or_else(|| "Хранилище не подключено".to_string())?;

        let content_type = super::upload::guess_content_type(&loc.name);
        // Хэш до заливки: он поедет в `notify` как `contentHash`. У multipart-объектов
        // `etag` перестаёт быть хэшем содержимого, а сравнение «устарела ли копия»
        // должно работать и тогда.
        let sha = super::upload::sha256_file(path)?;
        let mtime = file_mtime(path);

        // Ключ уже известного файла — обязателен при перезаливке.
        //
        // Без него бэкенд выписывает новый `{uuid}-{имя}`, `notify` не находит
        // строку по `s3_key` и ЗАВОДИТ ВТОРУЮ с тем же логическим именем: в
        // каталоге дубль, прежний объект в R2 осиротел, `file_id` сменился.
        // А перезапись результата в тот же путь — самый частый вид заливки.
        let known_key = self
            .with_sync({
                let loc = loc.clone();
                move |s| {
                    Ok(s.index
                        .entry_by_path(&loc.project_id, &loc.folder_path, &loc.name)?
                        .and_then(|e| e.s3_key))
                }
            })
            .await?;

        let project_id = loc.project_id.clone();
        let local = path.to_string_lossy().to_string();
        let transfer_id = self
            .with_sync(move |s| {
                s.index
                    .enqueue_transfer(None, &project_id, "up", &local, Some(size))
            })
            .await?;

        let out = self
            .single_put_inner(
                &provider,
                loc,
                path,
                size,
                content_type,
                &sha,
                mtime,
                transfer_id,
                known_key.as_deref(),
            )
            .await;

        match out {
            Ok(file) => {
                let file_id = file.id.clone();
                let s3_key = file.s3_key.clone().unwrap_or_default();
                let etag_for_baseline = sha.clone();
                let local_path = path.to_string_lossy().to_string();
                let mt = mtime.unwrap_or(0);
                let f = file.clone();

                self.with_sync(move |s| {
                    s.index.finish_transfer(transfer_id, None)?;
                    // Файл мог быть новым — тогда в каталоге его ещё нет. Добавляем
                    // из ответа `notify`, чтобы дерево не ждало следующей дельты.
                    s.index.upsert_from_file(&f)?;
                    // Версия в облаке = то, что мы только что залили. `upsert_from_file`
                    // её не пишет (в ответе `notify` хэша нет), а без неё значок сразу
                    // после заливки показывает «в облаке новее».
                    s.index.set_remote_version(&f.id, &etag_for_baseline)?;
                    s.index.mark_synced(
                        &f.id,
                        "Fresh",
                        &local_path,
                        size,
                        mt,
                        Some(&etag_for_baseline),
                    )
                })
                .await?;

                Ok(UploadResult {
                    file_id,
                    s3_key,
                    bytes: size,
                    strategy: super::upload::UploadStrategy::SinglePut,
                    sidecar: false,
                })
            }
            Err(e) => {
                let msg = e.clone();
                self.with_sync(move |s| s.index.finish_transfer(transfer_id, Some(&msg)))
                    .await?;
                Err(e)
            }
        }
    }

    // ─── Сайдкары: служебные JSON-ы проекта ──────────────────────────────────
    //
    // Здесь нет ни presign, ни notify, ни строки в каталоге, ни передачи байтов в
    // R2 напрямую: тело едет ЧЕРЕЗ бэкенд одним запросом. Для файлов такое было бы
    // недопустимо (гигабайты через API), но сайдкар — это сотни байт настроек, и
    // взамен мы получаем единственное, что здесь важно: попадание в канонический
    // ключ, по которому файл читает сайт.

    /// Отдать сайдкар в облако.
    ///
    /// **Сначала читаем то, что там лежит.** Причина не в экономии запроса: подтянув
    /// правку с сайта, мы пишем файл на диск, вотчер видит запись и ставит его в
    /// очередь на заливку — и без этой сверки мы бы тут же вернули в облако то, что
    /// только что оттуда взяли. Один GET разрывает эту петлю.
    async fn upload_sidecar(
        &self,
        loc: &super::paths::MirrorLocation,
        which: Sidecar,
        path: &Path,
    ) -> Result<UploadResult, String> {
        let provider = self
            .provider()
            .ok_or_else(|| "Хранилище не подключено".to_string())?;

        let body = std::fs::read_to_string(path)
            .map_err(|e| format!("Не прочитан {}: {e}", path.display()))?;
        let bytes = body.len() as i64;

        let remote = provider
            .sidecar_get(&loc.project_id, which)
            .await
            .map_err(|e| e.to_string())?;
        if remote.as_deref() == Some(body.as_str()) {
            return Ok(sidecar_upload_result(bytes));
        }

        provider
            .sidecar_put(&loc.project_id, which, &body, None)
            .await
            .map_err(|e| e.to_string())?;

        // Строки каталога у сайдкаров быть не должно. Если она есть — это наследство
        // прежней (неверной) заливки обычным путём, и её надо убрать, иначе интерфейс
        // продолжит показывать значок синхронизации у файла, которого в каталоге
        // концептуально нет, а вытеснение будет считать его обычной копией.
        if let Err(e) = self.purge_sidecar_row(&loc.project_id, which).await {
            eprintln!("[storage] не удалось убрать каталожную строку сайдкара: {e}");
        }

        self.emit_changed(&[path.to_string_lossy().to_string()]);
        Ok(sidecar_upload_result(bytes))
    }

    /// Подтянуть сайдкар из облака на диск. `true` — файл на диске изменился.
    ///
    /// Пишем только при РАСХОЖДЕНИИ содержимого: лишняя запись двигает mtime, вотчер
    /// принимает это за правку человека и ставит файл в очередь на заливку.
    ///
    /// Папку проекта не создаём, даже если её нет: сайдкар без проекта на диске —
    /// это гонка (проект переименовали или удалили), и воскрешать папку записью
    /// служебного файла нельзя.
    pub async fn pull_sidecar(&self, project_id: &str, which: Sidecar) -> Result<bool, String> {
        let provider = self
            .provider()
            .ok_or_else(|| "Хранилище не подключено".to_string())?;

        let Some(body) = provider
            .sidecar_get(project_id, which)
            .await
            .map_err(|e| e.to_string())?
        else {
            return Ok(false);
        };

        let root = self.mirror_root();
        let Some(path) = super::paths::mirror_path(
            &root,
            &self.dirs(),
            project_id,
            super::types::SIDECAR_FOLDER,
            which.file_name(),
        ) else {
            return Ok(false);
        };
        let Some(project_dir) = path.parent().and_then(|p| p.parent()) else {
            return Ok(false);
        };
        if !project_dir.is_dir() {
            return Ok(false);
        }

        if std::fs::read_to_string(&path).ok().as_deref() == Some(body.as_str()) {
            return Ok(false);
        }

        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("create_dir_all {}: {e}", parent.display()))?;
        }
        std::fs::write(&path, body.as_bytes())
            .map_err(|e| format!("write {}: {e}", path.display()))?;
        self.emit_changed(&[path.to_string_lossy().to_string()]);
        Ok(true)
    }

    /// Убрать каталожную строку сайдкара — наследство заливки обычным путём.
    ///
    /// Удаляем ЧЕРЕЗ API, вместе с объектом: этот объект (`options/{uuid}-имя.json`)
    /// не читает никто, он существует только потому, что мы однажды залили служебный
    /// файл не тем каналом.
    ///
    /// **Строку с каноническим ключом не трогаем.** Если `s3_key` кончается ровно на
    /// логическое имя, значит объект — тот самый, который читает сайт (например, его
    /// подобрал `/reindex`), и удалить его значило бы снести живые настройки проекта.
    async fn purge_sidecar_row(&self, project_id: &str, which: Sidecar) -> Result<(), String> {
        let pid = project_id.to_string();
        let entry = self
            .with_sync(move |s| {
                s.index.entry_by_path(
                    &pid,
                    super::types::SIDECAR_FOLDER,
                    which.file_name(),
                )
            })
            .await?;
        let Some(entry) = entry else { return Ok(()) };

        let canonical_tail = format!("/{}/{}", super::types::SIDECAR_FOLDER, which.file_name());
        if entry
            .s3_key
            .as_deref()
            .is_some_and(|k| k.ends_with(&canonical_tail))
        {
            return Ok(());
        }

        let provider = self
            .provider()
            .ok_or_else(|| "Хранилище не подключено".to_string())?;
        provider
            .delete(project_id, &entry.id, None)
            .await
            .map_err(|e| e.to_string())?;
        // `forget_files`, а не tombstone: строки быть не должно вообще, а не «есть,
        // но удалена». Локальный файл на диске остаётся — это рабочие настройки,
        // удалялась только его ошибочная копия в каталоге.
        let ids = vec![entry.id.clone()];
        self.with_sync(move |s| s.index.forget_files(&ids).map(|_| ()))
            .await?;
        Ok(())
    }

    /// Писать прогресс в базу, ПОКА передача ещё идёт.
    ///
    /// Байты считает обёртка над потоком тела, но она синхронная и в базу писать не
    /// может. Из-за этого `bytes_done` записывался единственный раз — после ответа
    /// сервера, то есть когда показывать прогресс уже незачем: файл на 200 МБ всю
    /// заливку честно показывал «↑ 0 %». Хуже того, в `active` передачу переводит
    /// именно запись прогресса, поэтому строка всю дорогу оставалась `queued` — и в
    /// верхней панели заливки не было видно вовсе, хотя у файла значок уже стоял.
    ///
    /// Запрос и опрос счётчика идут в ОДНОЙ задаче через `select!`: на время записи
    /// в базу передача приостанавливается на считанные миллисекунды. Первый тик
    /// отчитывается всегда, даже про нулевой прогресс, — им и снимается `queued`.
    ///
    /// Тот же тик — единственное место, где заливка вообще может УЗНАТЬ об отмене.
    /// Тело PUT отдаётся потоком внутрь `reqwest`, своего цикла по кускам у нас нет,
    /// и до этой правки «Остановить» помечало передачу отменённой, а байты продолжали
    /// ехать до конца. Возвращаем `None` — future запроса роняется, соединение
    /// закрывается. Объект в бакете при этом не появляется (PUT атомарен), а `/notify`
    /// мы не звали, поэтому и каталог о файле не узнает: «остановил — и в облаке
    /// ничего нет» выполняется буквально.
    ///
    /// Ограничение по устройству: внутри `fut` нельзя дожидаться того, что зависит
    /// от продвижения этой же задачи, — пока ветка тикера ждёт лок каталога, `fut`
    /// не опрашивается. Для сетевого запроса это условие выполняется всегда.
    async fn report_progress_while<T>(
        &self,
        transfer_id: i64,
        sent: &std::sync::atomic::AtomicI64,
        tick: std::time::Duration,
        fut: impl std::future::Future<Output = T>,
    ) -> Option<T> {
        tokio::pin!(fut);
        // -1, а не 0: иначе про самое начало передачи никто не отчитается и строка
        // останется `queued`.
        let mut last: i64 = -1;
        loop {
            tokio::select! {
                out = &mut fut => return Some(out),
                _ = tokio::time::sleep(tick) => {
                    if self.is_cancelled(transfer_id) {
                        return None;
                    }
                    let done = sent.load(std::sync::atomic::Ordering::Relaxed);
                    if done != last {
                        last = done;
                        let _ = self
                            .with_sync(move |s| s.index.set_transfer_progress(transfer_id, done))
                            .await;
                    }
                }
            }
        }
    }

    #[allow(clippy::too_many_arguments)]
    async fn single_put_inner(
        &self,
        provider: &Provider,
        loc: &super::paths::MirrorLocation,
        path: &Path,
        size: i64,
        content_type: &str,
        sha: &str,
        mtime: Option<i64>,
        transfer_id: i64,
        known_key: Option<&str>,
    ) -> Result<ProjectFile, String> {
        // Ссылка запрашивается здесь, а не пачкой заранее: TTL час, и хвост длинной
        // очереди протух бы.
        let presigned = provider
            .presign_put(
                &loc.project_id,
                &loc.folder_path,
                &loc.name,
                content_type,
                Some(3600),
                known_key,
            )
            .await
            .map_err(|e| e.to_string())?;

        // Тело — потоком с диска. Читать пятигиговый мастер в память нельзя.
        let file = tokio::fs::File::open(path)
            .await
            .map_err(|e| format!("open {}: {e}", path.display()))?;
        let sent = std::sync::Arc::new(std::sync::atomic::AtomicI64::new(0));
        let sent2 = sent.clone();
        let stream = futures_util::StreamExt::map(
            tokio_util::io::ReaderStream::new(file),
            move |chunk| {
                if let Ok(b) = &chunk {
                    sent2.fetch_add(b.len() as i64, std::sync::atomic::Ordering::Relaxed);
                }
                chunk
            },
        );

        // Счётчик крутится в памяти, поэтому опрашивать его надо ПОКА идёт запрос:
        // писать `bytes_done` после `send().await` — значит не показать прогресс
        // вообще (см. `report_progress_while`).
        let sent_res = self
            .report_progress_while(
                transfer_id,
                &sent,
                PROGRESS_TICK,
                self.http
                    .put(&presigned.url)
                    .header("Content-Type", content_type)
                    .header("Content-Length", size.to_string())
                    .body(reqwest::Body::wrap_stream(stream))
                    .send(),
            )
            .await;
        let Some(res) = sent_res else {
            self.forget_cancel(transfer_id);
            return Err("Передача отменена".into());
        };
        let res = res.map_err(|e| format!("PUT: {e}"))?;

        if !res.status().is_success() {
            return Err(format!("PUT вернул {}", res.status().as_u16()));
        }

        let done = sent.load(std::sync::atomic::Ordering::Relaxed);
        let _ = self
            .with_sync(|s| s.index.set_transfer_progress(transfer_id, done))
            .await;

        // Без этого шага бэкенд про файл не узнает. Отдельная ветка ошибки: объект
        // в бакете уже лежит, и если `notify` не прошёл — это НЕ то же самое, что
        // «заливка не удалась». Сообщение должно это различать.
        provider_notify(provider, loc, &presigned.s3_key, size, content_type, sha, mtime)
            .await
            .map_err(|e| {
                format!(
                    "Байты залиты, но подтверждение не прошло ({e}). \
                     Объект есть в бакете, а каталог его не видит — поможет /reindex."
                )
            })
    }
}

/// Результат заливки сайдкара. `file_id`/`s3_key` пусты не «пока», а по существу:
/// строки в каталоге у сайдкара нет, а ключ канонический и известен бэкенду.
fn sidecar_upload_result(bytes: i64) -> UploadResult {
    UploadResult {
        file_id: String::new(),
        s3_key: String::new(),
        bytes,
        strategy: super::upload::UploadStrategy::SinglePut,
        sidecar: true,
    }
}

async fn provider_notify(
    provider: &Provider,
    loc: &super::paths::MirrorLocation,
    s3_key: &str,
    size: i64,
    content_type: &str,
    sha: &str,
    mtime: Option<i64>,
) -> Result<ProjectFile, StorageError> {
    provider
        .notify(super::client::NotifyArgs {
            project_id: &loc.project_id,
            s3_key,
            file_name: &loc.name,
            folder_path: &loc.folder_path,
            size_bytes: Some(size),
            content_type: Some(content_type),
            origin_mtime: mtime,
            content_hash: Some(sha),
            event_id: None,
        })
        .await
}

// ─── Сведения о пути без гидрации ────────────────────────────────────────────

/// Ответ на «что это за путь» БЕЗ скачивания.
///
/// Нужен там, где коду нужны метаданные, а не содержимое: проверки существования
/// и `stat` при обходе дерева. Если бы они гидратировали, первый же обход проекта
/// скачал бы весь архив.
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PathInfo {
    /// Путь под зеркалом. `false` — обычный локальный файл, всё как раньше.
    pub in_mirror: bool,
    /// Существует ли: на диске ИЛИ в облаке. Для кода, решающего «обрабатывать
    /// или пропустить», облачный файл существует — он просто ещё не здесь.
    pub exists: bool,
    /// Есть ли локальная копия прямо сейчас.
    pub local: bool,
    pub is_folder: bool,
    pub size: Option<i64>,
    /// Unix seconds. Для облачного файла — исходное время из каталога.
    pub mtime: Option<i64>,
    pub file_id: Option<String>,
}

impl StorageService {
    /// Убедиться, что каталог проекта хоть раз загружен с бэкенда.
    ///
    /// ── Зачем ───────────────────────────────────────────────────────────────
    /// Листинг папок читает **только локальный индекс** — это правильно, иначе
    /// каждый показ папки стоил бы запроса. Но первый `/tree` кто-то должен
    /// позвать, и до этой правки не звал никто: `catch_up` дёргали лишь модалка
    /// «Информация» и раннер перед витком. Поэтому свежеподключённое хранилище
    /// показывало проекты (они приходят из `/projects`) и **пустоту внутри них** —
    /// выглядело как «облако не работает», хотя файлы в облаке есть.
    ///
    /// `tree_at`, а не `cursor`: курсор нулевой и у проекта, по которому обход
    /// сделан, а изменений не было. Различать «не знаем» и «знаем, что пусто»
    /// обязательно — иначе обход повторялся бы на каждый показ пустой папки.
    ///
    /// Single-flight по проекту: открыли три папки подряд — обход один.
    pub async fn ensure_catalog(&self, project_id: &str) -> Result<(), String> {
        // Обращение к каталогу проекта — это и есть касание: дальше он живёт в
        // опросе дельт, пока с ним работают.
        self.touch_project(project_id);
        let pid = project_id.to_string();
        if self.with_sync(move |s| s.index.tree_at(&pid)).await?.is_some() {
            return Ok(());
        }

        let key = format!("boot:{project_id}");
        let lock = self.file_lock(&key);
        let guard = lock.lock().await;

        // Пока ждали лок, обход мог сделать сосед.
        let pid = project_id.to_string();
        let done = self.with_sync(move |s| s.index.tree_at(&pid)).await?.is_some();
        let mut sidecars_dirty = 0u8;
        if !done {
            let mut g = self.sync_mut().await;
            if let Some(s) = g.as_mut() {
                let report = s.catch_up(project_id).await.map_err(|e| e.to_string())?;
                sidecars_dirty = report.sidecars_dirty;
            }
        }
        drop(guard);
        self.drop_file_lock(&key);

        // Первый обход проекта — единственный момент, когда сайдкары надо подтянуть
        // без всякого сигнала: в `/tree` их нет, а на диске у новой машины тоже.
        for which in super::types::Sidecar::from_mask(sidecars_dirty) {
            if let Err(e) = self.pull_sidecar(project_id, which).await {
                eprintln!(
                    "[storage] сайдкар {} проекта {project_id}: {e}",
                    which.file_name()
                );
            }
        }
        Ok(())
    }

    /// Перечитать деревья заново — целиком, а не дельтами.
    ///
    /// Единственный способ увидеть **чужое переименование**: бэкенд его не журналит
    /// (`writeRename` пишет в журнал только при смене ключа, а ключ при
    /// переименовании не меняется), поэтому из `/delta` о нём не узнать никак.
    /// Дорого, поэтому редко и **только по тёплым проектам**: перечитывать то, с чем
    /// никто не работает, значит платить за чужую папку без причины.
    ///
    /// Возвращает, сколько проектов перечитали.
    pub async fn retree_warm(&self, window: std::time::Duration) -> Result<usize, String> {
        let ids = self.warm_projects(window);
        let mut done = 0;
        for id in &ids {
            let mut g = self.sync_mut().await;
            let Some(s) = g.as_mut() else { break };
            match s.bootstrap(id).await {
                Ok(_) => done += 1,
                Err(e) => eprintln!("[storage] повторный обход {id}: {e}"),
            }
            drop(g);
        }
        if done > 0 {
            // Имена могли измениться — локальные копии обязаны переехать следом.
            let moved = self.reconcile_local_paths().await?;
            if moved > 0 {
                println!("[storage] после повторного обхода переехало копий: {moved}");
            }
        }
        Ok(done)
    }

    /// Отпечаток списка проектов: имя + архив + пауза + владелец по каждому.
    ///
    /// Нужен, чтобы отличить «список изменился» от «просто перечитали»: событие
    /// интерфейсу отправляется только при настоящем изменении.
    pub async fn projects_fingerprint(&self) -> Result<String, String> {
        self.with_sync(|s| {
            let mut rows: Vec<String> = s
                .index
                .projects(None)?
                .into_iter()
                .map(|p| {
                    format!(
                        "{}|{}|{}|{}|{}",
                        p.id,
                        p.name,
                        p.is_archived as u8,
                        p.is_paused as u8,
                        p.user_id.unwrap_or_default()
                    )
                })
                .collect();
            rows.sort();
            Ok(rows.join("\n"))
        })
        .await
    }

    /// Сообщить интерфейсу, что список проектов изменился (имя, архив, пауза, состав).
    pub fn emit_projects_changed(&self) {
        let guard = self.app.lock().unwrap();
        if let Some(app) = guard.as_ref() {
            use tauri::Emitter;
            let _ = app.emit("storage-projects-changed", ());
        }
    }

    /// Догнать дельты одного проекта. Отдельно от команды — зовёт и демон.
    ///
    /// Заодно подтягиваем сайдкары, если журнал сообщил, что их тронули: иначе
    /// «выключил проект на сайте» до машины не доходит вовсе — вкл/выкл живёт в
    /// `options/folderState.json`, а его читает локальный `read_folder_states` с диска.
    pub async fn catch_up_project(&self, project_id: &str) -> Result<(), String> {
        self.touch_project(project_id);
        let mut g = self.sync_mut().await;
        let s = g
            .as_mut()
            .ok_or_else(|| "Хранилище не подключено".to_string())?;
        let report = s.catch_up(project_id).await.map_err(|e| e.to_string())?;
        // Лок каталога отпускаем ДО сетевых запросов за сайдкарами: держать его на
        // время трёх GET значит подвесить листинг колонок на всё это время.
        drop(g);

        for which in super::types::Sidecar::from_mask(report.sidecars_dirty) {
            // Ошибка одного сайдкара не должна ронять догон: дельты уже применены,
            // а настройки подтянутся на следующем проходе.
            if let Err(e) = self.pull_sidecar(project_id, which).await {
                eprintln!(
                    "[storage] сайдкар {} проекта {project_id}: {e}",
                    which.file_name()
                );
            }
        }
        Ok(())
    }

    /// Привести локальные копии в соответствие с каталогом.
    ///
    /// ── Зачем ───────────────────────────────────────────────────────────────
    /// Дельта меняет логический путь записи (переименовали на сайте или на другой
    /// машине), но **файл на диске от этого не двигается**. Локальная копия остаётся
    /// по старому пути, сверка её там не находит, решает «удалили руками» и обнуляет
    /// baseline: свежий файл превращается в «только в облаке», хотя лежит на месте.
    ///
    /// Здесь мы делаем то, что дельта сделать не может: двигаем файл на диске за его
    /// логическим путём. `file_id` стабилен, поэтому перекачивать ничего не нужно —
    /// это переименование, а не передача.
    ///
    /// Возвращает, сколько копий переехало.
    pub async fn reconcile_local_paths(&self) -> Result<usize, String> {
        let root = self.mirror_root();
        if root.as_os_str().is_empty() {
            return Ok(0);
        }
        let ids = self.with_sync(|s| s.index.local_file_ids()).await?;
        let mut moved = 0;

        for id in ids {
            let Some((_, local_path, _, _)) = self
                .with_sync({
                    let id = id.clone();
                    move |s| s.index.local_baseline(&id)
                })
                .await?
            else {
                continue;
            };
            let expected = match self.mirror_path_for(&id).await {
                Ok(p) => p,
                // Записи в каталоге больше нет — этим занимается удаление, не мы.
                Err(_) => continue,
            };
            if expected == local_path {
                continue;
            }

            let from = PathBuf::from(&local_path);
            let to = PathBuf::from(&expected);
            if !from.exists() {
                // Копии на старом месте нет: либо уже переехала, либо вытеснена.
                // Просто выправляем запись, чтобы сверка смотрела в правильное место.
                let (a, b) = (local_path.clone(), expected.clone());
                self.with_sync(move |s| s.index.rebase_local_paths(&a, &b).map(|_| ()))
                    .await?;
                continue;
            }
            if let Some(parent) = to.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            if let Err(e) = std::fs::rename(&from, &to) {
                eprintln!("[storage] не переехал {local_path} → {expected}: {e}");
                continue;
            }
            let (a, b) = (local_path.clone(), expected.clone());
            self.with_sync(move |s| s.index.rebase_local_paths(&a, &b).map(|_| ()))
                .await?;
            self.emit_changed(&[local_path, expected]);
            moved += 1;
        }
        Ok(moved)
    }

    /// Создать папку **в каталоге**, а потом на диске.
    ///
    /// Папка, созданная только на диске, для облака не существует: её нет в
    /// каталоге, значит нет `file_id`, значит её нельзя ни переименовать, ни
    /// удалить через API, и значка синхронизации у неё быть не может. Ровно на это и
    /// натыкался человек: «создать могу, переименовать — нет».
    ///
    /// Объекта в R2 не появляется — логическая папка это строка в Postgres.
    ///
    /// `Ok(None)` — путь не в зеркале, зовущий создаёт папку как обычно.
    pub async fn mkdir_in_cloud(&self, path: &Path) -> Result<Option<String>, String> {
        let root = self.mirror_root();
        if !under_mirror(&root, path) {
            return Ok(None);
        }
        let loc = parse_mirror_path(&root, &self.dirs(), path).ok_or_else(|| {
            format!(
                "Папку можно создать только внутри проекта: {}",
                path.display()
            )
        })?;

        // Уже есть в каталоге — создавать нечего, это нормальный повторный вызов
        // (шов зовут перед каждой вставкой файла).
        if let Some(e) = self
            .with_sync({
                let loc = loc.clone();
                move |s| s.index.entry_by_path(&loc.project_id, &loc.folder_path, &loc.name)
            })
            .await?
        {
            std::fs::create_dir_all(path).ok();
            return Ok(Some(e.id));
        }

        let provider = self
            .provider()
            .ok_or_else(|| "Хранилище не подключено".to_string())?;
        let file = provider
            .mkdir(&loc.project_id, &loc.folder_path, &loc.name, None)
            .await
            .map_err(|e| e.to_string())?;

        let id = file.id.clone();
        self.with_sync(move |s| s.index.upsert_from_file(&file)).await?;
        std::fs::create_dir_all(path)
            .map_err(|e| format!("create_dir_all {}: {e}", path.display()))?;
        self.emit_changed(&[path.to_string_lossy().to_string()]);
        Ok(Some(id))
    }

    /// Освободить диск от локальных копий одного владельца.
    ///
    /// Убрать владельца из первой колонки — это «мне он больше не нужен на этой
    /// машине», а не «удалить в облаке». Поэтому онлайн не трогаем вообще: записи
    /// каталога остаются, повторно добавить владельца можно всегда, файлы скачаются
    /// заново.
    ///
    /// **Незалитое не трогаем** — это инвариант кэша, а не пожелание: в
    /// `LocalOnly`/`LocalModified`/`Uploading`/`Conflict` лежит работа, которой в
    /// облаке ещё нет, и стереть её значило бы потерять результат рендера. Такие
    /// файлы остаются на диске, и сколько их — возвращаем, чтобы интерфейс сказал
    /// человеку правду.
    pub async fn drop_owner_local(&self, owner_path: &Path) -> Result<DropOwnerReport, String> {
        let root = self.mirror_root();
        if !under_mirror(&root, owner_path) {
            return Err("Это не папка владельца в зеркале".into());
        }
        let dirs = self.dirs();
        let client_id = match paths::classify(&root, &dirs, owner_path) {
            Some(super::MirrorNode::Client { client_id }) => client_id,
            _ => return Err("Ожидалась папка владельца (первый уровень зеркала)".into()),
        };
        let client_dir = dirs
            .client_dir_of(&client_id)
            .ok_or_else(|| "Владелец пропал из раскладки".to_string())?
            .to_string();
        let project_ids: Vec<String> = dirs
            .projects_of_client_dir(&client_dir)
            .into_iter()
            .map(|(_, id)| id)
            .collect();

        let mut report = DropOwnerReport::default();
        for pid in project_ids {
            let rows = self
                .with_sync({
                    let pid = pid.clone();
                    move |s| s.index.subtree_ids(&pid, "")
                })
                .await?;
            // Корень проекта `subtree_ids(pid, "")` не покрывает файлы в корне
            // (их `folder_path` пуст и под `LIKE ''||'/%'` не попадает), поэтому
            // берём весь проект списком локальных копий.
            let ids: Vec<String> = rows.into_iter().map(|(id, _)| id).collect();
            let all_local = self.with_sync(|s| s.index.local_file_ids()).await?;

            for id in all_local.into_iter().chain(ids) {
                let Some((state, local_path, _, _)) = self
                    .with_sync({
                        let id = id.clone();
                        move |s| s.index.local_baseline(&id)
                    })
                    .await?
                else {
                    continue;
                };
                // Только копии ЭТОГО владельца: остальные не наше дело.
                if !under_mirror(owner_path, Path::new(&local_path)) {
                    continue;
                }
                if state != "Fresh" {
                    report.kept_unsafe += 1;
                    continue;
                }
                let size = std::fs::metadata(&local_path)
                    .map(|m| m.len() as i64)
                    .unwrap_or(0);
                let _ = std::fs::remove_file(&local_path);
                let id2 = id.clone();
                self.with_sync(move |s| s.index.mark_evicted(&id2)).await?;
                report.removed += 1;
                report.freed_bytes += size;
            }
        }

        // Пустые папки уносим, только если незалитого не осталось: иначе снесли бы
        // вместе с ними то, что решили сохранить.
        if report.kept_unsafe == 0 {
            let _ = std::fs::remove_dir_all(owner_path);
        }
        self.emit_changed(&[owner_path.to_string_lossy().to_string()]);
        Ok(report)
    }

    /// Разрешить конфликт: чью версию оставляем.
    ///
    /// Конфликт — единственное состояние, которое программа НЕ решает сама: файл
    /// изменился и локально, и в облаке, и любой автоматический выбор теряет данные
    /// (взяли облако — стёрли свой перерендер; взяли локальное — стёрли чужую
    /// правку). Поэтому выбор делает человек, а здесь только исполнение.
    ///
    /// `take_cloud = true` — выбросить локальную копию и скачать облачную заново.
    /// `false` — залить свою; явная заливка всегда права, поэтому просто снимаем
    /// метку конфликта и отправляем файл наверх.
    pub async fn resolve_conflict(
        &self,
        path: &Path,
        take_cloud: bool,
    ) -> Result<Option<FileState>, String> {
        let root = self.mirror_root();
        if !under_mirror(&root, path) {
            return Ok(None);
        }
        let loc = parse_mirror_path(&root, &self.dirs(), path)
            .ok_or_else(|| format!("Не разобран зеркальный путь: {}", path.display()))?;
        let entry = self
            .with_sync({
                let loc = loc.clone();
                move |s| s.index.entry_by_path(&loc.project_id, &loc.folder_path, &loc.name)
            })
            .await?
            .ok_or_else(|| format!("Записи нет в каталоге: {}", path.display()))?;

        if take_cloud {
            // Сначала снимаем метку и обнуляем baseline, потом убираем файл: иначе
            // сверка между шагами увидит «файл пропал» и решит за нас.
            let id = entry.id.clone();
            self.with_sync(move |s| s.index.mark_evicted(&id)).await?;
            let _ = std::fs::remove_file(path);
            self.emit_changed(&[path.to_string_lossy().to_string()]);
            // Качаем заново — теперь это обычная гидрация, конфликта больше нет.
            self.ensure_local(path).await?;
            Ok(Some(FileState::Fresh))
        } else {
            // Метку снимаем ДО заливки: `upload_local` не трогает файлы в состоянии
            // `Conflict`, и без этого заливка молча ничего бы не сделала.
            let id = entry.id.clone();
            self.with_sync(move |s| s.index.set_state(&id, "LocalModified", None))
                .await?;
            self.upload_local(path).await?;
            Ok(Some(FileState::Fresh))
        }
    }

    /// Что сделает следующее нажатие «Удалить» — и что оно сделало.
    ///
    /// Удаление **двухступенчатое** осознанно: первое нажатие убирает локальную
    /// копию, файл остаётся в облаке; второе — отправляет его в облаке. Так
    /// случайное нажатие стоит повторного скачивания, а не мастера, который считали
    /// часами.
    ///
    /// `NeedsConfirm` — вторая ступень, и её надо подтвердить: пока у бэкенда нет
    /// корзины (просьба 6), удаление в облаке необратимо.
    pub async fn delete_in_cloud(
        &self,
        path: &Path,
        allow_online: bool,
    ) -> Result<Option<DeleteStage>, String> {
        let root = self.mirror_root();
        if !under_mirror(&root, path) {
            return Ok(None);
        }

        match paths::classify(&root, &self.dirs(), path) {
            Some(super::MirrorNode::Folder { folder_path, .. }) if folder_path.is_empty() => {
                return Err("Проект удаляется отдельной командой, а не как папка".into())
            }
            Some(super::MirrorNode::Folder { .. }) => {}
            _ => return Err("Удалять можно только внутри проекта".into()),
        }

        let loc = parse_mirror_path(&root, &self.dirs(), path)
            .ok_or_else(|| format!("Не разобран зеркальный путь: {}", path.display()))?;
        let entry = self
            .with_sync({
                let loc = loc.clone();
                move |s| s.index.entry_by_path(&loc.project_id, &loc.folder_path, &loc.name)
            })
            .await?;

        let Some(entry) = entry else {
            // В каталоге записи нет: файл/папка существуют только на диске. В облаке
            // удалять нечего, поэтому ступень одна.
            remove_path(path)?;
            self.emit_changed(&[path.to_string_lossy().to_string()]);
            return Ok(Some(DeleteStage::LocalOnly));
        };

        // ── Ступень 1: есть локальная копия — убираем только её ─────────────
        // Для папки «локальная копия» означает, что внутри есть хоть один
        // скачанный файл: удалить папку целиком по первому нажатию значило бы
        // потерять всё поддерево в облаке.
        let local_paths: Vec<String> = if entry.is_folder {
            let prefix = if loc.folder_path.is_empty() {
                loc.name.clone()
            } else {
                format!("{}/{}", loc.folder_path, loc.name)
            };
            self.with_sync({
                let pid = loc.project_id.clone();
                move |s| s.index.subtree_ids(&pid, &prefix)
            })
            .await?
            .into_iter()
            .filter_map(|(_, p)| p)
            .collect()
        } else {
            self.with_sync({
                let id = entry.id.clone();
                move |s| Ok(s.index.local_baseline(&id)?.map(|(_, p, _, _)| p))
            })
            .await?
            .into_iter()
            .collect()
        };

        let has_local = local_paths.iter().any(|p| Path::new(p).exists());
        if has_local {
            let ids: Vec<String> = if entry.is_folder {
                let prefix = if loc.folder_path.is_empty() {
                    loc.name.clone()
                } else {
                    format!("{}/{}", loc.folder_path, loc.name)
                };
                self.with_sync({
                    let pid = loc.project_id.clone();
                    move |s| s.index.subtree_ids(&pid, &prefix)
                })
                .await?
                .into_iter()
                .map(|(id, _)| id)
                .collect()
            } else {
                vec![entry.id.clone()]
            };

            for p in &local_paths {
                let _ = std::fs::remove_file(p);
            }
            // Папка на диске могла остаться пустой — уносим и её, в каталоге она
            // при этом остаётся.
            if entry.is_folder {
                let _ = std::fs::remove_dir_all(path);
            }
            self.with_sync(move |s| {
                for id in &ids {
                    // Именно `mark_evicted`, а не `forget_files`: файл в облаке
                    // остался, ушла только копия. Baseline обнуляется, иначе
                    // повторное скачивание сочтёт файл «локально изменённым».
                    s.index.mark_evicted(id)?;
                }
                Ok(())
            })
            .await?;
            self.emit_changed(&[path.to_string_lossy().to_string()]);
            return Ok(Some(DeleteStage::LocalCopy));
        }

        // ── Ступень 2: копии нет, удаляем в облаке ──────────────────────────
        if !allow_online {
            return Ok(Some(DeleteStage::NeedsConfirm));
        }
        self.delete_online(&loc, &entry, path).await?;
        Ok(Some(DeleteStage::Online))
    }

    /// Ступень 2: убрать запись из каталога (папку — каскадом) и с диска.
    ///
    /// Папка удаляется каскадом: бэкенд убирает потомков и журналит каждого, мы
    /// вычищаем у себя ровно то же. Порядок «сначала каталог» тот же, что у
    /// переименования: иначе при отказе сервера файл исчез бы с диска, оставшись в
    /// облаке.
    async fn delete_online(
        &self,
        loc: &super::paths::MirrorLocation,
        entry: &TreeEntry,
        path: &Path,
    ) -> Result<(), String> {
        // Поддерево собираем ДО удаления: после ответа сервера искать уже нечего.
        let subtree = if entry.is_folder {
            let prefix = if loc.folder_path.is_empty() {
                loc.name.clone()
            } else {
                format!("{}/{}", loc.folder_path, loc.name)
            };
            self.with_sync({
                let pid = loc.project_id.clone();
                move |s| s.index.subtree_ids(&pid, &prefix)
            })
            .await?
        } else {
            Vec::new()
        };

        let provider = self
            .provider()
            .ok_or_else(|| "Хранилище не подключено".to_string())?;
        provider
            .delete(&loc.project_id, &entry.id, None)
            .await
            .map_err(|e| e.to_string())?;

        let mut ids: Vec<String> = subtree.iter().map(|(id, _)| id.clone()).collect();
        ids.push(entry.id.clone());
        self.with_sync(move |s| s.index.forget_files(&ids).map(|_| ()))
            .await?;

        remove_path(path)?;
        self.emit_changed(&[path.to_string_lossy().to_string()]);
        Ok(())
    }

    /// Выжечь проект: удалить в облаке всё его содержимое и убрать локальную папку.
    ///
    /// **Почему это отдельная команда, а не «удалить папку проекта».** Папка проекта —
    /// не запись в каталоге файлов, а строка в `projects`: у неё нет `file_id`, и
    /// `DELETE /object` её не принимает. Удалять проект под machine token бэкенд пока
    /// не умеет вообще (просьба 3.7), поэтому программа делает всё, что API позволяет:
    /// сносит содержимое и локальную копию. **Запись проекта остаётся**, и интерфейс
    /// обязан сказать это прямо, а не изобразить полное удаление.
    ///
    /// Порядок «сначала облако, потом диск» тот же, что у переименования: при отказе
    /// сервера файлы остаются на диске. Обратный порядок оставил бы человека без
    /// локальных копий и с теми же файлами в облаке.
    ///
    /// `options` бэкенд защищает 403 (контракт, п. 7). Отказ на папке не считаем
    /// провалом всей операции: спускаемся внутрь и пробуем файлы по одному — тогда
    /// проект хотя бы перестанет занимать место. Внутрь идём только на `forbidden`:
    /// на отвалившейся сети это превратило бы один отказ в сотню запросов.
    ///
    /// `None` — путь не в зеркале, зовущий удаляет папку как обычную.
    pub async fn purge_project(&self, path: &Path) -> Result<Option<PurgeReport>, String> {
        let root = self.mirror_root();
        if !under_mirror(&root, path) {
            return Ok(None);
        }
        let dirs = self.dirs();
        let project_id = match paths::classify(&root, &dirs, path) {
            Some(super::MirrorNode::Folder {
                project_id,
                folder_path,
            }) if folder_path.is_empty() => project_id,
            _ => return Err("Ожидалась папка проекта (второй уровень зеркала)".into()),
        };

        // Каталог мог отстать. Без свежих дельт мы не тронем файл, залитый другой
        // машиной, — и «удалённый» проект вернётся им при первом же обходе.
        self.catch_up_project(&project_id).await?;

        let before = self
            .with_sync({
                let pid = project_id.clone();
                move |s| s.index.subtree_stats(&pid, "")
            })
            .await?;

        let mut skipped: Vec<PurgeSkipped> = Vec::new();
        let mut refused: std::collections::HashSet<String> = std::collections::HashSet::new();

        // Проход 1 — верхний уровень: папку бэкенд удаляет каскадом, то есть проект в
        // три-четыре запроса вместо запроса на файл.
        let top: Vec<TreeEntry> = self
            .with_sync({
                let pid = project_id.clone();
                move |s| s.index.list_dir(&pid, "")
            })
            .await?;

        // Проход 2 — всё, что осталось в каталоге, по одной записи. Нужен не только
        // из-за `options`: запись файла может существовать без записи его папки
        // (заливка создаёт первую, дерево — вторую), и обход сверху её не нашёл бы.
        // Порядок внутри задаёт `project_entries`: файлы раньше папок.
        for pass in 0..2 {
            let entries: Vec<TreeEntry> = if pass == 0 {
                top.clone()
            } else {
                self.with_sync({
                    let pid = project_id.clone();
                    move |s| s.index.project_entries(&pid)
                })
                .await?
            };

            for entry in entries {
                let logical = if entry.folder_path.is_empty() {
                    entry.name.clone()
                } else {
                    format!("{}/{}", entry.folder_path, entry.name)
                };
                // Второй раз в тот же отказ не идём: `options` ответит тем же 403, а в
                // отчёте появится дубль.
                if refused.contains(&logical) {
                    continue;
                }
                let loc = super::MirrorLocation {
                    project_id: project_id.clone(),
                    folder_path: entry.folder_path.clone(),
                    name: entry.name.clone(),
                };
                // Путь на диске нужен `delete_online`: он уносит и локальную копию.
                let local = paths::mirror_path(&root, &dirs, &project_id, &entry.folder_path, &entry.name)
                    .unwrap_or_else(|| path.join(&entry.name));

                if let Err(e) = self.delete_online(&loc, &entry, &local).await {
                    // Записываем всё, включая папку `options`: «что именно осталось» —
                    // это ответ на вопрос «почему проект ещё виден на сайте».
                    refused.insert(logical.clone());
                    skipped.push(PurgeSkipped { path: logical, error: e });
                }
            }
        }

        let after = self
            .with_sync({
                let pid = project_id.clone();
                move |s| s.index.subtree_stats(&pid, "")
            })
            .await?;

        // Локальную папку — в самом конце и только целиком: то, что удалилось в
        // облаке, `delete_online` с диска уже унёс, а остаток (незалитое, мусор шагов)
        // человек удалять и просил.
        //
        // Но только если в облаке всё прошло. `forbidden` — постоянный отказ по
        // контракту (`options`), с ним удалять локальное можно. Сеть, 5xx, отсутствие
        // эндпоинта — «попробуй позже», и снести здесь диск значило бы уничтожить
        // единственную копию незалитого, оставив проект в облаке целым.
        let mut local_removed = false;
        let mut local_kept: Option<String> = None;
        let blocked = skipped.iter().any(|s| !s.error.starts_with("forbidden"));
        if blocked {
            local_kept = Some("в облаке удалилось не всё — папку оставили, попробуйте ещё раз".into());
        } else if path.exists() {
            match remove_path(path) {
                Ok(_) => local_removed = true,
                Err(e) => local_kept = Some(e),
            }
        }

        self.emit_changed(&[path.to_string_lossy().to_string()]);

        Ok(Some(PurgeReport {
            files_deleted: (before.files - after.files).max(0),
            freed_bytes: (before.bytes - after.bytes).max(0),
            files_left: after.files,
            local_removed,
            local_kept,
            skipped,
        }))
    }

    /// Включить/выключить проект в каталоге. `None` — путь не проект зеркала.
    ///
    /// Направление «программа → сайт». Обратное («сайт → программа») идёт само:
    /// `is_paused` приезжает в каждом `/projects` и снимает галочку.
    pub async fn set_project_paused(
        &self,
        project_path: &Path,
        paused: bool,
    ) -> Result<Option<()>, String> {
        let root = self.mirror_root();
        if !under_mirror(&root, project_path) {
            return Ok(None);
        }
        let project_id = match paths::classify(&root, &self.dirs(), project_path) {
            Some(super::MirrorNode::Folder {
                project_id,
                folder_path,
            }) if folder_path.is_empty() => project_id,
            _ => return Ok(None),
        };

        let provider = self
            .provider()
            .ok_or_else(|| "Хранилище не подключено".to_string())?;
        provider
            .set_project_paused(&project_id, paused)
            .await
            .map_err(|e| e.to_string())?;

        // Индекс правим сразу: иначе следующий `reloadFolders` вернёт галочку обратно
        // из ещё не обновлённого каталога, и выключение «отскочит».
        let pid = project_id.clone();
        self.with_sync(move |s| s.index.set_project_paused(&pid, paused))
            .await?;
        self.emit_projects_changed();
        Ok(Some(()))
    }

    /// Переименовать ПРОЕКТ: имя в каталоге, затем папка на диске.
    ///
    /// Для человека это такая же папка, как локальная, и «сходи на сайт» ломает
    /// работу. Поэтому пункт меню обычный, а не серый: имя меняется в каталоге, папка
    /// зеркала переезжает следом, локальные копии — за ней.
    ///
    /// Эндпоинта под machine token пока нет — тогда вернётся ошибка бэкенда, и
    /// интерфейс покажет её как есть. Ничего при этом не сломается: диск трогаем
    /// только после успешного ответа.
    pub async fn rename_project(
        &self,
        project_path: &Path,
        new_name: &str,
    ) -> Result<Option<RenameReport>, String> {
        let root = self.mirror_root();
        if !under_mirror(&root, project_path) {
            return Ok(None);
        }
        if new_name.trim().is_empty() || new_name.contains('/') || new_name.contains('\\') {
            return Err("Недопустимое имя".into());
        }
        let dirs = self.dirs();
        let project_id = match paths::classify(&root, &dirs, project_path) {
            Some(super::MirrorNode::Folder {
                project_id,
                folder_path,
            }) if folder_path.is_empty() => project_id,
            _ => return Err("Это не папка проекта".into()),
        };

        let provider = self
            .provider()
            .ok_or_else(|| "Хранилище не подключено".to_string())?;
        provider
            .rename_project(&project_id, new_name)
            .await
            .map_err(|e| e.to_string())?;

        // Список проектов — источник имён папок, поэтому перечитываем его и
        // пересобираем карту: без этого путь остался бы прежним, а каталог новым.
        {
            let mut g = self.sync_mut().await;
            if let Some(s) = g.as_mut() {
                let _ = s.refresh_projects().await;
            }
        }
        self.refresh_dirs().await;

        let new_path = self
            .dirs()
            .dirs_of(&project_id)
            .map(|(c, p)| root.join(c).join(p))
            .unwrap_or_else(|| project_path.with_file_name(new_name));

        let old_str = project_path.to_string_lossy().to_string();
        let new_str = new_path.to_string_lossy().to_string();
        if project_path.exists() && old_str != new_str {
            std::fs::rename(project_path, &new_path)
                .map_err(|e| format!("переименование папки проекта: {e}"))?;
        }
        let (a, b) = (old_str.clone(), new_str.clone());
        self.with_sync(move |s| s.index.rebase_local_paths(&a, &b).map(|_| ()))
            .await?;

        self.emit_changed(&[old_str.clone(), new_str.clone()]);
        self.emit_projects_changed();
        Ok(Some(RenameReport {
            file_id: project_id,
            old_path: old_str,
            new_path: new_str,
            is_folder: true,
        }))
    }

    /// Перенести файл или папку **в облаке**, а потом на диске.
    ///
    /// Это тот же `/rename`, только меняется `folderPath`: для бэкенда перенос — это
    /// `UPDATE` логического пути, **байты не двигаются вообще** (`s3Key` непрозрачный
    /// и не зависит от папки). Перенос папки с сотнями гигабайт внутри стоит один
    /// SQL-запрос.
    ///
    /// `dest_dir` — папка-приёмник (не итоговый путь файла).
    ///
    /// `Ok(None)` — источник вне зеркала, зовущий переносит как обычно.
    pub async fn move_in_cloud(
        &self,
        path: &Path,
        dest_dir: &Path,
    ) -> Result<Option<RenameReport>, String> {
        let root = self.mirror_root();
        if !under_mirror(&root, path) {
            return Ok(None);
        }
        // Приёмник вне зеркала — это не перенос внутри облака, а выгрузка наружу:
        // сначала гидрация, потом обычное копирование. Здесь мы этим не занимаемся.
        if !under_mirror(&root, dest_dir) {
            return Ok(None);
        }

        let dirs = self.dirs();
        let loc = parse_mirror_path(&root, &dirs, path)
            .ok_or_else(|| format!("Не разобран зеркальный путь: {}", path.display()))?;

        // Приёмник обязан быть папкой внутри ТОГО ЖЕ проекта: `/rename` работает в
        // границах `project_id`, а переноса между проектами у бэкенда нет вовсе.
        let (dest_project, dest_folder) = match paths::classify(&root, &dirs, dest_dir) {
            Some(super::MirrorNode::Folder {
                project_id,
                folder_path,
            }) => (project_id, folder_path),
            _ => return Err("Переносить можно только в папку проекта".into()),
        };
        if dest_project != loc.project_id {
            return Err(
                "Перенос между проектами бэкенд пока не умеет — скопируйте файл \
                 и удалите исходный"
                    .into(),
            );
        }
        if dest_folder == loc.folder_path {
            // Уже там: не гоняем запрос ради ничего.
            return Ok(None);
        }

        let entry = self
            .with_sync({
                let loc = loc.clone();
                move |s| s.index.entry_by_path(&loc.project_id, &loc.folder_path, &loc.name)
            })
            .await?
            .ok_or_else(|| format!("Записи нет в каталоге: {}", path.display()))?;

        // Папку нельзя переносить внутрь самой себя: в каталоге это дало бы цикл, из
        // которого логический путь не восстанавливается.
        if entry.is_folder {
            let own_prefix = if loc.folder_path.is_empty() {
                loc.name.clone()
            } else {
                format!("{}/{}", loc.folder_path, loc.name)
            };
            if dest_folder == own_prefix || dest_folder.starts_with(&format!("{own_prefix}/")) {
                return Err("Нельзя перенести папку внутрь себя".into());
            }
        }

        // Гейт по возможностям — ПОСЛЕ структурных проверок: бессмыслицу («перенести
        // папку внутрь себя») надо отклонять как бессмыслицу, а не как «бэкенд не
        // умеет». Иначе сообщение уводит от настоящей причины.
        let caps = self.with_sync(|s| Ok(s.caps().clone())).await?;
        if !caps.rename {
            return Err("Бэкенд не поддерживает перенос".into());
        }

        let provider = self
            .provider()
            .ok_or_else(|| "Хранилище не подключено".to_string())?;
        let file = provider
            .rename(&loc.project_id, &entry.id, None, Some(&dest_folder), None)
            .await
            .map_err(|e| e.to_string())?;

        let new_path = dest_dir.join(&loc.name);
        let old_str = path.to_string_lossy().to_string();
        let new_str = new_path.to_string_lossy().to_string();

        if path.exists() {
            if let Some(parent) = new_path.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            std::fs::rename(path, &new_path)
                .map_err(|e| format!("перенос на диске {old_str}: {e}"))?;
        }

        let f = file.clone();
        let (old_prefix, new_prefix) = if entry.is_folder {
            let old = if loc.folder_path.is_empty() {
                loc.name.clone()
            } else {
                format!("{}/{}", loc.folder_path, loc.name)
            };
            let new = if dest_folder.is_empty() {
                loc.name.clone()
            } else {
                format!("{}/{}", dest_folder, loc.name)
            };
            (Some(old), Some(new))
        } else {
            (None, None)
        };

        let project_id = loc.project_id.clone();
        let old_local = old_str.clone();
        let new_local = new_str.clone();
        self.with_sync(move |s| {
            s.index.upsert_from_file(&f)?;
            // Потомков бэкенд правит у себя, но событий на них не журналит — каскад
            // применяем сами, иначе дети останутся по старому логическому пути.
            if let (Some(op), Some(np)) = (&old_prefix, &new_prefix) {
                s.index.reprefix_children(&project_id, op, np)?;
            }
            s.index.rebase_local_paths(&old_local, &new_local)?;
            Ok(())
        })
        .await?;

        self.emit_changed(&[old_str.clone(), new_str.clone()]);
        Ok(Some(RenameReport {
            file_id: file.id,
            old_path: old_str,
            new_path: new_str,
            is_folder: entry.is_folder,
        }))
    }

    /// Переименовать файл или папку **в облаке**, а потом на диске.
    ///
    /// ── Почему через API, а не `fs::rename` ─────────────────────────────────
    /// Логическое имя живёт в каталоге бэкенда. Переименуй только на диске — и путь
    /// перестанет разбираться: `classify` не найдёт такую папку, `browse` ответит
    /// «не найдено в каталоге», колонка молча прочитает диск, и **все значки
    /// синхронизации исчезнут**. Файл при этом остаётся в облаке под прежним именем,
    /// то есть локальное и облачное состояние тихо разъезжаются.
    ///
    /// `Ok(None)` — путь не в зеркале, зовущий переименовывает как обычно.
    ///
    /// Байты не двигаются: `s3Key` бэкенд не трогает, это `UPDATE` одной строки (у
    /// папки — плюс `UPDATE` по потомкам).
    pub async fn rename_in_cloud(
        &self,
        path: &Path,
        new_name: &str,
    ) -> Result<Option<RenameReport>, String> {
        let root = self.mirror_root();
        if !under_mirror(&root, path) {
            return Ok(None);
        }
        if new_name.trim().is_empty() || new_name.contains('/') || new_name.contains('\\') {
            return Err("Недопустимое имя".into());
        }

        // Уровни выше проекта переименовать нельзя: имя владельца — это email из БД
        // сайта, имя проекта — `projects.name`, и оба меняются там, а не здесь.
        match paths::classify(&root, &self.dirs(), path) {
            None | Some(super::MirrorNode::Unknown) => {
                return Err(format!(
                    "Папка не найдена в каталоге: {}. Обновите список проектов.",
                    path.display()
                ))
            }
            Some(super::MirrorNode::Root) => {
                return Err("Это корень зеркала, его переименовывать нечего".into())
            }
            Some(super::MirrorNode::Client { .. }) => {
                return Err("Папка пользователя переименовывается на сайте".into())
            }
            Some(super::MirrorNode::Folder { folder_path, .. }) if folder_path.is_empty() => {
                return Err(
                    "Проект переименовывается на сайте: его имя хранится в каталоге, \
                     а не в имени папки"
                        .into(),
                )
            }
            Some(super::MirrorNode::Folder { .. }) => {}
        }

        let caps = self.with_sync(|s| Ok(s.caps().clone())).await?;
        if !caps.rename {
            return Err("Бэкенд не поддерживает переименование".into());
        }

        let loc = parse_mirror_path(&root, &self.dirs(), path)
            .ok_or_else(|| format!("Не разобран зеркальный путь: {}", path.display()))?;
        // Одна и та же выборка отвечает и про файл, и про папку: в каталоге они
        // строки одной таблицы, отличаются флагом.
        let entry = self
            .with_sync({
                let loc = loc.clone();
                move |s| s.index.entry_by_path(&loc.project_id, &loc.folder_path, &loc.name)
            })
            .await?
            .ok_or_else(|| format!("Записи нет в каталоге: {}", path.display()))?;

        let provider = self
            .provider()
            .ok_or_else(|| "Хранилище не подключено".to_string())?;
        let file = provider
            .rename(&loc.project_id, &entry.id, Some(new_name), None, None)
            .await
            .map_err(|e| e.to_string())?;

        let new_path = path
            .parent()
            .map(|p| p.join(new_name))
            .ok_or_else(|| "Нет родительской папки".to_string())?;
        let old_str = path.to_string_lossy().to_string();
        let new_str = new_path.to_string_lossy().to_string();
        let is_folder = entry.is_folder;

        // Диск двигаем ПОСЛЕ успешного ответа каталога: обратный порядок оставил бы
        // переименованную локальную копию при неудаче на сервере.
        if path.exists() {
            std::fs::rename(path, &new_path)
                .map_err(|e| format!("переименование на диске {old_str}: {e}"))?;
        }

        let f = file.clone();
        let (old_prefix, new_prefix) = if is_folder {
            let base = if loc.folder_path.is_empty() {
                String::new()
            } else {
                format!("{}/", loc.folder_path)
            };
            (
                Some(format!("{base}{}", loc.name)),
                Some(format!("{base}{new_name}")),
            )
        } else {
            (None, None)
        };

        let project_id = loc.project_id.clone();
        let old_local = old_str.clone();
        let new_local = new_str.clone();
        self.with_sync(move |s| {
            s.index.upsert_from_file(&f)?;
            // Каскад по потомкам: бэкенд его делает у себя, но событий на детей не
            // журналит — значит из дельт мы бы о них не узнали никогда.
            if let (Some(op), Some(np)) = (&old_prefix, &new_prefix) {
                s.index.reprefix_children(&project_id, op, np)?;
            }
            s.index.rebase_local_paths(&old_local, &new_local)?;
            Ok(())
        })
        .await?;

        // Обе папки перечитать: строка ушла из одной и появилась в другой.
        self.emit_changed(&[old_str.clone(), new_str.clone()]);

        Ok(Some(RenameReport {
            file_id: file.id,
            old_path: old_str,
            new_path: new_str,
            is_folder,
        }))
    }

    /// Сведения о проекте по его пути в зеркале. `None` — путь не проект.
    ///
    /// Нужно раннеру: он оперирует путями, а решение «обрабатывать ли» зависит от
    /// флага каталога. Ни одного запроса в сеть — только локальный индекс.
    pub async fn project_info(&self, path: &Path) -> Result<Option<ProjectInfo>, String> {
        let Some(project_id) = self.project_id_for_path(path).await else {
            return Ok(None);
        };
        let pid = project_id.clone();
        let found = self
            .with_sync(move |s| {
                Ok(s.index
                    .projects(None)?
                    .into_iter()
                    .find(|p| p.id == pid))
            })
            .await?;
        Ok(found.map(|p| ProjectInfo {
            project_id: p.id,
            name: p.name,
            archived: p.is_archived,
            archived_at: p.archived_at,
            paused: p.is_paused,
        }))
    }

    /// Какому проекту принадлежит путь. `None` — путь не в зеркале либо папка не
    /// опознана (клиента или проекта с такими именами в каталоге нет).
    ///
    /// Нужно раннеру: он знает путь проекта, а дельты запрашиваются по
    /// `project_id`. Карту раскладки при незнакомом пути пересобираем — имя папки
    /// могло измениться вместе с переименованием проекта на сайте.
    pub async fn project_id_for_path(&self, path: &Path) -> Option<String> {
        let root = self.mirror_root();
        if !under_mirror(&root, path) {
            return None;
        }
        if let Some(super::MirrorNode::Folder { project_id, .. }) =
            paths::classify(&root, &self.dirs(), path)
        {
            return Some(project_id);
        }
        self.refresh_dirs().await;
        match paths::classify(&root, &self.dirs(), path) {
            Some(super::MirrorNode::Folder { project_id, .. }) => Some(project_id),
            _ => None,
        }
    }

    pub async fn path_info(&self, path: &Path) -> Result<PathInfo, String> {
        let root = self.mirror_root();
        let on_disk = path.exists();

        if !under_mirror(&root, path) {
            let meta = std::fs::metadata(path).ok();
            return Ok(PathInfo {
                in_mirror: false,
                exists: on_disk,
                local: on_disk,
                is_folder: meta.as_ref().map(|m| m.is_dir()).unwrap_or(false),
                size: meta.as_ref().map(|m| m.len() as i64),
                mtime: file_mtime(path),
                file_id: None,
            });
        }

        let Some(loc) = parse_mirror_path(&root, &self.dirs(), path) else {
            // Сама папка проекта или корень зеркала.
            return Ok(PathInfo {
                in_mirror: true,
                exists: on_disk,
                local: on_disk,
                is_folder: true,
                size: None,
                mtime: None,
                file_id: None,
            });
        };

        let entry = self
            .with_sync(move |s| s.index.entry_by_path(&loc.project_id, &loc.folder_path, &loc.name))
            .await?;

        Ok(match entry {
            Some(e) => PathInfo {
                in_mirror: true,
                // Файл есть в каталоге → он существует, даже если ещё не скачан.
                exists: true,
                local: on_disk,
                is_folder: e.is_folder,
                // Размер берём из каталога: он известен и без локальной копии.
                size: e.size_bytes,
                mtime: e.origin_mtime,
                file_id: Some(e.id),
            },
            None => PathInfo {
                in_mirror: true,
                exists: on_disk,
                local: on_disk,
                is_folder: path.is_dir(),
                size: std::fs::metadata(path).ok().map(|m| m.len() as i64),
                mtime: file_mtime(path),
                file_id: None,
            },
        })
    }
}

// ─── Обнаружение локальных правок ────────────────────────────────────────────

impl StorageService {
    /// Сверить локальную копию с baseline и обновить состояние.
    ///
    /// Это единственное место, где появляется `LocalModified`. Движок значков
    /// диска не касается (иначе листинг на тысячу файлов делал бы тысячу `stat`),
    /// поэтому факт правки должен кто-то обнаружить явно — вот этим вызовом.
    ///
    /// Зовём при ОБРАЩЕНИИ к файлу и по кнопке «проверить», а не на каждый рендер.
    ///
    /// **Сравнение консервативное: размер ИЛИ время отличаются → считаем правкой.**
    /// Хэшировать пятигиговый мастер ради точности дорого, а цена ошибок
    /// несимметрична: ложное срабатывание стоит одной лишней заливки, пропуск —
    /// потерянной работы.
    pub async fn detect_local_change(&self, file_id: &str) -> Result<Option<FileState>, String> {
        let id = file_id.to_string();
        let Some((state, local_path, base_size, base_mtime)) = self
            .with_sync(move |s| s.index.local_baseline(&id))
            .await?
        else {
            return Ok(None); // локальной копии никогда и не было
        };

        // Идущие передачи и неразрешённый конфликт не трогаем: у них своя логика,
        // и вмешиваться в середине — верный способ получить рассинхрон.
        if matches!(
            state.as_str(),
            "Downloading" | "Uploading" | "Conflict" | "Error"
        ) {
            return Ok(None);
        }

        let path = std::path::PathBuf::from(&local_path);
        let meta = std::fs::metadata(&path).ok();

        let Some(meta) = meta else {
            // Файл удалили мимо программы. Baseline обнуляем — иначе после
            // повторного скачивания сравнение решит, что файл «локально изменён».
            let id = file_id.to_string();
            self.with_sync(move |s| s.index.mark_evicted(&id)).await?;
            return Ok(Some(FileState::Cloud));
        };

        let size = meta.len() as i64;
        let mtime = file_mtime(&path).unwrap_or(0);
        let changed = Some(size) != base_size || Some(mtime) != base_mtime;

        let next = if changed {
            "LocalModified"
        } else if state == "LocalModified" {
            // Вернули как было — снимаем метку.
            "Fresh"
        } else {
            return Ok(None);
        };

        let id = file_id.to_string();
        let n = next.to_string();
        self.with_sync(move |s| s.index.set_state(&id, &n, None))
            .await?;
        Ok(Some(if changed {
            FileState::LocalModified
        } else {
            FileState::Fresh
        }))
    }

    /// Надо ли этот путь заливать вообще.
    ///
    /// ── Зачем проверка ──────────────────────────────────────────────────────
    /// Кандидаты приходят от вотчера, а вотчер видит и НАШИ собственные записи:
    /// только что скачанный файл — это событие «создан файл». Без проверки
    /// свежескачанный файл уехал бы обратно в облако, и каждое скачивание
    /// оплачивалось бы заливкой того же самого. Раньше этой ловушки не было
    /// только потому, что кандидатов давал полный обход, а он брал лишь файлы,
    /// которых нет в каталоге.
    ///
    /// Три ветки, и третья неочевидна:
    ///   • в каталоге записи нет            → `LocalOnly`, заливаем;
    ///   • запись есть, локальной копии не было → это НАША новая версия
    ///     (пайплайн перезаписал облачный файл, не скачивая его), заливаем;
    ///   • запись есть и копия была         → заливаем, только если содержимое
    ///     разошлось с baseline. Идущие передачи и конфликт `detect_local_change`
    ///     не трогает — значит и мы их не трогаем.
    pub async fn needs_upload(&self, path: &Path) -> Result<bool, String> {
        let root = self.mirror_root();
        let Some(loc) = parse_mirror_path(&root, &self.dirs(), path) else {
            // Путь в зеркале, но вне логической структуры (брошен в корень или в
            // папку клиента) — заливать некуда.
            return Ok(false);
        };

        let known = self
            .with_sync({
                let loc = loc.clone();
                move |s| s.index.entry_by_path(&loc.project_id, &loc.folder_path, &loc.name)
            })
            .await?;
        let Some(entry) = known else {
            return Ok(true);
        };

        let file_id = entry.id.clone();
        let baseline = self
            .with_sync({
                let id = file_id.clone();
                move |s| s.index.local_baseline(&id)
            })
            .await?;
        if baseline.is_none() {
            return Ok(true);
        }

        Ok(matches!(
            self.detect_local_change(&file_id).await?,
            Some(FileState::LocalModified)
        ))
    }

    /// Пути локально изменённых копий — то, что демон ставит в очередь заливки.
    ///
    /// Отдельно от `detect_local_changes` намеренно: та ставит метки и считает, а
    /// заливать надо по путям. Одной функцией это было бы удобнее ровно до первого
    /// раза, когда сверку понадобится позвать, ничего не заливая.
    pub async fn local_modified_paths(&self) -> Result<Vec<PathBuf>, String> {
        let rows = self
            .with_sync(|s| s.index.paths_in_state("LocalModified"))
            .await?;
        Ok(rows.into_iter().map(PathBuf::from).collect())
    }

    /// Сверить все локальные копии разом. Для кнопки «проверить локальные
    /// изменения» и для прогона перед витком обработки.
    pub async fn detect_local_changes(&self) -> Result<i64, String> {
        let ids = self
            .with_sync(|s| s.index.local_file_ids())
            .await?;
        let mut changed = 0;
        for id in ids {
            if matches!(
                self.detect_local_change(&id).await?,
                Some(FileState::LocalModified)
            ) {
                changed += 1;
            }
        }
        Ok(changed)
    }
}

// ─── Копирование из зеркала («переписать устаревший») ────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum CopyAction {
    /// Скопировали.
    Copied,
    /// Файл на месте уже есть, а перезапись не разрешена.
    SkippedExists,
    /// Файл на месте есть и сделан из ТОЙ ЖЕ версии источника. Ничего не качали.
    SkippedUpToDate,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct CopyReport {
    pub action: CopyAction,
    pub bytes: Option<i64>,
    /// Пришлось ли скачивать источник. `false` при `SkippedUpToDate` — в этом весь смысл.
    pub hydrated: bool,
}

impl StorageService {
    /// Скопировать файл из зеркала в рабочую папку с режимом «переписать устаревший».
    ///
    /// Порядок критичен и потому зашит здесь, а не оставлен на вызывающего:
    ///
    /// ```text
    /// 1. проверить, актуальна ли копия   ← локальный индекс: 0 запросов, 0 байт
    /// 2. актуальна → выходим
    /// 3. устарела → ensureLocal(src)     ← только теперь качаем
    /// 4. копируем
    /// 5. запоминаем версию
    /// ```
    ///
    /// Если разбить это на отдельные команды, рано или поздно кто-то позовёт их в
    /// обратном порядке и скачает три гигабайта, чтобы выяснить, что качать было не
    /// нужно. А про шаг 5 просто забудет — и экономия исчезнет совсем.
    ///
    /// **Сравнение по версии источника, а не по mtime.** Часы на машинах
    /// расходятся, копирование не всегда сохраняет mtime, а правка локальной копии
    /// меняет её mtime, не меняя источник. Плюс главное: у облачного файла, который
    /// не скачан, mtime вообще нет — `stat` бросит исключение.
    pub async fn copy_from_mirror(
        &self,
        src: &Path,
        dest: &Path,
        overwrite_oldest: bool,
    ) -> Result<CopyReport, String> {
        let dest_s = dest.to_string_lossy().to_string();
        let root = self.mirror_root();
        let src_in_mirror = under_mirror(&root, src);

        if dest.exists() {
            if !overwrite_oldest {
                return Ok(CopyReport {
                    action: CopyAction::SkippedExists,
                    bytes: None,
                    hydrated: false,
                });
            }
            if self.dest_is_up_to_date(src, dest, src_in_mirror, &dest_s).await? {
                return Ok(CopyReport {
                    action: CopyAction::SkippedUpToDate,
                    bytes: None,
                    hydrated: false,
                });
            }
        }

        // Только теперь качаем.
        let ensured = self.ensure_local(src).await?;
        let hydrated = ensured.outcome == EnsureOutcome::Downloaded;

        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("create_dir_all {}: {e}", parent.display()))?;
        }
        let bytes = std::fs::copy(src, dest)
            .map_err(|e| format!("copy {} → {}: {e}", src.display(), dest.display()))?
            as i64;

        if src_in_mirror {
            if let Some(loc) = parse_mirror_path(&root, &self.dirs(), src) {
                let d = dest_s.clone();
                self.with_sync(move |s| {
                    let Some(e) =
                        s.index
                            .entry_by_path(&loc.project_id, &loc.folder_path, &loc.name)?
                    else {
                        return Ok(());
                    };
                    s.index.record_copy(
                        &d,
                        &e.id,
                        e.etag.as_deref(),
                        e.content_hash.as_deref(),
                        e.size_bytes,
                    )
                })
                .await?;
            }
        }

        Ok(CopyReport {
            action: CopyAction::Copied,
            bytes: Some(bytes),
            hydrated,
        })
    }

    /// Актуальна ли копия по адресу `dest`.
    ///
    /// Для источника из зеркала — сравнение версий по записи `copied_files`. Работает
    /// и когда зеркальная копия УЖЕ ВЫТЕСНЕНА: запись помнит версию, из которой
    /// копировали, а актуальная версия лежит в каталоге. Ни байта по сети.
    ///
    /// Для обычного локального источника — сравнение mtime, то есть поведение как
    /// было до появления облака.
    async fn dest_is_up_to_date(
        &self,
        src: &Path,
        dest: &Path,
        src_in_mirror: bool,
        dest_s: &str,
    ) -> Result<bool, String> {
        if !src_in_mirror {
            let (Ok(s), Ok(d)) = (std::fs::metadata(src), std::fs::metadata(dest)) else {
                // Что-то не прочиталось — считаем, что копировать надо.
                return Ok(false);
            };
            let (Ok(sm), Ok(dm)) = (s.modified(), d.modified()) else {
                return Ok(false);
            };
            return Ok(sm <= dm);
        }

        let root = self.mirror_root();
        let Some(loc) = parse_mirror_path(&root, &self.dirs(), src) else {
            return Ok(false);
        };
        let dest_key = dest_s.to_string();

        self.with_sync(move |s| {
            let Some(rec) = s.index.copy_record(&dest_key)? else {
                // Копия есть, а откуда — неизвестно (скопировали руками или до
                // внедрения). Считаем устаревшей: безопасно и случай редкий.
                return Ok(false);
            };
            let Some(e) =
                s.index
                    .entry_by_path(&loc.project_id, &loc.folder_path, &loc.name)?
            else {
                return Ok(false);
            };
            let (rec_file_id, rec_etag, rec_hash, _rec_size) = rec;
            if rec_file_id != e.id {
                // По этому пути теперь копия другого файла.
                return Ok(false);
            }
            // Сравниваем по content_hash, если он есть, иначе по etag: у
            // multipart-объектов etag перестаёт быть хэшем содержимого.
            let now_v = e.content_hash.clone().or(e.etag.clone());
            let was_v = rec_hash.or(rec_etag);
            Ok(match (was_v, now_v) {
                (Some(a), Some(b)) => a == b,
                _ => false,
            })
        })
        .await
    }
}

// ─── Вытеснение ──────────────────────────────────────────────────────────────

impl StorageService {
    /// Прогон чистки кэша.
    ///
    /// Кандидаты идут от самых давно нетронутых: давление по размеру должно
    /// снимать сначала холодное. Бюджет пересчитывается по ходу — освободили место,
    /// давление кончилось, остальное живёт дальше по TTL.
    pub async fn run_eviction(
        &self,
        policy: super::evict::EvictionPolicy,
    ) -> Result<super::evict::EvictionReport, String> {
        use super::evict::{decide, EvictDecision};

        let (mut current, candidates) = self
            .with_sync(|s| Ok((s.index.mirror_bytes()?, s.index.eviction_candidates()?)))
            .await?;

        let now = now_sec();
        let mut report = super::evict::EvictionReport::default();
        let mut freed_paths: Vec<String> = Vec::new();

        for c in candidates {
            report.scanned += 1;
            let over_budget = policy.max_bytes.is_some_and(|b| current > b);

            match decide(&c, now, &policy, over_budget) {
                EvictDecision::KeepFresh => {}
                EvictDecision::KeepHot => report.kept_hot += 1,
                EvictDecision::KeepPinned => report.kept_pinned += 1,
                EvictDecision::KeepUnsafe => report.kept_unsafe += 1,
                EvictDecision::Expired | EvictDecision::Pressure => {
                    // Файла может не быть — удалили руками или прошлый прогон
                    // оборвался. Это не ошибка: состояние всё равно приводим в
                    // порядок, иначе запись останется вечным призраком.
                    let _ = std::fs::remove_file(&c.local_path);
                    let id = c.file_id.clone();
                    self.with_sync(move |s| s.index.mark_evicted(&id)).await?;
                    current -= c.local_size;
                    report.evicted += 1;
                    report.freed_bytes += c.local_size;
                    freed_paths.push(c.local_path.clone());
                }
            }
        }

        // Вытеснение идёт по таймеру, без участия человека: без события файл
        // остался бы на экране «синхронизированным», хотя копии уже нет.
        self.emit_changed(&freed_paths);
        Ok(report)
    }
}

fn now_sec() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Убрать путь с диска, не считая отсутствие ошибкой.
///
/// Файла может не быть штатно: облачный файл не скачан, или прошлый прогон
/// оборвался. Возвращает 1, если что-то реально удалили.
fn remove_path(path: &Path) -> Result<usize, String> {
    let meta = match std::fs::metadata(path) {
        Ok(m) => m,
        Err(_) => return Ok(0),
    };
    if meta.is_dir() {
        std::fs::remove_dir_all(path).map_err(|e| format!("remove_dir_all {}: {e}", path.display()))?;
    } else {
        std::fs::remove_file(path).map_err(|e| format!("remove_file {}: {e}", path.display()))?;
    }
    Ok(1)
}

/// Осмотр кандидата для очереди заливки: размер и время, либо `None`.
///
/// Папка отдаёт `None` осознанно: событие файловой системы приходит и на папку
/// (её mtime меняется, когда внутри появился файл), а заливать папку нечем —
/// в каталоге она строка, а не объект.
fn stat_for_pending(path: &Path) -> Option<super::pending::Seen> {
    let meta = std::fs::metadata(path).ok()?;
    if !meta.is_file() {
        return None;
    }
    Some(super::pending::Seen {
        size: meta.len(),
        mtime: file_mtime(path).unwrap_or(0),
    })
}

fn file_mtime(path: &Path) -> Option<i64> {
    std::fs::metadata(path)
        .ok()?
        .modified()
        .ok()?
        .duration_since(std::time::UNIX_EPOCH)
        .ok()
        .map(|d| d.as_secs() as i64)
}

// ─── Тесты ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::mock::{MockApi, MockState};
    use std::collections::HashMap as Map;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    /// Минимальный HTTP-сервер: отдаёт одно и то же тело на любой запрос и считает
    /// обращения. Нужен, чтобы проверить настоящую передачу байтов — `.part`,
    /// переименование, хэш, single-flight, — а не только логику вокруг.
    struct TestServer {
        addr: String,
        hits: Arc<AtomicUsize>,
    }

    async fn spawn_server(body: Vec<u8>) -> TestServer {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = format!("http://{}", listener.local_addr().unwrap());
        let hits = Arc::new(AtomicUsize::new(0));
        let hits2 = hits.clone();

        tokio::spawn(async move {
            loop {
                let Ok((mut sock, _)) = listener.accept().await else {
                    return;
                };
                let body = body.clone();
                let hits = hits2.clone();
                tokio::spawn(async move {
                    let mut buf = [0u8; 2048];
                    let _ = sock.read(&mut buf).await;
                    hits.fetch_add(1, Ordering::SeqCst);
                    // Небольшая задержка, чтобы второй запрос успел упереться в
                    // single-flight, а не проскочить мимо.
                    tokio::time::sleep(std::time::Duration::from_millis(60)).await;
                    let head = format!(
                        "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                        body.len()
                    );
                    let _ = sock.write_all(head.as_bytes()).await;
                    let _ = sock.write_all(&body).await;
                    let _ = sock.flush().await;
                });
            }
        });

        TestServer { addr, hits }
    }

    /// Владелец и проект, из которых складывается раскладка зеркала в тестах:
    /// `<mirror>/Клиент/Проект/…` (имя папки верхнего уровня — имя владельца).
    fn demo_projects() -> crate::storage::ProjectsResponse {
        crate::storage::ProjectsResponse {
            clients: vec![],
            users: vec![crate::storage::RemoteUser {
                id: "u1".into(),
                email: "Клиент".into(),
                full_name: String::new(),
                display_name: String::new(),
            }],
            projects: vec![crate::storage::RemoteProject {
                id: "p1".into(),
                name: "Проект".into(),
                client_id: None,
                user_id: Some("u1".into()),
                group_name: "personal".into(),
                is_active: true,
                is_paused: false,
                is_archived: false,
                archived_at: None,
                updated_at: "2026-08-08T00:00:00.000Z".into(),
            }],
        }
    }

    /// Путь в зеркале для тестовой фикстуры: `<tmp>/Клиент/Проект/<folder>/<name>`.
    fn mpath(tmp: &Path, folder: &str, name: &str) -> PathBuf {
        let mut p = tmp.join("Клиент").join("Проект");
        for seg in folder.split('/').filter(|s| !s.is_empty()) {
            p.push(seg);
        }
        p.push(name);
        p
    }

    /// Запись-ПАПКА. Каталог перечисляет папки отдельными записями (`is_folder`),
    /// и листинг опирается именно на них: из `folder_path` файлов папки не выводятся.
    fn dir_entry(id: &str, folder: &str, name: &str) -> TreeEntry {
        TreeEntry {
            id: id.into(),
            project_id: "p1".into(),
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

    fn entry(id: &str, folder: &str, name: &str, size: i64) -> TreeEntry {
        TreeEntry {
            id: id.into(),
            project_id: "p1".into(),
            folder_path: folder.into(),
            name: name.into(),
            is_folder: false,
            // Раскладка как у бэкенда, С сегментом владельца:
            // `projects/{userId}/{projectId}/…`. Без него тесты не увидели бы, что
            // из ключа определяется владелец — а именно он строит первый уровень.
            s3_key: Some(format!(
                "innohub/projects/3fa85f64-5717-4562-b3fc-2c963f66afa6/p1/{folder}/uuid-{name}"
            )),
            size_bytes: Some(size),
            content_type: None,
            etag: Some("e1".into()),
            content_hash: None,
            origin_mtime: None,
            created_at: None,
            updated_at: None,
            last_seq: None,
        }
    }

    /// Сервис с моком и временным зеркалом. `url_base` подменяет presign, чтобы
    /// ссылки вели на тестовый сервер.
    async fn service(url_base: Option<&str>, tmp: &Path) -> StorageService {
        let mut trees = Map::new();
        trees.insert("p1".to_string(), vec![entry("f1", "IN", "a.mov", 11)]);

        let mock = MockApi::new(MockState {
            trees,
            projects: demo_projects(),
            ..Default::default()
        });
        if let Some(base) = url_base {
            mock.with(|m| m.presign_base = Some(base.to_string()));
        }

        let idx = Index::open_in_memory().unwrap();
        let mut sync = Sync::new(Provider::Mock(mock), idx);
        // Список проектов — ДО bootstrap: из него строится раскладка зеркала
        // (`<Клиент>/<Проект>`), и без неё ни один путь не разберётся.
        sync.refresh_projects().await.unwrap();
        sync.bootstrap("p1").await.unwrap();

        let svc = StorageService::new();
        svc.attach(sync, tmp.to_path_buf()).await;
        svc
    }

    fn tmpdir(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!(
            "fsm-hydrate-{tag}-{}-{:?}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .subsec_nanos()
        ));
        let _ = std::fs::create_dir_all(&d);
        d
    }

    // ─── Сайдкары ────────────────────────────────────────────────────────────

    /// Служебный JSON обязан уходить каналом сайдкаров, а не обычной заливкой.
    ///
    /// Это главный тест всей истории: залитый через `presign` + `notify`
    /// `folderState.json` получает физический ключ `{uuid}-имя` и ложится РЯДОМ с тем
    /// объектом, который читает сайт. Настройки при этом уезжают в облако и никем
    /// не читаются — «сохранил, а на сайте не появилось».
    #[tokio::test]
    async fn служебный_json_уходит_сайдкаром_а_не_обычной_заливкой() {
        let tmp = tmpdir("sidecar-up");
        let svc = service(None, &tmp).await;

        let path = mpath(&tmp, "options", "folderState.json");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, br#"{"enabled":false}"#).unwrap();

        let r = svc.upload_local(&path).await.unwrap();

        assert!(r.sidecar, "служебный JSON обязан уйти каналом сайдкаров");
        assert!(
            r.s3_key.is_empty() && r.file_id.is_empty(),
            "у сайдкара нет ни строки в каталоге, ни физического ключа"
        );
        // `notify` не звался вовсе: иначе в каталоге появилась бы строка с uuid-ключом.
        let notifies = svc
            .with_sync(|s| {
                Ok(match &s.provider {
                    Provider::Mock(m) => m.with(|st| st.notify_calls),
                    _ => usize::MAX,
                })
            })
            .await
            .unwrap();
        assert_eq!(notifies, 0, "сайдкар не должен подтверждаться как обычный файл");

        let body = svc
            .provider()
            .unwrap()
            .sidecar_get("p1", Sidecar::FolderState)
            .await
            .unwrap();
        assert_eq!(body.as_deref(), Some(r#"{"enabled":false}"#));
    }

    /// Тот же файл во ДРУГОЙ папке — обычный файл, канал подменять нельзя.
    #[test]
    fn folderstate_вне_options_остаётся_обычным_файлом() {
        assert!(Sidecar::from_logical("options", "folderState.json").is_some());
        assert!(
            Sidecar::from_logical("IN", "folderState.json").is_none(),
            "имя файла само по себе сайдкаром его не делает — только путь options/"
        );
        assert!(Sidecar::from_logical("", "options.json").is_none());
    }

    /// Подтянули с сайта → не отправили тут же обратно.
    ///
    /// Петля реальна: `pull_sidecar` пишет файл, вотчер видит запись и ставит его в
    /// очередь на заливку. Спасает сверка с тем, что уже лежит в облаке.
    #[tokio::test]
    async fn подтянутый_сайдкар_не_уезжает_обратно() {
        let tmp = tmpdir("sidecar-loop");
        let svc = service(None, &tmp).await;
        let project_dir = tmp.join("Клиент").join("Проект");
        std::fs::create_dir_all(&project_dir).unwrap();

        // Сайт что-то записал.
        svc.provider()
            .unwrap()
            .sidecar_put("p1", Sidecar::FolderState, r#"{"enabled":true}"#, None)
            .await
            .unwrap();

        let changed = svc.pull_sidecar("p1", Sidecar::FolderState).await.unwrap();
        assert!(changed, "первое подтягивание обязано создать файл на диске");

        let path = mpath(&tmp, "options", "folderState.json");
        assert_eq!(
            std::fs::read_to_string(&path).unwrap(),
            r#"{"enabled":true}"#
        );

        // Повторное подтягивание не должно трогать файл: иначе mtime поедет и вотчер
        // поставит файл в очередь на заливку без всякой правки.
        assert!(
            !svc.pull_sidecar("p1", Sidecar::FolderState).await.unwrap(),
            "совпадающий сайдкар перезаписывать нельзя — это ложная правка для вотчера"
        );

        // А заливка того же содержимого не должна дойти до PUT.
        let r = svc.upload_local(&path).await.unwrap();
        assert!(r.sidecar);
    }

    /// Проекта нет на диске — сайдкар его не воскрешает.
    #[tokio::test]
    async fn сайдкар_не_создаёт_папку_удалённого_проекта() {
        let tmp = tmpdir("sidecar-ghost");
        let svc = service(None, &tmp).await;

        svc.provider()
            .unwrap()
            .sidecar_put("p1", Sidecar::Options, "{}", None)
            .await
            .unwrap();

        // Папки проекта на диске нет вообще.
        assert!(
            !svc.pull_sidecar("p1", Sidecar::Options).await.unwrap(),
            "запись служебного файла не должна воскрешать папку проекта"
        );
        assert!(!mpath(&tmp, "options", "options.json").exists());
    }

    /// Прогресс заливки обязан попадать в базу ПОСРЕДИ передачи.
    ///
    /// Тест смотрит в базу изнутри самой «передачи» — то есть до того, как та
    /// вернёт результат. Проверка «после завершения» ничего не значила бы: там
    /// `bytes_done` записывался и в сломанной версии, только показывать его было
    /// уже некому.
    #[tokio::test]
    async fn прогресс_заливки_виден_до_ответа_сервера() {
        let tmp = tmpdir("progress");
        let svc = service(None, &tmp).await;

        let id = svc
            .with_sync(|s| s.index.enqueue_transfer(None, "p1", "up", "/tmp/big.mp4", Some(1000)))
            .await
            .unwrap();

        let sent = Arc::new(std::sync::atomic::AtomicI64::new(0));
        let sent2 = sent.clone();
        let svc_ref = &svc;

        // «Передача»: отправила часть байтов, подождала — и сама заглянула в базу.
        let fut = async move {
            sent2.store(400, std::sync::atomic::Ordering::Relaxed);
            tokio::time::sleep(std::time::Duration::from_millis(90)).await;
            svc_ref
                .with_sync(|s| s.index.list_transfers(10))
                .await
                .unwrap()
                .into_iter()
                .find(|t| t.id == id)
                .map(|t| (t.bytes_done, t.state))
                .expect("передача должна быть в списке")
        };

        let (mid_done, mid_state) = svc
            .report_progress_while(id, &sent, std::time::Duration::from_millis(20), fut)
            .await
            .expect("передача не отменялась");

        assert_eq!(
            mid_done, 400,
            "байты обязаны быть в базе ещё ДО ответа сервера — иначе прогресс не показать"
        );
        assert_eq!(
            mid_state, "active",
            "передача с прогрессом больше не 'queued': пока она queued, верхняя панель её не считает"
        );
    }

    /// «Остановить» обязано ронять саму передачу, а не только красить строку.
    ///
    /// До правки отмена проверялась лишь в цикле скачивания, а заливка про неё не
    /// знала вовсе: строка становилась «отменено», байты продолжали ехать до конца.
    #[tokio::test]
    async fn отмена_роняет_заливку_а_не_только_метку() {
        let tmp = tmpdir("cancel-up");
        let svc = service(None, &tmp).await;

        let id = svc
            .with_sync(|s| s.index.enqueue_transfer(None, "p1", "up", "/tmp/big.mp4", Some(1000)))
            .await
            .unwrap();
        svc.cancel_transfer(id).await.unwrap();

        let sent = Arc::new(std::sync::atomic::AtomicI64::new(0));
        // «Запрос», который сам никогда не закончится: единственный способ выйти —
        // заметить отмену.
        let вечный = async {
            tokio::time::sleep(std::time::Duration::from_secs(30)).await;
            "не должно случиться"
        };

        let out = svc
            .report_progress_while(id, &sent, std::time::Duration::from_millis(10), вечный)
            .await;

        assert!(out.is_none(), "отменённая передача обязана прекратиться, а не дойти до конца");
    }

    #[tokio::test]
    async fn вне_зеркала_ничего_не_делаем() {
        let tmp = tmpdir("outside");
        let svc = service(None, &tmp).await;

        let outside = PathBuf::from("/Users/x/Work/local.mov");
        let r = svc.ensure_local(&outside).await.unwrap();
        assert_eq!(r.outcome, EnsureOutcome::NotInMirror);
        assert_eq!(r.path, outside.to_string_lossy());

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[tokio::test]
    async fn скачивает_и_кладёт_по_логическому_пути() {
        let tmp = tmpdir("download");
        let srv = spawn_server(b"hello world".to_vec()).await;
        let svc = service(Some(&srv.addr), &tmp).await;

        let target = mpath(&tmp, "IN", "a.mov");
        let r = svc.ensure_local(&target).await.unwrap();

        assert_eq!(r.outcome, EnsureOutcome::Downloaded);
        assert_eq!(r.bytes, Some(11));
        assert_eq!(std::fs::read_to_string(&target).unwrap(), "hello world");
        // `.part` не должен остаться рядом.
        assert!(!paths::part_path(&target).exists());

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[tokio::test]
    async fn второй_раз_не_качает() {
        let tmp = tmpdir("fresh");
        let srv = spawn_server(b"hello world".to_vec()).await;
        let svc = service(Some(&srv.addr), &tmp).await;
        let target = mpath(&tmp, "IN", "a.mov");

        svc.ensure_local(&target).await.unwrap();
        let r = svc.ensure_local(&target).await.unwrap();

        assert_eq!(r.outcome, EnsureOutcome::AlreadyFresh);
        assert_eq!(srv.hits.load(Ordering::SeqCst), 1, "быстрый путь без сети");

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[tokio::test]
    async fn single_flight_качает_один_раз_на_двоих() {
        let tmp = tmpdir("single");
        let srv = spawn_server(b"hello world".to_vec()).await;
        let svc = Arc::new(service(Some(&srv.addr), &tmp).await);
        let target = mpath(&tmp, "IN", "a.mov");

        // Две ноды попросили один файл одновременно.
        let (a, b) = tokio::join!(
            {
                let s = svc.clone();
                let t = target.clone();
                async move { s.ensure_local(&t).await }
            },
            {
                let s = svc.clone();
                let t = target.clone();
                async move { s.ensure_local(&t).await }
            }
        );

        a.unwrap();
        b.unwrap();
        assert_eq!(
            srv.hits.load(Ordering::SeqCst),
            1,
            "второй должен был дождаться первого, а не качать параллельно"
        );

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[tokio::test]
    async fn файл_вне_каталога_это_localonly_а_не_попытка_скачать() {
        let tmp = tmpdir("localonly");
        let svc = service(None, &tmp).await;

        // Положили руками то, чего в каталоге нет.
        let target = mpath(&tmp, "IN", "рукописный.mov");
        std::fs::create_dir_all(target.parent().unwrap()).unwrap();
        std::fs::write(&target, b"local").unwrap();

        let r = svc.ensure_local(&target).await.unwrap();
        assert_eq!(
            r.outcome,
            EnsureOutcome::LocalOnly,
            "качать нечего — такого файла в облаке нет"
        );

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[tokio::test]
    async fn обрыв_не_оставляет_обрезанный_файл() {
        let tmp = tmpdir("broken");
        // Сервер, который сразу закрывает соединение, — имитация обрыва.
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = format!("http://{}", listener.local_addr().unwrap());
        tokio::spawn(async move {
            while let Ok((sock, _)) = listener.accept().await {
                drop(sock);
            }
        });

        let svc = service(Some(&addr), &tmp).await;
        let target = mpath(&tmp, "IN", "a.mov");

        assert!(svc.ensure_local(&target).await.is_err());
        assert!(!target.exists(), "целевого файла быть не должно");

        // И состояние должно стать Error, а не молча остаться Cloud.
        let state = svc
            .with_sync(|s| s.index.local_state("f1"))
            .await
            .unwrap()
            .map(|(st, _)| st);
        assert_eq!(state.as_deref(), Some("Error"));

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[tokio::test]
    async fn заливает_и_подтверждает() {
        let tmp = tmpdir("upload");
        let srv = spawn_server(b"ok".to_vec()).await;
        let svc = service(Some(&srv.addr), &tmp).await;

        // Пайплайн положил результат в зеркальную папку OUT.
        let target = mpath(&tmp, "OUT", "final.mov");
        std::fs::create_dir_all(target.parent().unwrap()).unwrap();
        std::fs::write(&target, b"hello world").unwrap();

        let r = svc.upload_local(&target).await.unwrap();
        assert_eq!(r.bytes, 11);
        assert_eq!(r.strategy, crate::storage::upload::UploadStrategy::SinglePut);

        // Файл должен появиться в дереве СРАЗУ, не дожидаясь следующей дельты.
        let listed = svc
            .with_sync(|s| s.index.list_dir("p1", "OUT"))
            .await
            .unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].name, "final.mov");

        // И состояние — Fresh: залито и совпадает.
        let st = svc
            .with_sync(|s| s.index.local_state(&r.file_id))
            .await
            .unwrap()
            .map(|(st, _)| st);
        assert_eq!(st.as_deref(), Some("Fresh"));

        let _ = std::fs::remove_dir_all(&tmp);
    }

    /// Перезаливка известного файла обязана идти в ТОТ ЖЕ объект.
    ///
    /// `/presign` без ключа выписывает новый `{uuid}-{имя}`, `notify` ищет строку
    /// по `s3_key`, не находит и заводит ВТОРУЮ с тем же логическим именем: дубль
    /// в каталоге, осиротевший объект в R2, сменившийся `file_id`. А перезапись
    /// результата в тот же путь — самый частый вид заливки, так что промах здесь
    /// плодил бы дубли на каждом перерендере.
    #[tokio::test]
    async fn перезаливка_идёт_в_тот_же_ключ() {
        let tmp = tmpdir("rekey");
        let srv = spawn_server(b"ok".to_vec()).await;
        let svc = service(Some(&srv.addr), &tmp).await;

        // `f1` = IN/a.mov, он уже есть в каталоге с ключом от бэкенда.
        let known = svc
            .with_sync(|s| Ok(s.index.entry("f1")?.and_then(|e| e.s3_key)))
            .await
            .unwrap()
            .expect("у файла из каталога должен быть s3_key");

        let target = mpath(&tmp, "IN", "a.mov");
        std::fs::create_dir_all(target.parent().unwrap()).unwrap();
        std::fs::write(&target, b"rerendered").unwrap();

        let r = svc.upload_local(&target).await.unwrap();
        assert_eq!(r.s3_key, known, "ключ обязан остаться прежним");
        assert_eq!(r.file_id, "f1", "и file_id вместе с ним");

        // Второй строки с тем же именем появиться не должно.
        let listed = svc.with_sync(|s| s.index.list_dir("p1", "IN")).await.unwrap();
        assert_eq!(
            listed.iter().filter(|e| e.name == "a.mov").count(),
            1,
            "дубль в каталоге: {listed:?}"
        );

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[tokio::test]
    async fn в_notify_уходят_хэш_и_время_файла() {
        let tmp = tmpdir("notifyargs");
        let srv = spawn_server(b"ok".to_vec()).await;
        let svc = service(Some(&srv.addr), &tmp).await;
        let mock = svc.mock_handle().await.unwrap();

        let target = mpath(&tmp, "OUT", "final.mov");
        std::fs::create_dir_all(target.parent().unwrap()).unwrap();
        std::fs::write(&target, b"hello world").unwrap();
        svc.upload_local(&target).await.unwrap();

        let (_key, hash, mtime) = mock.with(|m| m.last_notify.clone()).unwrap();
        // sha256("hello world") — считаем сами и присылаем: у multipart-объектов
        // etag перестанет быть хэшем содержимого, и сравнение версий сломается.
        assert_eq!(
            hash.as_deref(),
            Some("b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9")
        );
        assert!(mtime.is_some(), "origin_mtime бэкенд теперь принимает — присылаем");

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[tokio::test]
    async fn без_notify_заливка_не_считается_успешной() {
        let tmp = tmpdir("nonotify");
        let srv = spawn_server(b"ok".to_vec()).await;
        let svc = service(Some(&srv.addr), &tmp).await;
        let mock = svc.mock_handle().await.unwrap();

        let target = mpath(&tmp, "OUT", "final.mov");
        std::fs::create_dir_all(target.parent().unwrap()).unwrap();
        std::fs::write(&target, b"hello world").unwrap();

        // Байты уедут, а подтверждение упадёт — самый неприятный случай:
        // объект в бакете есть, а каталог его не видит.
        mock.with(|m| m.fail_notify = true);
        let err = svc.upload_local(&target).await.unwrap_err();

        assert!(srv.hits.load(Ordering::SeqCst) > 0, "байты должны были уехать");
        assert!(
            err.contains("подтверждение не прошло") && err.contains("reindex"),
            "сообщение обязано отличать «не залилось» от «залилось, но не подтвердилось», \
             и подсказывать выход: {err}"
        );

        // И главное: файл НЕ должен появиться в дереве как успешно залитый.
        let listed = svc
            .with_sync(|s| s.index.list_dir("p1", "OUT"))
            .await
            .unwrap();
        assert!(
            listed.is_empty(),
            "без подтверждения файла в каталоге быть не может"
        );

        // Передача помечена ошибкой, а не тихо забыта.
        let failed = svc
            .with_sync(|s| {
                s.index
                    .conn_for_test()
                    .query_row(
                        "SELECT COUNT(*) FROM transfers WHERE state = 'error'",
                        [],
                        |r| r.get::<_, i64>(0),
                    )
                    .map_err(|e| e.to_string())
            })
            .await
            .unwrap();
        assert_eq!(failed, 1);

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[tokio::test]
    async fn отказ_по_размеру_приходит_до_передачи_байтов() {
        let tmp = tmpdir("gate");
        let srv = spawn_server(b"ok".to_vec()).await;
        let svc = service(Some(&srv.addr), &tmp).await;

        // Порог = 1 байт и multipart «поддерживается» бэкендом → стратегия
        // Multipart, которой у нас пока нет.
        svc.set_multipart_threshold(1);
        svc.with_sync(|_s| Ok(())).await.unwrap();
        svc.force_caps_multipart(true).await;

        let target = mpath(&tmp, "OUT", "big.mov");
        std::fs::create_dir_all(target.parent().unwrap()).unwrap();
        std::fs::write(&target, b"hello world").unwrap();

        let err = svc.upload_local(&target).await.unwrap_err();
        assert!(err.contains("Multipart"), "получили: {err}");
        assert_eq!(
            srv.hits.load(Ordering::SeqCst),
            0,
            "ни одного байта не должно было уехать"
        );

        let _ = std::fs::remove_dir_all(&tmp);
    }

    /// Охват синхронизации = то, с чем работают. Никаких режимов и переключателей:
    /// дотронулись до проекта — он в опросе, перестали — выпал сам.
    ///
    /// Это и есть разница двух картин: оператор открывает папки руками и греет то,
    /// что открыл; машина обработки трогает один проект задачи, и опрашивается
    /// только он, а не вся папка пользователя.
    #[tokio::test]
    async fn опрашиваются_только_проекты_с_которыми_работают() {
        let tmp = tmpdir("warm");
        let svc = service(None, &tmp).await;
        let long = std::time::Duration::from_secs(600);

        // Ничего не трогали — опрашивать нечего, даже если каталог знает проекты.
        assert!(svc.warm_projects(long).is_empty());

        // Обращение к каталогу проекта — это касание.
        svc.ensure_catalog("p1").await.unwrap();
        assert_eq!(svc.warm_projects(long), vec!["p1".to_string()]);

        // Остывший проект выпадает сам: окно нулевое — значит тёплых нет.
        assert!(svc.warm_projects(std::time::Duration::from_secs(0)).is_empty());
        // И повторно уже не появляется — запись выброшена, а не просто скрыта.
        assert!(svc.warm_projects(long).is_empty());

        let _ = std::fs::remove_dir_all(&tmp);
    }

    /// Каталог сказал, что файл теперь называется иначе (переименовали на сайте) —
    /// локальная копия обязана переехать за ним.
    ///
    /// Без этого копия остаётся по старому пути, сверка её там не находит, решает
    /// «удалили руками» и обнуляет baseline: файл на диске начинает показываться как
    /// «только в облаке».
    #[tokio::test]
    async fn локальная_копия_едет_за_переименованием_в_каталоге() {
        let tmp = tmpdir("reconcile");
        let svc = service(None, &tmp).await;
        let p = seed_hydrated(&svc, &tmp, "f1", b"hello world").await;
        assert!(p.exists());

        // Имитируем чужое переименование: в каталоге новое имя, на диске старое.
        svc.with_sync(|s| {
            s.index
                .conn_for_test()
                .execute(
                    "UPDATE remote_entries SET name = 'переименован.mov' WHERE file_id = 'f1'",
                    [],
                )
                .map_err(|e| e.to_string())?;
            Ok(())
        })
        .await
        .unwrap();

        assert_eq!(svc.reconcile_local_paths().await.unwrap(), 1);

        let moved = p.parent().unwrap().join("переименован.mov");
        assert!(moved.exists(), "файл обязан переехать на диске");
        assert!(!p.exists(), "по старому пути остаться не должен");

        // И запись выправлена — иначе сверка продолжит смотреть в пустоту.
        let (_, local_path, _, _) = svc
            .with_sync(|s| s.index.local_baseline("f1"))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(local_path, moved.to_string_lossy());

        // Повторный прогон уже ничего не двигает.
        assert_eq!(svc.reconcile_local_paths().await.unwrap(), 0);

        let _ = std::fs::remove_dir_all(&tmp);
    }

    // ─── Убрать владельца с этой машины ──────────────────────────────────────

    /// Убрать владельца из колонки = освободить диск, но **онлайн не тронуть**, и
    /// **не стереть незалитое**: в нём работа, которой в облаке ещё нет.
    #[tokio::test]
    async fn удаление_владельца_чистит_диск_но_щадит_незалитое() {
        let tmp = tmpdir("dropowner");
        let svc = service(None, &tmp).await;

        // Синхронизированная копия — её можно унести.
        let synced = seed_hydrated(&svc, &tmp, "f1", b"hello world").await;

        // И незалитый результат рядом: он существует только здесь.
        let draft = mpath(&tmp, "OUT", "черновик.mov");
        std::fs::create_dir_all(draft.parent().unwrap()).unwrap();
        std::fs::write(&draft, b"draft").unwrap();
        let draft_s = draft.to_string_lossy().to_string();
        svc.with_sync(move |s| {
            s.index
                .mark_synced("f-draft", "LocalOnly", &draft_s, 5, 1, None)
        })
        .await
        .unwrap();

        let report = svc.drop_owner_local(&tmp.join("Клиент")).await.unwrap();

        assert!(!synced.exists(), "синхронизированную копию надо унести");
        assert!(
            draft.exists(),
            "незалитый файл стирать нельзя — в облаке его нет"
        );
        assert_eq!(report.removed, 1);
        assert_eq!(report.kept_unsafe, 1, "интерфейс обязан сказать, что не всё");
        assert!(report.freed_bytes > 0);

        // Запись в каталоге на месте: онлайн не тронут, владельца можно добавить снова.
        assert!(svc.with_sync(|s| s.index.entry("f1")).await.unwrap().is_some());

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[tokio::test]
    async fn удалять_можно_только_папку_владельца() {
        let tmp = tmpdir("dropowner2");
        let svc = service(None, &tmp).await;
        // Папка проекта — не владелец.
        assert!(svc
            .drop_owner_local(&tmp.join("Клиент").join("Проект"))
            .await
            .is_err());
        // И путь вне зеркала тоже.
        assert!(svc.drop_owner_local(Path::new("/Users/x/Work")).await.is_err());
        let _ = std::fs::remove_dir_all(&tmp);
    }

    // ─── Прогресс заливки нового файла ───────────────────────────────────────

    /// Файл, которого ещё нет в каталоге, обязан показывать ход заливки.
    ///
    /// У новой заливки `file_id` появляется только из ответа `/notify`, поэтому
    /// связать строку с передачей можно лишь по пути. Без этого файл на 200 МБ полторы
    /// минуты показывал статичную стрелку «надо залить»: заливка шла, а на экране не
    /// двигалось ничего — ровно то, что выглядит как зависшая программа.
    #[tokio::test]
    async fn незалитый_файл_показывает_проценты_заливки() {
        let tmp = tmpdir("progress");
        let svc = service(None, &tmp).await;

        let p = mpath(&tmp, "OUT", "большой.mov");
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(&p, b"payload").unwrap();
        let path_s = p.to_string_lossy().to_string();

        // Пока передачи нет — обычная стрелка «надо залить», без процентов.
        let before = svc
            .browse(&p.parent().unwrap().to_string_lossy())
            .await
            .unwrap()
            .unwrap();
        let row = before.iter().find(|r| r.name == "большой.mov").unwrap();
        assert_eq!(row.state, Some(FileState::LocalOnly));
        assert!(row.progress.is_none());

        // Заводим передачу «наверх» с прогрессом 25 % — как это делает `upload_local`.
        let ps = path_s.clone();
        svc.with_sync(move |s| {
            let id = s.index.enqueue_transfer(None, "p1", "up", &ps, Some(400))?;
            s.index.set_transfer_progress(id, 100)
        })
        .await
        .unwrap();

        let after = svc
            .browse(&p.parent().unwrap().to_string_lossy())
            .await
            .unwrap()
            .unwrap();
        let row = after.iter().find(|r| r.name == "большой.mov").unwrap();
        assert_eq!(row.state, Some(FileState::Uploading), "должна быть заливка");
        assert_eq!(row.progress, Some(0.25), "и проценты, а не пустота");

        let _ = std::fs::remove_dir_all(&tmp);
    }

    // ─── Удаление: две ступени ───────────────────────────────────────────────

    /// Первое нажатие обязано убрать ТОЛЬКО локальную копию.
    ///
    /// Это единственная защита от случайной потери мастера: одноступенчатое
    /// удаление стирало запись в каталоге и объект в R2 сразу, а корзины у бэкенда
    /// нет — отменить было нечем.
    #[tokio::test]
    async fn первое_удаление_убирает_только_локальную_копию() {
        let tmp = tmpdir("del1");
        let svc = service(None, &tmp).await;
        let p = seed_hydrated(&svc, &tmp, "f1", b"hello world").await;

        let stage = svc.delete_in_cloud(&p, false).await.unwrap();
        assert_eq!(stage, Some(crate::storage::DeleteStage::LocalCopy));
        assert!(!p.exists(), "локальная копия должна исчезнуть");

        // Запись в каталоге на месте — файл остался в облаке.
        let entry = svc.with_sync(|s| s.index.entry("f1")).await.unwrap();
        assert!(entry.is_some(), "в каталоге файл обязан остаться");

        // Baseline обнулён: иначе повторное скачивание сочло бы файл «локально
        // изменённым» и попросило заливку.
        let base = svc.with_sync(|s| s.index.local_baseline("f1")).await.unwrap();
        assert!(base.is_none() || base.unwrap().0 != "Fresh");

        let _ = std::fs::remove_dir_all(&tmp);
    }

    /// Второе нажатие (копии уже нет) не должно молча уходить в облако: пока нет
    /// корзины, это точка невозврата, и интерфейс обязан спросить.
    #[tokio::test]
    async fn второе_удаление_требует_подтверждения() {
        let tmp = tmpdir("del2");
        let svc = service(None, &tmp).await;

        // Файл известен каталогу, локальной копии нет — состояние «только онлайн».
        let p = mpath(&tmp, "IN", "a.mov");
        let stage = svc.delete_in_cloud(&p, false).await.unwrap();
        assert_eq!(stage, Some(crate::storage::DeleteStage::NeedsConfirm));

        // И ничего не тронуто: запись на месте.
        assert!(svc.with_sync(|s| s.index.entry("f1")).await.unwrap().is_some());

        let _ = std::fs::remove_dir_all(&tmp);
    }

    /// Файл, которого в каталоге нет (положили руками и ещё не залили) — ступень
    /// одна: в облаке удалять нечего.
    #[tokio::test]
    async fn незалитый_файл_удаляется_одним_шагом() {
        let tmp = tmpdir("del3");
        let svc = service(None, &tmp).await;

        let p = mpath(&tmp, "OUT", "черновик.mov");
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(&p, b"draft").unwrap();

        let stage = svc.delete_in_cloud(&p, false).await.unwrap();
        assert_eq!(stage, Some(crate::storage::DeleteStage::LocalOnly));
        assert!(!p.exists());

        let _ = std::fs::remove_dir_all(&tmp);
    }

    // ─── Выжигание проекта ───────────────────────────────────────────────────

    /// Отказ в облаке НЕ должен уносить локальную папку.
    ///
    /// Иначе один обрыв сети превращает «удалить проект» в «удалить только мою
    /// работу»: в облаке проект целый, а незалитого на диске больше нет. Мок удаление
    /// не поддерживает — это и есть отказ, который нужен для проверки.
    #[tokio::test]
    async fn выжигание_при_отказе_облака_щадит_диск() {
        let tmp = tmpdir("purge-refuse");
        let svc = service(None, &tmp).await;
        let p = seed_hydrated(&svc, &tmp, "f1", b"hello world").await;
        let project = tmp.join("Клиент").join("Проект");

        let r = svc.purge_project(&project).await.unwrap().unwrap();

        assert!(!r.skipped.is_empty(), "мок обязан отказать в удалении");
        assert!(!r.local_removed, "в облаке ничего не удалилось — папку сносить нельзя");
        assert!(r.local_kept.is_some(), "и надо сказать, почему оставили");
        assert!(p.exists(), "локальный файл обязан остаться на диске");
        assert_eq!(r.files_left, 1, "файл остался в облаке");
        assert_eq!(r.files_deleted, 0);

        let _ = std::fs::remove_dir_all(&tmp);
    }

    /// Файл без записи его ПАПКИ в каталоге обязан попасть под выжигание.
    ///
    /// Каталог это допускает: `/notify` создаёт запись файла, а записи папок приезжают
    /// деревом. Обход «сверху вниз» такой файл не нашёл бы — и он остался бы в облаке
    /// как раз в тот момент, когда человек считает проект удалённым. У мока в дереве
    /// ровно такой случай: `IN/a.mov` есть, записи папки `IN` нет.
    #[tokio::test]
    async fn выжигание_видит_файл_без_записи_его_папки() {
        let tmp = tmpdir("purge-orphan");
        let svc = service(None, &tmp).await;
        let project = tmp.join("Клиент").join("Проект");

        // Верхний уровень пуст — значит проход «сверху» ничего бы не дал.
        let top = svc.with_sync(|s| s.index.list_dir("p1", "")).await.unwrap();
        assert!(top.is_empty(), "предпосылка теста: записи папки IN в каталоге нет");

        let r = svc.purge_project(&project).await.unwrap().unwrap();
        assert_eq!(r.skipped.len(), 1, "до файла всё равно дошли (и получили отказ мока)");
        assert_eq!(r.skipped[0].path, "IN/a.mov");

        let _ = std::fs::remove_dir_all(&tmp);
    }

    /// Выжигать можно только сам проект: папка внутри удаляется обычным
    /// двухступенчатым удалением, и путать эти две семантики нельзя.
    #[tokio::test]
    async fn выжигание_принимает_только_папку_проекта() {
        let tmp = tmpdir("purge-level");
        let svc = service(None, &tmp).await;

        let inside = tmp.join("Клиент").join("Проект").join("IN");
        assert!(svc.purge_project(&inside).await.is_err(), "папка внутри проекта — не проект");

        // Вне зеркала — не наше дело: зовущий удалит папку как обычную.
        let outside = std::env::temp_dir();
        assert!(svc.purge_project(&outside).await.unwrap().is_none());

        let _ = std::fs::remove_dir_all(&tmp);
    }

    // ─── Перенос ─────────────────────────────────────────────────────────────

    /// Перенос внутри проекта — это смена `folderPath` в каталоге, и локальная копия
    /// обязана поехать за ней. Двинуть только на диске значило бы порвать связь с
    /// каталогом: путь перестанет разбираться, значки исчезнут (та же болезнь, что
    /// была у переименования).
    #[tokio::test]
    async fn перенос_меняет_папку_в_каталоге_и_двигает_копию() {
        let tmp = tmpdir("move");
        let srv = spawn_server(b"ok".to_vec()).await;
        let svc = service(Some(&srv.addr), &tmp).await;
        let p = seed_hydrated(&svc, &tmp, "f1", b"hello world").await;

        let dest = tmp.join("Клиент").join("Проект").join("OUT");
        std::fs::create_dir_all(&dest).unwrap();

        // Мок мутации не поддерживает — проверяем, что до сети дошли с правильными
        // аргументами, а не что мок ответил.
        let err = svc.move_in_cloud(&p, &dest).await.unwrap_err();
        assert!(
            err.contains("мок") || err.contains("не поддерж"),
            "ожидали отказ мока, получили: {err}"
        );
        // Ничего не двинулось: порядок «сначала каталог» соблюдён.
        assert!(p.exists(), "при отказе сервера копия должна остаться на месте");

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[tokio::test]
    async fn папку_нельзя_перенести_внутрь_себя() {
        let tmp = tmpdir("moveself");
        let svc = service(None, &tmp).await;

        // Заводим папку IN и подпапку IN/sub в каталоге.
        svc.with_sync(|s| {
            for (id, folder, name) in [("d1", "", "IN"), ("d2", "IN", "sub")] {
                s.index
                    .conn_for_test()
                    .execute(
                        "INSERT INTO remote_entries (file_id, project_id, folder_path, name, is_folder, deleted)
                         VALUES (?1,'p1',?2,?3,1,0)",
                        rusqlite::params![id, folder, name],
                    )
                    .map_err(|e| e.to_string())?;
            }
            Ok(())
        })
        .await
        .unwrap();

        let project = tmp.join("Клиент").join("Проект");
        let err = svc
            .move_in_cloud(&project.join("IN"), &project.join("IN").join("sub"))
            .await
            .unwrap_err();
        assert!(err.contains("внутрь себя"), "получили: {err}");

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[tokio::test]
    async fn перенос_наружу_и_в_ту_же_папку_нас_не_касается() {
        let tmp = tmpdir("moveout");
        let svc = service(None, &tmp).await;
        let p = mpath(&tmp, "IN", "a.mov");

        // Приёмник вне зеркала — это выгрузка наружу, ей занимается копирование.
        assert!(svc
            .move_in_cloud(&p, Path::new("/Users/x/Work"))
            .await
            .unwrap()
            .is_none());

        // Та же папка — запроса не делаем вовсе.
        assert!(svc
            .move_in_cloud(&p, &tmp.join("Клиент").join("Проект").join("IN"))
            .await
            .unwrap()
            .is_none());

        let _ = std::fs::remove_dir_all(&tmp);
    }

    // ─── Переименование ──────────────────────────────────────────────────────

    /// Уровни выше проекта переименовывать нельзя, и отказ обязан быть внятным.
    ///
    /// Молчаливое локальное переименование ровно здесь и стоило дороже всего: путь
    /// переставал разбираться, `browse` отвечал «не найдено в каталоге», колонка
    /// читала диск, и **все значки синхронизации исчезали**, а в облаке имя
    /// оставалось прежним.
    #[tokio::test]
    async fn проект_и_папку_владельца_переименовать_нельзя() {
        let tmp = tmpdir("rename-guard");
        let svc = service(None, &tmp).await;

        let owner = tmp.join("Клиент");
        let err = svc.rename_in_cloud(&owner, "Другой").await.unwrap_err();
        assert!(err.contains("на сайте"), "получили: {err}");

        let project = owner.join("Проект");
        let err = svc.rename_in_cloud(&project, "Проект 2").await.unwrap_err();
        assert!(err.contains("на сайте"), "получили: {err}");

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[tokio::test]
    async fn вне_зеркала_переименование_не_наше_дело() {
        let tmp = tmpdir("rename-outside");
        let svc = service(None, &tmp).await;
        assert!(svc
            .rename_in_cloud(Path::new("/Users/x/Work/файл.mov"), "новое.mov")
            .await
            .unwrap()
            .is_none());
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[tokio::test]
    async fn имя_со_слэшем_отвергается() {
        let tmp = tmpdir("rename-slash");
        let svc = service(None, &tmp).await;
        let p = mpath(&tmp, "IN", "a.mov");
        assert!(svc.rename_in_cloud(&p, "под/папку").await.is_err());
        let _ = std::fs::remove_dir_all(&tmp);
    }

    /// Переименование папки: бэкенд правит потомков у себя, но **события на них не
    /// журналит** — значит каскад в индекс обязаны применить мы, иначе дети
    /// останутся по старому логическому пути и «пропадут» из проекта.
    #[test]
    fn каскад_переименования_папки_правит_потомков() {
        let idx = Index::open_in_memory().unwrap();
        let c = idx.conn_for_test();
        for (id, folder, name, is_dir) in [
            ("d1", "", "IN", 1),
            ("f1", "IN", "a.mov", 0),
            ("d2", "IN", "sub", 1),
            ("f2", "IN/sub", "b.mov", 0),
            ("f3", "OUT", "c.mov", 0),
        ] {
            c.execute(
                "INSERT INTO remote_entries (file_id, project_id, folder_path, name, is_folder, deleted)
                 VALUES (?1,'p1',?2,?3,?4,0)",
                rusqlite::params![id, folder, name, is_dir],
            )
            .unwrap();
        }

        let moved = idx.reprefix_children("p1", "IN", "ВХОД").unwrap();
        assert_eq!(moved, 3, "сама папка IN, sub и файлы внутри");

        let by = |id: &str| -> String {
            idx.conn_for_test()
                .query_row(
                    "SELECT folder_path FROM remote_entries WHERE file_id = ?1",
                    rusqlite::params![id],
                    |r| r.get(0),
                )
                .unwrap()
        };
        assert_eq!(by("f1"), "ВХОД");
        assert_eq!(by("d2"), "ВХОД");
        assert_eq!(by("f2"), "ВХОД/sub");
        assert_eq!(by("f3"), "OUT", "чужая ветка не должна поехать");
    }

    /// Локальные копии переехали вместе с папкой — запись обязана это отразить.
    /// Иначе сверка не найдёт файл, решит «удалён руками» и обнулит baseline:
    /// лежащая на диске свежая копия превратится в «только в облаке».
    #[test]
    fn локальные_пути_переезжают_за_папкой() {
        let idx = Index::open_in_memory().unwrap();
        idx.mark_synced("f1", "Fresh", "/m/Кл/Пр/IN/a.mov", 10, 1, Some("e1"))
            .unwrap();
        idx.mark_synced("f2", "Fresh", "/m/Кл/Пр/OUT/b.mov", 10, 1, Some("e2"))
            .unwrap();

        let n = idx.rebase_local_paths("/m/Кл/Пр/IN", "/m/Кл/Пр/ВХОД").unwrap();
        assert_eq!(n, 1);
        assert_eq!(
            idx.local_baseline("f1").unwrap().unwrap().1,
            "/m/Кл/Пр/ВХОД/a.mov"
        );
        assert_eq!(
            idx.local_baseline("f2").unwrap().unwrap().1,
            "/m/Кл/Пр/OUT/b.mov",
            "чужой путь не должен поехать"
        );
    }

    // ─── Архивные проекты ────────────────────────────────────────────────────

    /// Строка проекта в листинге должна нести признак архива, а раннер — уметь
    /// спросить его по пути. Без первого человек не понимает, почему проект стоит;
    /// без второго архивный проект пойдёт в обработку.
    #[tokio::test]
    async fn архивный_проект_виден_в_листинге_и_по_пути() {
        let tmp = tmpdir("archived");
        let svc = service(None, &tmp).await;

        // Каталог отдал проект как архивный.
        svc.with_sync(|s| {
            s.index
                .conn_for_test()
                .execute(
                    "UPDATE remote_projects SET is_archived = 1, archived_at = ?1 WHERE id = 'p1'",
                    rusqlite::params!["2026-08-01T10:00:00.000Z"],
                )
                .map_err(|e| e.to_string())?;
            Ok(())
        })
        .await
        .unwrap();

        // 1. Листинг папки владельца: строка проекта помечена.
        let owner_dir = tmp.join("Клиент");
        let rows = svc
            .browse(&owner_dir.to_string_lossy())
            .await
            .unwrap()
            .expect("папка владельца под зеркалом");
        let row = rows.iter().find(|r| r.name == "Проект").expect("строка проекта");
        assert!(row.archived, "архив обязан быть видён в листинге");

        // 2. По пути проекта — то же самое, это и спрашивает раннер.
        let info = svc
            .project_info(&owner_dir.join("Проект"))
            .await
            .unwrap()
            .expect("путь проекта");
        assert!(info.archived);
        assert_eq!(info.archived_at.as_deref(), Some("2026-08-01T10:00:00.000Z"));

        // 3. Файл внутри проекта архивным не помечается: флаг про проект, не про файлы.
        let inside = svc
            .browse(&owner_dir.join("Проект").join("IN").to_string_lossy())
            .await
            .unwrap()
            .unwrap_or_default();
        assert!(inside.iter().all(|r| !r.archived));

        let _ = std::fs::remove_dir_all(&tmp);
    }

    /// Путь вне зеркала — не проект, и это не ошибка: локальные папки проходят
    /// через тот же вызов на каждом витке обработки.
    #[tokio::test]
    async fn вне_зеркала_сведений_о_проекте_нет() {
        let tmp = tmpdir("archived-outside");
        let svc = service(None, &tmp).await;
        assert!(svc
            .project_info(Path::new("/Users/x/Work/локальная"))
            .await
            .unwrap()
            .is_none());
        let _ = std::fs::remove_dir_all(&tmp);
    }

    // ─── Первый уровень зеркала: владелец проекта ────────────────────────────

    /// Бэкенд `userId` не отдаёт — владелец добывается из ключа, и **это то, что
    /// строит первую колонку**. Без него все проекты сваливаются в одну папку
    /// «Без клиента»: снаружи выглядит как «облако подключилось, а структуры нет».
    #[tokio::test]
    async fn владелец_определяется_из_ключа_и_даёт_папку_верхнего_уровня() {
        let tmp = tmpdir("owner");
        let svc = service(None, &tmp).await;

        // Приводим индекс к тому, что отдаёт живой бэкенд: `userId` в `/projects`
        // отсутствует, значит владелец неизвестен.
        svc.with_sync(|s| {
            s.index
                .conn_for_test()
                .execute("UPDATE remote_projects SET user_id = NULL", [])
                .map_err(|e| e.to_string())?;
            Ok(())
        })
        .await
        .unwrap();
        svc.refresh_dirs().await;

        let before = svc
            .with_sync(|s| s.index.projects_without_owner())
            .await
            .unwrap();
        assert_eq!(before, vec!["p1".to_string()]);

        let found = svc.discover_owners().await.unwrap();
        assert_eq!(found, 1, "владелец обязан найтись в ключе файла");

        // Записан в индекс — значит переживёт перезапуск и повторный обход не нужен.
        let after = svc
            .with_sync(|s| s.index.projects_without_owner())
            .await
            .unwrap();
        assert!(after.is_empty());

        // И карта пересобрана: путь файла теперь лежит внутри папки владельца, а не
        // в папке сирот. Проверяем через тот же `mirror_path_for`, которым ходит
        // гидрация, — иначе тест доказывал бы только запись в БД.
        let p = svc.mirror_path_for("f1").await.unwrap();
        assert!(
            !p.contains(crate::storage::layout::NO_CLIENT_DIR),
            "проект остался в папке сирот: {p}"
        );
        assert!(
            p.contains("Пользователь 3fa85f64"),
            "в пути нет папки владельца: {p}"
        );

        let _ = std::fs::remove_dir_all(&tmp);
    }

    /// Пустой проект тоже обязан получить владельца.
    ///
    /// Ключей у него нет — ни файлов, ни, тем более, папок с ключами. Ровно на этом
    /// первая версия и спотыкалась: у человека из пяти проектов владельцы нашлись
    /// только у двух, потому что у двух каталог пуст, а у третьего в нём лежали
    /// только папки. Владельца выдаёт `/presign`: ключ он строит из владельца, а
    /// объект при этом не создаётся — ни байта, ни строки в каталоге.
    #[tokio::test]
    async fn владелец_пустого_проекта_берётся_из_подписи() {
        let tmp = tmpdir("ownerempty");
        let svc = service(None, &tmp).await;

        // Каталог пуст и владелец неизвестен — состояние «проект только создали».
        svc.with_sync(|s| {
            s.index
                .conn_for_test()
                .execute("DELETE FROM remote_entries", [])
                .map_err(|e| e.to_string())?;
            s.index
                .conn_for_test()
                .execute("UPDATE remote_projects SET user_id = NULL", [])
                .map_err(|e| e.to_string())?;
            Ok(())
        })
        .await
        .unwrap();

        assert_eq!(
            svc.discover_owners().await.unwrap(),
            1,
            "владелец обязан прийти из ответа /presign"
        );

        // И дерево при этом никто не качал: заливка тоже не запускалась.
        let entries = svc
            .with_sync(|s| s.index.list_dir("p1", "IN"))
            .await
            .unwrap();
        assert!(entries.is_empty(), "определение владельца не должно тянуть дерево");

        let _ = std::fs::remove_dir_all(&tmp);
    }

    // ─── Триггер заливки: очередь кандидатов ─────────────────────────────────

    /// Положить файл на диск и записать baseline РОВНО по факту диска —
    /// так выглядит только что скачанный файл.
    ///
    /// `seed_local` для этого не годится: он пишет `mtime = 1`, то есть заведомо
    /// расходится с диском, и любая сверка объявит файл изменённым.
    async fn seed_hydrated(svc: &StorageService, tmp: &Path, file_id: &str, bytes: &[u8]) -> PathBuf {
        let p = mpath(tmp, "IN", "a.mov");
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(&p, bytes).unwrap();

        let path_s = p.to_string_lossy().to_string();
        let size = bytes.len() as i64;
        let mtime = file_mtime(&p).unwrap();
        let id = file_id.to_string();
        svc.with_sync(move |s| s.index.mark_synced(&id, "Fresh", &path_s, size, mtime, Some("e1")))
            .await
            .unwrap();
        p
    }

    /// Главная ловушка событийного триггера: вотчер видит НАШИ же записи.
    /// Скачали файл → пришло событие «создан файл» → без проверки он поехал бы
    /// обратно в облако, и каждое скачивание оплачивалось бы заливкой.
    #[tokio::test]
    async fn свежескачанный_файл_обратно_не_заливается() {
        let tmp = tmpdir("echo");
        let svc = service(None, &tmp).await;
        let p = seed_hydrated(&svc, &tmp, "f1", b"hello world").await;

        assert!(
            !svc.needs_upload(&p).await.unwrap(),
            "файл совпадает с baseline — заливать нечего"
        );

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[tokio::test]
    async fn изменённый_локально_файл_заливается() {
        let tmp = tmpdir("modified");
        let svc = service(None, &tmp).await;
        let p = seed_hydrated(&svc, &tmp, "f1", b"hello world").await;

        // Перерендер в тот же путь: размер другой → расхождение с baseline.
        std::fs::write(&p, "совсем другое содержимое".as_bytes()).unwrap();
        assert!(svc.needs_upload(&p).await.unwrap());

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[tokio::test]
    async fn незнакомый_каталогу_файл_заливается() {
        let tmp = tmpdir("localonly");
        let svc = service(None, &tmp).await;

        let p = mpath(&tmp, "OUT", "новый.mov");
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(&p, b"result").unwrap();

        assert!(
            svc.needs_upload(&p).await.unwrap(),
            "в каталоге записи нет — это LocalOnly, его надо залить"
        );

        let _ = std::fs::remove_dir_all(&tmp);
    }

    /// Пайплайн перезаписал облачный файл, ни разу его не скачав: запись в
    /// каталоге есть, локальной копии никогда не было. Это НАША новая версия, и
    /// пропустить её значило бы потерять результат обработки.
    #[tokio::test]
    async fn известный_файл_без_локальной_копии_заливается() {
        let tmp = tmpdir("nobaseline");
        let svc = service(None, &tmp).await;

        let p = mpath(&tmp, "IN", "a.mov"); // f1 есть в каталоге, local_state пуст
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(&p, "перезаписали заново".as_bytes()).unwrap();

        assert!(svc.needs_upload(&p).await.unwrap());

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[tokio::test]
    async fn пути_вне_зеркала_в_очередь_не_попадают() {
        let tmp = tmpdir("markdirty");
        let svc = service(None, &tmp).await;

        let inside = mpath(&tmp, "OUT", "результат.mov");
        let outside = PathBuf::from("/Users/x/Work/локальный.mov");
        let accepted = svc.mark_dirty(&[inside, outside], true);

        assert_eq!(accepted, 1, "чужой путь заливать некуда");
        assert_eq!(svc.pending_len(), 1);

        let _ = std::fs::remove_dir_all(&tmp);
    }

    /// Кандидат, помеченный явно, обязан отдаваться с первого осмотра: раннер
    /// знает про готовность файла точно, и ждать затишья тут — потерянное время.
    #[tokio::test]
    async fn явный_кандидат_отдаётся_сразу() {
        let tmp = tmpdir("candidates");
        let svc = service(None, &tmp).await;

        let p = mpath(&tmp, "OUT", "готов.mov");
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(&p, b"result").unwrap();

        svc.mark_dirty(&[p.clone()], true);
        let ready = svc.take_upload_candidates(2, 10);
        assert_eq!(ready, vec![p]);
        assert_eq!(svc.pending_len(), 0, "отданный кандидат не должен заливаться дважды");

        let _ = std::fs::remove_dir_all(&tmp);
    }

    /// Отключение обязано снимать слежку: корень зеркала при следующем
    /// подключении может быть другим, а слежка за прошлой папкой выглядит
    /// работающей и не видит ни одного файла.
    #[tokio::test]
    async fn отключение_снимает_слежку_и_чистит_очередь() {
        let tmp = tmpdir("detach");
        let svc = service(None, &tmp).await;
        assert!(svc.is_watching(), "при подключении слежка должна подняться");

        let p = mpath(&tmp, "OUT", "x.mov");
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(&p, b"x").unwrap();
        svc.mark_dirty(&[p], true);

        svc.detach().await;
        assert!(!svc.is_watching());
        assert_eq!(svc.pending_len(), 0);

        let _ = std::fs::remove_dir_all(&tmp);
    }

    // ─── Вытеснение ──────────────────────────────────────────────────────────

    /// Кладёт на диск файл и отмечает его синхронизированным `age_hours` назад.
    async fn seed_local(
        svc: &StorageService,
        tmp: &Path,
        file_id: &str,
        folder: &str,
        name: &str,
        size: usize,
        age_hours: i64,
    ) -> PathBuf {
        let p = mpath(tmp, folder, name);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(&p, vec![b'x'; size]).unwrap();

        let path_s = p.to_string_lossy().to_string();
        let id = file_id.to_string();
        svc.with_sync(move |s| {
            s.index
                .mark_synced(&id, "Fresh", &path_s, size as i64, 1, Some("e1"))?;
            // Отодвигаем последнее обращение в прошлое.
            s.index.conn_for_test().execute(
                "UPDATE local_state SET last_access = ?2 WHERE file_id = ?1",
                rusqlite::params![id, now_sec() - age_hours * 3600],
            ).map_err(|e| e.to_string())?;
            Ok(())
        })
        .await
        .unwrap();
        p
    }

    /// Дерево с четырьмя файлами: два в IN, один в options, один в OUT.
    async fn service_for_evict(tmp: &Path) -> StorageService {
        let mut trees = Map::new();
        trees.insert(
            "p1".to_string(),
            vec![
                entry("f1", "IN", "старый.mov", 100),
                entry("f2", "IN", "свежий.mov", 100),
                entry("f3", "options", "folderState.json", 10),
                entry("f4", "OUT", "результат.mov", 100),
            ],
        );
        let mock = MockApi::new(MockState {
            trees,
            projects: demo_projects(),
            ..Default::default()
        });
        let idx = Index::open_in_memory().unwrap();
        let mut sync = Sync::new(Provider::Mock(mock), idx);
        // Список проектов — ДО bootstrap: из него строится раскладка зеркала
        // (`<Клиент>/<Проект>`), и без неё ни один путь не разберётся.
        sync.refresh_projects().await.unwrap();
        sync.bootstrap("p1").await.unwrap();
        let svc = StorageService::new();
        svc.attach(sync, tmp.to_path_buf()).await;
        svc
    }

    fn policy(ttl_hours: u32, max_bytes: Option<i64>) -> crate::storage::EvictionPolicy {
        crate::storage::EvictionPolicy {
            ttl_hours,
            max_bytes,
            hot_patterns: vec!["options/*.json".into()],
        }
    }

    #[tokio::test]
    async fn по_ttl_удаляет_старое_и_оставляет_свежее() {
        let tmp = tmpdir("evict-ttl");
        let svc = service_for_evict(&tmp).await;
        let old = seed_local(&svc, &tmp, "f1", "IN", "старый.mov", 100, 10).await;
        let new = seed_local(&svc, &tmp, "f2", "IN", "свежий.mov", 100, 1).await;

        let r = svc.run_eviction(policy(4, None)).await.unwrap();

        assert_eq!(r.evicted, 1);
        assert_eq!(r.freed_bytes, 100);
        assert!(!old.exists(), "старый файл должен быть удалён");
        assert!(new.exists(), "свежий — остаться");

        // И состояние вернулось в «только в облаке».
        let st = svc
            .with_sync(|s| s.index.local_state("f1"))
            .await
            .unwrap()
            .map(|(st, _)| st);
        assert_eq!(st.as_deref(), Some("Cloud"));

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[tokio::test]
    async fn горячий_сайдкар_не_вытесняется_никогда() {
        let tmp = tmpdir("evict-hot");
        let svc = service_for_evict(&tmp).await;
        let hot = seed_local(&svc, &tmp, "f3", "options", "folderState.json", 10, 10_000).await;

        let r = svc.run_eviction(policy(4, Some(0))).await.unwrap();

        assert_eq!(r.kept_hot, 1);
        assert!(
            hot.exists(),
            "сайдкары читаются постоянно — гонять их через гидрацию бессмысленно"
        );

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[tokio::test]
    async fn незалитый_результат_не_вытесняется_под_давлением() {
        let tmp = tmpdir("evict-unsafe");
        let svc = service_for_evict(&tmp).await;
        let out = seed_local(&svc, &tmp, "f4", "OUT", "результат.mov", 100, 10_000).await;
        // Пайплайн положил результат, залить ещё не успели.
        svc.with_sync(|s| s.index.set_state("f4", "LocalOnly", None))
            .await
            .unwrap();

        // Лимит 0 байт — максимальное давление, TTL давно вышел.
        let r = svc.run_eviction(policy(1, Some(0))).await.unwrap();

        assert_eq!(r.evicted, 0);
        assert_eq!(r.kept_unsafe, 1);
        assert!(
            out.exists(),
            "это единственная копия — удалить её значит потерять работу"
        );

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[tokio::test]
    async fn давление_снимается_и_останавливается() {
        let tmp = tmpdir("evict-pressure");
        let svc = service_for_evict(&tmp).await;
        // Три файла по 100 байт, разного возраста. TTL не истёк ни у одного.
        seed_local(&svc, &tmp, "f1", "IN", "старый.mov", 100, 3).await;
        seed_local(&svc, &tmp, "f2", "IN", "свежий.mov", 100, 2).await;
        let newest = seed_local(&svc, &tmp, "f4", "OUT", "результат.mov", 100, 1).await;

        // Бюджет 150 байт: надо освободить хотя бы 150, то есть два файла.
        let r = svc.run_eviction(policy(24, Some(150))).await.unwrap();

        assert_eq!(r.evicted, 2, "освободили ровно столько, сколько нужно");
        assert!(
            newest.exists(),
            "давление снимается с самых холодных, самый свежий должен остаться"
        );

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[tokio::test]
    async fn пропавший_файл_не_ломает_прогон() {
        let tmp = tmpdir("evict-ghost");
        let svc = service_for_evict(&tmp).await;
        let p = seed_local(&svc, &tmp, "f1", "IN", "старый.mov", 100, 10).await;
        // Удалили руками мимо программы.
        std::fs::remove_file(&p).unwrap();

        let r = svc.run_eviction(policy(4, None)).await.unwrap();

        assert_eq!(r.evicted, 1, "запись всё равно надо привести в порядок");
        let st = svc
            .with_sync(|s| s.index.local_state("f1"))
            .await
            .unwrap()
            .map(|(st, _)| st);
        assert_eq!(st.as_deref(), Some("Cloud"), "иначе останется вечный призрак");

        let _ = std::fs::remove_dir_all(&tmp);
    }

    /// Сервис БЕЗ предварительного bootstrap: каталог по проекту пуст.
    async fn service_no_tree(tmp: &Path) -> StorageService {
        let mut trees = Map::new();
        trees.insert(
            "p1".to_string(),
            vec![
                dir_entry("d1", "", "IN"),
                entry("f1", "IN", "a.mov", 11),
                entry("f2", "", "options.json", 4),
            ],
        );
        let mock = MockApi::new(MockState {
            trees,
            projects: demo_projects(),
            ..Default::default()
        });
        let idx = Index::open_in_memory().unwrap();
        let mut sync = Sync::new(Provider::Mock(mock), idx);
        sync.refresh_projects().await.unwrap();
        let svc = StorageService::new();
        svc.attach(sync, tmp.to_path_buf()).await;
        svc
    }

    #[tokio::test]
    async fn листинг_сам_тянет_дерево_проекта() {
        // Раньше дерево подтягивала отдельная онлайн-колонка. Её больше нет, и без
        // этого папка проекта выглядела бы ПУСТОЙ при полном хранилище — ровно тот
        // баг, который видно глазами и не видно тестам на индексе.
        let tmp = tmpdir("browse-bootstrap");
        let svc = service_no_tree(&tmp).await;

        let project = tmp.join("Клиент").join("Проект");
        let rows = svc.browse(&project.to_string_lossy()).await.unwrap().unwrap();

        let names: Vec<&str> = rows.iter().map(|r| r.name.as_str()).collect();
        assert!(names.contains(&"IN"), "не увидели папку IN: {names:?}");
        assert!(names.contains(&"options.json"), "не увидели файл в корне: {names:?}");

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[tokio::test]
    async fn уровни_зеркала_листаются() {
        let tmp = tmpdir("browse-levels");
        let svc = service_no_tree(&tmp).await;

        // Корень — клиенты.
        let root = svc.browse(&tmp.to_string_lossy()).await.unwrap().unwrap();
        assert_eq!(root.len(), 1);
        assert_eq!(root[0].name, "Клиент");
        assert!(root[0].is_dir);

        // Папка клиента — проекты.
        let client = svc.browse(&root[0].path).await.unwrap().unwrap();
        assert_eq!(client.len(), 1);
        assert_eq!(client[0].name, "Проект");

        // Не наш путь — `None`, чтобы колонка пошла на диск как раньше.
        assert!(svc.browse("/Users/x/Work").await.unwrap().is_none());

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[tokio::test]
    async fn файл_с_диска_виден_даже_если_каталог_о_нём_не_знает() {
        // Результат обработки в OUT: файл есть, но ещё не залит. Не показать его
        // значит спрятать от человека то, что он только что сделал.
        let tmp = tmpdir("browse-local-only");
        let svc = service_no_tree(&tmp).await;

        let inbox = tmp.join("Клиент").join("Проект").join("IN");
        std::fs::create_dir_all(&inbox).unwrap();
        std::fs::write(inbox.join("свой.mov"), b"x").unwrap();
        // Огрызок незавершённой закачки показывать нельзя.
        std::fs::write(inbox.join("качается.mov.part"), b"x").unwrap();

        let rows = svc.browse(&inbox.to_string_lossy()).await.unwrap().unwrap();
        let names: Vec<&str> = rows.iter().map(|r| r.name.as_str()).collect();
        assert!(names.contains(&"a.mov"), "запись каталога пропала: {names:?}");
        assert!(names.contains(&"свой.mov"), "локальный файл не показан: {names:?}");
        assert!(!names.iter().any(|n| n.ends_with(".part")), "показали огрызок: {names:?}");

        let own = rows.iter().find(|r| r.name == "свой.mov").unwrap();
        assert_eq!(own.state, Some(super::super::FileState::LocalOnly));

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[tokio::test]
    async fn папка_создаётся_по_требованию_а_не_сама() {
        // Структура видна из каталога и без диска, поэтому создавать её целиком
        // незачем. Папка нужна физически ровно тогда, когда её открывают в Finder
        // или в неё кладут файл.
        let tmp = tmpdir("ensure-dir");
        let svc = service_no_tree(&tmp).await;
        let inbox = tmp.join("Клиент").join("Проект").join("IN");

        // Просмотр структуры сам по себе диск не трогает.
        let rows = svc
            .browse(&tmp.join("Клиент").join("Проект").to_string_lossy())
            .await
            .unwrap()
            .unwrap();
        assert!(rows.iter().any(|r| r.name == "IN"), "IN не виден в структуре");
        assert!(!inbox.exists(), "папку создали, хотя не просили");

        assert!(svc.ensure_dir(&inbox).await.unwrap());
        assert!(inbox.is_dir(), "папка не создана по требованию");

        // Путь мимо каталога создавать нельзя: намусорить в зеркале — значит
        // однажды принять этот мусор за данные.
        let bogus = tmp.join("Неизвестный").join("Проект");
        assert!(svc.ensure_dir(&bogus).await.is_err());
        assert!(!bogus.exists());

        // Вне зеркала — не наша забота, молча `false`.
        assert!(!svc.ensure_dir(Path::new("/Users/x/Work")).await.unwrap());

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[tokio::test]
    async fn положенный_руками_файл_попадает_в_очередь_заливки() {
        // `detect_local_changes` видит только правки известных файлов. Новый файл
        // каталогу неизвестен, и без отдельного обхода он остался бы лежать
        // локально навсегда — «положил в папку, а оно никуда не уехало».
        let tmp = tmpdir("pending");
        let svc = service_no_tree(&tmp).await;
        let project = tmp.join("Клиент").join("Проект");
        let _ = svc.browse(&project.to_string_lossy()).await.unwrap();
        svc.ensure_dir(&project.join("IN")).await.unwrap();

        let mine = project.join("IN").join("моё видео.mov");
        std::fs::write(&mine, b"data").unwrap();
        // Огрызок и скрытый файл в очередь попадать не должны.
        std::fs::write(project.join("IN").join("качается.mov.part"), b"x").unwrap();
        std::fs::write(project.join("IN").join(".DS_Store"), b"x").unwrap();

        let pending = svc.pending_uploads(10).await.unwrap();
        let names: Vec<String> = pending
            .iter()
            .map(|p| p.file_name().unwrap().to_string_lossy().to_string())
            .collect();

        assert!(names.contains(&"моё видео.mov".to_string()), "не нашли новый файл: {names:?}");
        assert!(!names.iter().any(|n| n.ends_with(".part")), "огрызок в очереди: {names:?}");
        assert!(!names.iter().any(|n| n.starts_with('.')), "скрытый файл в очереди: {names:?}");

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[tokio::test]
    async fn уже_известный_файл_повторно_не_заливается() {
        // Скачанный файл лежит на диске и есть в каталоге — он не «новый».
        // Иначе синхронизатор гонял бы его в облако по кругу на каждом тике.
        let tmp = tmpdir("pending-known");
        let svc = service_no_tree(&tmp).await;
        let project = tmp.join("Клиент").join("Проект");
        let _ = svc.browse(&project.to_string_lossy()).await.unwrap();
        svc.ensure_dir(&project).await.unwrap();

        std::fs::write(project.join("options.json"), b"{}").unwrap();
        let pending = svc.pending_uploads(10).await.unwrap();
        assert!(
            !pending.iter().any(|p| p.ends_with("options.json")),
            "файл из каталога попал в очередь заливки: {pending:?}"
        );

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[tokio::test]
    async fn отключение_отпускает_клиент_но_не_трогает_файлы() {
        // Отключение — это «клиент больше не работает», а не «сотри всё». Локальные
        // копии принадлежат человеку, и терять их при выходе из демо недопустимо.
        let tmp = tmpdir("detach");
        let srv = spawn_server(b"hello world".to_vec()).await;
        let svc = service(Some(&srv.addr), &tmp).await;

        let target = mpath(&tmp, "IN", "a.mov");
        svc.ensure_local(&target).await.unwrap();
        assert!(target.exists());

        svc.detach().await;
        assert!(!svc.is_attached().await, "клиент остался поднятым");
        assert!(target.exists(), "отключение удалило локальный файл");

        // Шов обязан стать no-op: корня зеркала больше нет, и под ним нет ничего.
        let r = svc.ensure_local(&target).await.unwrap();
        assert_eq!(r.outcome, EnsureOutcome::NotInMirror);
        // Листинг тоже больше не наш — колонка должна читать диск как обычно.
        assert!(svc.browse(&tmp.to_string_lossy()).await.unwrap().is_none());

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[tokio::test]
    async fn удалить_копию_можно_только_синхронизированную() {
        // Кнопка «удалить локальную копию» не должна становиться кнопкой «потерять
        // работу»: незалитые байты существуют только здесь.
        let tmp = tmpdir("drop-local");
        let srv = spawn_server(b"hello world".to_vec()).await;
        let svc = service(Some(&srv.addr), &tmp).await;

        let target = mpath(&tmp, "IN", "a.mov");
        svc.ensure_local(&target).await.unwrap();
        assert!(target.exists());

        // Синхронизированная копия видна в списке и удаляется.
        let list = svc.local_files().await.unwrap();
        assert_eq!(list.len(), 1, "ожидали одну локальную копию: {list:?}");
        assert_eq!(list[0].name, "a.mov");
        assert!(list[0].project.contains("Клиент"), "не подставлен проект: {:?}", list[0].project);

        let freed = svc.drop_local("f1").await.unwrap();
        assert_eq!(freed, 11);
        assert!(!target.exists(), "файл остался на диске");
        assert!(svc.local_files().await.unwrap().is_empty());

        // И качается заново — то есть удаление не сломало состояние.
        let r = svc.ensure_local(&target).await.unwrap();
        assert_eq!(r.outcome, EnsureOutcome::Downloaded);

        // А вот правленную руками копию удалять нельзя.
        std::fs::write(&target, "моя работа".as_bytes()).unwrap();
        svc.detect_local_changes().await.unwrap();
        let err = svc.drop_local("f1").await.unwrap_err();
        assert!(err.contains("не синхронизирована"), "получили: {err}");
        assert!(target.exists(), "удалили несохранённую работу");
        // И в списке её тоже нет — предлагать удаление было бы ловушкой.
        assert!(svc.local_files().await.unwrap().is_empty());

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[tokio::test]
    async fn неопознанный_путь_в_зеркале_ругается_а_не_молчит() {
        // Переименовали проект на сайте — путь перестал узнаваться. Если ответить
        // «не в зеркале», файл не скачается МОЛЧА, и обработка получит путь к
        // несуществующему файлу. Ошибка обязана быть громкой.
        let tmp = tmpdir("unknown-path");
        let svc = service(None, &tmp).await;

        let stale = tmp.join("Старый клиент").join("Старый проект").join("IN").join("a.mov");
        let err = svc.ensure_local(&stale).await.unwrap_err();
        assert!(err.contains("не опознан"), "получили: {err}");

        // А сама папка проекта — законное «не файл», без всякой ругани.
        let dir = tmp.join("Клиент").join("Проект");
        let r = svc.ensure_local(&dir).await.unwrap();
        assert_eq!(r.outcome, EnsureOutcome::NotInMirror);

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[tokio::test]
    async fn после_вытеснения_файл_качается_заново_а_не_считается_изменённым() {
        let tmp = tmpdir("evict-rehydrate");
        let srv = spawn_server(b"hello world".to_vec()).await;
        let mut trees = Map::new();
        trees.insert("p1".to_string(), vec![entry("f1", "IN", "a.mov", 11)]);
        let mock = MockApi::new(MockState {
            trees,
            projects: demo_projects(),
            presign_base: Some(srv.addr.clone()),
            ..Default::default()
        });
        let idx = Index::open_in_memory().unwrap();
        let mut sync = Sync::new(Provider::Mock(mock), idx);
        // Список проектов — ДО bootstrap: из него строится раскладка зеркала
        // (`<Клиент>/<Проект>`), и без неё ни один путь не разберётся.
        sync.refresh_projects().await.unwrap();
        sync.bootstrap("p1").await.unwrap();
        let svc = StorageService::new();
        svc.attach(sync, tmp.to_path_buf()).await;

        let target = mpath(&tmp, "IN", "a.mov");
        svc.ensure_local(&target).await.unwrap();

        // Состарим и вытесним.
        svc.with_sync(|s| {
            s.index
                .conn_for_test()
                .execute(
                    "UPDATE local_state SET last_access = ?1 WHERE file_id = 'f1'",
                    rusqlite::params![now_sec() - 100 * 3600],
                )
                .map_err(|e| e.to_string())?;
            Ok(())
        })
        .await
        .unwrap();
        svc.run_eviction(policy(4, None)).await.unwrap();
        assert!(!target.exists());

        // Ключевое: baseline обнулён, поэтому файл — снова Cloud, а не «изменён локально».
        let r = svc.ensure_local(&target).await.unwrap();
        assert_eq!(r.outcome, EnsureOutcome::Downloaded);
        assert_eq!(srv.hits.load(Ordering::SeqCst), 2);

        let _ = std::fs::remove_dir_all(&tmp);
    }

    // ─── Копирование «переписать устаревший» ─────────────────────────────────

    #[tokio::test]
    async fn копирует_когда_на_месте_ничего_нет() {
        let tmp = tmpdir("copy-new");
        let srv = spawn_server(b"hello world".to_vec()).await;
        let svc = service(Some(&srv.addr), &tmp).await;

        let src = mpath(&tmp, "IN", "a.mov");
        let dest = tmp.join("work").join("a.mov");

        let r = svc.copy_from_mirror(&src, &dest, true).await.unwrap();
        assert_eq!(r.action, CopyAction::Copied);
        assert!(r.hydrated, "источника локально не было — качаем");
        assert_eq!(std::fs::read_to_string(&dest).unwrap(), "hello world");

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[tokio::test]
    async fn без_разрешения_на_перезапись_не_трогает_существующее() {
        let tmp = tmpdir("copy-noover");
        let srv = spawn_server(b"hello world".to_vec()).await;
        let svc = service(Some(&srv.addr), &tmp).await;

        let src = mpath(&tmp, "IN", "a.mov");
        let dest = tmp.join("work").join("a.mov");
        std::fs::create_dir_all(dest.parent().unwrap()).unwrap();
        std::fs::write(&dest, "моё".as_bytes()).unwrap();

        let r = svc.copy_from_mirror(&src, &dest, false).await.unwrap();
        assert_eq!(r.action, CopyAction::SkippedExists);
        assert_eq!(std::fs::read_to_string(&dest).unwrap(), "моё");
        assert_eq!(srv.hits.load(Ordering::SeqCst), 0, "и ничего не качали");

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[tokio::test]
    async fn неизменившийся_источник_не_качается_даже_после_вытеснения() {
        // Ровно тот случай, ради которого всё это: копия в рабочей папке жива,
        // зеркальная копия вытеснена, источник не менялся — качать нечего.
        let tmp = tmpdir("copy-evicted");
        let srv = spawn_server(b"hello world".to_vec()).await;
        let svc = service(Some(&srv.addr), &tmp).await;

        let src = mpath(&tmp, "IN", "a.mov");
        let dest = tmp.join("work").join("a.mov");

        // Первый виток: скачали и скопировали.
        let r1 = svc.copy_from_mirror(&src, &dest, true).await.unwrap();
        assert_eq!(r1.action, CopyAction::Copied);
        let after_first = srv.hits.load(Ordering::SeqCst);

        // Зеркальная копия вытеснена (4 часа прошли).
        svc.with_sync(|s| {
            s.index
                .conn_for_test()
                .execute(
                    "UPDATE local_state SET last_access = ?1 WHERE file_id = 'f1'",
                    rusqlite::params![now_sec() - 100 * 3600],
                )
                .map_err(|e| e.to_string())?;
            Ok(())
        })
        .await
        .unwrap();
        svc.run_eviction(policy(4, None)).await.unwrap();
        assert!(!src.exists(), "зеркальной копии больше нет");

        // Второй виток: источник не менялся.
        let r2 = svc.copy_from_mirror(&src, &dest, true).await.unwrap();
        assert_eq!(r2.action, CopyAction::SkippedUpToDate);
        assert!(!r2.hydrated);
        assert_eq!(
            srv.hits.load(Ordering::SeqCst),
            after_first,
            "ни одного лишнего байта по сети"
        );

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[tokio::test]
    async fn изменившийся_в_облаке_источник_перекопируется() {
        let tmp = tmpdir("copy-changed");
        let srv = spawn_server(b"hello world".to_vec()).await;
        let svc = service(Some(&srv.addr), &tmp).await;

        let src = mpath(&tmp, "IN", "a.mov");
        let dest = tmp.join("work").join("a.mov");
        svc.copy_from_mirror(&src, &dest, true).await.unwrap();

        // В облаке файл перезалили: etag изменился.
        svc.with_sync(|s| {
            s.index
                .conn_for_test()
                .execute(
                    "UPDATE remote_entries SET etag = 'e2' WHERE file_id = 'f1'",
                    [],
                )
                .map_err(|e| e.to_string())?;
            Ok(())
        })
        .await
        .unwrap();

        let r = svc.copy_from_mirror(&src, &dest, true).await.unwrap();
        assert_eq!(r.action, CopyAction::Copied, "версия другая — надо обновить");

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[tokio::test]
    async fn локальный_источник_сравнивается_по_mtime_как_раньше() {
        // Поведение вне зеркала не должно измениться: чисто локальные пайплайны
        // работают как до появления облака.
        let tmp = tmpdir("copy-local");
        // ВАЖНО: источник должен лежать ВНЕ корня зеркала — иначе он попадёт под
        // облачную ветку и сравнение пойдёт по версии, а не по mtime.
        let outside = tmpdir("copy-local-src");
        let svc = service(None, &tmp).await;

        let src = outside.join("a.mov");
        let dest = tmp.join("work").join("a.mov");
        std::fs::create_dir_all(src.parent().unwrap()).unwrap();
        std::fs::create_dir_all(dest.parent().unwrap()).unwrap();
        std::fs::write(&src, "источник".as_bytes()).unwrap();
        std::fs::write(&dest, "копия".as_bytes()).unwrap();

        // dest создан позже → источник не новее → копировать не надо.
        let r = svc.copy_from_mirror(&src, &dest, true).await.unwrap();
        assert_eq!(r.action, CopyAction::SkippedUpToDate);

        // Трогаем источник — теперь он новее.
        let later = std::time::SystemTime::now() + std::time::Duration::from_secs(10);
        filetime::set_file_mtime(&src, filetime::FileTime::from_system_time(later)).unwrap();
        let r = svc.copy_from_mirror(&src, &dest, true).await.unwrap();
        assert_eq!(r.action, CopyAction::Copied);

        let _ = std::fs::remove_dir_all(&tmp);
        let _ = std::fs::remove_dir_all(&outside);
    }

    #[tokio::test]
    async fn копия_неизвестного_происхождения_считается_устаревшей() {
        // Скопировали руками или до внедрения: записи о версии нет. Безопасный
        // выбор — перекопировать, а не поверить на слово.
        let tmp = tmpdir("copy-unknown");
        let srv = spawn_server(b"hello world".to_vec()).await;
        let svc = service(Some(&srv.addr), &tmp).await;

        let src = mpath(&tmp, "IN", "a.mov");
        let dest = tmp.join("work").join("a.mov");
        std::fs::create_dir_all(dest.parent().unwrap()).unwrap();
        std::fs::write(&dest, "неизвестно откуда".as_bytes()).unwrap();

        let r = svc.copy_from_mirror(&src, &dest, true).await.unwrap();
        assert_eq!(r.action, CopyAction::Copied);

        let _ = std::fs::remove_dir_all(&tmp);
    }

    // ─── Обнаружение локальных правок ────────────────────────────────────────

    #[tokio::test]
    async fn правка_локальной_копии_обнаруживается() {
        let tmp = tmpdir("detect-edit");
        let srv = spawn_server(b"hello world".to_vec()).await;
        let svc = service(Some(&srv.addr), &tmp).await;
        let target = mpath(&tmp, "IN", "a.mov");

        svc.ensure_local(&target).await.unwrap();
        assert_eq!(
            svc.with_sync(|s| s.index.badge_state("f1")).await.unwrap().unwrap().state,
            FileState::Fresh
        );

        // Правим файл руками.
        std::fs::write(&target, "изменённое содержимое".as_bytes()).unwrap();
        let st = svc.detect_local_change("f1").await.unwrap();
        assert_eq!(st, Some(FileState::LocalModified));

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[tokio::test]
    async fn правку_не_затирают_повторной_гидрацией() {
        // Главное свойство: без обнаружения `ensure_local` спокойно скачал бы
        // файл поверх ручной правки, и работа исчезла бы молча.
        let tmp = tmpdir("detect-noclobber");
        let srv = spawn_server(b"hello world".to_vec()).await;
        let svc = service(Some(&srv.addr), &tmp).await;
        let target = mpath(&tmp, "IN", "a.mov");

        svc.ensure_local(&target).await.unwrap();
        std::fs::write(&target, "моя правка".as_bytes()).unwrap();
        let hits_before = srv.hits.load(Ordering::SeqCst);

        let r = svc.ensure_local(&target).await.unwrap();

        assert_eq!(r.outcome, EnsureOutcome::LocalOnly, "качать поверх нельзя");
        assert_eq!(srv.hits.load(Ordering::SeqCst), hits_before, "и не качали");
        assert_eq!(
            std::fs::read_to_string(&target).unwrap(),
            "моя правка",
            "содержимое должно остаться моим"
        );

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[tokio::test]
    async fn удаление_мимо_программы_возвращает_в_облако() {
        let tmp = tmpdir("detect-gone");
        let srv = spawn_server(b"hello world".to_vec()).await;
        let svc = service(Some(&srv.addr), &tmp).await;
        let target = mpath(&tmp, "IN", "a.mov");

        svc.ensure_local(&target).await.unwrap();
        std::fs::remove_file(&target).unwrap();

        let st = svc.detect_local_change("f1").await.unwrap();
        assert_eq!(st, Some(FileState::Cloud));

        // Baseline обнулён, поэтому следующий раз файл именно КАЧАЕТСЯ, а не
        // считается «локально изменённым».
        let r = svc.ensure_local(&target).await.unwrap();
        assert_eq!(r.outcome, EnsureOutcome::Downloaded);

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[tokio::test]
    async fn идущая_передача_не_трогается() {
        // Вмешиваться в середину передачи — верный способ получить рассинхрон.
        let tmp = tmpdir("detect-inflight");
        let srv = spawn_server(b"hello world".to_vec()).await;
        let svc = service(Some(&srv.addr), &tmp).await;
        let target = mpath(&tmp, "IN", "a.mov");
        svc.ensure_local(&target).await.unwrap();

        svc.with_sync(|s| s.index.set_state("f1", "Downloading", None))
            .await
            .unwrap();
        std::fs::write(&target, "недокачанное".as_bytes()).unwrap();

        assert_eq!(svc.detect_local_change("f1").await.unwrap(), None);

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[tokio::test]
    async fn массовая_сверка_считает_изменённые() {
        let tmp = tmpdir("detect-bulk");
        let srv = spawn_server(b"hello world".to_vec()).await;
        let svc = service(Some(&srv.addr), &tmp).await;

        let a = mpath(&tmp, "IN", "a.mov");
        svc.ensure_local(&a).await.unwrap();
        assert_eq!(svc.detect_local_changes().await.unwrap(), 0);

        std::fs::write(&a, "правка".as_bytes()).unwrap();
        assert_eq!(svc.detect_local_changes().await.unwrap(), 1);

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[tokio::test]
    async fn отмена_прерывает_передачу_и_убирает_огрызок() {
        let tmp = tmpdir("cancel");
        // Медленный сервер: отдаёт тело по кускам с паузами, чтобы успеть отменить.
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = format!("http://{}", listener.local_addr().unwrap());
        tokio::spawn(async move {
            while let Ok((mut sock, _)) = listener.accept().await {
                tokio::spawn(async move {
                    let mut buf = [0u8; 1024];
                    let _ = sock.read(&mut buf).await;
                    let total = 1_000_000usize;
                    let head = format!(
                        "HTTP/1.1 200 OK\r\nContent-Length: {total}\r\nConnection: close\r\n\r\n"
                    );
                    let _ = sock.write_all(head.as_bytes()).await;
                    for _ in 0..100 {
                        if sock.write_all(&vec![b'x'; 10_000]).await.is_err() {
                            return;
                        }
                        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
                    }
                });
            }
        });

        let svc = Arc::new(service(Some(&addr), &tmp).await);
        let target = mpath(&tmp, "IN", "a.mov");

        let s2 = svc.clone();
        let t2 = target.clone();
        let job = tokio::spawn(async move { s2.ensure_local(&t2).await });

        // Дать передаче начаться, затем отменить.
        tokio::time::sleep(std::time::Duration::from_millis(120)).await;
        let list = svc.transfers(10).await.unwrap();
        let active = list.iter().find(|t| t.state == "active" || t.state == "queued");
        if let Some(t) = active {
            svc.cancel_transfer(t.id).await.unwrap();
        }

        let res = job.await.unwrap();
        assert!(res.is_err(), "отменённая передача обязана вернуть ошибку");
        assert!(!target.exists(), "целевого файла быть не должно");
        assert!(
            !paths::part_path(&target).exists(),
            "недокачанный .part надо убрать, иначе он останется мусором навсегда"
        );

        let _ = std::fs::remove_dir_all(&tmp);
    }
}
