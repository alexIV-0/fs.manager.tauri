// Per-file-type bounds для preview-окна. Портировано из electron/main/previewBounds.ts.
//
// Идея: каждый тип файла (video/audio/image/text/...) имеет свои сохранённые
// width/height/x/y. preview:resize не должен трогать размер/позицию, если для
// текущего типа уже есть сохранённые bounds — только применяет aspect ratio
// constraint. Это решает конфликт между "ресайз окна под видео" и "сохранить
// пользовательский размер".

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use tauri::Manager;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PreviewBounds {
    pub width: f64,
    pub height: f64,
    #[serde(default)]
    pub x: Option<f64>,
    #[serde(default)]
    pub y: Option<f64>,
}

const DEFAULT_BOUNDS: PreviewBounds = PreviewBounds {
    width: 800.0,
    height: 600.0,
    x: None,
    y: None,
};

/// Рантайм-реестр каскада preview-окон (НЕ персистится). На каждый тип файла храним
/// позицию (logical x,y) последнего заспавненного окна — это якорь для смещения
/// следующего окна того же типа (+offset). Сбрасывается, когда закрывается последнее
/// окно типа (см. on_preview_destroyed) — поэтому каскад не дрейфует между сессиями.
pub struct PreviewBoundsState {
    pub type_last_spawn: HashMap<String, (f64, f64)>,
}

impl PreviewBoundsState {
    pub fn new() -> Self {
        Self {
            type_last_spawn: HashMap::new(),
        }
    }
}

fn store_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("preview-bounds.json"))
}

pub fn normalize_type(t: &str) -> String {
    let trimmed = t.trim();
    if trimmed.is_empty() {
        "default".to_string()
    } else {
        trimmed.to_lowercase()
    }
}

/// Bucket для соотношения сторон. Используем три категории, чтобы у video/image
/// каждой ориентации был свой сохранённый размер — иначе горизонтальный 16:9
/// видео попадает в "залипшее" вертикальное окно от 9:16 и получает letterbox.
pub fn orientation_bucket(aspect: f64) -> &'static str {
    if aspect < 0.9 { "vertical" }
    else if aspect > 1.1 { "horizontal" }
    else { "square" }
}

/// Композитный ключ: "video_vertical", "image_horizontal", и т.д.
pub fn make_key(file_type: &str, aspect: f64) -> String {
    format!("{}_{}", file_type, orientation_bucket(aspect))
}

pub fn read_bounds_map(app: &tauri::AppHandle) -> HashMap<String, PreviewBounds> {
    let Ok(path) = store_path(app) else { return HashMap::new() };
    if !path.exists() {
        return HashMap::new();
    }
    let Ok(content) = fs::read_to_string(&path) else { return HashMap::new() };
    serde_json::from_str(&content).unwrap_or_default()
}

/// Возвращает bounds для типа + флаг hasSaved (есть ли запись именно для этого типа).
pub fn bounds_for_type(
    app: &tauri::AppHandle,
    file_type: &str,
) -> (PreviewBounds, bool) {
    let map = read_bounds_map(app);
    if let Some(b) = map.get(file_type) {
        return (b.clone(), true);
    }
    if let Some(b) = map.get("default") {
        return (b.clone(), false);
    }
    (DEFAULT_BOUNDS.clone(), false)
}

pub fn save_bounds(app: &tauri::AppHandle, file_type: &str, bounds: PreviewBounds) -> Result<(), String> {
    let path = store_path(app)?;
    let mut map = read_bounds_map(app);
    map.insert(file_type.to_string(), bounds);
    let content = serde_json::to_string_pretty(&map).map_err(|e| e.to_string())?;
    super::fs_commands::write_atomic(&path, content.as_bytes())
}

/// Возвращает любые сохранённые bounds для данного типа (любой ориентации).
/// Используется как initial size при создании окна — preview_resize потом подгонит
/// под актуальную ориентацию.
pub fn any_bounds_for_type(app: &tauri::AppHandle, file_type: &str) -> Option<PreviewBounds> {
    let map = read_bounds_map(app);
    for orient in &["vertical", "horizontal", "square"] {
        let key = format!("{}_{}", file_type, orient);
        if let Some(b) = map.get(&key) {
            return Some(b.clone());
        }
    }
    None
}
