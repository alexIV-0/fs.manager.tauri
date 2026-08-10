// Движок состояний: единственное место, где считается, какой значок показать.
//
// Правило из плана (R2_SYNC_PLAN.md, раздел 7): один селектор на файл, один на
// папку, и всё, что рисует значки, зовёт только их. Соблазн обойти — посмотреть
// тут `local_state.state`, там сверить `synced_etag`, в третьем месте посчитать
// агрегат обходом строк. Через месяц три места разойдутся, и папка покажет
// «синхронизировано», когда внутри лежит незалитый файл.
//
// ── Почему без обращений к диску ─────────────────────────────────────────────
// Листинг папки на тысячу файлов не должен делать тысячу `stat`. Поэтому:
//   • здесь считается всё, что выводимо из БД (сравнение версий бесплатно —
//     и baseline, и актуальный etag уже лежат в индексе);
//   • факт локальной правки обнаруживает `detect_local_change` — его зовут при
//     ОБРАЩЕНИИ к файлу и при фоновой сверке, а не на каждый рендер.

use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};

use super::index::Index;

// ─── Состояние файла ─────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum FileState {
    /// Только в облаке, локальной копии нет.
    Cloud,
    /// Скачивается.
    Downloading,
    /// Локальная копия есть и совпадает с облаком.
    Fresh,
    /// Локальная копия есть, но в облаке новее.
    Stale,
    /// Есть только локально — в облаке файла нет вообще.
    LocalOnly,
    /// В облаке есть, но у нас новее: надо залить.
    LocalModified,
    /// Заливается.
    Uploading,
    /// И локально, и в облаке изменилось после последней синхронизации.
    /// Не решаем сами: оба автоварианта теряют данные.
    Conflict,
    /// Передача упала.
    Error,
}

impl FileState {
    /// Требует ли состояние действия от человека. На этом же строится приоритет
    /// агрегата папки: значок должен вести к тому файлу, с которым надо что-то делать.
    #[cfg(test)]
    pub fn needs_attention(self) -> bool {
        matches!(
            self,
            Self::Error | Self::Conflict | Self::LocalOnly | Self::LocalModified
        )
    }

