// Превью-рендер кадра через ffmpeg для редакторов фильтров (keying, convert.v2,
// overlayAndOffset, ffSwitch). Универсален: на вход — render-spec (несколько входов +
// фильтрграф), на выход — один PNG-кадр в кэше app_data. Это «зелёный» (точный) ярус
// превью: то, что увидит пользователь, == то, что даст финальный экспорт, потому что
// фильтрграф строит тот же билдер плагина.
//
// Кэш: ключ = hash(namespace + filter_graph + complex + out_label + max_dim + time +
// для каждого входа path+seek+mtime). Файл уже есть → возвращаем cached=true, ffmpeg не
// запускаем. mtime входа в ключе → правка исходника инвалидирует кэш.
//
// Биндинги: команды регистрируются в lib.rs (collect_commands! + generate_handler!),
// src/bindings.ts регенерируется в debug.

use serde::{Deserialize, Serialize};
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use tauri::Manager;

use super::process_utils::HiddenConsole;
use super::settings_commands::AppSettingsState;

// ==================== Типы (→ TS через specta) ====================

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PreviewInput {
    /// Абсолютный путь к исходнику (видео/картинка).
    pub path: String,
    /// Позиция входного seek в секундах. None → берётся `spec.time`. 0 → seek не добавляется
    /// (важно для картинок: `-ss >0` на image2 может не отдать кадр).
    pub seek: Option<f64>,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PreviewRenderSpec {
    /// Входы по порядку (`-i`). Для keying/convert — один; для overlay/ffSwitch — несколько.
    pub inputs: Vec<PreviewInput>,
    /// Фильтрграф. complex=false → идёт в `-vf` (один вход). complex=true → в
    /// `-filter_complex`, и граф ОБЯЗАН заканчиваться меткой `out_label` (напр. `[out]`).
    pub filter_graph: String,
    /// true → многовходовой `-filter_complex` + `-map out_label`. false → `-vf`.
    #[serde(default)]
    pub complex: bool,
    /// Метка выходного пада для complex-графа (по умолчанию `[out]`). Для `-vf` игнорируется.
    pub out_label: Option<String>,
    /// Время кадра (сек) — в ключ кэша и как seek по умолчанию для входов без своего seek.
    pub time: f64,
    /// Ограничение по длинной стороне (proxy для скорости). None/0 → исходный размер.
    pub max_dim: Option<u32>,
    /// Неймспейс кэша (имя плагина: "keying", "convert"…) — раздел в папке кэша.
    pub namespace: String,
}

#[derive(Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PreviewFrameResult {
    /// Абсолютный путь к PNG в кэше (фронт превращает в asset-URL через toFileUrl).
    pub path: String,
    /// true → кадр был уже в кэше, ffmpeg не запускался.
    pub cached: bool,
}

// ==================== Кэш-папка / ключ ====================

fn preview_cache_dir(app: &tauri::AppHandle, namespace: &str) -> Result<PathBuf, String> {
    // Санитизация неймспейса — только [A-Za-z0-9_-], иначе path-traversal.
    let ns: String = namespace
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-')
        .collect();
    let ns = if ns.is_empty() { "default".to_string() } else { ns };
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {}", e))?
        .join("preview-cache")
        .join(ns);
    std::fs::create_dir_all(&dir).map_err(|e| format!("create_dir_all: {}", e))?;
    Ok(dir)
}

fn file_mtime_nanos(path: &str) -> u64 {
    std::fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0)
}

/// Стабильный (детерминированный между запусками) ключ кадра. DefaultHasher::new()
/// фиксирует сид, так что один и тот же spec даёт один и тот же файл.
fn compute_key(spec: &PreviewRenderSpec) -> String {
    let mut h = DefaultHasher::new();
    spec.namespace.hash(&mut h);
    spec.filter_graph.hash(&mut h);
    spec.complex.hash(&mut h);
    spec.out_label.hash(&mut h);
    spec.max_dim.hash(&mut h);
    // f64 не реализует Hash — округляем время до мс.
    ((spec.time * 1000.0).round() as i64).hash(&mut h);
    for inp in &spec.inputs {
        inp.path.hash(&mut h);
        let seek = inp.seek.unwrap_or(spec.time);
        ((seek * 1000.0).round() as i64).hash(&mut h);
        file_mtime_nanos(&inp.path).hash(&mut h);
    }
    format!("{:016x}", h.finish())
}

// ==================== Сборка аргументов ffmpeg ====================

