#![allow(dead_code)]

use notify::{Config, Event, RecommendedWatcher, RecursiveMode, Watcher};
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::Emitter;

pub struct WatcherState {
    pub watchers: HashMap<String, RecommendedWatcher>,
}

impl WatcherState {
    pub fn new() -> Self {
        Self {
            watchers: HashMap::new(),
        }
    }
}

#[tauri::command]
pub fn fs_watch_start(
    folder_path: String,
    app: tauri::AppHandle,
    state: tauri::State<Mutex<WatcherState>>,
) -> Result<(), String> {
    let mut state = state.lock().map_err(|e| e.to_string())?;

    // Если уже следим - не дублируем
    if state.watchers.contains_key(&folder_path) {
        return Ok(());
    }

    let folder_path_clone = folder_path.clone();
    let app_clone = app.clone();

    let mut watcher = RecommendedWatcher::new(
        move |result: Result<Event, notify::Error>| {
            if let Ok(event) = result {
                for path in event.paths {
                    let path_str = path.to_string_lossy().to_string();
                    let _ = app_clone.emit("fs-changed", &path_str);
                }
            }
        },
        Config::default(),
    )
    .map_err(|e| e.to_string())?;

    watcher
        .watch(
            std::path::Path::new(&folder_path),
            RecursiveMode::Recursive,
        )
        .map_err(|e| e.to_string())?;

    state.watchers.insert(folder_path_clone, watcher);
    Ok(())
}

#[tauri::command]
pub fn fs_watch_stop(
    folder_path: String,
    state: tauri::State<Mutex<WatcherState>>,
) -> Result<(), String> {
    let mut state = state.lock().map_err(|e| e.to_string())?;

    if let Some(watcher) = state.watchers.remove(&folder_path) {
        // Watcher автоматически останавливается при drop
        drop(watcher);
    }

    Ok(())
}

pub fn stop_all_watchers(state: &mut WatcherState) {
    state.watchers.clear();
    // Все watcher'ы автоматически закрываются при drop
}
