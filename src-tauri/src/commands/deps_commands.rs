// Авто-загрузка зависимостей: ffmpeg/ffprobe и whisper-модели.
//
// Идея: ничего не бандлим в приложение — качаем по требованию в app_data_dir и
// подключаем в те же настройки, что и ручной выбор (programPaths.json / folderPath).
//
// ffmpeg: единого источника «со всем» нет, поэтому держим список кандидат-сборок на
// платформу (предпочитая full/gpl) и после скачивания прогоняем через GATE —
// проверяем, что сборка содержит всё, что используют плагины (ffmpeg_requirements.json).
// Берём первый кандидат, прошедший gate. Источники подтверждены эмпирически (hap+snappy,
// libass, libx264): martin-riedl (mac/linux, стабильный latest-redirect) + BtbN gpl (win).
// Все источники отдают .zip → хватает уже подключённого crate `zip`.
//
// Биндинги: команды зарегистрированы в lib.rs (collect_commands! + generate_handler!),
// src/bindings.ts регенерируется автоматически в debug.

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use tauri::{Emitter, Manager};

use super::process_utils::HiddenConsole;
use super::settings_commands::AppSettingsState;

// Манифест требуемых возможностей — вшивается в бинарь; его же читает dev-сканер.
const FFMPEG_REQUIREMENTS: &str = include_str!("../../ffmpeg_requirements.json");

// ==================== Манифест ====================

#[derive(Debug, Clone, Deserialize)]
struct Requirements {
    required: RequiredCaps,
    optional: OptionalCaps,
}

#[derive(Debug, Clone, Deserialize)]
struct RequiredCaps {
    encoders: Vec<String>,
    filters: Vec<String>,
    demuxers: Vec<String>,
    #[serde(default)]
    encoder_opts: HashMap<String, Vec<String>>,
}

#[derive(Debug, Clone, Deserialize)]
struct OptionalCaps {
    encoders: Vec<String>,
    #[serde(default)]
    filters: Vec<String>,
}

fn load_requirements() -> Result<Requirements, String> {
    serde_json::from_str(FFMPEG_REQUIREMENTS)
        .map_err(|e| format!("ffmpeg_requirements.json parse error: {}", e))
}

// ==================== Типы результатов (→ TS через specta) ====================

#[derive(Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FfmpegStatus {
    pub installed: bool,
    pub version: Option<String>,
    pub ffmpeg_path: Option<String>,
    pub ffprobe_path: Option<String>,
}

#[derive(Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FfmpegInstallResult {
    /// true только если ffmpeg+ffprobe скачаны И gate по required пройден.
    pub ok: bool,
    pub version: Option<String>,
    pub source: Option<String>,
    pub ffmpeg_path: Option<String>,
    pub ffprobe_path: Option<String>,
    /// Отсутствующие ОБЯЗАТЕЛЬНЫЕ возможности (если непусто → ok=false, пути не подключать).
    pub missing_required: Vec<String>,
    /// Отсутствующие необязательные (предупреждение в UI, не блок).
    pub missing_optional: Vec<String>,
}

#[derive(Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct WhisperModel {
    pub name: String,
    pub filename: String,
    pub size_bytes: u64,
    pub size_label: String,
    pub downloaded: bool,
    pub recommended: bool,
}

// ==================== app_data пути ====================

fn app_data(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {}", e))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("create_dir_all: {}", e))?;
    Ok(dir)
}

fn bin_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app_data(app)?.join("bin");
    std::fs::create_dir_all(&dir).map_err(|e| format!("create_dir_all bin: {}", e))?;
    Ok(dir)
}

fn models_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app_data(app)?.join("whisper-models");
    std::fs::create_dir_all(&dir).map_err(|e| format!("create_dir_all whisper-models: {}", e))?;
    Ok(dir)
}

fn exe_name(base: &str) -> String {
    if cfg!(target_os = "windows") {
        format!("{}.exe", base)
    } else {
        base.to_string()
    }
}

// ==================== Источники ffmpeg ====================