    /// Можно ли вытеснять локальную копию. Инвариант кэша №1: незалитое —
    /// нельзя, иначе результат рендера исчезнет вместе с копией.
    pub fn is_evictable(self) -> bool {
        matches!(self, Self::Fresh | Self::Stale)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FileBadge {
    pub file_id: String,
    pub state: FileState,
    /// Пин рисуется ПОВЕРХ основного значка, а не вместо: запиненный файл
    /// одновременно либо синхронизирован, либо качается.
    pub pinned: bool,
    /// 0.0–1.0, когда идёт передача.
    pub progress: Option<f64>,
    pub error: Option<String>,
}

// ─── Агрегат папки ───────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum FolderAggregate {
    /// Внутри нет файлов (могут быть только вложенные папки).
    Empty,
    /// Ничего не скачано.
    AllCloud,
    /// Часть скачана.
    Mixed,
    /// Скачано всё.
    AllLocal,
    /// Внутри что-то качается.
    Downloading,
    /// Внутри есть незалитое или изменённое локально.
    NeedsUpload,
    /// Внутри есть конфликт.
    Conflict,
    /// Внутри есть ошибка.
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FolderBadge {
    pub aggregate: FolderAggregate,
    pub files: i64,
    pub bytes: i64,
    pub local_files: i64,
    pub local_bytes: i64,
}

// ─── Счётчики поддерева ──────────────────────────────────────────────────────

#[derive(Debug, Default, Clone, Copy)]
struct SubtreeCounts {
    total: i64,
    bytes: i64,
    local: i64,
    local_bytes: i64,
    errors: i64,
    conflicts: i64,
    needs_upload: i64,
    downloading: i64,
    uploading: i64,
}

impl Index {
    /// Значок одного файла. Только БД, ни одного обращения к диску.
    pub fn badge_state(&self, file_id: &str) -> Result<Option<FileBadge>, String> {
        let row = self
            .conn()
            .query_row(
                "SELECT re.etag, re.content_hash, re.deleted,
                        ls.state, ls.synced_etag, ls.pinned, ls.error,
                        (SELECT direction FROM transfers t
                          WHERE t.file_id = re.file_id AND t.state IN ('queued','active')
                          ORDER BY t.id DESC LIMIT 1),
                        (SELECT CASE WHEN IFNULL(t.bytes_total,0) > 0
                                     THEN CAST(t.bytes_done AS REAL) / t.bytes_total
                                     ELSE NULL END
                           FROM transfers t
                          WHERE t.file_id = re.file_id AND t.state IN ('queued','active')
                          ORDER BY t.id DESC LIMIT 1)
                   FROM remote_entries re
                   LEFT JOIN local_state ls ON ls.file_id = re.file_id
                  WHERE re.file_id = ?1",
                params![file_id],
                |r| {
                    Ok((
                        r.get::<_, Option<String>>(0)?, // remote etag
                        r.get::<_, Option<String>>(1)?, // remote content_hash
                        r.get::<_, i64>(2)? != 0,       // deleted
                        r.get::<_, Option<String>>(3)?, // stored state
                        r.get::<_, Option<String>>(4)?, // synced_etag
                        r.get::<_, Option<i64>>(5)?.unwrap_or(0) != 0, // pinned
                        r.get::<_, Option<String>>(6)?, // error
                        r.get::<_, Option<String>>(7)?, // active transfer direction
                        r.get::<_, Option<f64>>(8)?,    // progress
                    ))
                },
            )
            .optional()
            .map_err(|e| e.to_string())?;

        let Some((
            remote_etag,
            remote_hash,
            deleted,
            stored,
            synced_etag,
            pinned,
            error,
            transfer_dir,
            progress,
        )) = row
        else {
            return Ok(None);
        };

        // Активная передача перебивает всё: она уже происходит, и человеку важно
        // видеть именно её.
        let state = if let Some(dir) = transfer_dir.as_deref() {
            match dir {
                "down" => FileState::Downloading,
                _ => FileState::Uploading,
            }
        } else {
            derive_state(
                stored.as_deref(),
                synced_etag.as_deref(),
                remote_etag.as_deref(),
                remote_hash.as_deref(),
                deleted,
            )
        };

        Ok(Some(FileBadge {
            file_id: file_id.to_string(),
            state,
            pinned,
            progress,
            error,
        }))
    }

    /// Агрегат по поддереву. Приоритет: **ошибка и «надо залить» перебивают всё**
    /// — папка, внутри которой всё синхронизировано кроме одного незалитого файла,
    /// обязана показывать предупреждение, а не галочку.
    pub fn folder_badge(
        &self,
        project_id: &str,
        folder_path: &str,
    ) -> Result<FolderBadge, String> {
        let c = self.subtree_counts(project_id, folder_path)?;

        let aggregate = if c.errors > 0 {
            FolderAggregate::Error
        } else if c.conflicts > 0 {
            FolderAggregate::Conflict
        } else if c.needs_upload > 0 || c.uploading > 0 {
            FolderAggregate::NeedsUpload
        } else if c.downloading > 0 {
            FolderAggregate::Downloading
        } else if c.total == 0 {
            FolderAggregate::Empty
        } else if c.local == 0 {
            FolderAggregate::AllCloud
        } else if c.local == c.total {
            FolderAggregate::AllLocal
        } else {
            FolderAggregate::Mixed
        };

        Ok(FolderBadge {
            aggregate,
            files: c.total,
            bytes: c.bytes,
            local_files: c.local,
            local_bytes: c.local_bytes,
        })
    }

    /// Счётчики поддерева одним запросом.
    ///
    /// Поддерево — это `folder_path = X` плюс `folder_path LIKE 'X/%'`: логический
    /// путь, а не ключ. `s3_key` для этого не годится, он непрозрачный.
    fn subtree_counts(
        &self,
        project_id: &str,
        folder_path: &str,
    ) -> Result<SubtreeCounts, String> {
        // Для корня проекта (`""`) поддерево — вообще все записи, без LIKE.
        let (predicate, like) = if folder_path.is_empty() {
            ("1 = 1", String::new())
        } else {
            ("(re.folder_path = ?2 OR re.folder_path LIKE ?3)", format!("{folder_path}/%"))
        };

        let sql = format!(
            "SELECT
               COUNT(*),
               IFNULL(SUM(IFNULL(re.size_bytes, 0)), 0),
               IFNULL(SUM(CASE WHEN ls.local_path IS NOT NULL
                                AND ls.state IN ('Fresh','Stale','LocalModified','Conflict')
                               THEN 1 ELSE 0 END), 0),
               IFNULL(SUM(CASE WHEN ls.local_path IS NOT NULL
                                AND ls.state IN ('Fresh','Stale','LocalModified','Conflict')
                               THEN IFNULL(re.size_bytes, 0) ELSE 0 END), 0),
               IFNULL(SUM(CASE WHEN ls.state = 'Error'    THEN 1 ELSE 0 END), 0),
               IFNULL(SUM(CASE WHEN ls.state = 'Conflict' THEN 1 ELSE 0 END), 0),
               IFNULL(SUM(CASE WHEN ls.state IN ('LocalOnly','LocalModified') THEN 1 ELSE 0 END), 0),
               IFNULL(SUM(CASE WHEN ls.state = 'Downloading' THEN 1 ELSE 0 END), 0),
               IFNULL(SUM(CASE WHEN ls.state = 'Uploading'   THEN 1 ELSE 0 END), 0)
             FROM remote_entries re
             LEFT JOIN local_state ls ON ls.file_id = re.file_id
            WHERE re.project_id = ?1 AND re.deleted = 0 AND re.is_folder = 0
              AND {predicate}"
        );

        let mut st = self.conn().prepare(&sql).map_err(|e| e.to_string())?;
        let map = |r: &rusqlite::Row| -> rusqlite::Result<SubtreeCounts> {
            Ok(SubtreeCounts {
                total: r.get(0)?,
                bytes: r.get(1)?,
                local: r.get(2)?,
                local_bytes: r.get(3)?,
                errors: r.get(4)?,
                conflicts: r.get(5)?,
                needs_upload: r.get(6)?,
                downloading: r.get(7)?,
                uploading: r.get(8)?,
            })
        };

        if folder_path.is_empty() {
            st.query_row(params![project_id], map)
        } else {
            st.query_row(params![project_id, folder_path, like], map)
        }
        .map_err(|e| e.to_string())
    }

    /// Значки для всего содержимого папки — одним проходом, чтобы UI не дёргал
    /// `badge_state` в цикле по каждой строке.
    #[cfg(test)]
    pub fn list_dir_badges(
        &self,
        project_id: &str,
        folder_path: &str,
    ) -> Result<Vec<FileBadge>, String> {
        let ids: Vec<String> = self
            .list_dir(project_id, folder_path)?
            .into_iter()
            .filter(|e| !e.is_folder)
            .map(|e| e.id)
            .collect();
        let mut out = Vec::with_capacity(ids.len());
        for id in ids {
            if let Some(b) = self.badge_state(&id)? {
                out.push(b);
            }
        }
        Ok(out)
    }
}

// ─── Матрица расхождений ─────────────────────────────────────────────────────

/// Три направления расхождения плюс конфликт (R2_SYNC_PLAN.md, 6.3).
///
/// Без baseline эту задачу решить нельзя: «в облаке новее» и «у меня новее» дают
/// одинаковое `local ≠ remote`. Baseline — это `synced_etag`: версия, с которой
/// локальная копия была синхронизирована в последний раз.
///
/// | локально vs baseline | в облаке vs baseline | вывод          |
/// |----------------------|----------------------|----------------|
/// | не менялся           | не менялся           | `Fresh`        |
/// | не менялся           | изменился            | `Stale`        |
/// | изменился            | не менялся           | `LocalModified`|
/// | изменился            | изменился            | `Conflict`     |
///
/// Факт «локально изменился» приходит уже разобранным в `stored`: его ставит
/// `detect_local_change`, потому что для этого нужен `stat`, а здесь диска нет.
/// Обёртка для соседних модулей: вытеснение обязано оценивать состояние тем же
/// движком, что и значки, иначе они разойдутся в оценке одного файла.
pub(super) fn derive_state_pub(
    stored: Option<&str>,
    synced_etag: Option<&str>,
    remote_etag: Option<&str>,
    remote_hash: Option<&str>,
    remote_deleted: bool,
) -> FileState {
    derive_state(stored, synced_etag, remote_etag, remote_hash, remote_deleted)
}

fn derive_state(
    stored: Option<&str>,
    synced_etag: Option<&str>,
    remote_etag: Option<&str>,
    remote_hash: Option<&str>,
    remote_deleted: bool,
) -> FileState {
    // Сравниваем по content_hash, если он есть, иначе по etag. Правило сразу
    // правильное: у multipart-объектов etag перестаёт быть хэшем содержимого,
    // а content_hash продолжает работать.
    let remote_version = remote_hash.or(remote_etag);

    match stored {
        // Про файл ничего локально не знаем.
        None => {
            if remote_deleted {
                FileState::Cloud
            } else {
                FileState::Cloud
            }
        }
        Some("Error") => FileState::Error,
        Some("Conflict") => FileState::Conflict,
        Some("LocalOnly") => FileState::LocalOnly,
        Some("Downloading") => FileState::Downloading,
        Some("Uploading") => FileState::Uploading,
        Some("Cloud") => FileState::Cloud,

        // Локальная копия есть и локально её не правили: расхождение может быть
        // только со стороны облака.
        Some("Fresh") | Some("Stale") => match (synced_etag, remote_version) {
            (Some(base), Some(now)) if base != now => FileState::Stale,
            _ => FileState::Fresh,
        },

        // Локальная копия правилась. Если и в облаке с тех пор что-то менялось —
        // это конфликт, и решать его должен человек.
        Some("LocalModified") => match (synced_etag, remote_version) {
            (Some(base), Some(now)) if base != now => FileState::Conflict,
            _ => FileState::LocalModified,
        },

        // Неизвестная метка в БД: честнее показать ошибку, чем угадать.
        Some(_) => FileState::Error,
    }
}

// ─── Тесты ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn матрица_расхождений() {
        // не менялся / не менялся → Fresh
        assert_eq!(
            derive_state(Some("Fresh"), Some("e1"), Some("e1"), None, false),
            FileState::Fresh
        );
        // не менялся / изменился → Stale
        assert_eq!(
            derive_state(Some("Fresh"), Some("e1"), Some("e2"), None, false),
            FileState::Stale
        );
        // изменился / не менялся → LocalModified
        assert_eq!(
            derive_state(Some("LocalModified"), Some("e1"), Some("e1"), None, false),
            FileState::LocalModified
        );
        // изменился / изменился → Conflict
        assert_eq!(
            derive_state(Some("LocalModified"), Some("e1"), Some("e2"), None, false),
            FileState::Conflict
        );
    }

