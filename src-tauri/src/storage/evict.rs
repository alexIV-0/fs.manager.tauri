// Вытеснение локальных копий: политика и решение по одному файлу.
//
// Политика простая — **один TTL плюс аварийный лимит по размеру**. Всё остальное
// не настройки, а инварианты, которые нельзя выключить галочкой:
//
//   1. **Незалитое не вытесняем никогда.** Иначе результат рендера исчезнет вместе
//      с локальной копией — а он существовал только на этом диске.
//   2. **Горячее и запиненное не вытесняем.** `options/*.json` читаются постоянно;
//      гонять их через гидрацию на каждый чих бессмысленно.
//
// Лимит по размеру — не политика, а клапан: спасает, когда кто-то открыл руками
// сорок мастеров и TTL ещё не истёк.

use serde::{Deserialize, Serialize};

use super::state::FileState;

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct EvictionPolicy {
    /// Сколько часов держать копию после последнего обращения. 0 — «никогда не
    /// удалять по времени» (только по лимиту размера).
    pub ttl_hours: u32,
    /// Аварийный предел размера зеркала. `None` — без ограничения.
    pub max_bytes: Option<i64>,
    /// Маски «всегда горячих» файлов от корня проекта.
    pub hot_patterns: Vec<String>,
}

impl Default for EvictionPolicy {
    fn default() -> Self {
        Self {
            ttl_hours: 4,
            max_bytes: Some(100 * 1024 * 1024 * 1024),
            hot_patterns: vec!["options/*.json".into()],
        }
    }
}

#[derive(Debug, Default, Clone, Copy, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct EvictionReport {
    pub scanned: i64,
    pub evicted: i64,
    pub freed_bytes: i64,
    /// Оставлено по маске «всегда горячих».
    pub kept_hot: i64,
    pub kept_pinned: i64,
    /// Оставлено потому, что вытеснять было НЕЛЬЗЯ: незалитое, конфликт, ошибка.
    /// Если это число не ноль — в зеркале есть что-то, что существует только здесь.
    pub kept_unsafe: i64,
}

/// Почему файл не вытеснили — или почему вытеснили.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EvictDecision {
    /// Вытесняем: время вышло.
    Expired,
    /// Вытесняем: давим по размеру, хотя время ещё не вышло.
    Pressure,
    KeepFresh,
    KeepHot,
    KeepPinned,
    /// Вытеснять нельзя: копия единственная.
    KeepUnsafe,
}

/// Кандидат на вытеснение — то, что нужно для решения.
#[derive(Debug, Clone)]
pub struct Candidate {
    pub file_id: String,
    pub folder_path: String,
    pub name: String,
    pub local_path: String,
    pub local_size: i64,
    pub last_access: i64,
    pub state: FileState,
    pub pinned: bool,
}

/// Решение по одному файлу. `over_budget` — превышен ли лимит размера сейчас.
pub fn decide(
    c: &Candidate,
    now: i64,
    policy: &EvictionPolicy,
    over_budget: bool,
) -> EvictDecision {
    // Инвариант 1 идёт ПЕРВЫМ и не обходится ничем: ни давлением по размеру, ни
    // истёкшим TTL. Файл, которого нет в облаке, — единственная копия.
    if !c.state.is_evictable() {
        return EvictDecision::KeepUnsafe;
    }
    if c.pinned {
        return EvictDecision::KeepPinned;
    }
    if is_hot(&policy.hot_patterns, &c.folder_path, &c.name) {
        return EvictDecision::KeepHot;
    }

    let expired = policy.ttl_hours > 0 && {
        let age = now.saturating_sub(c.last_access);
        age >= policy.ttl_hours as i64 * 3600
    };
    if expired {
        return EvictDecision::Expired;
    }
    if over_budget {
        return EvictDecision::Pressure;
    }
    EvictDecision::KeepFresh
}

// ─── Маски ───────────────────────────────────────────────────────────────────

pub fn is_hot(patterns: &[String], folder_path: &str, name: &str) -> bool {
    let rel = if folder_path.is_empty() {
        name.to_string()
    } else {
        format!("{folder_path}/{name}")
    };
    patterns.iter().any(|p| matches_pattern(p, &rel, name))
}

