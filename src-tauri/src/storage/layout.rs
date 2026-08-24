// Раскладка зеркала человеческими именами: `<mirror>/<владелец>/<проект>/…`.
//
// Раньше на диске лежал `<mirror>/<project_id>/…`, и это было правильно ровно до
// того момента, пока зеркало не показывалось человеку теми же колонками, что и
// обычные папки: в колонке проектов появлялись UUID. Имя проекта на диске —
// не украшение, а условие того, что онлайн-папка неотличима от локальной.
//
// Цена — имена меняются. Поэтому здесь ЕДИНСТВЕННОЕ место, где id превращается в
// папки и обратно; всё остальное ходит через эту карту и переживает переименование
// пересборкой карты, а не разбором путей.
//
// ── Первый уровень — ВЛАДЕЛЕЦ, а не клиент ──────────────────────────────────
// Изначально верхним уровнем задумывался клиент (`clients.display_name`), но в
// живых данных `client_id` не заполнен ни у одного проекта, а раскладка бакета —
// `projects/{userId}/{projectId}/…`, то есть уровень пользователя есть всегда.
// Поэтому группируем по владельцу; `client_id` остаётся в типах для будущей
// группировки, но папок из него не строится.
//
// Внутренние имена (`ClientDir`, `MirrorNode::Client`) сохранены осознанно: это
// «верхний уровень зеркала», и переименование двадцати мест ради слова добавило бы
// риска без пользы. Читать их следует как «владелец».

use std::collections::{HashMap, HashSet};

use super::types::{RemoteProject, RemoteUser};

/// Проекты с неизвестным владельцем складываем сюда: класть их прямо в корень
/// нельзя — первый уровень зеркала занят владельцами, и папка проекта стала бы
/// неотличима от папки владельца при разборе пути.
pub const NO_CLIENT_DIR: &str = "_без_клиента";

/// Идентификатор псевдо-клиента для папки `NO_CLIENT_DIR`.
///
/// Папка есть, а клиента, которому она принадлежит, нет — и из-за этого проекты
/// без `client_id` были **недостижимы полностью**: корень зеркала перечисляет
/// клиентов (их не было), а разбор пути на первом уровне искал клиента по имени
/// папки и возвращал `Unknown`. То есть проекты видны в списке от бэкенда, но ни
/// открыть, ни синхронизировать их нельзя. Псевдо-клиент закрывает дыру одним
/// местом: дальше всё работает штатно.
///
/// Подчёркивания в начале — чтобы не столкнуться с реальным `id` (там UUID).
pub const NO_CLIENT_ID: &str = "__no_client__";

/// Имя псевдо-владельца в интерфейсе. Слово «клиент» здесь было бы неверным: в этой
/// папке лежит то, чьего ВЛАДЕЛЬЦА определить не удалось.
pub const NO_CLIENT_LABEL: &str = "Владелец неизвестен";

/// Короткая форма идентификатора для подписи папки: первый сегмент UUID.
///
/// Ровно то, по чему человек узнаёт папку в панели R2 (`093025a9-…`), и достаточно
/// уникально, чтобы не путать владельцев; коллизии всё равно разводит `unique`.
fn short_id(id: &str) -> String {
    let head = id.split('-').next().unwrap_or(id);
    let head = if head.is_empty() { id } else { head };
    head.chars().take(8).collect()
}