struct FfSource {
    name: &'static str,
    /// zip с ffmpeg-бинарником.
    ffmpeg_zip: String,
    /// zip с ffprobe-бинарником (может совпадать с ffmpeg_zip — тогда один скачиваем).
    ffprobe_zip: String,
}

fn platform_target() -> String {
    let os = std::env::consts::OS;
    let arch = std::env::consts::ARCH;
    match (os, arch) {
        ("macos", "aarch64") => "mac-arm64",
        ("macos", _) => "mac-x64",
        ("windows", "aarch64") => "win-arm64",
        ("windows", _) => "win-x64",
        ("linux", "aarch64") => "linux-arm64",
        ("linux", _) => "linux-x64",
        _ => "unknown",
    }
    .to_string()
}

/// martin-riedl latest-redirect: стабильный URL, отдаёт ffmpeg/ffprobe раздельными zip.
fn mr(os: &str, arch: &str, bin: &str) -> String {
    format!(
        "https://ffmpeg.martin-riedl.de/redirect/latest/{}/{}/release/{}.zip",
        os, arch, bin
    )
}

/// Кандидат-источники под платформу (по приоритету). Финальный выбор — за gate.
fn ffmpeg_sources(target: &str) -> Vec<FfSource> {
    match target {
        "mac-arm64" => vec![
            FfSource {
                name: "martin-riedl (macos/arm64)",
                ffmpeg_zip: mr("macos", "arm64", "ffmpeg"),
                ffprobe_zip: mr("macos", "arm64", "ffprobe"),
            },
            FfSource {
                name: "osxexperts (arm64)",
                ffmpeg_zip: "https://www.osxexperts.net/ffmpeg81arm.zip".into(),
                ffprobe_zip: "https://www.osxexperts.net/ffprobe81arm.zip".into(),
            },
        ],
        "mac-x64" => vec![
            FfSource {
                name: "martin-riedl (macos/amd64)",
                ffmpeg_zip: mr("macos", "amd64", "ffmpeg"),
                ffprobe_zip: mr("macos", "amd64", "ffprobe"),
            },
            FfSource {
                name: "evermeet (intel)",
                ffmpeg_zip: "https://evermeet.cx/ffmpeg/getrelease/ffmpeg/zip".into(),
                ffprobe_zip: "https://evermeet.cx/ffmpeg/getrelease/ffprobe/zip".into(),
            },
        ],
        "win-x64" => {
            let z = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip".to_string();
            vec![FfSource {
                name: "BtbN (win64-gpl)",
                ffmpeg_zip: z.clone(),
                ffprobe_zip: z,
            }]
        }
        "win-arm64" => {
            // Своего win-arm64 gpl нет → берём win64 (идёт через эмуляцию).
            let z = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip".to_string();
            vec![FfSource {
                name: "BtbN (win64-gpl, emulated on arm64)",
                ffmpeg_zip: z.clone(),
                ffprobe_zip: z,
            }]
        }
        "linux-x64" => vec![FfSource {
            name: "martin-riedl (linux/amd64)",
            ffmpeg_zip: mr("linux", "amd64", "ffmpeg"),
            ffprobe_zip: mr("linux", "amd64", "ffprobe"),
        }],
        "linux-arm64" => vec![FfSource {
            name: "martin-riedl (linux/arm64)",
            ffmpeg_zip: mr("linux", "arm64", "ffmpeg"),
            ffprobe_zip: mr("linux", "arm64", "ffprobe"),
        }],
        _ => vec![],
    }
}

// ==================== Прогресс-события ====================

/// Эмитит `deps-progress`. id: "ffmpeg" или имя файла модели. phase: download|extract|verify|done|error.
fn emit_progress(
    app: &tauri::AppHandle,
    id: &str,
    phase: &str,
    text: &str,
    downloaded: u64,
    total: Option<u64>,
) {
    let percent = match total {
        Some(t) if t > 0 => (downloaded as f64 / t as f64 * 100.0).min(100.0),
        _ => 0.0,
    };
    let _ = app.emit(
        "deps-progress",
        serde_json::json!({
            "id": id,
            "phase": phase,
            "text": text,
            "downloaded": downloaded,
            "total": total,
            "percent": percent,
        }),
    );
}