/// Сопоставление маски.
///
/// Правило как в `.gitignore` и в том, чего ждёт человек:
///   • маска **без** `/` (`*.aep`) сравнивается с ИМЕНЕМ файла на любой глубине;
///   • маска **со** `/` (`options/*.json`) сравнивается с путём от корня проекта
///     посегментно, и `*` не переходит через `/`.
///
/// Иначе `*.aep` работал бы только в корне проекта, а человек ждёт, что «все
/// проекты AE» — это все, где бы они ни лежали.
fn matches_pattern(pattern: &str, rel_path: &str, name: &str) -> bool {
    let pattern = pattern.trim();
    if pattern.is_empty() {
        return false;
    }
    if !pattern.contains('/') {
        return glob_segment(pattern, name);
    }

    let pat: Vec<&str> = pattern.split('/').filter(|s| !s.is_empty()).collect();
    let path: Vec<&str> = rel_path.split('/').filter(|s| !s.is_empty()).collect();
    if pat.len() != path.len() {
        return false;
    }
    pat.iter().zip(path.iter()).all(|(p, s)| glob_segment(p, s))
}

/// `*` внутри одного сегмента: `*.json`, `pre*`, `*mid*`.
fn glob_segment(pattern: &str, text: &str) -> bool {
    // Регистр: на macOS и Windows ФС регистро-нечувствительна, и маска `*.JSON`
    // должна ловить `a.json` — иначе поведение зависит от того, как человек
    // набрал расширение.
    let p = pattern.to_lowercase();
    let t = text.to_lowercase();

    let parts: Vec<&str> = p.split('*').collect();
    if parts.len() == 1 {
        return p == t;
    }

    let mut pos = 0usize;
    for (i, part) in parts.iter().enumerate() {
        if part.is_empty() {
            continue;
        }
        if i == 0 {
            if !t.starts_with(part) {
                return false;
            }
            pos = part.len();
        } else if i == parts.len() - 1 {
            // Последний кусок должен совпасть с хвостом, и не залезть на уже
            // разобранное начало.
            return t.len() >= pos + part.len() && t.ends_with(part);
        } else {
            match t[pos..].find(part) {
                Some(idx) => pos += idx + part.len(),
                None => return false,
            }
        }
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cand(state: FileState, last_access: i64) -> Candidate {
        Candidate {
            file_id: "f1".into(),
            folder_path: "IN".into(),
            name: "a.mov".into(),
            local_path: "/m/p1/IN/a.mov".into(),
            local_size: 100,
            last_access,
            state,
            pinned: false,
        }
    }

    fn policy() -> EvictionPolicy {
        EvictionPolicy {
            ttl_hours: 4,
            max_bytes: None,
            hot_patterns: vec!["options/*.json".into()],
        }
    }

    const NOW: i64 = 1_800_000_000;
    const H: i64 = 3600;

    #[test]
    fn свежее_не_трогаем() {
        let c = cand(FileState::Fresh, NOW - H);
        assert_eq!(decide(&c, NOW, &policy(), false), EvictDecision::KeepFresh);
    }

    #[test]
    fn после_ttl_вытесняем() {
        let c = cand(FileState::Fresh, NOW - 5 * H);
        assert_eq!(decide(&c, NOW, &policy(), false), EvictDecision::Expired);
    }

    #[test]
    fn незалитое_не_вытесняем_даже_под_давлением() {
        // Самый важный тест файла. Ни истёкший TTL, ни нехватка места не дают
        // права удалить единственную копию.
        for st in [
            FileState::LocalOnly,
            FileState::LocalModified,
            FileState::Uploading,
            FileState::Conflict,
            FileState::Error,
        ] {
            let c = cand(st, NOW - 100 * H);
            assert_eq!(
                decide(&c, NOW, &policy(), true),
                EvictDecision::KeepUnsafe,
                "{st:?} вытеснять нельзя ни при каких условиях"
            );
        }
    }

    #[test]
    fn запиненное_не_вытесняем() {
        let mut c = cand(FileState::Fresh, NOW - 100 * H);
        c.pinned = true;
        assert_eq!(decide(&c, NOW, &policy(), true), EvictDecision::KeepPinned);
    }

    #[test]
    fn горячее_не_вытесняем() {
        let mut c = cand(FileState::Fresh, NOW - 100 * H);
        c.folder_path = "options".into();
        c.name = "folderState.json".into();
        assert_eq!(decide(&c, NOW, &policy(), true), EvictDecision::KeepHot);
    }

    #[test]
    fn давление_по_размеру_вытесняет_до_истечения_ttl() {
        // Клапан: TTL ещё не вышел, но диск кончается.
        let c = cand(FileState::Fresh, NOW - H);
        assert_eq!(decide(&c, NOW, &policy(), true), EvictDecision::Pressure);
    }

    #[test]
    fn нулевой_ttl_означает_только_по_размеру() {
        let p = EvictionPolicy {
            ttl_hours: 0,
            ..policy()
        };
        let c = cand(FileState::Fresh, NOW - 10_000 * H);
        assert_eq!(decide(&c, NOW, &p, false), EvictDecision::KeepFresh);
        assert_eq!(decide(&c, NOW, &p, true), EvictDecision::Pressure);
    }

    #[test]
    fn устаревшую_копию_вытеснять_можно() {
        // Stale — в облаке новее, локальная копия просто мусор. Удалить можно.
        let c = cand(FileState::Stale, NOW - 5 * H);
        assert_eq!(decide(&c, NOW, &policy(), false), EvictDecision::Expired);
    }

    // ─── Маски ───────────────────────────────────────────────────────────────

    #[test]
    fn маска_с_путём_совпадает_посегментно() {
        let p = vec!["options/*.json".to_string()];
        assert!(is_hot(&p, "options", "options.json"));
        assert!(is_hot(&p, "options", "folderState.json"));
        // Глубже — не совпадает: `*` не переходит через `/`.
        assert!(!is_hot(&p, "options/_stats", "2026.08.json"));
        // Другая папка — тоже нет.
        assert!(!is_hot(&p, "IN", "a.json"));
    }

    #[test]
    fn маска_без_слэша_ловит_на_любой_глубине() {
        // Человек, написавший `*.aep`, ждёт «все проекты AE», а не «только в корне».
        let p = vec!["*.aep".to_string()];
        assert!(is_hot(&p, "", "проект.aep"));
        assert!(is_hot(&p, "IN/sub/глубоко", "проект.aep"));
        assert!(!is_hot(&p, "IN", "проект.mov"));
    }

    #[test]
    fn регистр_маски_не_важен() {
        // Иначе поведение зависит от того, как человек набрал расширение.
        let p = vec!["options/*.JSON".to_string()];
        assert!(is_hot(&p, "options", "folderState.json"));
    }

    #[test]
    fn звёздочка_в_середине_и_несколько_звёздочек() {
        assert!(matches_pattern("pre*post", "pre_x_post", "pre_x_post"));
        assert!(matches_pattern("*_v*.mov", "клип_v2.mov", "клип_v2.mov"));
        assert!(!matches_pattern("pre*post", "pre_x", "pre_x"));
    }

    #[test]
    fn маска_без_звёздочек_это_точное_имя() {
        let p = vec!["options/folderState.json".to_string()];
        assert!(is_hot(&p, "options", "folderState.json"));
        assert!(!is_hot(&p, "options", "options.json"));
    }

    #[test]
    fn пустая_маска_ничего_не_ловит() {
        // Пустая строка в списке (человек нажал Enter) не должна делать горячим всё.
        assert!(!is_hot(&["".to_string()], "IN", "a.mov"));
        assert!(!is_hot(&["   ".to_string()], "IN", "a.mov"));
    }

    #[test]
    fn одна_звёздочка_ловит_любое_имя_но_не_путь() {
        let p = vec!["*".to_string()];
        assert!(is_hot(&p, "IN", "что угодно.mov"));
        let p2 = vec!["options/*".to_string()];
        assert!(is_hot(&p2, "options", "x.json"));
        assert!(!is_hot(&p2, "options/_stats", "x.json"));
    }
}
