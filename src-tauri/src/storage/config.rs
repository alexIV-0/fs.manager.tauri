// Настройки подключения к хранилищу: адрес бэкенда, machine token, корень зеркала.
//
// Лежит файлом в app data, как и остальные токены программы
// (`accounts/<mainFolder>/<platform>.json`). Решение сознательное:
// keychain в проекте не используется нигде, и один защищённый токен среди десяти
// открытых картины не меняет — осмысленно переносить всё сразу, отдельной
// миграцией (см. SECRETS_VAULT_SITE_PLAN.md).
//
// Что реально снижает риск при таком хранении:
//   • права 0600 — читает только владелец (ставим ниже);
//   • machine token отзывается на сервере (`DELETE /api/account/machine-tokens`),
//     то есть утечка лечится, а не только предотвращается;
//   • app data не должен попадать в синхронизируемые папки (iCloud, Dropbox).

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", default)]
pub struct ConnectionConfig {
    /// Адрес сайта, например `https://hub.example.com`. Путь `/api/storage/v1`
    /// клиент добавляет сам.
    pub base_url: String,
    /// Machine token (`mch_…`), **непривязанный к проекту**: у привязанного
    /// `scopedProjectId` проверяется раньше роли и не пустит даже админа.
    pub token: String,
    /// Корень зеркала — единственная папка, за которой следит клиент.
    pub mirror_root: String,
    /// Сколько часов держать локальную копию после последнего обращения.
    pub keep_hours: Option<u32>,
    /// Аварийный лимит размера зеркала в гигабайтах: поверх TTL, чтобы диск не
    /// забился, если открыть руками десяток мастеров.
    pub max_mirror_gb: Option<u32>,
    /// Маски «всегда горячих» файлов. `None` — берём дефолт.
    pub hot_patterns: Option<Vec<String>>,
    /// Прошлое подключение было к демо-фикстурам.
    ///
    /// Нужно, чтобы восстановить режим при запуске. Без этого после перезапуска
    /// облачная папка молча превращалась в обычную локальную: значков нет,
    /// синхронизации нет, а причина не видна нигде.
    pub demo: bool,
}

impl ConnectionConfig {
    pub fn is_connected(&self) -> bool {
        !self.base_url.trim().is_empty() && !self.token.trim().is_empty()
    }

    /// Значения по умолчанию — те, что в плане: 4 часа и 100 ГБ.
    pub fn keep_hours_or_default(&self) -> u32 {
        self.keep_hours.unwrap_or(4)
    }

    pub fn max_mirror_gb_or_default(&self) -> u32 {
        self.max_mirror_gb.unwrap_or(100)
    }

    /// Пустые строки отбрасываем: человек нажал Enter в редакторе, а пустая маска
    /// не должна сделать горячим вообще всё.
    pub fn hot_patterns_or_default(&self) -> Vec<String> {
        let cleaned: Vec<String> = self
            .hot_patterns
            .clone()
            .unwrap_or_default()
            .into_iter()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();
        if cleaned.is_empty() {
            vec!["options/*.json".to_string()]
        } else {
            cleaned
        }
    }

    /// Токен наружу не отдаём: настройки читает renderer, а показывать секрет в
    /// интерфейсе незачем — только факт, что он задан.
    pub fn redacted(&self) -> Self {
        Self {
            token: if self.token.is_empty() {
                String::new()
            } else {
                "••••••••".into()
            },
            ..self.clone()
        }
    }
}

pub fn config_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("storage").join("connection.json")
}

pub fn load(app_data_dir: &Path) -> ConnectionConfig {
    let path = config_path(app_data_dir);
    std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn save(app_data_dir: &Path, cfg: &ConnectionConfig) -> Result<(), String> {
    let path = config_path(app_data_dir);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("create_dir_all {}: {e}", parent.display()))?;
    }
    let body = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
    std::fs::write(&path, body).map_err(|e| format!("write {}: {e}", path.display()))?;
    restrict_permissions(&path);
    Ok(())
}

