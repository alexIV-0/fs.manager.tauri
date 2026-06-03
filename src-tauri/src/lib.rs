#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;

use commands::{
    fs_commands::*,
    window_commands::*,
    log_archive::*,
    diag_log::*,
    watch_commands::*,
    processing_commands::*,
    plugin_commands::*,
    dialog_commands::*,
    camelcase_wrappers::*,
    window_state::*,
    exec_commands::*,
    ffmpeg_commands::*,
    ae_commands::*,
    settings_commands::*,
    docs_commands::*,
    http_commands::*,
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
/// Содержит ТОЛЬКО snake-реализации (НЕ camel-обёртки) — см. SPECTA_MIGRATION_PLAN.md §4.
/// `generate_handler!` ниже пока остаётся ЕДИНСТВЕННЫМ источником истины для рантайма;
/// этот билдер НЕ монтируется в `tauri::Builder` — используется исключительно для
/// `export()` в debug-сборке. Поэтому коллизий имён в рантайме нет, поведение не меняется.
///
/// Пилот миграции: модуль `ae_commands` (2 команды). Остальные модули добавляются
/// в `collect_commands!` по мере миграции.
#[cfg(debug_assertions)]
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
    // Export-only: в debug пересобираем src/bindings.ts из specta-билдера.
    // generate_handler! НЕ трогаем — он остаётся invoke_handler'ом приложения.
    #[cfg(debug_assertions)]
    export_specta_bindings();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
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

            // Инициализируем ExecState с ссылкой на abort_signal из ProcessingState
            let processing_state_mutex = app.state::<std::sync::Mutex<commands::processing_commands::ProcessingState>>();
            let processing_state = processing_state_mutex.lock().unwrap();
            let abort_flag = processing_state.abort_signal.clone();
            drop(processing_state);
            let exec_state = commands::exec_commands::ExecState::new(abort_flag);
            app.manage(exec_state);
            
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
        .invoke_handler(tauri::generate_handler![
            // Native file icon (drag-preview)
            commands::icon_commands::get_file_icon,
            // File system commands
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
            write_binary_file,
            check_file_path,
            check_folder_path,
            get_some_from_folder,
            list_subfolders,
            recursive_find_files,
            get_user_data_path,
            get_plugins_dev_path,
            getPluginsDevPath,
            get_platform_target,
            getPlatformTarget,
            get_cpu_count,
            getCpuCount,
            fonts_get_list,
            fonts_load_one,
            // CamelCase wrappers (frontend compatible)
            getFileInfo,
            getFileTypeByExtname,
            testAndCreateFolder,
            testAndCreateFolders,
            createTextFile,
            renameFolder,
            setPathMtime,
            copyItem,
            moveItem,
            deleteItem,
            readFileSync,
            readMediaPreview,
            writeFile,
            getSomeFromFolder,
            listSubfolders,
            recursiveFindFiles,
            getOptionsFolder,
            checkFilePath,
            checkFolderPath,
            fontsGetList,
            fontsLoadOne,
            shellOpenPath,
            openNodeWindow,
            abortProcessing,
            processItem,
            setStatusBar,
            sendLog,
            sendNodeStart,
            sendNodeDone,
            sendNodeError,
            sendProcessComplete,
            // Dialog commands (мигрированы на specta — snake-имена, реальные реализации)
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
            // Window state (мигрирован на specta — camel saveWindowState/loadWindowState удалены)
            save_window_state,
            load_window_state,
            // Path utilities: только path_join (его зовут плагины через IPC);
            // basename/dirname/extname/parse/relative удалены — приложение считает в renderer.
            path_join,
            // Window commands
            open_node_window,
            request_node_window_data,
            request_data_from_main_window,
            send_data_to_node_window,
            preview_open,
            preview_resize,
            preview_detect_alpha,
            preview_transcode_webm,
            preview_delete_temp,
            open_devtools,
            request_data,
            // Log window
            log_message,
            log_window_open,
            log_window_toggle,
            log_window_close,
            log_window_get_status,
            log_window_get_history,
            log_window_clear,
            log_window_export,
            log_window_open_quick,
            log_window_open_errors_only,
            log_window_has_errors,
            log_window_get_recent,
            log_window_get_errors,
            log_window_emit_item_start,
            log_window_emit_item_log,
            log_window_emit_node_update,
            log_window_emit_item_end,
            log_window_emit_item_queued,
            log_window_emit_substep_batch,
            log_window_emit_abort_queued,
            log_archive_list_days,
            log_archive_get_day,
            log_archive_cleanup,
            log_archive_clear,
            diag_log_write,
            diag_log_path,
            diag_log_clear,
            intercept_console,
            restore_console,
            // File watcher
            fs_watch_start,
            fs_watch_stop,
            // Processing
            abort_processing,
            is_processing_aborted,
            reset_processing_signal,
            set_processing_progress,
            get_processing_progress,
            add_processing_error,
            move_to_errors,
            processing_delete_item,
            path_exists,
            get_item_info,
            process_item,
            set_status_bar,
            send_log,
            send_node_start,
            send_node_done,
            send_node_error,
            send_process_complete,
            // External command (exec)
            exec_command,
            kill_all_exec_processes,
            // FFmpeg
            ffmpeg_get_path,
            ffprobe_get_path,
            ffprobe_get_info,
            ffmpeg_get_video_thumbnail,
            ffmpeg_exec_with_progress,
            read_media_preview_with_ffmpeg,
            // After Effects
            run_script_in_ae,
            launch_ae_with_script,
            // App Settings & Color Types
            app_settings_get,
            app_settings_set,
            app_settings_patch,
            color_types_get,
            color_types_set,
            color_types_rescan,
            color_types_add,
            color_types_remove,
            // File Types & Program Paths
            file_types_get,
            file_types_set,
            program_paths_get,
            program_paths_set,
            // Cleanup & DB
            cleanup_auto_delete,
            db_register_found,
            // Docs
            docs_list,
            docs_read,
            // HTTP (Rust-side, no CORS)
            http_fetch,
            http_upload,
            http_download,
            // Plugins
            plugin_manager_init,
            plugin_manager_load_plugin,
            plugin_manager_unload_plugin,
            plugin_manager_get_all_plugins,
            plugin_manager_get_plugins_by_type,
            plugin_manager_get_plugin,
            plugin_manager_get_plugin_ui,
            plugin_manager_get_all_ui_nodes,
            plugin_manager_get_ui_nodes,
            plugin_manager_list,
            plugin_manager_get_state,
            plugin_manager_call,
            plugin_manager_install,
            plugin_manager_delete,
            plugin_manager_destroy,
        ])
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
}