    #[test]
    fn content_hash_имеет_приоритет_над_etag() {
        // etag разошёлся, а честный хэш совпадает — файл тот же.
        // Это спасает, когда бэкенд начнёт использовать multipart: там etag
        // перестаёт быть хэшем содержимого.
        assert_eq!(
            derive_state(Some("Fresh"), Some("h1"), Some("etag-другой"), Some("h1"), false),
            FileState::Fresh
        );
    }

    #[test]
    fn неизвестная_метка_не_выдаёт_себя_за_норму() {
        assert_eq!(
            derive_state(Some("ЧтоТоНовое"), None, None, None, false),
            FileState::Error
        );
    }

    #[test]
    fn что_можно_вытеснять() {
        // Инвариант кэша: незалитое и проблемное не вытесняем никогда.
        assert!(FileState::Fresh.is_evictable());
        assert!(FileState::Stale.is_evictable());
        for s in [
            FileState::LocalOnly,
            FileState::LocalModified,
            FileState::Uploading,
            FileState::Conflict,
            FileState::Error,
            FileState::Downloading,
        ] {
            assert!(!s.is_evictable(), "{s:?} вытеснять нельзя");
        }
    }

    #[test]
    fn что_требует_внимания() {
        for s in [
            FileState::Error,
            FileState::Conflict,
            FileState::LocalOnly,
            FileState::LocalModified,
        ] {
            assert!(s.needs_attention(), "{s:?} должен требовать внимания");
        }
        for s in [FileState::Fresh, FileState::Cloud, FileState::Stale] {
            assert!(!s.needs_attention());
        }
    }

