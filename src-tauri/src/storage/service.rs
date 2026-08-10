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
            {
                let mut guard = state.sync_mut().await;
                let s = guard
                    .as_mut()
                    .ok_or_else(|| "Хранилище не подключено".to_string())?;
                if s.index.tree_at(&project_id)?.is_none() {
                    s.bootstrap(&project_id).await.map_err(|e| e.to_string())?;
                }
            }

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
                            });
                        }
                    }
                    Ok(out)
                })
                .await?;

            Ok(Some(merge_local_only(&p, entries)))
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
fn merge_local_only(dir: &std::path::Path, mut entries: Vec<BrowseEntry>) -> Vec<BrowseEntry> {
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
            entries.push(BrowseEntry {
                name,
                path: de.path().to_string_lossy().to_string(),
                is_dir,
                size_bytes: de.metadata().ok().map(|m| m.len() as i64),
                file_id: None,
                // Файла нет в каталоге — значит он только здесь и его надо залить.
                state: if is_dir { None } else { Some(super::FileState::LocalOnly) },
                aggregate: None,
                pinned: false,
                progress: None,
                error: None,
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
            http: reqwest::Client::new(),
        }
    }

    pub async fn attach(&self, sync: Sync, mirror_root: PathBuf) {
        *self.provider.lock().unwrap() = Some(sync.provider.clone());
        *self.mirror_root.lock().unwrap() = mirror_root;
        // Карту строим ДО передачи `sync` внутрь: без неё ни один путь в зеркале
        // не разберётся, и первое же обращение ушло бы мимо каталога.
        Self::build_dirs_into(&self.dirs, &sync);
        *self.sync.lock().await = Some(sync);
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
    }

    fn build_dirs_into(slot: &StdMutex<super::layout::MirrorDirs>, sync: &Sync) {
        let clients = sync.index.clients().unwrap_or_default();
        let projects = sync.index.projects(None).unwrap_or_default();
        *slot.lock().unwrap() = super::layout::MirrorDirs::build(&clients, &projects);
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
    pub file_id: String,
    pub s3_key: String,
    pub bytes: i64,
    pub strategy: super::upload::UploadStrategy,
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

        let project_id = loc.project_id.clone();
        let local = path.to_string_lossy().to_string();
        let transfer_id = self
            .with_sync(move |s| {
                s.index
                    .enqueue_transfer(None, &project_id, "up", &local, Some(size))
            })
            .await?;

        let out = self
            .single_put_inner(&provider, loc, path, size, content_type, &sha, mtime, transfer_id)
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

        let res = self
            .http
            .put(&presigned.url)
            .header("Content-Type", content_type)
            .header("Content-Length", size.to_string())
            .body(reqwest::Body::wrap_stream(stream))
            .send()
            .await
            .map_err(|e| format!("PUT: {e}"))?;

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
                }
            }
        }

        Ok(report)
    }
}

fn now_sec() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
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

    /// Клиент и проект, из которых складывается раскладка зеркала в тестах.
    fn demo_projects() -> crate::storage::ProjectsResponse {
        crate::storage::ProjectsResponse {
            clients: vec![crate::storage::RemoteClient {
                id: "c1".into(),
                display_name: "Клиент".into(),
            }],
            projects: vec![crate::storage::RemoteProject {
                id: "p1".into(),
                name: "Проект".into(),
                client_id: Some("c1".into()),
                group_name: "personal".into(),
                is_active: true,
                is_paused: false,
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
            s3_key: Some(format!("innohub/projects/p1/{folder}/uuid-{name}")),
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
