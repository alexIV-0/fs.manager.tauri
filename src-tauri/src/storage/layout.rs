// Раскладка зеркала человеческими именами: `<mirror>/<клиент>/<проект>/…`.
//
// Раньше на диске лежал `<mirror>/<project_id>/…`, и это было правильно ровно до
// того момента, пока зеркало не показывалось человеку теми же колонками, что и
// обычные папки: в колонке проектов появлялись UUID. Имя проекта на диске —
// не украшение, а условие того, что онлайн-папка неотличима от локальной.
//
// Цена — имена меняются. Поэтому здесь ЕДИНСТВЕННОЕ место, где id превращается в
// папки и обратно; всё остальное ходит через эту карту и переживает переименование
// пересборкой карты, а не разбором путей.

use std::collections::{HashMap, HashSet};

use super::types::{RemoteClient, RemoteProject};

/// Проекты без клиента складываем сюда: класть их прямо в корень нельзя — первый
/// уровень зеркала занят клиентами, и папка проекта стала бы неотличима от папки
/// клиента при разборе пути.
pub const NO_CLIENT_DIR: &str = "_без_клиента";

#[derive(Debug, Clone)]
pub struct ClientDir {
    pub id: String,
    pub display_name: String,
    pub dir: String,
}

#[derive(Debug, Clone, Default)]
pub struct MirrorDirs {
    /// project_id → (папка клиента, папка проекта)
    by_id: HashMap<String, (String, String)>,
    /// (папка клиента, папка проекта) в нижнем регистре → project_id
    by_dirs: HashMap<(String, String), String>,
    clients: Vec<ClientDir>,
}

impl MirrorDirs {
    pub fn build(clients: &[RemoteClient], projects: &[RemoteProject]) -> Self {
        let mut me = Self::default();

        // Папки клиентов. Совпадения имён разводим тем же способом, что и проекты.
        let mut taken_clients: HashSet<String> = HashSet::new();
        let mut client_dir_by_id: HashMap<String, String> = HashMap::new();
        let mut sorted_clients: Vec<&RemoteClient> = clients.iter().collect();
        sorted_clients.sort_by(|a, b| a.id.cmp(&b.id));
        for c in sorted_clients {
            let dir = unique(sanitize(&c.display_name, &c.id), &c.id, &mut taken_clients);
            client_dir_by_id.insert(c.id.clone(), dir.clone());
            me.clients.push(ClientDir {
                id: c.id.clone(),
                display_name: c.display_name.clone(),
                dir,
            });
        }

        // Папки проектов — по одному набору занятых имён НА КЛИЕНТА: два проекта с
        // одинаковым именем у разных клиентов не мешают друг другу.
        let mut taken_projects: HashMap<String, HashSet<String>> = HashMap::new();
        let mut sorted: Vec<&RemoteProject> = projects.iter().collect();
        // Порядок по id — чтобы суффикс при совпадении имён не «прыгал» между
        // запусками: иначе папка проекта переезжала бы сама собой.
        sorted.sort_by(|a, b| a.id.cmp(&b.id));

        for p in sorted {
            let client_dir = p
                .client_id
                .as_ref()
                .and_then(|id| client_dir_by_id.get(id).cloned())
                .unwrap_or_else(|| NO_CLIENT_DIR.to_string());

            let slot = taken_projects.entry(client_dir.clone()).or_default();
            let project_dir = unique(sanitize(&p.name, &p.id), &p.id, slot);

            me.by_dirs.insert(
                (lower(&client_dir), lower(&project_dir)),
                p.id.clone(),
            );
            me.by_id.insert(p.id.clone(), (client_dir, project_dir));
        }

        me
    }

    pub fn dirs_of(&self, project_id: &str) -> Option<&(String, String)> {
        self.by_id.get(project_id)
    }

    pub fn project_of(&self, client_dir: &str, project_dir: &str) -> Option<&str> {
        self.by_dirs
            .get(&(lower(client_dir), lower(project_dir)))
            .map(|s| s.as_str())
    }

    pub fn clients(&self) -> &[ClientDir] {
        &self.clients
    }

    pub fn client_by_dir(&self, dir: &str) -> Option<&ClientDir> {
        self.clients.iter().find(|c| lower(&c.dir) == lower(dir))
    }

    pub fn client_dir_of(&self, client_id: &str) -> Option<&str> {
        self.clients
            .iter()
            .find(|c| c.id == client_id)
            .map(|c| c.dir.as_str())
    }

    /// Папки проектов данного клиента: `(папка, project_id)`.
    pub fn projects_of_client_dir(&self, client_dir: &str) -> Vec<(String, String)> {
        let want = lower(client_dir);
        let mut out: Vec<(String, String)> = self
            .by_id
            .iter()
            .filter(|(_, (cd, _))| lower(cd) == want)
            .map(|(id, (_, pd))| (pd.clone(), id.clone()))
            .collect();
        out.sort_by(|a, b| a.0.to_lowercase().cmp(&b.0.to_lowercase()));
        out
    }
}

/// Сравнение папок регистронезависимо: на macOS и Windows файловая система такая
/// же, и `Мегафон` с `мегафон` — один каталог (та же грабля, что в `under_mirror`).
fn lower(s: &str) -> String {
    s.to_lowercase()
}

