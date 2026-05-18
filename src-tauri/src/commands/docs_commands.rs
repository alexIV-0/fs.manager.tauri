// Команды для доступа к документации (markdown-файлы в public/docs/).
// На фронтенде используется через window.docs.list() / window.docs.read().

use serde::Serialize;
use std::fs;
use std::path::PathBuf;

#[derive(Serialize)]
pub struct DocFile {
    pub name: String,
    #[serde(rename = "fileName")]
    pub file_name: String,
}

#[derive(Serialize)]
pub struct DocSection {
    pub name: String,
    pub files: Vec<DocFile>,
}

fn is_safe_segment(s: &str) -> bool {
    !s.is_empty()
        && !s.contains('/')
        && !s.contains('\\')
        && !s.contains("..")
}

fn docs_root(app: &tauri::AppHandle) -> Option<PathBuf> {
    // В dev: <project_root>/public/docs (CARGO_MANIFEST_DIR указывает на src-tauri/)
    #[cfg(debug_assertions)]
    {
        let manifest_dir = env!("CARGO_MANIFEST_DIR");
        let candidate = PathBuf::from(manifest_dir).join("..").join("public").join("docs");
        if candidate.exists() {
            return Some(candidate);
        }
    }

    // В prod: <resource_dir>/docs (docs/ должен быть добавлен в bundle.resources)
    if let Ok(res_dir) = tauri::Manager::path(app).resource_dir() {
        let candidate = res_dir.join("docs");
        if candidate.exists() {
            return Some(candidate);
        }
    }

    None
}

#[tauri::command]
pub fn docs_list(app: tauri::AppHandle) -> Result<Vec<DocSection>, String> {
    let root = match docs_root(&app) {
        Some(p) => p,
        None => return Ok(Vec::new()),
    };

    let entries = match fs::read_dir(&root) {
        Ok(rd) => rd,
        Err(_) => return Ok(Vec::new()),
    };

    let mut sections: Vec<DocSection> = Vec::new();

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let section_name = match path.file_name().and_then(|n| n.to_str()) {
            Some(s) => s.to_string(),
            None => continue,
        };

        let mut files: Vec<DocFile> = Vec::new();

        if let Ok(rd) = fs::read_dir(&path) {
            for f in rd.flatten() {
                let fp = f.path();
                if !fp.is_file() {
                    continue;
                }
                let fname = match fp.file_name().and_then(|n| n.to_str()) {
                    Some(s) => s.to_string(),
                    None => continue,
                };
                if !fname.to_lowercase().ends_with(".md") {
                    continue;
                }
                let display = fname.trim_end_matches(".md").trim_end_matches(".MD").to_string();
                files.push(DocFile {
                    name: display,
                    file_name: fname,
                });
            }
        }

        files.sort_by(|a, b| a.file_name.cmp(&b.file_name));
        sections.push(DocSection {
            name: section_name,
            files,
        });
    }

    sections.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(sections)
}

#[tauri::command]
pub fn docs_read(
    app: tauri::AppHandle,
    section_name: String,
    file_name: String,
) -> Result<String, String> {
    if !is_safe_segment(&section_name) || !is_safe_segment(&file_name) {
        return Err("Invalid path".to_string());
    }
    if !file_name.to_lowercase().ends_with(".md") {
        return Err("Only .md files allowed".to_string());
    }

    let root = docs_root(&app).ok_or_else(|| "docs root not found".to_string())?;
    let path = root.join(&section_name).join(&file_name);
    fs::read_to_string(&path).map_err(|e| format!("read_to_string: {}", e))
}