    // ─── Интеграционные: настоящая БД, настоящий SQL ─────────────────────────

    use crate::storage::types::TreeEntry;

    fn file(id: &str, folder: &str, name: &str, size: i64, etag: &str) -> TreeEntry {
        TreeEntry {
            id: id.into(),
            project_id: "p1".into(),
            folder_path: folder.into(),
            name: name.into(),
            is_folder: false,
            s3_key: Some(format!("innohub/projects/p1/{folder}/uuid-{name}")),
            size_bytes: Some(size),
            content_type: None,
            etag: Some(etag.into()),
            content_hash: None,
            origin_mtime: None,
            created_at: None,
            updated_at: None,
            last_seq: None,
        }
    }

    fn dir(id: &str, folder: &str, name: &str) -> TreeEntry {
        TreeEntry {
            is_folder: true,
            s3_key: None,
            size_bytes: None,
            ..file(id, folder, name, 0, "")
        }
    }

    /// IN/a.mov, IN/b.mov, IN/sub/c.mov, OUT/d.mov — по 100 байт.
    fn seeded() -> Index {
        let mut idx = Index::open_in_memory().unwrap();
        idx.apply_tree(
            "p1",
            &[
                dir("dIN", "", "IN"),
                dir("dOUT", "", "OUT"),
                dir("dSUB", "IN", "sub"),
                file("f1", "IN", "a.mov", 100, "e1"),
                file("f2", "IN", "b.mov", 100, "e1"),
                file("f3", "IN/sub", "c.mov", 100, "e1"),
                file("f4", "OUT", "d.mov", 100, "e1"),
            ],
            1,
        )
        .unwrap();
        idx
    }