// ==================== Скачивание (reqwest streaming) ====================

async fn download_to(
    app: &tauri::AppHandle,
    url: &str,
    dest: &Path,
    progress_id: &str,
    label: &str,
) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .user_agent("fs-manager-tauri")
        .build()
        .map_err(|e| e.to_string())?;

    let mut res = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("download request failed ({}): {}", url, e))?;
    if !res.status().is_success() {
        return Err(format!("HTTP {} downloading {}", res.status(), url));
    }

    let total = res.content_length();
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let mut file = std::fs::File::create(dest).map_err(|e| e.to_string())?;

    let mut downloaded: u64 = 0;
    let mut last = std::time::Instant::now();
    let mut first = true;
    emit_progress(app, progress_id, "download", label, 0, total);

    while let Some(chunk) = res
        .chunk()
        .await
        .map_err(|e| format!("download stream error: {}", e))?
    {
        file.write_all(&chunk).map_err(|e| e.to_string())?;
        downloaded += chunk.len() as u64;
        if first || last.elapsed().as_millis() >= 150 {
            first = false;
            last = std::time::Instant::now();
            emit_progress(app, progress_id, "download", label, downloaded, total);
        }
    }
    file.flush().map_err(|e| e.to_string())?;
    emit_progress(
        app,
        progress_id,
        "download",
        label,
        downloaded,
        total.or(Some(downloaded)),
    );
    Ok(())
}

// ==================== Распаковка zip ====================

/// Извлекает из zip первый файл, чей basename == `target` (поддерживает и плоские,
/// и вложенные `*/bin/ffmpeg.exe` архивы). Возвращает true если нашёл и записал.
fn extract_binary_from_zip(zip_path: &Path, target: &str, dest: &Path) -> Result<bool, String> {
    let data = std::fs::read(zip_path).map_err(|e| e.to_string())?;
    let mut archive =
        zip::ZipArchive::new(std::io::Cursor::new(data)).map_err(|e| e.to_string())?;

    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        if entry.is_dir() {
            continue;
        }
        let name = entry.name().to_string();
        let base = Path::new(&name)
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        if base.eq_ignore_ascii_case(target) {
            let mut out = std::fs::File::create(dest).map_err(|e| e.to_string())?;
            std::io::copy(&mut entry, &mut out).map_err(|e| e.to_string())?;
            set_executable(dest)?;
            return Ok(true);
        }
    }
    Ok(false)
}

#[cfg(unix)]
fn set_executable(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    let mut perms = std::fs::metadata(path).map_err(|e| e.to_string())?.permissions();
    perms.set_mode(0o755);
    std::fs::set_permissions(path, perms).map_err(|e| e.to_string())
}

#[cfg(not(unix))]
fn set_executable(_path: &Path) -> Result<(), String> {
    Ok(())
}

// ==================== GATE: проверка возможностей сборки ====================

/// Парсит вывод `ffmpeg -encoders/-filters/-demuxers` → множество имён (2-й токен строки).
fn parse_capability_names(output: &str) -> HashSet<String> {
    let mut set = HashSet::new();
    for line in output.lines() {
        let toks: Vec<&str> = line.split_whitespace().collect();
        if toks.len() < 2 || toks[1] == "=" {
            continue; // заголовки/легенда (` V..... = Video`)
        }
        // Колонка флагов — только буквы и точки (V....D, TSC, D.). Иначе это не строка списка.
        if !toks[0].chars().all(|c| c.is_ascii_alphabetic() || c == '.') {
            continue;
        }
        set.insert(toks[1].to_string());
    }
    set
}

