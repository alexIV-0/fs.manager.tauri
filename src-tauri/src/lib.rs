#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod storage;

use commands::{
    fs_commands::*,
    window_commands::*,
    log_archive::*,
    diag_log::*,
    watch_commands::*,
    processing_commands::*,
    plugin_commands::*,
    dialog_commands::*,
    window_state::*,
    exec_commands::*,
    ffmpeg_commands::*,
    ae_commands::*,
    settings_commands::*,
    docs_commands::*,
    http_commands::*,
    deps_commands::*,
    preview_commands::*,
    account_commands::*,
    vk_auth_commands::*,
    youtube_auth_commands::*,
    youtube_upload_commands::*,
    tg_commands::*,
    storage_commands::*,
};
use commands::plugin_commands::PluginManagerState;
use commands::settings_commands::AppSettingsState;
use commands::db_analytics::DbState;
use std::sync::Mutex;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
#[cfg(target_os = "macos")]
use tauri::menu::{Menu, Submenu, PredefinedMenuItem};

/// Specta-builder для генерации типобезопасных TS-биндингов (стадия «export-only»).
///
/// ЕДИНСТВЕННЫЙ список команд приложения.
///
/// Он же даёт типы (`export()` → `src/bindings.ts`) и он же регистрирует рантайм
/// (`invoke_handler()` в `run()`). Раньше списков было ДВА — `collect_commands!` для
/// типов и `tauri::generate_handler!` для рантайма, — и компилятор их расхождение не
/// ловил: команда компилировалась, типизировалась, тесты были зелёные, а фронт получал
/// «command not found». Так однажды отвалился весь клиент хранилища целиком, 26 команд.
///
/// Пока списков было два, от этого сторожил тест-сличитель. Теперь сличать нечего:
/// добавить команду в одно место и забыть про другое стало невозможно.
fn specta_builder() -> tauri_specta::Builder<tauri::Wry> {
    tauri_specta::Builder::<tauri::Wry>::new()
        .commands(tauri_specta::collect_commands![
            run_script_in_ae,
            launch_ae_with_script,
            // fs watcher (мигрирован Stage 1 — call-sites на commands.*, camel-обёртки удалены)
            fs_watch_start,
            fs_watch_stop,
            // preview (мигрирован — call-sites на commands.*, camel previewResize/previewOpen удалены)
            preview_open,
            preview_resize,
            preview_detect_alpha,
            preview_transcode_webm,
            preview_delete_temp,
            // dialog/shell/файловые (мигрированы — реальные реализации, snake-имена,
            // dialog_commands_camel.rs удалён)
            select_folders,
            select_files,
            copy_to_clipboard,
            show_in_folder,
            open_file_with_default_app,
            create_folder,
            rename_file,
            get_node_obj_from_file,
            save_flow_to_options_folder,
            get_paths_from_files,
            request_data_preview,
            open_dev_tools,
            // docs (чистый от плагинов) — мигрирован на commands.*
            docs_list,
            docs_read,
            // window-state (чистый) — мигрирован на commands.*
            save_window_state,
            load_window_state,
            // log_archive (чистый) — мигрирован на commands.*
            log_archive_list_days,
            log_archive_get_day,
            log_archive_cleanup,
            log_archive_clear,
            // processing (app-only часть — мигрирована; sendLog/setStatusBar плагинные, оставлены)
            abort_processing,
            // Снятие сигнала прерывания на старте прогона. Долго была мёртвой: в
            // рантайме есть, в specta не было, и никто её не звал — флаг гасился
            // побочным эффектом в exec_command, из-за чего один убитый процесс
            // снимал глобальный стоп. Теперь её зовёт startProcessContext().
            reset_processing_signal,
            move_to_errors,
            send_node_start,
            send_node_done,
            send_node_error,
            send_process_complete,
            // path_exists — plugin-shared, но app использует через commands.pathExists (типобезопасно),
            // плагины — через raw invoke('path_exists', {path}); argMapper удаляем
            path_exists,
            // log_window UI (чистый) — мигрирован на commands.* (мёртвые toggle/status/quick/console — нет)
            log_window_open,
            log_window_clear,
            log_window_get_history,
            log_window_export,
            log_window_emit_item_log,
            log_window_emit_node_update,
            log_window_emit_item_end,
            log_window_emit_substep_batch,
            log_window_emit_item_queued,
            log_window_emit_abort_queued,
            // settings (app_settings/color_types/file_types/program_paths + cleanup/db) —
            // чистый от плагинов модуль, мигрирован на commands.*
            app_settings_get,
            app_settings_set,
            app_settings_patch,
            color_types_get,
            color_types_set,
            color_types_rescan,
            color_types_add,
            color_types_remove,
            file_types_get,
            file_types_set,
            program_paths_get,
            program_paths_set,
            cleanup_auto_delete,
            db_register_found,
            // path-утилиты: НЕ через specta — приложение считает их в renderer (чистый TS,
            // src/Utils/path.ts), а path_join оставлен только как обычная команда для плагинов.
            // fs_commands (app type-safety; camel-обёртки остаются для плагинов до миграции плагинного слоя)
            get_file_info,
            get_file_type_by_extname,
            test_and_create_folder,
            test_and_create_folders,
            create_text_file,
            ensure_and_read_dir,
            get_stat,
            os_tmpdir,
            hash_file,
            rename_folder,
            set_path_mtime,
            copy_item,
            move_item,
            delete_item,
            read_file_sync,
            read_media_preview,
            write_file,
            write_file_atomic,
            append_file,
            write_binary_file,
            check_file_path,
            check_folder_path,
            get_some_from_folder,
            list_subfolders,
            read_folder_states,
            recursive_find_files,
            get_user_data_path,
            get_plugins_dev_path,
            get_cpu_count,
            get_platform_target,
            fonts_get_list,
            fonts_load_one,
            shell_open_path,
            // deps: авто-загрузка ffmpeg/ffprobe + whisper-моделей
            deps_ffmpeg_status,
            deps_download_ffmpeg,
            deps_whisper_models_dir,
            deps_list_whisper_models,
            deps_download_whisper_model,
            deps_download_tg_server,
            // preview: точный ffmpeg-рендер кадра для редакторов фильтров
            preview_render_frame,
            preview_render_audio,
            preview_clear_cache,
            // Autopost: хранилище аккаунтов (App Support, сегментация по главной папке + платформе)
            account_save,
            account_list,
            account_get_token,
            account_add_channel,
            account_remove_channel,
            account_delete,
            // VK OAuth + валидация (vk_auth_capture — внутренняя, через raw invoke из init-скрипта)
            vk_auth_open,
            vk_validate_token,
            vk_groups_get,
            // YouTube OAuth (Модель B / BYO credentials): PKCE-флоу + refresh + upload
            youtube_auth_start,
            youtube_refresh_token,
            youtube_get_access_token,
            youtube_upload_video,
            youtube_set_thumbnail,
            // Telegram: валидация токена бота + проверка канала + авто-обнаружение каналов
            tg_validate_token,
            tg_get_chat,
            tg_discover_channels,
            tg_discover_sources,
            tg_get_updates,
            tg_fetch_file,
            tg_delete_message,
            tg_set_reaction,
            tg_create_forum_topic,
            tg_base_url,
            tg_server_start,
            tg_server_stop,
            tg_server_status,
            tg_cloud_log_out,
            // Клиент облачного хранилища (см. ideasAndTest/R2_SYNC_PLAN.md)
            storage_get_config,
            storage_set_config,
            storage_connect,
            storage_connect_mock,
            storage_disconnect,
            storage_status,
            storage_refresh_projects,
            storage_clients,
            storage_projects,
            storage_catch_up,
            storage_list_dir,
            storage_browse,
            storage_ensure_dir,
            storage_local_files,
            storage_drop_local,
            storage_folder_badge,
            storage_set_pinned,
            storage_project_synced_at,
            storage_ensure_local,
            storage_upload,
            storage_run_eviction,
            storage_mirror_bytes,
            storage_copy_from_mirror,
            storage_mirror_path,
            storage_download,
            storage_detect_local_changes,
            storage_transfers,
            storage_cancel_transfer,
            storage_clear_finished_transfers,
            storage_subtree_stats,
            storage_path_info,

            // ─── Дотянуто до полного паритета: раньше эти 46 команд жили ТОЛЬКО
            // в generate_handler! и звались строкой (из TS и из плагинов), то есть
            // без типов. Теперь список ОДИН и он же регистрирует рантайм.
            commands::icon_commands::get_file_icon,
            path_join,
            open_node_window,
            open_devtools,
            request_data,
            diag_log_write,
            diag_log_path,
            diag_log_clear,
            is_processing_aborted,
            set_processing_progress,
            get_processing_progress,
            add_processing_error,
            processing_delete_item,
            get_item_info,
            process_item,
            set_status_bar,
            send_log,
            exec_command,
            kill_all_exec_processes,
            ffmpeg_get_path,
            ffprobe_get_path,
            ffprobe_get_info,
            ffmpeg_get_video_thumbnail,
            ffmpeg_exec_with_progress,
            read_media_preview_with_ffmpeg,
            http_fetch,
            http_upload,
            http_download,
            plugin_manager_init,
            plugin_manager_load_plugin,
            plugin_manager_unload_plugin,
            plugin_manager_get_all_plugins,
            plugin_manager_get_plugins_by_type,
            plugin_manager_get_plugin,
            plugin_manager_set_cost,
            plugin_manager_get_plugin_ui,
            plugin_manager_get_all_ui_nodes,
            plugin_manager_get_ui_nodes,
            plugin_manager_list,
            plugin_manager_get_state,
            plugin_manager_call,
            plugin_manager_install,
            plugin_manager_delete,
            plugin_manager_destroy,
            plugin_build,
            vk_auth_capture,
        ])
}