fn build_ffmpeg_args(spec: &PreviewRenderSpec, out_path: &Path) -> Vec<String> {
    let mut a: Vec<String> = vec![
        "-hide_banner".into(),
        "-loglevel".into(),
        "error".into(),
    ];

    for inp in &spec.inputs {
        let seek = inp.seek.unwrap_or(spec.time);
        if seek > 0.0 {
            a.push("-ss".into());
            a.push(format!("{}", seek));
        }
        a.push("-i".into());
        a.push(inp.path.clone());
    }

    a.push("-frames:v".into());
    a.push("1".into());

    let md = spec.max_dim.filter(|m| *m > 0);
    // scale-в-рамку: вписать в md×md с сохранением пропорций.
    let scale = |m: u32| format!("scale={}:{}:force_original_aspect_ratio=decrease", m, m);

    if spec.complex {
        let out = spec.out_label.clone().unwrap_or_else(|| "[out]".into());
        let (graph, map) = match md {
            Some(m) => (
                format!("{};{}{}[__pv]", spec.filter_graph, out, scale(m)),
                "[__pv]".to_string(),
            ),
            None => (spec.filter_graph.clone(), out),
        };
        a.push("-filter_complex".into());
        a.push(graph);
        a.push("-map".into());
        a.push(map);
    } else {
        let mut vf = spec.filter_graph.clone();
        if let Some(m) = md {
            vf = if vf.is_empty() {
                scale(m)
            } else {
                format!("{},{}", vf, scale(m))
            };
        }
        if !vf.is_empty() {
            a.push("-vf".into());
            a.push(vf);
        }
    }

    a.push("-y".into());
    a.push(out_path.to_string_lossy().to_string());
    a
}

// ==================== Команды ====================

#[tauri::command]
#[specta::specta]
pub async fn preview_render_frame(
    app: tauri::AppHandle,
    state: tauri::State<'_, Mutex<AppSettingsState>>,
    spec: PreviewRenderSpec,
) -> Result<PreviewFrameResult, String> {
    if spec.inputs.is_empty() {
        return Err("preview_render_frame: пустой список входов".into());
    }

    // Всё, что требует state, делаем синхронно до запуска ffmpeg.
    let ffmpeg = super::ffmpeg_commands::resolve_program_path("ffmpeg", &state);
    let cache_dir = preview_cache_dir(&app, &spec.namespace)?;
    let out_path = cache_dir.join(format!("{}.png", compute_key(&spec)));

    if out_path.exists() {
        return Ok(PreviewFrameResult {
            path: out_path.to_string_lossy().to_string(),
            cached: true,
        });
    }

    let args = build_ffmpeg_args(&spec, &out_path);
    let output = Command::new(&ffmpeg)
        .args(&args)
        .hide_console()
        .output()
        .map_err(|e| format!("не удалось запустить ffmpeg: {}", e))?;

    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        let tail = err.lines().rev().find(|l| !l.trim().is_empty()).unwrap_or("").trim();
        return Err(format!("ffmpeg: {}", tail));
    }
    if !out_path.exists() {
        return Err("ffmpeg отработал, но кадр не создан".into());
    }

    // Вытесняем старое только после РЕАЛЬНОЙ записи: на попадании в кэш каталог
    // не читаем, чтобы не платить листингом за каждый кадр.
    evict_cache_dir(&cache_dir, CACHE_MAX_ENTRIES);

    Ok(PreviewFrameResult {
        path: out_path.to_string_lossy().to_string(),
        cached: false,
    })
}


/// Сколько файлов держим в одном разделе кэша превью.
///
/// Кэш лежит на диске и раньше не вытеснялся вообще: ключ включает позицию кадра, то
/// есть каждое движение по таймлайну добавляло новый PNG навсегда. Команда
/// `preview_clear_cache` существует, но её никто не вызывает — значит расти было нечем
/// ограничено, и при настройке фильтров по многим видео в app_data накапливались
/// гигабайты. Двести кадров на раздел — с запасом для работы и предсказуемо по объёму.
const CACHE_MAX_ENTRIES: usize = 200;

/// Удаляет самые старые файлы раздела, пока их не станет `max`.
///
/// Порядок — по времени изменения: у кэша, где ключ = хэш входа, «старый по mtime»
/// это и есть «давно не пригождался», потому что попадание в кэш файл не трогает.
/// Ошибки глушим намеренно: не смогли подчистить — это не повод рушить рендер кадра.
fn evict_cache_dir(dir: &Path, max: usize) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    let mut files: Vec<(std::time::SystemTime, PathBuf)> = entries
        .flatten()
        .filter_map(|e| {
            let path = e.path();
            let meta = e.metadata().ok()?;
            if !meta.is_file() {
                return None;
            }
            Some((meta.modified().ok()?, path))
        })
        .collect();

    if files.len() <= max {
        return;
    }

    files.sort_by_key(|(mtime, _)| *mtime);
    let to_drop = files.len() - max;
    for (_, path) in files.into_iter().take(to_drop) {
        let _ = std::fs::remove_file(path);
    }
}

/// Чистка кэша превью. namespace=None → весь preview-cache; Some(ns) → только раздел.
#[tauri::command]
#[specta::specta]
pub fn preview_clear_cache(app: tauri::AppHandle, namespace: Option<String>) -> Result<(), String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {}", e))?
        .join("preview-cache");
    let target = match namespace {
        Some(ns) => {
            let ns: String = ns
                .chars()
                .filter(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-')
                .collect();
            root.join(ns)
        }
        None => root,
    };
    if target.exists() {
        std::fs::remove_dir_all(&target).map_err(|e| format!("remove_dir_all: {}", e))?;
    }
    Ok(())
}