fn run_ffmpeg(ffmpeg: &Path, args: &[&str]) -> Result<String, String> {
    let out = Command::new(ffmpeg)
        .args(args)
        .hide_console()
        .output()
        .map_err(|e| format!("failed to run ffmpeg: {}", e))?;
    // ffmpeg печатает списки в stdout, версию/help — тоже; объединяем на всякий случай.
    let mut s = String::from_utf8_lossy(&out.stdout).to_string();
    s.push('\n');
    s.push_str(&String::from_utf8_lossy(&out.stderr));
    Ok(s)
}

struct GateResult {
    version: String,
    missing_required: Vec<String>,
    missing_optional: Vec<String>,
}

/// Прогоняет gate: версия + наличие required/optional возможностей + опции энкодеров.
fn run_gate(ffmpeg: &Path, ffprobe: &Path, req: &Requirements) -> Result<GateResult, String> {
    // ffprobe должен хотя бы запускаться.
    let probe_ok = Command::new(ffprobe)
        .arg("-version")
        .hide_console()
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);
    if !probe_ok {
        return Err("ffprobe не запускается".into());
    }

    let version = run_ffmpeg(ffmpeg, &["-hide_banner", "-version"])?
        .lines()
        .next()
        .unwrap_or("")
        .trim()
        .to_string();

    let encoders = parse_capability_names(&run_ffmpeg(ffmpeg, &["-hide_banner", "-encoders"])?);
    let filters = parse_capability_names(&run_ffmpeg(ffmpeg, &["-hide_banner", "-filters"])?);
    let demuxers = parse_capability_names(&run_ffmpeg(ffmpeg, &["-hide_banner", "-demuxers"])?);

    let mut missing_required = Vec::new();
    for e in &req.required.encoders {
        if !encoders.contains(e) {
            missing_required.push(format!("encoder:{}", e));
        }
    }
    for f in &req.required.filters {
        if !filters.contains(f) {
            missing_required.push(format!("filter:{}", f));
        }
    }
    for d in &req.required.demuxers {
        if !demuxers.contains(d) {
            missing_required.push(format!("demuxer:{}", d));
        }
    }
    // Опции энкодеров (напр. hap → snappy): проверяем только если сам энкодер есть.
    for (enc, opts) in &req.required.encoder_opts {
        if encoders.contains(enc) {
            let help = run_ffmpeg(ffmpeg, &["-hide_banner", "-h", &format!("encoder={}", enc)])
                .unwrap_or_default();
            for opt in opts {
                if !help.contains(opt.as_str()) {
                    missing_required.push(format!("encoder_opt:{}:{}", enc, opt));
                }
            }
        }
    }

    let mut missing_optional = Vec::new();
    for e in &req.optional.encoders {
        if !encoders.contains(e) {
            missing_optional.push(format!("encoder:{}", e));
        }
    }
    for f in &req.optional.filters {
        if !filters.contains(f) {
            missing_optional.push(format!("filter:{}", f));
        }
    }

    Ok(GateResult {
        version,
        missing_required,
        missing_optional,
    })
}

// ==================== Команды: статус ffmpeg ====================

#[tauri::command]
#[specta::specta]
pub fn deps_ffmpeg_status(
    state: tauri::State<Mutex<AppSettingsState>>,
) -> Result<FfmpegStatus, String> {
    let ffmpeg = super::ffmpeg_commands::resolve_program_path("ffmpeg", &state);
    let ffprobe = super::ffmpeg_commands::resolve_program_path("ffprobe", &state);

    let ffmpeg_path = Path::new(&ffmpeg);
    let runs = ffmpeg_path.is_absolute() && ffmpeg_path.exists();
    if !runs {
        return Ok(FfmpegStatus {
            installed: false,
            version: None,
            ffmpeg_path: None,
            ffprobe_path: None,
        });
    }
    let version = run_ffmpeg(ffmpeg_path, &["-hide_banner", "-version"])
        .ok()
        .and_then(|s| s.lines().next().map(|l| l.trim().to_string()));

    Ok(FfmpegStatus {
        installed: version.is_some(),
        version,
        ffmpeg_path: Some(ffmpeg),
        ffprobe_path: Some(ffprobe),
    })
}