/// Экспортирует `src/bindings.ts` из specta-билдера.
///
/// `bigint(Number)` — обязателен: по умолчанию specta-typescript падает на `u64`/`i64`/
/// `usize` (`BigIntForbidden`), т.к. JS-число теряет точность за пределами 2^53. В нашем
/// коде эти поля (таймауты, размеры, mtime) и так ходят как обычные `number` в JS —
/// `Number` сохраняет это поведение. Конфиг тут единый, чтобы dev-экспорт (`run()`) и
/// headless-тест не разъехались.
#[cfg(debug_assertions)]
fn export_specta_bindings() {
    specta_builder()
        .export(
            specta_typescript::Typescript::default()
                .bigint(specta_typescript::BigIntExportBehavior::Number),
            "../src/bindings.ts",
        )
        .expect("Failed to export specta TS bindings");
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // В debug заодно пересобираем src/bindings.ts из того же самого билдера.
    #[cfg(debug_assertions)]
    export_specta_bindings();

    let specta = specta_builder();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_clipboard::init())
        .plugin(tauri_plugin_drag::init())
        // Кастомный `plugin://` протокол для динамической загрузки плагинов через import().
        // Resolver: distr-plugins (dev, приоритет) → app_data/plugins → resource/plugins.
        // На лету переписывает Node-импорты в плагинах на наши @plugin-api/* полифилы.
        .register_uri_scheme_protocol("plugin", |ctx, request| {
            let app = ctx.app_handle().clone();
            let uri_path = request.uri().path().to_string();
            commands::plugin_protocol::handle_plugin_request(&app, &uri_path)
        })
        .manage(Mutex::new(commands::watch_commands::WatcherState::new()))
        .manage(Mutex::new(commands::processing_commands::ProcessingState::new()))
        .manage(Mutex::new(commands::window_commands::LogState::new()))
        .manage(Mutex::new(commands::window_commands::NodeWindowState::new()))
        .manage(Mutex::new(commands::window_commands::PreviewWindowState::new()))
        .manage(Mutex::new(commands::preview_bounds::PreviewBoundsState::new()))
        .manage(Mutex::new(AppSettingsState::new()))
        .manage(Mutex::new(DbState::new()))
        .manage(crate::storage::StorageService::new())
        .setup(|app| {
            let app_handle = app.handle().clone();

            // Диагностический heartbeat: фоновый поток пишет в `logs/diag.log` каждые 2 сек.
            // Если строки `heartbeat` перестают идти — Rust runtime заблокирован целиком.
            commands::diag_log::spawn_heartbeat(app_handle.clone());

            // Инициализируем PluginManagerState с правильным путём
            let app_data_dir = app.path()
                .app_data_dir()
                .expect("Failed to get app data dir");

            let mut plugin_state = PluginManagerState::new(cfg!(debug_assertions), app_data_dir);

            // Грузим все плагины ОДИН РАЗ на старте процесса.
            // Раньше каждое окно (main/nodeWin/previewWin/logWindow) дёргало
            // plugin_manager_init из JS и плагины перечитывались 4 раза.
            // Теперь JS-вызов идемпотентен (см. plugin_manager_init), а реальная
            // загрузка происходит здесь до открытия любого окна.
            let plugins_path = plugin_state.plugins_path.clone();
            let api_version = plugin_state.api_version;
            if let Err(e) = commands::plugin_commands::load_all_plugins(
                &mut plugin_state,
                &plugins_path,
                api_version,
            ) {
                eprintln!("[PluginManager] startup load failed: {}", e);
            } else {
                println!("[PluginManager] Loaded {} plugins on startup", plugin_state.plugins.len());
            }

            app.manage(Mutex::new(plugin_state));

            // ExecState хранит только реестр запущенных процессов. Флаги прерывания
            // живут в ProcessingState по ПОЛОСАМ (processing/posting) и берутся в
            // `exec_command` по полосе вызова — раньше здесь клонировался один
            // общий флаг, и потому стоп одного раннера убивал процессы другого.
            app.manage(commands::exec_commands::ExecState::new());
            
            // Восстановить состояние главного окна ДО показа.
            // Окно создаётся скрытым (tauri.conf.json → "visible": false), позиция/размер
            // выставляются пока оно невидимо, и только потом show() — поэтому больше нет
            // «прыжка» (раньше окно появлялось по центру с дефолтным размером, а затем
            // переезжало в сохранённое место уже на глазах у пользователя).
            if let Some(main_win) = app.get_webview_window("main") {
                if let Ok(Some(state)) = commands::window_state::load_window_state("main".to_string(), app_handle.clone()) {
                    println!("[WindowState] Restoring main window: {:?}", state);
                    // apply_state_to_window выставляет размер+позицию с защитой от «потерянного»
                    // окна (если сохранённый экран отключён — центрирует на первичном мониторе).
                    commands::window_state::apply_state_to_window(&main_win, &state);
                }
                // Показываем уже спозиционированное окно — без прыжка.
                let _ = main_win.show();
                let _ = main_win.set_focus();
            }
            
            // Node Editor window
            // disable_drag_drop_handler() — отключает Tauri-перехват drop-событий
            // (для нативного drop файлов в окно). Без этого HTML5 drag-and-drop
            // внутри WebView (sidebar → canvas) не работает.
            let node_win = WebviewWindowBuilder::new(
                app,
                "nodeWin",
                WebviewUrl::App("nodeWin.html".into()),
            )
            .title("fsManager — Node Editor")
            .inner_size(1400.0, 900.0)
            .visible(false)
            .disable_drag_drop_handler()
            .build()?;

            if let Ok(Some(state)) = commands::window_state::load_window_state("nodeWin".to_string(), app_handle.clone()) {
                let _ = node_win.set_size(tauri::Size::Physical(tauri::PhysicalSize {
                    width: state.width as u32,
                    height: state.height as u32,
                }));
                if let (Some(x), Some(y)) = (state.x, state.y) {
                    let _ = node_win.set_position(tauri::Position::Physical(tauri::PhysicalPosition { x: x as i32, y: y as i32 }));
                }
            }

            // Preview-окна теперь создаются динамически в preview_open (мульти-инстанс,
            // label "preview-{type}-{n}", каскад, bounds-per-type). Заранее единое
            // previewWin больше не нужно — оно бы просто висело скрытым.

            // Log window
            let log_win = WebviewWindowBuilder::new(
                app,
                "logWindow",
                WebviewUrl::App("logWindow.html".into()),
            )
            .title("fsManager — Log Window")
            .inner_size(1000.0, 700.0)
            .visible(false)
            .build()?;

            if let Ok(Some(state)) = commands::window_state::load_window_state("logWindow".to_string(), app_handle.clone()) {
                let _ = log_win.set_size(tauri::Size::Physical(tauri::PhysicalSize {
                    width: state.width as u32,
                    height: state.height as u32,
                }));
                if let (Some(x), Some(y)) = (state.x, state.y) {
                    let _ = log_win.set_position(tauri::Position::Physical(tauri::PhysicalPosition { x: x as i32, y: y as i32 }));
                }
            }
            
            // Автосохранение размера/позиции с дебаунсом — для всех окон.
            // Save срабатывает после того как пользователь отпустил мышку
            // (Tauri прекращает слать Resized/Moved события, дебаунс истекает).
            commands::window_state::register_autosave(&app_handle, "main");
            commands::window_state::register_autosave(&app_handle, "nodeWin");
            // previewWin использует свой механизм (bounds-per-type) — см. preview_open
            commands::window_state::register_autosave(&app_handle, "logWindow");

            // Edit-меню: без него macOS не маршрутизирует Cmd+C/V в WebView.
            // Устанавливаем на уровне приложения И явно на каждое окно —
            // вторичные окна Tauri v2 не всегда наследуют app-level меню.
            #[cfg(target_os = "macos")]
            {
                let make_edit_menu = |h: &tauri::AppHandle| -> Result<Menu<tauri::Wry>, tauri::Error> {
                    let edit = Submenu::with_items(h, "Edit", true, &[
                        &PredefinedMenuItem::undo(h, None)?,
                        &PredefinedMenuItem::redo(h, None)?,
                        &PredefinedMenuItem::separator(h)?,
                        &PredefinedMenuItem::cut(h, None)?,
                        &PredefinedMenuItem::copy(h, None)?,
                        &PredefinedMenuItem::paste(h, None)?,
                        &PredefinedMenuItem::select_all(h, None)?,
                    ])?;
                    Menu::with_items(h, &[&edit])
                };

                let app_menu = make_edit_menu(&app_handle)?;
                app.set_menu(app_menu)?;

                // Явно на каждое окно (гарантия для вторичных окон).
                // previewWin'ов больше нет на старте — их меню ставит preview_open при создании.
                for label in &["main", "nodeWin", "logWindow"] {
                    if let Some(win) = app.get_webview_window(label) {
                        let win_menu = make_edit_menu(&app_handle)?;
                        let _ = win.set_menu(win_menu);
                    }
                }
            }

            // Закрытие main-окна = выход из приложения
            let app_for_exit = app_handle.clone();
            if let Some(main_win) = app_handle.get_webview_window("main") {
                let _ = main_win.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { .. } = event {
                        let app = app_for_exit.clone();
                        tauri::async_runtime::spawn(async move {
                            let _ = app.exit(0);
                        });
                    }
                });
            }

            Ok(())
        })
        .invoke_handler(specta.invoke_handler())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod specta_export_tests {
    /// Генерация `src/bindings.ts` без запуска GUI: `cargo test export_bindings`.
    /// Зеркалит debug-экспорт из `run()`, но запускается headless (в CI/без дисплея).
    #[test]
    fn export_bindings() {
        super::export_specta_bindings();
    }

    /// Достаёт имена из `<marker>[ … ]` — по одному идентификатору в строке,
    /// комментарии и пути вида `commands::mod::name` отбрасываются.
    fn list(src: &str, marker: &str) -> std::collections::BTreeSet<String> {
        let start = src.find(marker).unwrap_or_else(|| panic!("не найден {marker}"));
        let body = &src[start + marker.len()..];
        let end = body.find("])").expect("не найден конец списка");
        body[..end]
            .lines()
            .map(|l| l.split("//").next().unwrap_or("").trim().trim_end_matches(','))
            .filter(|l| !l.is_empty())
            .map(|l| l.rsplit("::").next().unwrap_or(l).to_string())
            .collect()
    }

    /// Страж от возвращения ДВУХ списков команд.
    ///
    /// Здесь когда-то стоял тест-сличитель: `collect_commands!` против
    /// `tauri::generate_handler!`. Он был нужен, пока списков было два и компилятор их
    /// расхождение не ловил — команда компилировалась, типизировалась, тесты были
    /// зелёные, а фронт получал «command not found» (так умер весь клиент хранилища,
    /// 26 команд).
    ///
    /// Сличать больше нечего: рантайм собирается из ТОГО ЖЕ списка через
    /// `specta.invoke_handler()`. Но вернуть `generate_handler!` рядом ничто не мешает,
    /// а это молча вернёт и всю проблему — поэтому сторожим сам факт единственности.
    #[test]
    fn список_команд_ровно_один() {
        let src = include_str!("lib.rs");

        assert!(
            src.contains(".invoke_handler(specta.invoke_handler())"),
            "рантайм больше не берёт команды из specta-билдера — вернулся второй источник истины"
        );

        // Комментарии снимаем: имя старого макроса живёт в пояснениях (и в этом
        // тесте), а искать надо ВЫЗОВ. Без этого страж падал бы на собственном тексте.
        let code: String = src
            .lines()
            .map(|l| l.split("//").next().unwrap_or(""))
            .collect::<Vec<_>>()
            .join("\n");
        let marker = concat!("generate_", "handler![");
        assert!(
            !code.contains(marker),
            "в lib.rs снова есть вызов {marker} — это второй список команд, и он разъедется с collect_commands!"
        );

        let specta = list(src, "collect_commands![");
        assert!(specta.len() > 200, "specta-список разобран не полностью: {}", specta.len());
        assert!(specta.contains("storage_connect_mock"), "парсер не видит storage-команд");
        // Команды, которые до 2026-08-11 жили только в рантайме и звались строкой.
        for raw in ["http_fetch", "process_item", "plugin_manager_call", "exec_command"] {
            assert!(specta.contains(raw), "{raw} потерялся при переходе на единый список");
        }
    }

    /// Встречный страж к тесту выше.
    ///
    /// Тот сторожит единственность списка. Здесь другое направление: каждая команда,
    /// которую фронт или плагин зовёт СЫРОЙ строкой (`invoke('имя')`), обязана в этом
    /// списке присутствовать.
    ///
    /// Зачем он остался и после перехода на единый список: сырой вызов строкой типы
    /// обходит по определению. Плагины зовут `http_fetch`/`exec_command` через
    /// `tauriAPI.invoke('имя')`, и переименование команды в Rust компилятор не заметит,
    /// `tsc` не заметит, а вызов сломается в рантайме. Ловится только текстовой сверкой.
    #[test]
    fn сырые_invoke_из_ts_существуют_в_рантайме() {
        use std::collections::BTreeSet;
        use std::path::Path;

        let runtime = list(include_str!("lib.rs"), "collect_commands![");
        assert!(runtime.len() > 50, "рантайм-список разобран не полностью: {}", runtime.len());

        fn collect(dir: &Path, out: &mut BTreeSet<String>) {
            let Ok(entries) = std::fs::read_dir(dir) else { return };
            for e in entries.flatten() {
                let p = e.path();
                if p.is_dir() {
                    if p.file_name().is_some_and(|n| n == "node_modules") {
                        continue;
                    }
                    collect(&p, out);
                    continue;
                }
                let is_ts = p.extension().is_some_and(|x| x == "ts" || x == "tsx");
                // bindings.ts сгенерён — имена там согласованы с Rust по построению.
                let generated = p.file_name().is_some_and(|n| n == "bindings.ts");
                if !is_ts || generated {
                    continue;
                }
                let Ok(text) = std::fs::read_to_string(&p) else { continue };
                let bytes = text.as_bytes();
                // Ищем ЛЮБОЙ вызывающий, чьё имя заканчивается на invoke: `invoke(`,
                // `tauriInvoke(`, `invokeHost(`. Наивный поиск подстроки "invoke(" видит
                // только первую форму — а через неё как раз почти ничего и не зовётся.
                for (idx, _) in text.match_indices('(') {
                    let mut start = idx;
                    while start > 0 {
                        let c = bytes[start - 1];
                        if c.is_ascii_alphanumeric() || c == b'_' {
                            start -= 1;
                        } else {
                            break;
                        }
                    }
                    let callee = &text[start..idx];
                    if !callee.to_ascii_lowercase().ends_with("invoke")
                        && !callee.to_ascii_lowercase().ends_with("invokehost")
                    {
                        continue;
                    }
                    let rest = text[idx + 1..].trim_start();
                    let Some(quote) = rest.chars().next() else { continue };
                    if quote != '\'' && quote != '"' && quote != '`' {
                        continue; // имя вычисляется — сверить нельзя
                    }
                    let body = &rest[1..];
                    let Some(end) = body.find(quote) else { continue };
                    let name = &body[..end];
                    // Берём только snake_case: camelCase — алиасы обёртки tauri-api,
                    // а имена с ':' принадлежат встроенным плагинам Tauri.
                    let snake = !name.is_empty()
                        && name.starts_with(|c: char| c.is_ascii_lowercase())
                        && name.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_');
                    if snake {
                        out.insert(name.to_string());
                    }
                }
            }
        }

        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("..");
        let mut called = BTreeSet::new();
        collect(&root.join("src"), &mut called);
        collect(&root.join("plugins-dev"), &mut called);

        // Иначе «пустой» разбор дал бы пустую разность и тест прошёл бы, ничего не проверив.
        assert!(
            called.len() > 20,
            "подозрительно мало сырых invoke найдено ({}) — сломался разбор, а не код",
            called.len()
        );

        let missing: Vec<_> = called.difference(&runtime).collect();
        assert!(
            missing.is_empty(),
            "TS зовёт команды, которых нет в списке команд — в рантайме это «command not found»: {missing:?}"
        );
    }
}