/// Имя, пригодное для файловой системы.
///
/// Разделители убираем обязательно: имя проекта с `/` иначе раскрошило бы путь на
/// лишний уровень и сломало разбор.
fn sanitize(name: &str, fallback_id: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            c if (c as u32) < 0x20 => '_',
            c => c,
        })
        .collect();
    // Windows не хранит имена с точкой или пробелом на конце — молча обрежет.
    let trimmed = cleaned.trim().trim_end_matches(['.', ' ']).to_string();
    if trimmed.is_empty() {
        format!("проект_{}", short(fallback_id))
    } else {
        trimmed
    }
}

/// Развести совпадающие имена. Суффикс — кусок id, стабильный между запусками.
fn unique(base: String, id: &str, taken: &mut HashSet<String>) -> String {
    let key = lower(&base);
    if taken.insert(key) {
        return base;
    }
    let with_id = format!("{base} ({})", short(id));
    taken.insert(lower(&with_id));
    with_id
}

fn short(id: &str) -> String {
    id.chars().take(6).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn client(id: &str, name: &str) -> RemoteClient {
        RemoteClient {
            id: id.into(),
            display_name: name.into(),
        }
    }

    fn project(id: &str, name: &str, client: Option<&str>) -> RemoteProject {
        RemoteProject {
            id: id.into(),
            name: name.into(),
            client_id: client.map(|s| s.to_string()),
            group_name: "personal".into(),
            is_active: true,
            is_paused: false,
            updated_at: "2026-08-08T00:00:00.000Z".into(),
        }
    }

    #[test]
    fn имена_вместо_идентификаторов() {
        let m = MirrorDirs::build(
            &[client("c1", "Мегафон")],
            &[project("p1", "Реклама Q3", Some("c1"))],
        );
        assert_eq!(
            m.dirs_of("p1"),
            Some(&("Мегафон".to_string(), "Реклама Q3".to_string()))
        );
        assert_eq!(m.project_of("Мегафон", "Реклама Q3"), Some("p1"));
    }

    #[test]
    fn разбор_регистронезависим() {
        // На macOS `мегафон` и `Мегафон` — один каталог; строгое сравнение отправило
        // бы файл мимо гидрации.
        let m = MirrorDirs::build(
            &[client("c1", "Мегафон")],
            &[project("p1", "Реклама Q3", Some("c1"))],
        );
        assert_eq!(m.project_of("мегафон", "реклама q3"), Some("p1"));
    }

    #[test]
    fn слэш_в_имени_не_создаёт_лишний_уровень() {
        let m = MirrorDirs::build(&[], &[project("p1", "A/B", None)]);
        let (c, p) = m.dirs_of("p1").unwrap();
        assert_eq!(c, NO_CLIENT_DIR);
        assert!(!p.contains('/'), "получили {p}");
    }

    #[test]
    fn одинаковые_имена_разводятся_и_не_прыгают() {
        let projects = [
            project("p2", "Ролики", Some("c1")),
            project("p1", "Ролики", Some("c1")),
        ];
        let m = MirrorDirs::build(&[client("c1", "Клиент")], &projects);
        let a = m.dirs_of("p1").unwrap().1.clone();
        let b = m.dirs_of("p2").unwrap().1.clone();
        assert_ne!(a, b, "два проекта не могут делить одну папку");

        // Порядок в исходном списке не должен менять результат — иначе папка
        // проекта переезжала бы от запуска к запуску.
        let reversed = [projects[1].clone(), projects[0].clone()];
        let m2 = MirrorDirs::build(&[client("c1", "Клиент")], &reversed);
        assert_eq!(m2.dirs_of("p1").unwrap().1, a);
        assert_eq!(m2.dirs_of("p2").unwrap().1, b);
    }

    #[test]
    fn одноимённые_проекты_у_разных_клиентов_не_мешают() {
        let m = MirrorDirs::build(
            &[client("c1", "Первый"), client("c2", "Второй")],
            &[
                project("p1", "Реклама", Some("c1")),
                project("p2", "Реклама", Some("c2")),
            ],
        );
        // Разные клиенты — суффикс не нужен, папки и так не пересекаются.
        assert_eq!(m.dirs_of("p1").unwrap().1, "Реклама");
        assert_eq!(m.dirs_of("p2").unwrap().1, "Реклама");
    }

    #[test]
    fn проект_без_клиента_уходит_в_отдельную_папку() {
        let m = MirrorDirs::build(&[], &[project("p1", "Сам по себе", None)]);
        assert_eq!(m.dirs_of("p1").unwrap().0, NO_CLIENT_DIR);
        assert_eq!(m.project_of(NO_CLIENT_DIR, "Сам по себе"), Some("p1"));
    }

    #[test]
    fn пустое_имя_не_даёт_пустую_папку() {
        let m = MirrorDirs::build(&[], &[project("p1abcdef", "   ", None)]);
        let dir = &m.dirs_of("p1abcdef").unwrap().1;
        assert!(!dir.trim().is_empty());
        assert!(dir.contains("p1abcd"), "ожидали кусок id в имени, получили {dir}");
    }

    #[test]
    fn список_проектов_клиента() {
        let m = MirrorDirs::build(
            &[client("c1", "Мегафон")],
            &[
                project("p1", "Бета", Some("c1")),
                project("p2", "Альфа", Some("c1")),
                project("p3", "Чужой", Some("c2")),
            ],
        );
        let list = m.projects_of_client_dir("Мегафон");
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].0, "Альфа", "сортировка по имени");
        assert_eq!(list[1].0, "Бета");
    }
}