// ==================== Команды: скачать ffmpeg+ffprobe ====================

#[tauri::command]
#[specta::specta]
pub async fn deps_download_ffmpeg(app: tauri::AppHandle) -> Result<FfmpegInstallResult, String> {
    let req = load_requirements()?;
    let target = platform_target();
    let sources = ffmpeg_sources(&target);
    if sources.is_empty() {
        return Err(format!("нет источников ffmpeg для платформы {}", target));
    }

    let dest_dir = bin_dir(&app)?;
    let ffmpeg_dest = dest_dir.join(exe_name("ffmpeg"));
    let ffprobe_dest = dest_dir.join(exe_name("ffprobe"));
    let ffmpeg_base = exe_name("ffmpeg");
    let ffprobe_base = exe_name("ffprobe");

    let tmp = std::env::temp_dir();
    // Бинарники каждой сборки распаковываем в staging (в dest копируем только выбранную);
    // лучшего кандидата держим в best_* — чтобы не остановиться на первой рабочей сборке,
    // а найти самую полную (с optional-возможностями вроде filter:rubberband).
    let stage_ffmpeg = tmp.join("fsm_stage_ffmpeg");
    let stage_ffprobe = tmp.join("fsm_stage_ffprobe");
    let best_ffmpeg = tmp.join("fsm_best_ffmpeg");
    let best_ffprobe = tmp.join("fsm_best_ffprobe");
    let mut best: Option<FfmpegInstallResult> = None;
    let mut last_result: Option<FfmpegInstallResult> = None;

    for src in &sources {
        emit_progress(
            &app,
            "ffmpeg",
            "download",
            &format!("Источник: {}", src.name),
            0,
            None,
        );

        // 1) Скачиваем zip(ы).
        let ffmpeg_zip = tmp.join("fsm_ffmpeg.zip");
        let ffprobe_zip = tmp.join("fsm_ffprobe.zip");
        if let Err(e) = download_to(
            &app,
            &src.ffmpeg_zip,
            &ffmpeg_zip,
            "ffmpeg",
            &format!("⬇️ ffmpeg ({})", src.name),
        )
        .await
        {
            emit_progress(&app, "ffmpeg", "error", &e, 0, None);
            continue;
        }
        let same = src.ffprobe_zip == src.ffmpeg_zip;
        if !same {
            if let Err(e) = download_to(
                &app,
                &src.ffprobe_zip,
                &ffprobe_zip,
                "ffmpeg",
                &format!("⬇️ ffprobe ({})", src.name),
            )
            .await
            {
                emit_progress(&app, "ffmpeg", "error", &e, 0, None);
                continue;
            }
        }
        let probe_zip_path = if same { ffmpeg_zip.clone() } else { ffprobe_zip.clone() };

        // 2+3) Распаковка zip и GATE — блокирующие (std::fs + subprocess ffmpeg), поэтому
        // уводим в spawn_blocking, чтобы не подвешивать async-runtime и параллельный IPC
        // (та же причина, что у ffprobe_get_info).
        emit_progress(&app, "ffmpeg", "extract", "Распаковка и проверка возможностей…", 0, None);
        let (req_c, fz, pz, fmd, fpd, fmb, fpb) = (
            req.clone(),
            ffmpeg_zip.clone(),
            probe_zip_path,
            stage_ffmpeg.clone(),
            stage_ffprobe.clone(),
            ffmpeg_base.clone(),
            ffprobe_base.clone(),
        );
        let gate = tokio::task::spawn_blocking(move || -> Result<GateResult, String> {
            let got_ffmpeg = extract_binary_from_zip(&fz, &fmb, &fmd).unwrap_or(false);
            let got_ffprobe = extract_binary_from_zip(&pz, &fpb, &fpd).unwrap_or(false);
            let _ = std::fs::remove_file(&fz);
            if pz != fz {
                let _ = std::fs::remove_file(&pz);
            }
            if !got_ffmpeg || !got_ffprobe {
                return Err("в архиве не найден бинарник".into());
            }
            run_gate(&fmd, &fpd, &req_c)
        })
        .await
        .map_err(|e| format!("join error: {}", e))?;

        let gate = match gate {
            Ok(g) => g,
            Err(e) => {
                emit_progress(&app, "ffmpeg", "error", &format!("{} ({})", e, src.name), 0, None);
                continue;
            }
        };

        let result = FfmpegInstallResult {
            ok: gate.missing_required.is_empty(),
            version: Some(gate.version.clone()),
            source: Some(src.name.to_string()),
            ffmpeg_path: Some(ffmpeg_dest.to_string_lossy().to_string()),
            ffprobe_path: Some(ffprobe_dest.to_string_lossy().to_string()),
            missing_required: gate.missing_required.clone(),
            missing_optional: gate.missing_optional.clone(),
        };

        if result.ok && result.missing_optional.is_empty() {
            // Идеальная сборка (есть всё, включая optional) — фиксируем в dest и выходим.
            std::fs::copy(&stage_ffmpeg, &ffmpeg_dest).map_err(|e| format!("copy ffmpeg: {}", e))?;
            std::fs::copy(&stage_ffprobe, &ffprobe_dest).map_err(|e| format!("copy ffprobe: {}", e))?;
            emit_progress(
                &app,
                "ffmpeg",
                "done",
                &format!("✅ {} ({})", gate.version, src.name),
                1,
                Some(1),
            );
            return Ok(result);
        }
        if result.ok {
            // Прошла required, но не хватает optional — кандидат. Держим лучшего (минимум
            // missing_optional) в best_* и пробуем следующий источник: вдруг полнее.
            let better = match &best {
                None => true,
                Some(b) => result.missing_optional.len() < b.missing_optional.len(),
            };
            if better {
                let _ = std::fs::copy(&stage_ffmpeg, &best_ffmpeg);
                let _ = std::fs::copy(&stage_ffprobe, &best_ffprobe);
                best = Some(result);
            }
            continue;
        }
        // Не прошёл required — запоминаем и пробуем следующий источник.
        last_result = Some(result);
    }

    // Идеальной сборки (без missing_optional) не нашлось — берём лучшего кандидата,
    // прошедшего required (минимум optional-дыр).
    if let Some(b) = best {
        std::fs::copy(&best_ffmpeg, &ffmpeg_dest).map_err(|e| format!("copy ffmpeg: {}", e))?;
        std::fs::copy(&best_ffprobe, &ffprobe_dest).map_err(|e| format!("copy ffprobe: {}", e))?;
        emit_progress(
            &app,
            "ffmpeg",
            "done",
            &format!(
                "✅ {} ({}) — нет optional: {}",
                b.version.clone().unwrap_or_default(),
                b.source.clone().unwrap_or_default(),
                b.missing_optional.join(", ")
            ),
            1,
            Some(1),
        );
        return Ok(b);
    }

    // Ни один источник не прошёл gate. Возвращаем последний (с missing), не подключая пути.
    if let Some(r) = last_result {
        emit_progress(
            &app,
            "ffmpeg",
            "error",
            &format!("Сборка не содержит: {}", r.missing_required.join(", ")),
            0,
            None,
        );
        return Ok(r);
    }
    Err("не удалось скачать ни один кандидат ffmpeg".into())
}

