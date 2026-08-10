// Отображение «логический путь ↔ путь в зеркале».
//
// Раскладка зеркала повторяет ЛОГИЧЕСКУЮ структуру, а не ключи R2:
//
//     <mirror_root>/<клиент>/<проект>/<folder_path>/<name>
//
// Из `s3_key` строить путь нельзя: он непрозрачный (`{uuid}-{safeName}`), и на
// диске появились бы папки вида `a3f9c1-clip.mov`.
//
// Имена клиента и проекта, а не их id: зеркало показывается человеку теми же
// колонками, что и обычные папки, и UUID в колонке проектов недопустим.
// Соответствие «id ↔ папки» живёт в `layout.rs` — здесь только пути.
//
// Главная функция здесь — `under_mirror`: от неё зависит вся безопасность шва
// гидрации. Наивный `starts_with` ломается в трёх местах, и одно из них
// (регистр на macOS) выстреливает не сразу.

use std::path::{Component, Path, PathBuf};

use super::layout::MirrorDirs;

/// Куда лечь файлу в зеркале. `None` — проекта нет в карте (её надо обновить).
pub fn mirror_path(
    mirror_root: &Path,
    dirs: &MirrorDirs,
    project_id: &str,
    folder_path: &str,
    name: &str,
) -> Option<PathBuf> {
    let (client_dir, project_dir) = dirs.dirs_of(project_id)?;
    let mut p = mirror_root.join(client_dir).join(project_dir);
    for seg in folder_path.split('/').filter(|s| !s.is_empty()) {
        p.push(seg);
    }
    p.push(name);
    Some(p)
}

/// Разобранный зеркальный путь.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MirrorLocation {
    pub project_id: String,
    /// `""` — корень проекта.
    pub folder_path: String,
    pub name: String,
}

/// Лежит ли путь под корнем зеркала.
///
/// Три ловушки наивного `starts_with`:
///
/// 1. **Регистр на macOS.** Файловая система регистро-нечувствительна, а сравнение
///    строк — нет. `/Users/x/Mirror` и `/users/x/mirror` — один и тот же каталог,
///    но `starts_with` скажет «нет», и файл молча пойдёт по локальной ветке: путь
///    в зеркале, а гидрации не будет.
/// 2. **Относительные пути и `..`** — до сравнения надо канонизировать.
/// 3. **Граница сегмента.** `/data/mirror-old` не внутри `/data/mirror`, хотя
///    строка и начинается так же.
pub fn under_mirror(mirror_root: &Path, path: &Path) -> bool {
    if mirror_root.as_os_str().is_empty() {
        // Зеркало не настроено (режим локальной папки) → под ним нет ничего.
        return false;
    }
    strip_mirror(mirror_root, path).is_some()
}

/// Отрезать корень зеркала. `None` — путь не под зеркалом.
fn strip_mirror(mirror_root: &Path, path: &Path) -> Option<Vec<String>> {
    let root = normalize(mirror_root);
    let p = normalize(path);
    if root.is_empty() || p.len() < root.len() {
        return None;
    }
    // Сравнение по сегментам, а не по строке: так граница сегмента соблюдается
    // сама и `/data/mirror-old` не попадёт внутрь `/data/mirror`.
    for (a, b) in root.iter().zip(p.iter()) {
        if !same_segment(a, b) {
            return None;
        }
    }
    Some(p[root.len()..].to_vec())
}

/// Разобрать путь в зеркале в логические координаты.
///
/// Ожидается минимум три сегмента после корня: `<клиент>/<проект>/<name>`. Двух
/// (только клиент и проект) недостаточно — это сама папка проекта, не файл в ней.
pub fn parse_mirror_path(
    mirror_root: &Path,
    dirs: &MirrorDirs,
    path: &Path,
) -> Option<MirrorLocation> {
    let rest = strip_mirror(mirror_root, path)?;
    if rest.len() < 3 {
        return None;
    }
    let project_id = dirs.project_of(&rest[0], &rest[1])?.to_string();
    let name = rest[rest.len() - 1].clone();
    let folder_path = rest[2..rest.len() - 1].join("/");
    Some(MirrorLocation {
        project_id,
        folder_path,
        name,
    })
}

/// Что именно за путь под зеркалом — нужно листингу колонок.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MirrorNode {
    /// Сам корень зеркала: показываем клиентов.
    Root,
    /// Папка клиента: показываем его проекты.
    Client { client_id: String },
    /// Папка внутри проекта (`folder_path` = `""` — корень проекта).
    Folder {
        project_id: String,
        folder_path: String,
    },
    /// Путь под зеркалом, но не опознан (клиента/проекта с такими именами нет).
    Unknown,
}

