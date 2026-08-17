// Идентичность машины: UUID — ключ, hostname — подпись.
//
// Разделение не косметическое, это две разные роли:
//
//   • UUID  — чем машина ОТЛИЧАЕТСЯ от других. Уходит в очередь задач («кто взял
//     задачу», продление аренды) и даёт хвост имени файла статистики.
//   • hostname — как машину зовут ЛЮДИ. Годится показать в админке и в имени файла,
//     но ключом быть не может.
//
// Почему hostname не ключ: дефолтные имена маков совпадают сплошь и рядом — два
// `MacBook-Pro` дают один идентификатор. И ломается на этом не будущая очередь, а
// СЕГОДНЯШНЯЯ статистика: обе машины пишут в один `2026.08.macbook-pro.jsonl`, а в
// объектном хранилище нет дописывания в конец — заливка перезаписывает объект целиком,
// и строки затираются тихо, задним числом. Плюс `sanitize` режет имя до 20 символов,
// так что схлопнуться могут и разные длинные имена.
//
// Почему отдельный файл, а не `storage/connection.json`: идентичность машины к
// подключению отношения не имеет. Переподключение к другому сайту её не меняет, а
// отключение от хранилища не должно её стирать.

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

#[derive(Debug, Clone)]
pub struct Identity {
    /// Полный UUID — ключ машины для очереди задач.
    ///
    /// Пока не читается никем, кроме тестов: потребитель — режим воркера
    /// (`claimTask`, продление аренды). Заводим сейчас, потому что ключ обязан быть
    /// стабильным с первого запуска, а не появиться в момент включения воркера.
    #[allow(dead_code)]
    pub uuid: String,
    /// Санитизированный hostname: `Alexeys-iMac.local` → `alexeys-imac`.
    /// Отдельно от `slug` — его показывать людям (админка, диагностика).
    #[allow(dead_code)]
    pub label: String,
    /// Кусок имени файла статистики: `alexeys-imac-a1b2`.
    pub slug: String,
}

static IDENTITY: OnceLock<Identity> = OnceLock::new();

fn identity_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("machine.json")
}

/// Прочитать идентичность (или завести при первом запуске).
///
/// Зовётся один раз из `setup()`, до открытия любого окна: дальше `uuid()`/`slug()`
/// работают без `AppHandle`, а он есть далеко не везде — статистику пишет функция в
/// глубине `db_analytics`, тащить туда handle только ради имени файла незачем.
pub fn init(app_data_dir: &Path) {
    let _ = IDENTITY.set(load_or_create(app_data_dir));
}

fn load_or_create(app_data_dir: &Path) -> Identity {
    let label = sanitize_machine(&read_hostname());
    let path = identity_path(app_data_dir);

    if let Some(uuid) = read_uuid(&path) {
        return Identity {
            slug: build_slug(&label, &uuid),
            uuid,
            label,
        };
    }

    let uuid = uuid::Uuid::new_v4().to_string();
    let body = serde_json::json!({ "uuid": uuid, "createdLabel": label });
    let written = std::fs::create_dir_all(app_data_dir)
        .and_then(|_| std::fs::write(&path, serde_json::to_string_pretty(&body).unwrap_or_default()));

    match written {
        Ok(()) => Identity {
            slug: build_slug(&label, &uuid),
            uuid,
            label,
        },
        Err(e) => {
            // Записать не смогли — UUID проживёт только эту сессию. Имя файла
            // статистики в этом случае оставляем БЕЗ хвоста: иначе каждый запуск
            // заводил бы новый файл в проекте, и вместо одной проблемы получили бы две.
            eprintln!("[machine] не удалось сохранить {}: {e}", path.display());
            Identity {
                uuid,
                slug: label.clone(),
                label,
            }
        }
    }
}

fn read_uuid(path: &Path) -> Option<String> {
    let text = std::fs::read_to_string(path).ok()?;
    let value: serde_json::Value = serde_json::from_str(&text).ok()?;
    let uuid = value.get("uuid")?.as_str()?.trim().to_string();
    if uuid.is_empty() {
        None
    } else {
        Some(uuid)
    }
}

/// Подпись + короткий хвост ключа. Хвост — чтобы две машины с одинаковым hostname
/// всё-таки писали в разные файлы; четырёх шестнадцатеричных знаков на парк из
/// десятка машин с запасом.
fn build_slug(label: &str, uuid: &str) -> String {
    let tail: String = uuid.chars().filter(|c| c.is_ascii_alphanumeric()).take(4).collect();
    if tail.is_empty() {
        label.to_string()
    } else {
        format!("{label}-{tail}")
    }
}

fn read_hostname() -> String {
    std::process::Command::new("hostname")
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .unwrap_or_default()
}