// ==================== Команды: whisper-модели ====================

/// Каталог моделей whisper.cpp (имена из download-ggml-model.sh). Размеры — приблизительные,
/// для отображения; точный размер берётся из Content-Length при скачивании.
fn whisper_catalog() -> Vec<(&'static str, u64, bool)> {
    // (имя, размер в байтах, рекомендуемая). Размеры — реальные Content-Length из
    // ggerganov/whisper.cpp; точный размер всё равно берётся при скачивании.
    vec![
        ("tiny", 77_691_713, false),
        ("base", 147_951_465, false),
        ("small", 487_601_967, false),
        ("medium", 1_533_763_059, false),
        ("large-v2", 3_094_623_691, false),
        ("large-v3", 3_095_033_483, false),
        ("large-v3-turbo", 1_624_555_275, true),
        ("large-v3-turbo-q5_0", 574_041_195, false),
        ("large-v3-turbo-q8_0", 874_188_075, false),
    ]
}

fn human_size(bytes: u64) -> String {
    const KB: f64 = 1024.0;
    const MB: f64 = KB * 1024.0;
    const GB: f64 = MB * 1024.0;
    let f = bytes as f64;
    if f >= GB {
        format!("{:.1} GB", f / GB)
    } else if f >= MB {
        format!("{:.0} MB", f / MB)
    } else {
        format!("{:.0} KB", f / KB)
    }
}