/// Классифицировать путь. `None` — путь вообще не под зеркалом.
pub fn classify(mirror_root: &Path, dirs: &MirrorDirs, path: &Path) -> Option<MirrorNode> {
    let rest = strip_mirror(mirror_root, path)?;
    if rest.is_empty() {
        return Some(MirrorNode::Root);
    }
    if rest.len() == 1 {
        return Some(match dirs.client_by_dir(&rest[0]) {
            Some(c) => MirrorNode::Client {
                client_id: c.id.clone(),
            },
            None => MirrorNode::Unknown,
        });
    }
    match dirs.project_of(&rest[0], &rest[1]) {
        Some(pid) => Some(MirrorNode::Folder {
            project_id: pid.to_string(),
            folder_path: rest[2..].join("/"),
        }),
        None => Some(MirrorNode::Unknown),
    }
}

/// Сегменты пути без `.`, с раскрытыми `..`. Абсолютность не требуется: тесты и
/// вызовы работают и с относительными путями, лишь бы сравнение было честным.
fn normalize(p: &Path) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for c in p.components() {
        match c {
            Component::CurDir => {}
            Component::ParentDir => {
                out.pop();
            }
            Component::RootDir => out.push("/".into()),
            Component::Prefix(pr) => out.push(pr.as_os_str().to_string_lossy().to_string()),
            Component::Normal(s) => out.push(s.to_string_lossy().to_string()),
        }
    }
    out
}

/// На macOS и Windows файловые системы по умолчанию регистро-нечувствительны,
/// поэтому и сравниваем без учёта регистра. На Linux — точно.
fn same_segment(a: &str, b: &str) -> bool {
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    {
        a.eq_ignore_ascii_case(b) || a.to_lowercase() == b.to_lowercase()
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        a == b
    }
}