// ==================== Превью аудио региона (с -af фильтрами) ====================

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PreviewAudioSpec {
    /// Абсолютный путь к исходнику (видео/аудио).
    pub path: String,
    /// Начало региона (сек).
    pub start: f64,
    /// Длительность региона (сек).
    pub duration: f64,
    /// `-af` цепочка аудио-фильтров (может быть пустой → просто вырезка региона).
    pub filter: String,
}

#[derive(Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PreviewAudioResult {
    /// Абсолютный путь к WAV в кэше (фронт превращает в asset-URL через toFileUrl).
    pub path: String,
    pub cached: bool,
}

fn compute_audio_key(spec: &PreviewAudioSpec) -> String {
    let mut h = DefaultHasher::new();
    spec.path.hash(&mut h);
    spec.filter.hash(&mut h);
    spec.start.to_bits().hash(&mut h);
    spec.duration.to_bits().hash(&mut h);
    file_mtime_nanos(&spec.path).hash(&mut h);
    format!("{:016x}", h.finish())
}

#[tauri::command]
#[specta::specta]
pub async fn preview_render_audio(
    app: tauri::AppHandle,
    state: tauri::State<'_, Mutex<AppSettingsState>>,
    spec: PreviewAudioSpec,
) -> Result<PreviewAudioResult, String> {
    if spec.path.is_empty() || spec.duration <= 0.0 {
        return Err("preview_render_audio: пустой путь или нулевая длительность".into());
    }

    let ffmpeg = super::ffmpeg_commands::resolve_program_path("ffmpeg", &state);
    let cache_dir = preview_cache_dir(&app, "audio")?;
    let out_path = cache_dir.join(format!("{}.wav", compute_audio_key(&spec)));

    if out_path.exists() {
        return Ok(PreviewAudioResult {
            path: out_path.to_string_lossy().to_string(),
            cached: true,
        });
    }

    let mut args: Vec<String> = vec![
        "-hide_banner".into(),
        "-loglevel".into(),
        "error".into(),
        "-ss".into(),
        format!("{}", spec.start),
        "-i".into(),
        spec.path.clone(),
        "-t".into(),
        format!("{}", spec.duration),
        "-vn".into(),
    ];
    if !spec.filter.trim().is_empty() {
        args.push("-af".into());
        args.push(spec.filter.clone());
    }
    args.push("-y".into());
    args.push(out_path.to_string_lossy().to_string());

    let output = Command::new(&ffmpeg)
        .args(&args)
        .hide_console()
        .output()
        .map_err(|e| format!("не удалось запустить ffmpeg: {}", e))?;

    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        let tail = err.lines().rev().find(|l| !l.trim().is_empty()).unwrap_or("").trim();
        return Err(format!("ffmpeg: {}", tail));
    }
    if !out_path.exists() {
        return Err("ffmpeg отработал, но аудио не создано".into());
    }

    // Аудио-раздел кэша тоже вытесняем: wav-и заметно крупнее кадров.
    evict_cache_dir(&cache_dir, CACHE_MAX_ENTRIES);

    Ok(PreviewAudioResult {
        path: out_path.to_string_lossy().to_string(),
        cached: false,
    })
}

#[cfg(test)]
mod cache_tests {
    use super::{evict_cache_dir, CACHE_MAX_ENTRIES};
    use std::fs;
    use std::path::PathBuf;

    fn tmp(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("fsm-prevcache-{}-{}", std::process::id(), tag));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    /// Ключ кэша включает позицию кадра, поэтому каждое движение по таймлайну добавляло
    /// новый PNG — навсегда, потому что `preview_clear_cache` никто не вызывает.
    /// Проверяем, что вытеснение оставляет ровно лимит и убирает САМЫЕ СТАРЫЕ.
    #[test]
    fn вытесняет_самые_старые_до_лимита() {
        let dir = tmp("evict");
        // Пишем 5 файлов с заведомо разным mtime (задаём вручную, чтобы не спать).
        for i in 0..5u32 {
            let p = dir.join(format!("{i}.png"));
            fs::write(&p, b"x").unwrap();
            let t = filetime::FileTime::from_unix_time(1_000_000 + i as i64 * 10, 0);
            filetime::set_file_mtime(&p, t).unwrap();
        }

        evict_cache_dir(&dir, 2);

        let mut left: Vec<String> = fs::read_dir(&dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().to_string())
            .collect();
        left.sort();
        assert_eq!(left, vec!["3.png".to_string(), "4.png".to_string()], "остаться должны свежие");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn ниже_лимита_ничего_не_трогает() {
        let dir = tmp("keep");
        fs::write(dir.join("a.png"), b"x").unwrap();
        fs::write(dir.join("b.png"), b"x").unwrap();
        evict_cache_dir(&dir, CACHE_MAX_ENTRIES);
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 2);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn отсутствующий_каталог_не_ломает() {
        let missing = std::env::temp_dir().join("fsm-prevcache-nope-xyz");
        let _ = std::fs::remove_dir_all(&missing);
        evict_cache_dir(&missing, 10); // не должно паниковать
    }
}
