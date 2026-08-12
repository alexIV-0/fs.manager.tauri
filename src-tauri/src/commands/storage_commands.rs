// IPC-поверхность клиента хранилища. Тонкий слой: разобрал аргументы, позвал
// `storage::*`, вернул результат. Логики здесь нет.
//
// Состояние держим в `tokio::sync::Mutex`, а не в `std`: команды асинхронные, и
// std-гвард нельзя протащить через `.await` — фьючер перестанет быть `Send`.

use serde::Serialize;
use tauri::{Manager, State};

use crate::storage::config::{self, ConnectionConfig};
use crate::storage::{
    CopyReport, EnsureResult, EvictionPolicy, EvictionReport, UploadResult, FileState, FolderAggregate, Index, MockApi, Provider, StorageApi,
    StorageConfig, StorageService, Sync,
};

/// Одна строка списка: всё, что нужно нарисовать, одним запросом.
///
/// Специально не заставляем renderer звать значок на каждую строку отдельно —
/// иначе на папке в тысячу файлов получим тысячу IPC-вызовов.
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct StorageDirEntry {
    pub file_id: String,
    pub name: String,
    pub folder_path: String,
    pub is_folder: bool,
    pub size_bytes: Option<i64>,
    pub content_type: Option<String>,
    /// Для файлов.
    pub state: Option<FileState>,
    pub pinned: bool,
    pub progress: Option<f64>,
    pub error: Option<String>,
    /// Для папок — агрегат по всему поддереву.
    pub aggregate: Option<FolderAggregate>,
    pub subtree_files: Option<i64>,
    pub subtree_bytes: Option<i64>,
    pub subtree_local_bytes: Option<i64>,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct StorageStatus {
    /// Заданы ли адрес и токен в настройках.
    ///
    /// Отличается от `connected`: настроено — значит «этой программой облако
    /// используют», подключено — значит «клиент поднят прямо сейчас». Интерфейс
    /// прячет облачную секцию, пока не настроено и не подключено: показывать
    /// кнопку подключения тому, кто хранилище не заводил, незачем.
    pub configured: bool,
    /// Поднят ли клиент сейчас.
    pub connected: bool,
    /// Корень зеркала. Пусто — облака нет вообще, и шов в ядре должен стать
    /// no-op БЕЗ единого IPC-вызова: иначе сканирование локальных папок
    /// удвоит обращения на ровном месте.
    pub mirror_root: String,
    /// Работаем на моке — то есть данные ненастоящие. Это должно быть видно в UI,
    /// иначе легко принять фикстуры за живой бэкенд.
    pub mock: bool,
    pub base_url: String,
    /// Что умеет бэкенд. До первого успешного запроса всё `false`.
    pub caps: crate::storage::Capabilities,
    /// Ошибка последней попытки соединиться.
    pub last_error: Option<String>,
    /// Поднялась ли слежка за зеркалом.
    ///
    /// `false` при подключённом клиенте — не поломка, но важная разница: файлы,
    /// положенные руками, будут находиться редким полным обходом (до 10 минут), а
    /// не за секунды. Без этого поля «почему файл не залился сразу» неотлаживаемо.
    pub watching: bool,
    /// Сколько путей ждут заливки в очереди кандидатов. Диагностика: очередь,
    /// которая не пустеет, означает, что заливка стоит.
    pub pending_uploads: i64,
}

// ─── Вспомогательное ─────────────────────────────────────────────────────────

fn app_data(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {e}"))
}

/// Запомнить, к чему подключались, чтобы восстановить это при следующем запуске.
fn remember_mode(app: &tauri::AppHandle, demo: bool) {
    let Ok(dir) = app_data(app) else { return };
    let mut cfg = config::load(&dir);
    if cfg.demo != demo {
        cfg.demo = demo;
        let _ = config::save(&dir, &cfg);
    }
}

fn open_index(app: &tauri::AppHandle) -> Result<Index, String> {
    Index::open(&config::index_path(&app_data(app)?))
}


// ─── Настройки и подключение ─────────────────────────────────────────────────

/// Настройки без токена: его renderer'у показывать незачем, достаточно факта.
#[tauri::command]
#[specta::specta]
pub fn storage_get_config(app: tauri::AppHandle) -> Result<ConnectionConfig, String> {
    Ok(config::load(&app_data(&app)?).redacted())
}

/// Сохранить настройки. Пустой `token` означает «не менять» — иначе замаскированное
/// значение из интерфейса затёрло бы настоящий токен.
#[tauri::command]
#[specta::specta]
pub fn storage_set_config(
    app: tauri::AppHandle,
    patch: ConnectionConfig,
) -> Result<ConnectionConfig, String> {
    let dir = app_data(&app)?;
    let mut cfg = config::load(&dir);

    cfg.base_url = patch.base_url;
    cfg.mirror_root = patch.mirror_root;
    cfg.keep_hours = patch.keep_hours;
    cfg.max_mirror_gb = patch.max_mirror_gb;
    cfg.hot_patterns = patch.hot_patterns;
    // `demo` из интерфейса не приходит — режим ставится только подключением.
    if !patch.token.trim().is_empty() && !patch.token.starts_with('•') {
        cfg.token = patch.token;
    }

    config::save(&dir, &cfg)?;
    Ok(cfg.redacted())
}

/// Поднять клиент из сохранённых настроек и спросить у бэкенда, что он умеет.
///
/// Отдельная команда, а не автоподключение на старте: сеть может быть недоступна,
/// и запуск программы не должен от этого зависеть.
#[tauri::command]
#[specta::specta]
pub async fn storage_connect(
    app: tauri::AppHandle,
    state: State<'_, StorageService>,
) -> Result<StorageStatus, String> {
    let cfg = config::load(&app_data(&app)?);
    if !cfg.is_connected() {
        return Ok(StorageStatus {
            configured: false,
            connected: false,
            mirror_root: String::new(),
            mock: false,
            base_url: cfg.base_url,
            caps: Default::default(),
            last_error: Some("Не задан адрес сайта или токен".into()),
            watching: false,
            pending_uploads: 0,
        });
    }

    let provider = Provider::Api(StorageApi::new(StorageConfig {
        base_url: cfg.base_url.clone(),
        token: cfg.token.clone(),
    }));
    let mut sync = Sync::new(provider, open_index(&app)?);

    let (caps, last_error) = match sync.refresh_capabilities().await {
        Ok(c) => (c, None),
        // Не подключились — но клиент всё равно оставляем: индекс уже наполнен
        // прошлыми сессиями, и по нему можно работать офлайн.
        Err(e) => (Default::default(), Some(e.to_string())),
    };

    state
        .attach(sync, std::path::PathBuf::from(&cfg.mirror_root))
        .await;
    // Хэндл нужен, чтобы фоновые передачи могли сообщить интерфейсу об
    // изменившихся файлах: иначе значок меняется только у того, что начал сам
    // интерфейс, а скачанное префетчем остаётся «только в облаке».
    state.set_app(app.clone());
    remember_mode(&app, false);
    crate::storage::daemon::start(app.clone());
    Ok(StorageStatus {
        configured: true,
        connected: true,
        mock: false,
        mirror_root: cfg.mirror_root.clone(),
        base_url: cfg.base_url,
        caps,
        last_error,
        watching: state.is_watching(),
        pending_uploads: state.pending_len() as i64,
    })
}

/// Подключиться к моку — для разработки и демонстрации без бэкенда.
/// Данные ненастоящие, и `status.mock = true` обязан быть виден в интерфейсе.
#[tauri::command]
#[specta::specta]
pub async fn storage_connect_mock(
    app: tauri::AppHandle,
    state: State<'_, StorageService>,
) -> Result<StorageStatus, String> {
    let mock = MockApi::new(crate::storage::mock::demo_state());

    // Поднимаем локальный HTTP-сервер и направляем presigned-ссылки на него.
    // Без этого демо-режим показывает дерево, но ничего не качает: половина
    // интерфейса (прогресс, смена значков, вытеснение) остаётся непроверяемой.
    let blobs = std::sync::Arc::new(std::sync::Mutex::new(std::collections::HashMap::new()));
    match crate::storage::mock_server::start(mock.state_arc(), blobs).await {
        Ok(base) => mock.with(|m| m.presign_base = Some(base)),
        // Порт не дали — дерево всё равно покажем, просто без передачи байтов.
        Err(e) => eprintln!("[storage] демо-сервер не поднялся: {e}"),
    }
    let mut sync = Sync::new(Provider::Mock(mock), open_index(&app)?);
    let caps = sync
        .refresh_capabilities()
        .await
        .map_err(|e| e.to_string())?;

    // Папка зеркала может быть не настроена — в демо это не должно мешать:
    // без неё `ensureLocal` стал бы no-op и скачивание молча ничего не делало.
    let cfg = config::load(&app_data(&app)?);
    let mirror = if cfg.mirror_root.trim().is_empty() {
        app_data(&app)?.join("storage").join("demo-mirror")
    } else {
        std::path::PathBuf::from(&cfg.mirror_root)
    };
    let _ = std::fs::create_dir_all(&mirror);

    let mirror_str = mirror.to_string_lossy().to_string();
    state.attach(sync, mirror).await;
    state.set_app(app.clone());
    remember_mode(&app, true);
    crate::storage::daemon::start(app.clone());
    Ok(StorageStatus {
        configured: cfg.is_connected(),
        connected: true,
        mock: true,
        mirror_root: mirror_str,
        base_url: "mock://".into(),
        caps,
        last_error: None,
        watching: state.is_watching(),
        pending_uploads: state.pending_len() as i64,
    })
}

/// Отключить хранилище: и живое, и демо.
///
/// Сбрасывает и запомненный режим — иначе при следующем запуске демо поднялось бы
/// само, и «отключил» выглядело бы как «не сработало».
#[tauri::command]
#[specta::specta]
pub async fn storage_disconnect(
    app: tauri::AppHandle,
    state: State<'_, StorageService>,
) -> Result<StorageStatus, String> {
    state.detach().await;
    remember_mode(&app, false);

    let cfg = config::load(&app_data(&app)?);
    Ok(StorageStatus {
        configured: cfg.is_connected(),
        connected: false,
        mirror_root: String::new(),
        mock: false,
        base_url: cfg.base_url,
        caps: Default::default(),
        last_error: None,
        watching: false,
        pending_uploads: 0,
    })
}

#[tauri::command]
#[specta::specta]
pub async fn storage_status(
    app: tauri::AppHandle,
    state: State<'_, StorageService>,
) -> Result<StorageStatus, String> {
    let guard = state.sync_mut().await;
    let cfg = config::load(&app_data(&app)?);
    Ok(match guard.as_ref() {
        Some(s) => StorageStatus {
            configured: cfg.is_connected(),
            connected: true,
            mirror_root: state.mirror_root_str(),
            mock: matches!(s.provider, Provider::Mock(_)),
            base_url: cfg.base_url,
            caps: s.caps().clone(),
            last_error: None,
            watching: state.is_watching(),
            pending_uploads: state.pending_len() as i64,
        },
        None => StorageStatus {
            configured: cfg.is_connected(),
            connected: false,
            mirror_root: String::new(),
            mock: false,
            base_url: cfg.base_url,
            caps: Default::default(),
            last_error: None,
            watching: false,
            pending_uploads: 0,
        },
    })
}

// ─── Каталог ─────────────────────────────────────────────────────────────────

/// Обновить список клиентов и проектов. Без этого `/tree` звать не по чему:
/// `projectId` больше взять негде.
#[tauri::command]
#[specta::specta]
pub async fn storage_refresh_projects(
    state: State<'_, StorageService>,
) -> Result<crate::storage::ProjectsResponse, String> {
    let mut guard = state.sync_mut().await;
    let s = guard
        .as_mut()
        .ok_or_else(|| "Хранилище не подключено".to_string())?;
    let resp = s.refresh_projects().await.map_err(|e| e.to_string())?;
    // Имена папок в зеркале берутся отсюда — карту надо пересобрать сразу,
    // иначе переименованный проект перестанет находиться по пути.
    drop(guard);
    state.refresh_dirs().await;

    // Первый уровень зеркала — владелец проекта. Бэкенд `userId` пока не отдаёт,
    // поэтому недостающих владельцев добираем из ключей: без этого все проекты
    // лежали бы в одной папке «Без клиента» вместо папок пользователей.
    if let Err(e) = state.discover_owners().await {
        eprintln!("[storage] владельцы проектов: {e}");
    }
    Ok(resp)
}

#[tauri::command]
#[specta::specta]
pub async fn storage_clients(
    state: State<'_, StorageService>,
) -> Result<Vec<crate::storage::RemoteClient>, String> {
    state.with_sync(|s| s.index.clients()).await
}

#[tauri::command]
#[specta::specta]
pub async fn storage_projects(
    state: State<'_, StorageService>,
    client_id: Option<String>,
) -> Result<Vec<crate::storage::RemoteProject>, String> {
    state.with_sync(|s| s.index.projects(client_id.as_deref())).await
}

/// Догнать проект: полный `/tree` при первом обращении, дальше цикл `/delta`.
#[tauri::command]
#[specta::specta]
pub async fn storage_catch_up(
    state: State<'_, StorageService>,
    project_id: String,
) -> Result<StorageSyncReport, String> {
    let mut guard = state.sync_mut().await;
    let s = guard
        .as_mut()
        .ok_or_else(|| "Хранилище не подключено".to_string())?;
    let r = s.catch_up(&project_id).await.map_err(|e| e.to_string())?;
    Ok(StorageSyncReport {
        pages: r.pages as i64,
        upserted: r.upserted as i64,
        deleted: r.deleted as i64,
        skipped: r.skipped as i64,
        rebootstrapped: r.rebootstrapped,
        cursor: r.cursor,
    })
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct StorageSyncReport {
    pub pages: i64,
    pub upserted: i64,
    pub deleted: i64,
    pub skipped: i64,
    pub rebootstrapped: bool,
    pub cursor: i64,
}

/// Содержимое папки со значками — один вызов на папку.
#[tauri::command]
#[specta::specta]
pub async fn storage_list_dir(
    state: State<'_, StorageService>,
    project_id: String,
    folder_path: String,
) -> Result<Vec<StorageDirEntry>, String> {
    // Первый `/tree` по проекту: без него листинг честно отдаёт пустоту из индекса,
    // и «в облаке ничего нет» невозможно отличить от «мы ещё не спрашивали».
    state.ensure_catalog(&project_id).await?;
    state.with_sync(|s| {
        let entries = s.index.list_dir(&project_id, &folder_path)?;
        let mut out = Vec::with_capacity(entries.len());

        for e in entries {
            if e.is_folder {
                // Путь поддерева — логический: 'IN' + '/' + имя папки.
                let sub = if e.folder_path.is_empty() {
                    e.name.clone()
                } else {
                    format!("{}/{}", e.folder_path, e.name)
                };
                let agg = s.index.folder_badge(&project_id, &sub)?;
                out.push(StorageDirEntry {
                    file_id: e.id,
                    name: e.name,
                    folder_path: e.folder_path,
                    is_folder: true,
                    size_bytes: None,
                    content_type: None,
                    state: None,
                    pinned: false,
                    progress: None,
                    error: None,
                    aggregate: Some(agg.aggregate),
                    subtree_files: Some(agg.files),
                    subtree_bytes: Some(agg.bytes),
                    subtree_local_bytes: Some(agg.local_bytes),
                });
            } else {
                let b = s.index.badge_state(&e.id)?;
                out.push(StorageDirEntry {
                    file_id: e.id,
                    name: e.name,
                    folder_path: e.folder_path,
                    is_folder: false,
                    size_bytes: e.size_bytes,
                    content_type: e.content_type,
                    state: Some(b.as_ref().map(|b| b.state).unwrap_or(FileState::Cloud)),
                    pinned: b.as_ref().map(|b| b.pinned).unwrap_or(false),
                    progress: b.as_ref().and_then(|b| b.progress),
                    error: b.and_then(|b| b.error),
                    aggregate: None,
                    subtree_files: None,
                    subtree_bytes: None,
                    subtree_local_bytes: None,
                });
            }
        }
        Ok(out)
    })
    .await
}

/// Содержимое папки в зеркале. `None` — путь не под зеркалом, читайте диск как обычно.
#[tauri::command]
#[specta::specta]
pub async fn storage_browse(
    state: State<'_, StorageService>,
    path: String,
) -> Result<Option<Vec<crate::storage::BrowseEntry>>, String> {
    state.browse(&path).await
}

/// Локальные копии, которые можно освободить (только синхронизированные).
#[tauri::command]
#[specta::specta]
pub async fn storage_local_files(
    state: State<'_, StorageService>,
) -> Result<Vec<crate::storage::LocalFileRow>, String> {
    state.local_files().await
}

/// Удалить локальную копию, оставив файл в облаке. Возвращает освобождённые байты.
#[tauri::command]
#[specta::specta]
pub async fn storage_drop_local(
    state: State<'_, StorageService>,
    file_id: String,
) -> Result<i64, String> {
    state.drop_local(&file_id).await
}

/// Создать папку зеркала на диске. `false` — путь не под зеркалом.
#[tauri::command]
#[specta::specta]
pub async fn storage_ensure_dir(
    state: State<'_, StorageService>,
    path: String,
) -> Result<bool, String> {
    state.ensure_dir(std::path::Path::new(&path)).await
}

/// Агрегат одной папки — для модалки «Информация» и для заголовков.
#[tauri::command]
#[specta::specta]
pub async fn storage_folder_badge(
    state: State<'_, StorageService>,
    project_id: String,
    folder_path: String,
) -> Result<crate::storage::FolderBadge, String> {
    state.with_sync(|s| s.index.folder_badge(&project_id, &folder_path)).await
}

/// «Оставить оффлайн» — локальный флаг этой машины, в облако не уходит.
#[tauri::command]
#[specta::specta]
pub async fn storage_set_pinned(
    state: State<'_, StorageService>,
    file_id: String,
    pinned: bool,
) -> Result<(), String> {
    state.with_sync(|s| s.index.set_pinned(&file_id, pinned)).await
}

/// Был ли по проекту полный `/tree`. Нужно, чтобы отличать «пусто» от «не знаю»:
/// иначе непосещённая папка покажет «0 файлов» вместо честного «неизвестно».
#[tauri::command]
#[specta::specta]
pub async fn storage_project_synced_at(
    state: State<'_, StorageService>,
    project_id: String,
) -> Result<Option<i64>, String> {
    state.with_sync(|s| s.index.tree_at(&project_id)).await
}

/// Сделать так, чтобы по пути лежал актуальный файл, и вернуть этот путь.
///
/// **Вне зеркала — no-op**, возвращает путь как есть. Поэтому вызов безопасно
/// ставить везде, где путь превращается в файл, не разбираясь «здесь надо или нет».
#[tauri::command]
#[specta::specta]
pub async fn storage_ensure_local(
    state: State<'_, StorageService>,
    path: String,
) -> Result<EnsureResult, String> {
    state.ensure_local(std::path::Path::new(&path)).await
}

/// Залить файл из зеркала в облако: `presign` → `PUT` → **`notify`**.
///
/// Третий шаг обязателен. Если он не прошёл — операция считается неудачной, даже
/// когда байты уже в бакете: иначе получим объект, которого каталог не видит.
#[tauri::command]
#[specta::specta]
pub async fn storage_upload(
    state: State<'_, StorageService>,
    path: String,
) -> Result<UploadResult, String> {
    state.upload_local(std::path::Path::new(&path)).await
}

/// Прогон чистки кэша. Политику берём из настроек, если не передана явно.
///
/// Два инварианта внутри не выключаются настройкой: незалитое и горячее не
/// вытесняются никогда. `report.keptUnsafe > 0` означает, что в зеркале есть
/// файлы, существующие только здесь, — это стоит показать.
#[tauri::command]
#[specta::specta]
pub async fn storage_run_eviction(
    app: tauri::AppHandle,
    state: State<'_, StorageService>,
    policy: Option<EvictionPolicy>,
) -> Result<EvictionReport, String> {
    let policy = match policy {
        Some(p) => p,
        None => {
            let cfg = config::load(&app_data(&app)?);
            EvictionPolicy {
                ttl_hours: cfg.keep_hours_or_default(),
                max_bytes: Some(cfg.max_mirror_gb_or_default() as i64 * 1024 * 1024 * 1024),
                hot_patterns: cfg.hot_patterns_or_default(),
            }
        }
    };
    state.run_eviction(policy).await
}

/// Сколько байт занимают локальные копии сейчас — для настроек и статусбара.
#[tauri::command]
#[specta::specta]
pub async fn storage_mirror_bytes(state: State<'_, StorageService>) -> Result<i64, String> {
    state.with_sync(|s| s.index.mirror_bytes()).await
}

/// Копирование из зеркала с режимом «переписать устаревший».
///
/// Одна команда, а не три, потому что порядок здесь — инвариант:
/// **проверить актуальность → только потом гидратировать → скопировать → запомнить
/// версию.** Разбей это на части, и рано или поздно кто-то скачает три гигабайта,
/// чтобы выяснить, что качать было не нужно, а про «запомнить версию» просто забудет.
///
/// Для источника вне зеркала ведёт себя как раньше — сравнение по mtime.
#[tauri::command]
#[specta::specta]
pub async fn storage_copy_from_mirror(
    state: State<'_, StorageService>,
    src: String,
    dest: String,
    overwrite_oldest: bool,
) -> Result<CopyReport, String> {
    state
        .copy_from_mirror(
            std::path::Path::new(&src),
            std::path::Path::new(&dest),
            overwrite_oldest,
        )
        .await
}

/// Где этот файл лежал бы в зеркале. Нужно интерфейсу, чтобы позвать
/// `storage_ensure_local`: renderer не должен сам собирать путь — раскладка
/// зеркала это дело клиента, а не UI.
#[tauri::command]
#[specta::specta]
pub async fn storage_mirror_path(
    state: State<'_, StorageService>,
    file_id: String,
) -> Result<String, String> {
    state.mirror_path_for(&file_id).await
}

/// Скачать файл по его `file_id` — обёртка над `ensure_local` для интерфейса.
#[tauri::command]
#[specta::specta]
pub async fn storage_download(
    state: State<'_, StorageService>,
    file_id: String,
) -> Result<EnsureResult, String> {
    let p = state.mirror_path_for(&file_id).await?;
    state.ensure_local(std::path::Path::new(&p)).await
}

/// Сверить локальные копии с диском и обновить состояния.
///
/// Движок значков к диску не обращается (иначе листинг на тысячу файлов делал бы
/// тысячу `stat`), поэтому факт ручной правки должен кто-то обнаружить явно.
/// Зовётся по кнопке и перед витком обработки. Возвращает, сколько файлов
/// оказались изменёнными локально.
#[tauri::command]
#[specta::specta]
pub async fn storage_detect_local_changes(
    state: State<'_, StorageService>,
) -> Result<i64, String> {
    state.detect_local_changes().await
}

/// Список передач: активные первыми, затем недавно завершённые.
///
/// Завершённые показываем намеренно: ошибка, о которой никто не узнал, —
/// это ошибка, которая повторится.
#[tauri::command]
#[specta::specta]
pub async fn storage_transfers(
    state: State<'_, StorageService>,
    limit: Option<i64>,
) -> Result<Vec<crate::storage::TransferRow>, String> {
    state.transfers(limit.unwrap_or(50)).await
}

/// Отменить передачу. Прерывание происходит в цикле чтения между кусками,
/// недокачанный `.part` удаляется.
/// Что лежит здесь и не уехало в облако — включая остановленное вручную.
#[tauri::command]
#[specta::specta]
pub async fn storage_not_uploaded(
    state: State<'_, StorageService>,
    limit: Option<u32>,
) -> Result<Vec<crate::storage::NotUploadedRow>, String> {
    state.not_uploaded(limit.unwrap_or(500) as usize).await
}

/// Отправить файл в облако по явной команде человека — снимая прошлую остановку.
#[tauri::command]
#[specta::specta]
pub async fn storage_upload_now(
    state: State<'_, StorageService>,
    path: String,
) -> Result<(), String> {
    let p = std::path::PathBuf::from(&path);
    state.allow_upload(&p);
    state.mark_dirty(&[p], true);
    Ok(())
}

/// Убрать задачу из списка передач (обычно — упавшую).
#[tauri::command]
#[specta::specta]
pub async fn storage_dismiss_transfer(
    state: State<'_, StorageService>,
    id: i64,
) -> Result<(), String> {
    state.dismiss_transfer(id).await
}

/// Повторить упавшую передачу. Заливка встаёт в очередь сразу, скачивание уходит
/// в фоновую задачу. Если исходника больше нет — задача снимается, и об этом
/// сообщается текстом.
#[tauri::command]
#[specta::specta]
pub async fn storage_retry_transfer(
    state: State<'_, StorageService>,
    id: i64,
) -> Result<String, String> {
    state.retry_transfer(id).await
}

#[tauri::command]
#[specta::specta]
pub async fn storage_cancel_transfer(
    state: State<'_, StorageService>,
    id: i64,
) -> Result<(), String> {
    state.cancel_transfer(id).await
}

#[tauri::command]
#[specta::specta]
pub async fn storage_clear_finished_transfers(
    state: State<'_, StorageService>,
) -> Result<i64, String> {
    state.clear_finished_transfers().await
}

/// Статистика поддерева для модалки «Информация».
///
/// `known = false` означает «полного `/tree` по проекту ещё не делали» — это НЕ
/// то же самое, что «пусто», и интерфейс обязан их различать.
#[tauri::command]
#[specta::specta]
pub async fn storage_subtree_stats(
    state: State<'_, StorageService>,
    project_id: String,
    folder_path: String,
) -> Result<crate::storage::SubtreeStats, String> {
    state
        .with_sync(|s| s.index.subtree_stats(&project_id, &folder_path))
        .await
}

/// Сведения о пути БЕЗ скачивания: существует ли, размер, время, есть ли копия.
///
/// Ключевая команда шва. Проверки существования и `stat` обязаны отвечать из
/// каталога, а не гидратировать: иначе первый же обход проекта скачает весь архив.
#[tauri::command]
#[specta::specta]
pub async fn storage_path_info(
    state: State<'_, StorageService>,
    path: String,
) -> Result<crate::storage::PathInfo, String> {
    state.path_info(std::path::Path::new(&path)).await
}

/// Создать папку зеркала В КАТАЛОГЕ и на диске. `None` — путь не в зеркале.
///
/// Отличается от `storage_ensure_dir`: та только материализует на диске папку,
/// которая в каталоге уже есть. Здесь папка в каталоге ЗАВОДИТСЯ — иначе у неё нет
/// `file_id`, а значит ни переименования, ни удаления, ни значка синхронизации.
#[tauri::command]
#[specta::specta]
pub async fn storage_mkdir(
    state: State<'_, StorageService>,
    path: String,
) -> Result<Option<String>, String> {
    state.mkdir_in_cloud(std::path::Path::new(&path)).await
}

/// Догнать каталог прямо сейчас — кнопка «Обновить» у владельца.
///
/// Не перерисовывает интерфейс: он рисуется из локальной БД. Задача кнопки —
/// подтянуть саму БД (дельты по тёплым проектам) и подвинуть локальные копии за
/// изменившимися логическими путями.
#[tauri::command]
#[specta::specta]
pub async fn storage_sync_now(state: State<'_, StorageService>) -> Result<i64, String> {
    let warm = state.warm_projects(std::time::Duration::from_secs(15 * 60));
    for pid in &warm {
        if let Err(e) = state.catch_up_project(pid).await {
            eprintln!("[storage] дельта {pid}: {e}");
        }
    }
    let moved = state.reconcile_local_paths().await?;
    Ok(moved as i64)
}

/// Освободить диск от локальных копий владельца. Онлайн не трогается.
///
/// Незалитое остаётся на диске (инвариант кэша) и попадает в отчёт: интерфейс
/// обязан сказать, что удалено не всё, а не соврать «готово».
#[tauri::command]
#[specta::specta]
pub async fn storage_drop_owner_local(
    state: State<'_, StorageService>,
    path: String,
) -> Result<crate::storage::DropOwnerReport, String> {
    state.drop_owner_local(std::path::Path::new(&path)).await
}

/// Разрешить конфликт: `takeCloud = true` — взять облачную версию, `false` — залить свою.
///
/// Конфликт единственное состояние, которое программа не решает сама: любой
/// автовыбор теряет данные. Здесь только исполнение выбора человека.
#[tauri::command]
#[specta::specta]
pub async fn storage_resolve_conflict(
    state: State<'_, StorageService>,
    path: String,
    take_cloud: bool,
) -> Result<Option<FileState>, String> {
    state
        .resolve_conflict(std::path::Path::new(&path), take_cloud)
        .await
}

/// Удалить файл или папку зеркала — **двухступенчато**.
///
/// Первое нажатие убирает локальную копию (файл остаётся в облаке), второе —
/// удаляет в облаке. Вторая ступень возвращает `needsConfirm`, пока `allow_online`
/// не выставлен: у бэкенда нет корзины, и удаление в облаке необратимо.
///
/// `None` — путь не в зеркале, зовущий удаляет как обычно.
#[tauri::command]
#[specta::specta]
pub async fn storage_delete(
    state: State<'_, StorageService>,
    path: String,
    allow_online: Option<bool>,
) -> Result<Option<crate::storage::DeleteStage>, String> {
    state
        .delete_in_cloud(std::path::Path::new(&path), allow_online.unwrap_or(false))
        .await
}

/// Включить/выключить проект в каталоге (галочка во второй колонке).
/// `None` — путь не проект зеркала, зовущий решает сам (локальная папка).
#[tauri::command]
#[specta::specta]
pub async fn storage_set_project_paused(
    state: State<'_, StorageService>,
    path: String,
    paused: bool,
) -> Result<Option<()>, String> {
    state
        .set_project_paused(std::path::Path::new(&path), paused)
        .await
}

/// Переименовать проект: имя в каталоге, затем папка зеркала.
/// `None` — путь не в зеркале.
#[tauri::command]
#[specta::specta]
pub async fn storage_rename_project(
    state: State<'_, StorageService>,
    path: String,
    new_name: String,
) -> Result<Option<crate::storage::RenameReport>, String> {
    state
        .rename_project(std::path::Path::new(&path), &new_name)
        .await
}

/// Перенести файл или папку зеркала в другую папку ТОГО ЖЕ проекта.
///
/// Тот же `/rename`, только меняется `folderPath`: байты не двигаются, `s3Key` не
/// трогается. `None` — источник или приёмник вне зеркала, зовущий переносит сам
/// (для выгрузки наружу это гидрация + обычное копирование).
#[tauri::command]
#[specta::specta]
pub async fn storage_move(
    state: State<'_, StorageService>,
    path: String,
    dest_dir: String,
) -> Result<Option<crate::storage::RenameReport>, String> {
    state
        .move_in_cloud(
            std::path::Path::new(&path),
            std::path::Path::new(&dest_dir),
        )
        .await
}

/// Переименовать файл или папку зеркала — в каталоге и на диске.
///
/// `None` — путь не в зеркале, зовущий переименовывает как обычно. Уровни выше
/// проекта (владелец, сам проект) дают понятный отказ: их имена живут на сайте.
#[tauri::command]
#[specta::specta]
pub async fn storage_rename(
    state: State<'_, StorageService>,
    path: String,
    new_name: String,
) -> Result<Option<crate::storage::RenameReport>, String> {
    state
        .rename_in_cloud(std::path::Path::new(&path), &new_name)
        .await
}

/// Сведения о проекте по пути: архивный ли, приостановлен ли.
///
/// Раннер обязан пропускать архивные проекты (`STORAGE_API.md`, «Processing flags»),
/// а интерфейс — показывать это значком. `None` — путь не проект зеркала, и это не
/// ошибка: локальные папки сюда попадают штатно.
#[tauri::command]
#[specta::specta]
pub async fn storage_project_info(
    state: State<'_, StorageService>,
    path: String,
) -> Result<Option<crate::storage::ProjectInfo>, String> {
    state.project_info(std::path::Path::new(&path)).await
}

/// Сообщить, что по этим путям что-то появилось или изменилось.
///
/// `ready = true` — «файл дописан, заливай не дожидаясь затишья». Так зовёт
/// раннер: он знает точно, шаг завершён. `ready = false` — «просто посмотри»,
/// как это делает вотчер.
///
/// Пути вне зеркала молча отбрасываются — вызов безопасно ставить где угодно, не
/// разбираясь заранее, облачный ли это путь. Возвращает, сколько путей принято.
#[tauri::command]
#[specta::specta]
pub async fn storage_mark_dirty(
    state: State<'_, StorageService>,
    paths: Vec<String>,
    ready: Option<bool>,
) -> Result<i64, String> {
    let bufs: Vec<std::path::PathBuf> = paths.into_iter().map(std::path::PathBuf::from).collect();
    Ok(state.mark_dirty(&bufs, ready.unwrap_or(true)) as i64)
}

/// Объявить готовыми всех накопившихся кандидатов: конец витка, писать больше некому.
///
/// Заливку выполняет демон на следующем пульсе (≤3 с) — команда только снимает
/// ожидание затишья. Так она отвечает мгновенно и не держит IPC-вызов на время
/// передачи гигабайтов.
#[tauri::command]
#[specta::specta]
pub async fn storage_flush_uploads(state: State<'_, StorageService>) -> Result<i64, String> {
    Ok(state.flush_pending() as i64)
}

/// Догнать дельты для проекта, заданного ПУТЁМ, а не `project_id`.
///
/// Раннер оперирует путями и про идентификаторы каталога не знает. Один вызов на
/// проект в начале витка — и дальше весь виток можно доверять индексу: иначе
/// пришлось бы делать HEAD на каждый из десяти тысяч файлов.
///
/// `None` — путь не в зеркале (обычная локальная папка), и это не ошибка.
#[tauri::command]
#[specta::specta]
pub async fn storage_catch_up_path(
    state: State<'_, StorageService>,
    path: String,
) -> Result<Option<StorageSyncReport>, String> {
    let Some(project_id) = state.project_id_for_path(std::path::Path::new(&path)).await else {
        return Ok(None);
    };
    let mut guard = state.sync_mut().await;
    let s = guard
        .as_mut()
        .ok_or_else(|| "Хранилище не подключено".to_string())?;
    let r = s.catch_up(&project_id).await.map_err(|e| e.to_string())?;
    Ok(Some(StorageSyncReport {
        pages: r.pages as i64,
        upserted: r.upserted as i64,
        deleted: r.deleted as i64,
        skipped: r.skipped as i64,
        rebootstrapped: r.rebootstrapped,
        cursor: r.cursor,
    }))
}