/// Временное имя для скачивания. Готовый файл появляется только атомарным
/// переименованием — иначе обрыв оставит обрезанный файл, который выглядит целым.
pub fn part_path(target: &Path) -> PathBuf {
    let mut name = target
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "download".into());
    name.push_str(".part");
    target.with_file_name(name)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::types::{RemoteClient, RemoteProject};

    fn root() -> PathBuf {
        PathBuf::from("/Users/x/Mirror")
    }

    /// Один клиент «Мегафон» с проектом «Реклама Q3» (id `proj1`).
    fn dirs() -> MirrorDirs {
        MirrorDirs::build(
            &[RemoteClient { id: "c1".into(), display_name: "Мегафон".into() }],
            &[RemoteProject {
                id: "proj1".into(),
                name: "Реклама Q3".into(),
                client_id: Some("c1".into()),
                group_name: "personal".into(),
                is_active: true,
                is_paused: false,
                updated_at: "2026-08-08T00:00:00.000Z".into(),
            }],
        )
    }

    #[test]
    fn путь_строится_именами_а_не_идентификаторами() {
        let p = mirror_path(&root(), &dirs(), "proj1", "IN/sub", "a.mov").unwrap();
        // Именно так папка выглядит у человека — без UUID.
        assert_eq!(p, PathBuf::from("/Users/x/Mirror/Мегафон/Реклама Q3/IN/sub/a.mov"));
    }

    #[test]
    fn корень_проекта_без_лишнего_слэша() {
        let p = mirror_path(&root(), &dirs(), "proj1", "", "options.json").unwrap();
        assert_eq!(p, PathBuf::from("/Users/x/Mirror/Мегафон/Реклама Q3/options.json"));
    }

    #[test]
    fn неизвестный_проект_не_даёт_пути() {
        // Лучше честный None, чем путь в папку, которой нет в каталоге.
        assert!(mirror_path(&root(), &dirs(), "нет-такого", "IN", "a.mov").is_none());
    }

    #[test]
    fn круговой_разбор() {
        let d = dirs();
        let p = mirror_path(&root(), &d, "proj1", "IN/sub", "a.mov").unwrap();
        let loc = parse_mirror_path(&root(), &d, &p).unwrap();
        assert_eq!(loc.project_id, "proj1");
        assert_eq!(loc.folder_path, "IN/sub");
        assert_eq!(loc.name, "a.mov");
    }

    #[test]
    fn файл_в_корне_проекта_разбирается() {
        let p = PathBuf::from("/Users/x/Mirror/Мегафон/Реклама Q3/options.json");
        let loc = parse_mirror_path(&root(), &dirs(), &p).unwrap();
        assert_eq!(loc.folder_path, "", "корень проекта — пустой folder_path");
        assert_eq!(loc.name, "options.json");
    }

    #[test]
    fn вне_зеркала_ничего_не_разбирается() {
        assert!(!under_mirror(&root(), Path::new("/Users/x/Work/a.mov")));
        assert!(parse_mirror_path(&root(), &dirs(), Path::new("/Users/x/Work/a.mov")).is_none());
    }

    #[cfg(any(target_os = "macos", target_os = "windows"))]
    #[test]
    fn регистр_не_выбивает_путь_из_зеркала() {
        // Ровно та грабля: ФС регистро-нечувствительна, а сравнение строк — нет.
        // Если бы сравнивали строкой, файл в зеркале пошёл бы по локальной ветке
        // и остался бы нескачанным. Регистр отличается и у корня, и у имён папок.
        let p = Path::new("/users/x/mirror/мегафон/реклама q3/IN/a.mov");
        assert!(under_mirror(&root(), p));
        let loc = parse_mirror_path(&root(), &dirs(), p).unwrap();
        assert_eq!(loc.project_id, "proj1");
    }

    #[test]
    fn похожее_имя_рядом_не_считается_вложенным() {
        // /Users/x/Mirror-old начинается той же строкой, но это другой каталог.
        assert!(!under_mirror(&root(), Path::new("/Users/x/Mirror-old/Мегафон/a.mov")));
    }

    #[test]
    fn точки_и_двойные_точки_раскрываются() {
        let p = Path::new("/Users/x/Mirror/Мегафон/Реклама Q3/IN/../IN/./a.mov");
        let loc = parse_mirror_path(&root(), &dirs(), p).unwrap();
        assert_eq!(loc.folder_path, "IN");
        assert_eq!(loc.name, "a.mov");
    }

    #[test]
    fn выход_за_корень_через_двойные_точки_не_проходит() {
        // Иначе `..` стал бы способом заставить гидратор смотреть наружу зеркала.
        let p = Path::new("/Users/x/Mirror/../Other/Мегафон/Реклама Q3/a.mov");
        assert!(!under_mirror(&root(), p));
    }

    #[test]
    fn сама_папка_проекта_не_файл() {
        // Двух сегментов мало: это каталог проекта, а не запись в нём.
        let p = Path::new("/Users/x/Mirror/Мегафон/Реклама Q3");
        assert!(under_mirror(&root(), p));
        assert!(parse_mirror_path(&root(), &dirs(), p).is_none());
    }

    #[test]
    fn ненастроенное_зеркало_ничего_не_захватывает() {
        // Режим локальной папки: под зеркалом не находится ничего, и `ensureLocal`
        // становится no-op для всех путей без единого ветвления.
        let empty = PathBuf::new();
        assert!(!under_mirror(&empty, Path::new("/Users/x/anything")));
    }

    #[test]
    fn классификация_уровней() {
        let d = dirs();
        assert_eq!(classify(&root(), &d, &root()), Some(MirrorNode::Root));
        assert_eq!(
            classify(&root(), &d, Path::new("/Users/x/Mirror/Мегафон")),
            Some(MirrorNode::Client { client_id: "c1".into() })
        );
        assert_eq!(
            classify(&root(), &d, Path::new("/Users/x/Mirror/Мегафон/Реклама Q3")),
            Some(MirrorNode::Folder { project_id: "proj1".into(), folder_path: String::new() })
        );
        assert_eq!(
            classify(&root(), &d, Path::new("/Users/x/Mirror/Мегафон/Реклама Q3/IN/sub")),
            Some(MirrorNode::Folder { project_id: "proj1".into(), folder_path: "IN/sub".into() })
        );
        // Не наш путь — не классифицируем вовсе, чтобы вызывающий пошёл на диск.
        assert_eq!(classify(&root(), &d, Path::new("/Users/x/Work")), None);
        // Под зеркалом, но каталог о таком не знает: показать нечего, но и на диск
        // уводить нельзя — это разные ответы.
        assert_eq!(
            classify(&root(), &d, Path::new("/Users/x/Mirror/Неизвестный")),
            Some(MirrorNode::Unknown)
        );
    }

    #[test]
    fn part_файл_рядом_с_целевым() {
        let t = Path::new("/Users/x/Mirror/Мегафон/Реклама Q3/IN/a.mov");
        assert_eq!(
            part_path(t),
            PathBuf::from("/Users/x/Mirror/Мегафон/Реклама Q3/IN/a.mov.part")
        );
    }
}