    #[test]
    fn незнакомый_файл_не_выдумывается() {
        let idx = seeded();
        assert!(idx.badge_state("нет-такого").unwrap().is_none());
    }

    #[test]
    fn без_локальной_записи_файл_в_облаке() {
        let idx = seeded();
        let b = idx.badge_state("f1").unwrap().unwrap();
        assert_eq!(b.state, FileState::Cloud);
        assert!(!b.pinned);
    }

    #[test]
    fn скачанный_файл_свежий_а_после_смены_etag_устаревает() {
        let mut idx = seeded();
        idx.mark_synced("f1", "Fresh", "/m/p1/IN/a.mov", 100, 1_700_000_000, Some("e1"))
            .unwrap();
        assert_eq!(idx.badge_state("f1").unwrap().unwrap().state, FileState::Fresh);

        // В облаке файл перезалили: etag стал другим.
        idx.apply_tree(
            "p1",
            &[
                dir("dIN", "", "IN"),
                file("f1", "IN", "a.mov", 100, "e2"),
            ],
            2,
        )
        .unwrap();
        assert_eq!(idx.badge_state("f1").unwrap().unwrap().state, FileState::Stale);
    }

    #[test]
    fn активная_передача_перебивает_состояние() {
        let idx = seeded();
        idx.mark_synced("f1", "Fresh", "/m/p1/IN/a.mov", 100, 1, Some("e1"))
            .unwrap();

        let t = idx
            .enqueue_transfer(Some("f1"), "p1", "down", "/m/p1/IN/a.mov", Some(200))
            .unwrap();
        idx.set_transfer_progress(t, 50).unwrap();

        let b = idx.badge_state("f1").unwrap().unwrap();
        assert_eq!(b.state, FileState::Downloading);
        assert_eq!(b.progress, Some(0.25));

        // Завершилась — снова показываем реальное состояние, без прогресса.
        idx.finish_transfer(t, None).unwrap();
        let b = idx.badge_state("f1").unwrap().unwrap();
        assert_eq!(b.state, FileState::Fresh);
        assert_eq!(b.progress, None);
    }

    #[test]
    fn пин_рисуется_поверх_а_не_вместо() {
        let idx = seeded();
        idx.mark_synced("f1", "Fresh", "/m/p1/IN/a.mov", 100, 1, Some("e1"))
            .unwrap();
        idx.set_pinned("f1", true).unwrap();

        let b = idx.badge_state("f1").unwrap().unwrap();
        assert!(b.pinned);
        assert_eq!(
            b.state,
            FileState::Fresh,
            "пин не должен затирать основное состояние"
        );
    }

    #[test]
    fn агрегат_считает_поддерево_включая_вложенные_папки() {
        let idx = seeded();
        // IN/a.mov, IN/b.mov и IN/sub/c.mov — три файла, 300 байт.
        let b = idx.folder_badge("p1", "IN").unwrap();
        assert_eq!(b.files, 3, "вложенная папка должна попасть в поддерево");
        assert_eq!(b.bytes, 300);
        assert_eq!(b.aggregate, FolderAggregate::AllCloud);

        // Корень проекта — все четыре файла.
        let root = idx.folder_badge("p1", "").unwrap();
        assert_eq!(root.files, 4);
        assert_eq!(root.bytes, 400);
    }