#[tauri::command]
#[specta::specta]
pub fn deps_whisper_models_dir(app: tauri::AppHandle) -> Result<String, String> {
    Ok(models_dir(&app)?.to_string_lossy().to_string())
}

#[tauri::command]
#[specta::specta]
pub fn deps_list_whisper_models(app: tauri::AppHandle) -> Result<Vec<WhisperModel>, String> {
    let dir = models_dir(&app)?;
    let existing: HashSet<String> = std::fs::read_dir(&dir)
        .map(|rd| {
            rd.filter_map(|e| e.ok())
                .map(|e| e.file_name().to_string_lossy().to_string())
                .collect()
        })
        .unwrap_or_default();

    let models = whisper_catalog()
        .into_iter()
        .map(|(name, size, recommended)| {
            let filename = format!("ggml-{}.bin", name);
            let downloaded = existing.contains(&filename);
            WhisperModel {
                name: name.to_string(),
                filename: filename.clone(),
                size_bytes: size,
                size_label: human_size(size),
                downloaded,
                recommended,
            }
        })
        .collect();
    Ok(models)
}

#[tauri::command]
#[specta::specta]
pub async fn deps_download_whisper_model(
    app: tauri::AppHandle,
    filename: String,
) -> Result<String, String> {
    // Защита от path-traversal: только ggml-*.bin без разделителей.
    if !filename.starts_with("ggml-")
        || !filename.ends_with(".bin")
        || filename.contains('/')
        || filename.contains('\\')
        || filename.contains("..")
    {
        return Err(format!("недопустимое имя модели: {}", filename));
    }

    let dir = models_dir(&app)?;
    let dest = dir.join(&filename);
    // Качаем во временный .part, затем атомарно переименовываем — чтобы прерванная
    // загрузка не выглядела как готовая модель.
    let part = dir.join(format!("{}.part", filename));

    // Базовые хосты по приоритету: основной HF и зеркало (на случай, если HF режется в сети).
    // ВАЖНО: репозиторий ggml-моделей — ggerganov/whisper.cpp (подтверждено: отдаёт анонимно,
    // 206). НЕ ggml-org/whisper.cpp — тот возвращает 401. (.pt-чекпоинты OpenAI whisper.cpp не
    // использует — ему нужны именно ggml .bin.)
    let bases = [
        "https://huggingface.co/ggerganov/whisper.cpp/resolve/main",
        "https://hf-mirror.com/ggerganov/whisper.cpp/resolve/main",
    ];

    let mut last_err = String::new();
    for base in bases {
        let url = format!("{}/{}", base, filename);
        match download_to(&app, &url, &part, &filename, &format!("⬇️ {}", filename)).await {
            Ok(_) => {
                std::fs::rename(&part, &dest).map_err(|e| format!("rename: {}", e))?;
                emit_progress(&app, &filename, "done", &format!("✅ {}", filename), 1, Some(1));
                return Ok(dest.to_string_lossy().to_string());
            }
            Err(e) => {
                last_err = format!("{} → {}", url, e);
                emit_progress(&app, &filename, "error", &last_err, 0, None);
            }
        }
    }
    let _ = std::fs::remove_file(&part);
    Err(format!("не удалось скачать {}: {}", filename, last_err))
}