/// Привести имя хоста к безопасному куску имени файла.
///
/// `Alexeys-iMac.local` → `alexeys-imac`: точки режем (иначе выглядят как расширения),
/// регистр вниз, длину ограничиваем — имя файла не место для корпоративного FQDN.
/// Пусто → `machine`, чтобы файл всё равно получил имя.
pub fn sanitize_machine(raw: &str) -> String {
    let head = raw.trim().split('.').next().unwrap_or("").trim();
    let cleaned: String = head
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect();
    let trimmed = cleaned.trim_matches('-').to_string();
    if trimmed.is_empty() {
        "machine".to_string()
    } else {
        trimmed.chars().take(20).collect()
    }
}

/// Запасной вариант на случай, когда `init` не звали: тесты и headless-экспорт
/// биндингов. Ключа машины там нет и быть не должно, а имя нужно.
fn fallback() -> &'static Identity {
    static FALLBACK: OnceLock<Identity> = OnceLock::new();
    FALLBACK.get_or_init(|| {
        let label = sanitize_machine(&read_hostname());
        Identity {
            uuid: String::new(),
            slug: label.clone(),
            label,
        }
    })
}

pub fn identity() -> &'static Identity {
    IDENTITY.get().unwrap_or_else(|| fallback())
}

/// Кусок имени файла статистики.
pub fn slug() -> &'static str {
    &identity().slug
}

/// Ключ и подпись машины для renderer'а.
///
/// Нужны режиму воркера: `uuid` уходит в очередь («кто взял задачу»), `label` — в
/// интерфейс. Секрета здесь нет: это идентификатор, а не токен, и отдавать его наружу
/// безопасно — в отличие от `ConnectionConfig::token`, который редактируется.
#[derive(Debug, Clone, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct MachineIdentity {
    pub uuid: String,
    pub label: String,
    pub slug: String,
}

#[tauri::command]
#[specta::specta]
pub fn machine_identity() -> MachineIdentity {
    let id = identity();
    MachineIdentity {
        uuid: id.uuid.clone(),
        label: id.label.clone(),
        slug: id.slug.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmpdir(tag: &str) -> PathBuf {
        std::env::temp_dir().join(format!("fsm-machine-{tag}-{}", std::process::id()))
    }

    #[test]
    fn имя_хоста_приводится_к_короткому_и_безопасному() {
        assert_eq!(sanitize_machine("Alexeys-iMac.local"), "alexeys-imac");
        assert_eq!(sanitize_machine("  RENDER BOX 2  "), "render-box-2");
        // Пусто — файл всё равно должен получить имя.
        assert_eq!(sanitize_machine(""), "machine");
        assert_eq!(sanitize_machine("..."), "machine");
        // Длину ограничиваем: имя файла не место для корпоративного FQDN.
        assert!(sanitize_machine(&"a".repeat(50)).len() <= 20);
    }

    #[test]
    fn uuid_переживает_перезапуск() {
        let dir = tmpdir("stable");
        let _ = std::fs::remove_dir_all(&dir);

        let first = load_or_create(&dir);
        let second = load_or_create(&dir);
        // Ключ машины обязан быть тем же: иначе после каждого запуска сайт видел бы
        // новую машину, а статистика уезжала бы в новый файл.
        assert_eq!(first.uuid, second.uuid);
        assert_eq!(first.slug, second.slug);
        assert!(!first.uuid.is_empty());

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn одинаковый_hostname_даёт_разные_slug() {
        let a = tmpdir("host-a");
        let b = tmpdir("host-b");
        let _ = std::fs::remove_dir_all(&a);
        let _ = std::fs::remove_dir_all(&b);

        // Две машины с совпадающим именем — ровно тот случай, ради которого затевался
        // хвост: без него обе писали бы в один объект R2 и затирали строки друг друга.
        let one = load_or_create(&a);
        let two = load_or_create(&b);
        assert_eq!(one.label, two.label, "hostname у обеих один и тот же");
        assert_ne!(one.slug, two.slug);

        let _ = std::fs::remove_dir_all(&a);
        let _ = std::fs::remove_dir_all(&b);
    }

    #[test]
    fn битый_файл_не_роняет_и_заводит_новый_ключ() {
        let dir = tmpdir("broken");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(identity_path(&dir), "{ это не json").unwrap();

        let id = load_or_create(&dir);
        assert!(!id.uuid.is_empty());
        // И следующий запуск уже читает записанное, а не генерит третий ключ.
        assert_eq!(load_or_create(&dir).uuid, id.uuid);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn slug_состоит_из_подписи_и_хвоста() {
        assert_eq!(build_slug("imac", "a1b2c3d4-0000"), "imac-a1b2");
        // Хвоста нет — остаётся одна подпись, а не имя с висящим дефисом.
        assert_eq!(build_slug("imac", ""), "imac");
    }
}