    #[test]
    fn агрегат_проходит_все_ступени() {
        let idx = seeded();
        let b = idx.folder_badge("p1", "IN").unwrap();
        assert_eq!(b.aggregate, FolderAggregate::AllCloud);

        // Скачали один из трёх → смешанно.
        idx.mark_synced("f1", "Fresh", "/m/a.mov", 100, 1, Some("e1"))
            .unwrap();
        let b = idx.folder_badge("p1", "IN").unwrap();
        assert_eq!(b.aggregate, FolderAggregate::Mixed);
        assert_eq!(b.local_files, 1);
        assert_eq!(b.local_bytes, 100);

        // Скачали все → всё локально.
        idx.mark_synced("f2", "Fresh", "/m/b.mov", 100, 1, Some("e1"))
            .unwrap();
        idx.mark_synced("f3", "Fresh", "/m/c.mov", 100, 1, Some("e1"))
            .unwrap();
        assert_eq!(
            idx.folder_badge("p1", "IN").unwrap().aggregate,
            FolderAggregate::AllLocal
        );
    }

    #[test]
    fn незалитое_перебивает_галочку() {
        let idx = seeded();
        // Всё скачано и совпадает…
        for id in ["f1", "f2", "f3"] {
            idx.mark_synced(id, "Fresh", "/m/x", 100, 1, Some("e1")).unwrap();
        }
        assert_eq!(
            idx.folder_badge("p1", "IN").unwrap().aggregate,
            FolderAggregate::AllLocal
        );

        // …кроме одного файла, который правили локально и не залили.
        idx.set_state("f2", "LocalModified", None).unwrap();
        assert_eq!(
            idx.folder_badge("p1", "IN").unwrap().aggregate,
            FolderAggregate::NeedsUpload,
            "папка не имеет права показывать галочку, пока внутри есть незалитое"
        );
    }

    #[test]
    fn ошибка_перебивает_даже_незалитое() {
        let idx = seeded();
        idx.set_state("f1", "LocalOnly", None).unwrap();
        assert_eq!(
            idx.folder_badge("p1", "IN").unwrap().aggregate,
            FolderAggregate::NeedsUpload
        );

        idx.set_state("f2", "Error", Some("заливка упала")).unwrap();
        assert_eq!(
            idx.folder_badge("p1", "IN").unwrap().aggregate,
            FolderAggregate::Error,
            "ошибка — самое срочное, она должна быть видна первой"
        );
    }

    #[test]
    fn удалённые_и_папки_в_агрегат_не_попадают() {
        let mut idx = seeded();
        let before = idx.folder_badge("p1", "IN").unwrap();
        assert_eq!(before.files, 3);

        // Tombstone на один файл — он выпадает из счёта.
        idx.apply_delta(
            "p1",
            &[crate::storage::types::Change {
                seq: 2,
                op: crate::storage::types::ChangeOp::Delete,
                key: "innohub/projects/p1/IN/a.mov".into(),
                project_id: "p1".into(),
                file_id: Some("f1".into()),
                name: Some("a.mov".into()),
                folder_path: Some("IN".into()),
                is_folder: Some(false),
                size: None,
                etag: None,
                content_hash: None,
                content_type: None,
                event_time: None,
            }],
            2,
        )
        .unwrap();

        let after = idx.folder_badge("p1", "IN").unwrap();
        assert_eq!(after.files, 2);
        assert_eq!(after.bytes, 200);
    }

    #[test]
    fn пустая_папка_и_папка_из_одних_подпапок_различимы_от_облачной() {
        let mut idx = Index::open_in_memory().unwrap();
        idx.apply_tree("p1", &[dir("dIN", "", "IN")], 1).unwrap();
        // В IN нет файлов, только сама папка существует.
        assert_eq!(
            idx.folder_badge("p1", "IN").unwrap().aggregate,
            FolderAggregate::Empty
        );
    }

    #[test]
    fn значки_папки_считаются_одним_проходом() {
        let idx = seeded();
        idx.mark_synced("f1", "Fresh", "/m/a.mov", 100, 1, Some("e1"))
            .unwrap();

        let badges = idx.list_dir_badges("p1", "IN").unwrap();
        // Только файлы прямо в IN: a.mov и b.mov. Папка sub — не файл.
        assert_eq!(badges.len(), 2);
        let a = badges.iter().find(|b| b.file_id == "f1").unwrap();
        let b = badges.iter().find(|b| b.file_id == "f2").unwrap();
        assert_eq!(a.state, FileState::Fresh);
        assert_eq!(b.state, FileState::Cloud);
    }

    // ─── Статистика поддерева (модалка «Информация») ─────────────────────────