/// Вытащить владельца проекта из ключа объекта.
///
/// ── Почему это не нарушение правила «`s3Key` непрозрачен» ───────────────────
/// Правило запрещает выводить из ключа **логический путь** файла: имя и папка
/// живут в Postgres отдельно, а в ключе имя обезображено uuid-префиксом — отсюда
/// на диске появились бы папки вида `a3f9c1-clip.mov`.
///
/// Здесь выводится другое: **кому принадлежит проект**. Этого в ответе `/projects`
/// пока нет вообще (`serializeProject` не кладёт `userId`), а уровень пользователя
/// нужен — он и есть первая колонка. Так что это осознанный обходной путь, и он
/// самоустраняется: как только поле появится в ответе, оно важнее (см.
/// `replace_projects`), и парсер больше не зовётся.
///
/// Раскладку не угадываем: ищем в ключе сегмент `projects`, а дальше требуем, чтобы
/// сегмент через один совпал с известным `project_id`. Не совпал — значит раскладка
/// другая, и мы молча отказываемся вместо того, чтобы придумать владельца.
/// Префикс бакета (`AWS_S3_PREFIX`) при этом может быть любым или отсутствовать.
pub fn owner_from_s3_key(key: &str, project_id: &str) -> Option<String> {
    let segs: Vec<&str> = key.split('/').filter(|s| !s.is_empty()).collect();
    for (i, seg) in segs.iter().enumerate() {
        if *seg != "projects" {
            continue;
        }
        let user = segs.get(i + 1)?;
        let project = segs.get(i + 2)?;
        if *project == project_id && !user.is_empty() {
            return Some((*user).to_string());
        }
    }
    None
}

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
    /// `users` — имена владельцев, если бэкенд их отдал. Владельцы, которых там нет,
    /// всё равно получают папку: именем становится их идентификатор, как в бакете.
    pub fn build(users: &[RemoteUser], projects: &[RemoteProject]) -> Self {
        let mut me = Self::default();

        // Владельцы, которые реально встречаются у проектов. Строить папки по всему
        // списку от бэкенда нельзя: пользователь без проектов дал бы пустую папку в
        // корне зеркала.
        let mut owner_ids: Vec<String> = Vec::new();
        let mut seen_owner: HashSet<String> = HashSet::new();
        let mut sorted: Vec<&RemoteProject> = projects.iter().collect();
        // Порядок по id — чтобы суффикс при совпадении имён не «прыгал» между
        // запусками: иначе папка проекта переезжала бы сама собой.
        sorted.sort_by(|a, b| a.id.cmp(&b.id));
        for p in &sorted {
            if let Some(uid) = p.user_id.as_ref() {
                if seen_owner.insert(uid.clone()) {
                    owner_ids.push(uid.clone());
                }
            }
        }
        owner_ids.sort();

        // Имя папки владельца: **email**, иначе полное имя, иначе готовое
        // `displayName`. Выбор внутри `RemoteUser::label`, здесь только применение.
        let name_of: HashMap<&str, &str> = users.iter().map(|u| (u.id.as_str(), u.label())).collect();

        // Папки владельцев. Совпадения имён разводим тем же способом, что и проекты.
        let mut taken_clients: HashSet<String> = HashSet::new();
        let mut client_dir_by_id: HashMap<String, String> = HashMap::new();
        for id in &owner_ids {
            // Имени нет — подписываем «Пользователь <первый сегмент id>». Полный UUID
            // в списке папок нечитаем, а нумерация («Пользователь 1») врала бы: номер
            // менялся бы от состава списка. Первый сегмент — то же, что видно в панели
            // R2, то есть папку можно сверить глазами.
            let label = name_of
                .get(id.as_str())
                .filter(|n| !n.trim().is_empty())
                .map(|n| n.to_string())
                .unwrap_or_else(|| format!("Пользователь {}", short_id(id)));
            let dir = unique(sanitize(&label, id), id, &mut taken_clients);
            client_dir_by_id.insert(id.clone(), dir.clone());
            me.clients.push(ClientDir {
                id: id.clone(),
                display_name: label,
                dir,
            });
        }

        // Папки проектов — по одному набору занятых имён НА ВЛАДЕЛЬЦА: два проекта с
        // одинаковым именем у разных владельцев не мешают друг другу.
        let mut taken_projects: HashMap<String, HashSet<String>> = HashMap::new();

        let mut has_orphans = false;
        for p in sorted {
            let client_dir = p
                .user_id
                .as_ref()
                .and_then(|id| client_dir_by_id.get(id).cloned())
                .unwrap_or_else(|| {
                    // Владелец неизвестен: бэкенд его не прислал, а из ключей добыть
                    // не удалось (проект пуст либо раскладка другая).
                    has_orphans = true;
                    NO_CLIENT_DIR.to_string()
                });

            let slot = taken_projects.entry(client_dir.clone()).or_default();
            let project_dir = unique(sanitize(&p.name, &p.id), &p.id, slot);

            me.by_dirs.insert(
                (lower(&client_dir), lower(&project_dir)),
                p.id.clone(),
            );
            me.by_id.insert(p.id.clone(), (client_dir, project_dir));
        }

        // Псевдо-владелец — только если он кому-то нужен: пустая папка «Без клиента»
        // в корне зеркала у тех, у кого владельцы всех проектов известны, была бы
        // мусором. И добавляем в конец, после настоящих владельцев.
        if has_orphans {
            me.clients.push(ClientDir {
                id: NO_CLIENT_ID.to_string(),
                display_name: NO_CLIENT_LABEL.to_string(),
                dir: NO_CLIENT_DIR.to_string(),
            });
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

    /// Владелец, подписанный email'ом — как в жизни.
    fn user(id: &str, email: &str) -> RemoteUser {
        RemoteUser {
            id: id.into(),
            email: email.into(),
            full_name: String::new(),
            display_name: String::new(),
        }
    }

    /// Третий аргумент — ВЛАДЕЛЕЦ (`user_id`): именно он даёт первый уровень
    /// зеркала. `client_id` для раскладки не используется.
    fn project(id: &str, name: &str, owner: Option<&str>) -> RemoteProject {
        RemoteProject {
            id: id.into(),
            name: name.into(),
            client_id: None,
            user_id: owner.map(|s| s.to_string()),
            group_name: "personal".into(),
            is_active: true,
            is_paused: false,
            is_archived: false,
            archived_at: None,
            updated_at: "2026-08-08T00:00:00.000Z".into(),
        }
    }

    /// Живой бэкенд отдал пять проектов и НИ ОДНОГО клиента (`client_id = null`).
    ///
    /// Без псевдо-клиента такие проекты недостижимы полностью: корень зеркала
    /// перечисляет клиентов — там пусто, а разбор пути на первом уровне ищет клиента
    /// по имени папки и отвечает `Unknown`. Снаружи это выглядит как «облако
    /// подключилось, но папок нет», хотя файлы в нём есть.
    #[test]
    fn проекты_без_клиента_достижимы() {
        let m = MirrorDirs::build(
            &[],
            &[project("p1", "Captions", None), project("p2", "instagram", None)],
        );

        // Папка верхнего уровня есть, и она одна на всех сирот.
        assert_eq!(m.clients().len(), 1);
        assert_eq!(m.clients()[0].dir, NO_CLIENT_DIR);
        assert_eq!(m.clients()[0].id, NO_CLIENT_ID);

        // Путь разбирается: клиент по имени папки находится.
        assert!(m.client_by_dir(NO_CLIENT_DIR).is_some());
        assert_eq!(m.client_dir_of(NO_CLIENT_ID), Some(NO_CLIENT_DIR));

        // И проекты внутри неё перечисляются.
        let inside = m.projects_of_client_dir(NO_CLIENT_DIR);
        assert_eq!(inside.len(), 2);
        assert_eq!(m.project_of(NO_CLIENT_DIR, "Captions"), Some("p1"));
    }

    /// Обратная сторона: у кого все проекты разложены по клиентам, лишней папки
    /// «Без клиента» в корне быть не должно.
    #[test]
    fn без_сирот_псевдо_владелец_не_появляется() {
        let m = MirrorDirs::build(
            &[user("u1", "Мегафон")],
            &[project("p1", "Реклама Q3", Some("u1"))],
        );
        assert_eq!(m.clients().len(), 1);
        assert_eq!(m.clients()[0].id, "u1");
        assert!(m.client_by_dir(NO_CLIENT_DIR).is_none());
    }

    /// Владелец известен, а имени его нет: бэкенд пока не отдаёт ни `userId`, ни
    /// список пользователей, и `user_id` добыт из ключа. Папка обязана появиться и
    /// быть читаемой: полный UUID в списке папок человек не разбирает, а первый
    /// сегмент видно и в панели R2, то есть папку можно сверить глазами.
    #[test]
    fn владелец_без_имени_подписан_коротким_идентификатором() {
        let m = MirrorDirs::build(
            &[],
            &[project("p1", "Captions", Some("093025a9-c65f-4a95-a175-8e308d1c2df1"))],
        );
        assert_eq!(m.clients().len(), 1);
        assert_eq!(m.clients()[0].dir, "Пользователь 093025a9");
        assert_eq!(m.project_of("Пользователь 093025a9", "Captions"), Some("p1"));
        assert!(m.client_by_dir(NO_CLIENT_DIR).is_none(), "сирот тут нет");
    }

    /// Имя от бэкенда важнее короткого идентификатора: как только `users` придёт,
    /// папка называется человеком.
    #[test]
    fn имя_владельца_с_бэкенда_перебивает_идентификатор() {
        let m = MirrorDirs::build(
            &[user("093025a9-c65f-4a95-a175-8e308d1c2df1", "anya@studio.example")],
            &[project("p1", "Captions", Some("093025a9-c65f-4a95-a175-8e308d1c2df1"))],
        );
        assert_eq!(m.clients()[0].dir, "anya@studio.example");
    }

    /// Порядок подписи: **email**, потом полное имя, потом готовое `displayName`.
    ///
    /// Email первый не по вкусу, а потому что уникален и узнаваем: `full_name`
    /// бывает пустым и повторяется у разных людей, а папка должна называться так,
    /// чтобы владельца было видно однозначно.
    #[test]
    fn email_важнее_остальных_имён() {
        let full = RemoteUser {
            id: "u1".into(),
            email: "ivan@example.com".into(),
            full_name: "Иван Иванов".into(),
            display_name: "ivan".into(),
        };
        assert_eq!(full.label(), "ivan@example.com");

        let no_email = RemoteUser { email: String::new(), ..full.clone() };
        assert_eq!(no_email.label(), "Иван Иванов");

        let only_display = RemoteUser {
            email: String::new(),
            full_name: "   ".into(),
            ..full.clone()
        };
        assert_eq!(only_display.label(), "ivan");

        let nothing = RemoteUser {
            id: "u1".into(),
            email: String::new(),
            full_name: String::new(),
            display_name: String::new(),
        };
        assert_eq!(nothing.label(), "", "пусто — подписывать нечем, папка возьмёт id");
    }

    /// Разбор ключа: владелец берётся между `projects` и `projectId`, а префикс
    /// бакета может быть любым. Чужой проект в ключе — отказ, а не выдумка.
    #[test]
    fn владелец_вынимается_из_ключа() {
        let key = "innohub/projects/8f14e45f-user/6c86025b-proj/IN/uuid-clip.mov";
        assert_eq!(
            owner_from_s3_key(key, "6c86025b-proj").as_deref(),
            Some("8f14e45f-user")
        );
        // Без префикса — тоже.
        assert_eq!(
            owner_from_s3_key("projects/u1/p1/a.mov", "p1").as_deref(),
            Some("u1")
        );
        // Ключ от другого проекта: раскладка не та, что мы думаем.
        assert_eq!(owner_from_s3_key(key, "другой-проект"), None);
        // Ни одного сегмента `projects` — тоже отказ.
        assert_eq!(owner_from_s3_key("misc/u1/p1/a.mov", "p1"), None);
    }

    #[test]
    fn имена_вместо_идентификаторов() {
        let m = MirrorDirs::build(
            &[user("u1", "Мегафон")],
            &[project("p1", "Реклама Q3", Some("u1"))],
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
            &[user("u1", "Мегафон")],
            &[project("p1", "Реклама Q3", Some("u1"))],
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
            project("p2", "Ролики", Some("u1")),
            project("p1", "Ролики", Some("u1")),
        ];
        let m = MirrorDirs::build(&[user("u1", "Клиент")], &projects);
        let a = m.dirs_of("p1").unwrap().1.clone();
        let b = m.dirs_of("p2").unwrap().1.clone();
        assert_ne!(a, b, "два проекта не могут делить одну папку");

        // Порядок в исходном списке не должен менять результат — иначе папка
        // проекта переезжала бы от запуска к запуску.
        let reversed = [projects[1].clone(), projects[0].clone()];
        let m2 = MirrorDirs::build(&[user("u1", "Клиент")], &reversed);
        assert_eq!(m2.dirs_of("p1").unwrap().1, a);
        assert_eq!(m2.dirs_of("p2").unwrap().1, b);
    }

    #[test]
    fn одноимённые_проекты_у_разных_владельцев_не_мешают() {
        let m = MirrorDirs::build(
            &[user("u1", "Первый"), user("u2", "Второй")],
            &[
                project("p1", "Реклама", Some("u1")),
                project("p2", "Реклама", Some("u2")),
            ],
        );
        // Разные владельцы — суффикс не нужен, папки и так не пересекаются.
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
            &[user("u1", "Мегафон")],
            &[
                project("p1", "Бета", Some("u1")),
                project("p2", "Альфа", Some("u1")),
                project("p3", "Чужой", Some("u2")),
            ],
        );
        let list = m.projects_of_client_dir("Мегафон");
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].0, "Альфа", "сортировка по имени");
        assert_eq!(list[1].0, "Бета");
    }
}