/// Файл с токеном не должен читаться кем угодно. На Windows аналога нет —
/// там полагаемся на ACL профиля пользователя.
#[cfg(unix)]
fn restrict_permissions(path: &Path) {
    use std::os::unix::fs::PermissionsExt;
    let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
}

#[cfg(not(unix))]
fn restrict_permissions(_path: &Path) {}

/// Индекс живёт рядом с настройками, но **не внутри зеркала**: иначе он начнёт
/// синхронизировать сам себя.
pub fn index_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("storage").join("index.sqlite")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn дефолты_совпадают_с_планом() {
        let c = ConnectionConfig::default();
        assert_eq!(c.keep_hours_or_default(), 4);
        assert_eq!(c.max_mirror_gb_or_default(), 100);
        assert!(!c.is_connected());
    }

    #[test]
    fn пустые_маски_не_делают_горячим_всё() {
        let c = ConnectionConfig {
            hot_patterns: Some(vec!["".into(), "  ".into()]),
            ..Default::default()
        };
        // Иначе список из одних пустых строк отключил бы вытеснение целиком.
        assert_eq!(c.hot_patterns_or_default(), vec!["options/*.json".to_string()]);

        let c = ConnectionConfig {
            hot_patterns: Some(vec!["options/*.json".into(), "".into(), "*.aep".into()]),
            ..Default::default()
        };
        assert_eq!(c.hot_patterns_or_default().len(), 2);
    }

    #[test]
    fn токен_не_утекает_в_интерфейс() {
        let c = ConnectionConfig {
            base_url: "https://x".into(),
            token: "mch_секрет".into(),
            ..Default::default()
        };
        let r = c.redacted();
        assert_eq!(r.base_url, "https://x");
        assert!(!r.token.contains("секрет"));
        assert!(!r.token.is_empty(), "факт наличия токена показать надо");
    }

    #[test]
    fn пустой_токен_остаётся_пустым_а_не_маскируется() {
        // Иначе интерфейс покажет «токен задан» там, где его нет.
        assert!(ConnectionConfig::default().redacted().token.is_empty());
    }

    #[test]
    fn сохранение_и_чтение_кругом() {
        let dir = std::env::temp_dir().join(format!("fsm-storage-cfg-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);

        let cfg = ConnectionConfig {
            base_url: "https://hub.example.com".into(),
            token: "mch_abc".into(),
            mirror_root: "/Users/x/Mirror".into(),
            keep_hours: Some(8),
            max_mirror_gb: None,
            hot_patterns: None,
            demo: false,
        };
        save(&dir, &cfg).unwrap();

        let back = load(&dir);
        assert_eq!(back.base_url, cfg.base_url);
        assert!(!back.demo, "режим по умолчанию — живое подключение");
        assert_eq!(back.token, cfg.token);
        assert_eq!(back.keep_hours, Some(8));
        // Отсутствующее поле берёт дефолт, а не ломает чтение.
        assert_eq!(back.max_mirror_gb_or_default(), 100);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn режим_демо_переживает_перезапуск() {
        // Демо живёт в памяти процесса. Если не запомнить режим, после перезапуска
        // облачная папка молча становится обычной локальной: ни значков, ни
        // синхронизации, и причина не видна нигде.
        let dir = std::env::temp_dir().join(format!("fsm-storage-demo-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);

        let cfg = ConnectionConfig { demo: true, ..Default::default() };
        save(&dir, &cfg).unwrap();
        assert!(load(&dir).demo);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn битый_файл_не_роняет_программу() {
        let dir = std::env::temp_dir().join(format!("fsm-storage-bad-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("storage")).unwrap();
        std::fs::write(config_path(&dir), "{ это не json").unwrap();

        // Правили руками или запись оборвалась — стартуем с пустых настроек.
        assert!(!load(&dir).is_connected());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