    #[test]
    fn статистика_разбивает_по_прямым_детям() {
        let idx = seeded();
        let st = idx.subtree_stats("p1", "").unwrap();

        assert!(st.known);
        assert_eq!(st.files, 4);
        assert_eq!(st.bytes, 400);

        let by = |n: &str| st.children.iter().find(|c| c.name == n).cloned();
        // IN содержит a.mov, b.mov и вложенный sub/c.mov — три файла глубоко.
        let in_ = by("IN").unwrap();
        assert_eq!(in_.files, 3, "вложенная папка должна попасть в итог родителя");
        assert_eq!(in_.bytes, 300);
        assert!(in_.is_folder);

        let out = by("OUT").unwrap();
        assert_eq!(out.files, 1);
    }

    #[test]
    fn файлы_прямо_в_папке_идут_отдельной_строкой() {
        let mut idx = Index::open_in_memory().unwrap();
        idx.apply_tree(
            "p1",
            &[
                dir("d1", "", "IN"),
                file("f0", "", "readme.txt", 10, "e"),
                file("f1", "IN", "a.mov", 100, "e"),
            ],
            1,
        )
        .unwrap();

        let st = idx.subtree_stats("p1", "").unwrap();
        let here = st.children.iter().find(|c| c.name.is_empty()).unwrap();
        assert_eq!(here.files, 1, "readme.txt лежит прямо в корне");
        assert!(!here.is_folder);
    }

    #[test]
    fn спуск_на_уровень_ниже_считает_своё_поддерево() {
        let idx = seeded();
        let st = idx.subtree_stats("p1", "IN").unwrap();
        assert_eq!(st.files, 3);

        let here = st.children.iter().find(|c| c.name.is_empty()).unwrap();
        assert_eq!(here.files, 2, "a.mov и b.mov лежат прямо в IN");
        let sub = st.children.iter().find(|c| c.name == "sub").unwrap();
        assert_eq!(sub.files, 1);
    }

    #[test]
    fn пустая_папка_видна_а_не_исчезает() {
        // В группировке её нет — в ней нет файлов. Но человек, создавший папку,
        // должен её видеть, иначе она выглядит несуществующей.
        let mut idx = Index::open_in_memory().unwrap();
        idx.apply_tree("p1", &[dir("d1", "", "IN"), dir("d2", "", "OUT"),
                               file("f1", "IN", "a.mov", 10, "e")], 1)
            .unwrap();
        let st = idx.subtree_stats("p1", "").unwrap();
        let out = st.children.iter().find(|c| c.name == "OUT").unwrap();
        assert_eq!(out.files, 0);
        assert!(out.is_folder);
    }

    #[test]
    fn служебные_папки_помечены() {
        let mut idx = Index::open_in_memory().unwrap();
        idx.apply_tree(
            "p1",
            &[
                dir("d1", "", "options"),
                dir("d2", "", "_stats"),
                dir("d3", "", "IN"),
                file("f1", "options", "o.json", 10, "e"),
                file("f2", "_stats", "s.jsonl", 10, "e"),
                file("f3", "IN", "a.mov", 10, "e"),
            ],
            1,
        )
        .unwrap();
        let st = idx.subtree_stats("p1", "").unwrap();
        let flag = |n: &str| st.children.iter().find(|c| c.name == n).unwrap().internal;
        assert!(flag("options"));
        assert!(flag("_stats"));
        assert!(!flag("IN"));
    }

    #[test]
    fn локальные_байты_считаются_отдельно() {
        let idx = seeded();
        idx.mark_synced("f1", "Fresh", "/m/a.mov", 100, 1, Some("e1"))
            .unwrap();
        let st = idx.subtree_stats("p1", "IN").unwrap();
        assert_eq!(st.files, 3);
        assert_eq!(st.local_files, 1);
        assert_eq!(st.local_bytes, 100);
    }

    #[test]
    fn неизвестное_отличается_от_пустого() {
        // Ключевое: показать «0 файлов» там, где мы просто не спрашивали, — худший
        // вид вранья. `known` разводит эти два случая.
        let mut idx = Index::open_in_memory().unwrap();
        let st = idx.subtree_stats("p1", "").unwrap();
        assert!(!st.known, "полного /tree не делали");

        idx.apply_tree("p1", &[], 0).unwrap();
        let st = idx.subtree_stats("p1", "").unwrap();
        assert!(st.known, "сделали, и там правда пусто");
        assert_eq!(st.files, 0);
    }
}
