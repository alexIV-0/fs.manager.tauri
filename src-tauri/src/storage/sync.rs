// Слой синхронизации каталога: наполняет локальный индекс.
//
// Что делает:
//   refresh_projects  — /projects → кэш клиентов и проектов;
//   bootstrap         — /tree → полное дерево проекта + курсор;
//   catch_up          — цикл /delta до догона.
//
// Байты здесь не ходят — только метаданные. Скачивание и заливка живут в
// transfer-слое; этот отвечает лишь на вопрос «что вообще есть в облаке».
//
// Все три обстоятельства, из-за которых цикл дельт сложнее, чем кажется
// (R2_SYNC_PLAN.md, раздел 13):
//   • страница максимум 5000 событий → крутить до конца;
//   • `truncated` → курсор старше окна журнала, спасает только полный /tree;
//   • курсор НА ПРОЕКТ, а не глобальный.

use super::index::Index;
use super::provider::Provider;
use super::types::*;

/// Защита от бесконечного цикла, если бэкенд начнёт отдавать события, не двигая
/// курсор. 200 страниц по 5000 — миллион событий, дальше это уже не догон.
const MAX_DELTA_PAGES: usize = 200;

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct SyncReport {
    pub pages: usize,
    pub upserted: usize,
    pub deleted: usize,
    pub skipped: usize,
    /// Пришлось делать полный `/tree` вместо инкремента.
    pub rebootstrapped: bool,
    pub cursor: i64,
}

pub struct Sync {
    pub provider: Provider,
    pub index: Index,
    caps: Capabilities,
}

impl Sync {
    /// `Capabilities` намеренно пессимистичны до первого `refresh_capabilities`:
    /// пока не спросили — не умеем ничего, и UI не покажет кнопку, которая упадёт.
    pub fn new(provider: Provider, index: Index) -> Self {
        Self {
            provider,
            index,
            caps: Capabilities::default(),
        }
    }

    pub fn caps(&self) -> &Capabilities {
        &self.caps
    }

    pub async fn refresh_capabilities(&mut self) -> StorageResult<Capabilities> {
        let caps = self.provider.capabilities().await?;
        self.caps = caps.clone();
        Ok(caps)
    }

    /// Без этого вызова остальное бесполезно: `/tree` и `/delta` требуют
    /// `projectId`, а взять его больше неоткуда.
    pub async fn refresh_projects(&mut self) -> StorageResult<ProjectsResponse> {
        let resp = self.provider.projects().await?;
        self.index
            .replace_projects(&resp)
            .map_err(StorageError::Other)?;
        Ok(resp)
    }

    /// Полное дерево проекта. Зовём при первом обращении и как спасение при
    /// `truncated` или неприменимой дельте.
    pub async fn bootstrap(&mut self, project_id: &str) -> StorageResult<SyncReport> {
        let tree = self.provider.tree(project_id, None).await?;
        let st = self
            .index
            .apply_tree(project_id, &tree.entries, tree.cursor)
            .map_err(StorageError::Other)?;
        Ok(SyncReport {
            pages: 1,
            upserted: st.upserted,
            rebootstrapped: true,
            cursor: tree.cursor,
            ..Default::default()
        })
    }

    /// Догнать проект до актуального состояния.
    ///
    /// Если полного `/tree` по проекту ещё не делали — делаем: инкремент от нулевого
    /// курсора дал бы только те события, что попали в журнал, а всё, что появилось
    /// раньше журнала, осталось бы невидимым.
    pub async fn catch_up(&mut self, project_id: &str) -> StorageResult<SyncReport> {
        if self
            .index
            .tree_at(project_id)
            .map_err(StorageError::Other)?
            .is_none()
        {
            return self.bootstrap(project_id).await;
        }

        let mut report = SyncReport::default();
        let mut cursor = self.index.cursor(project_id).map_err(StorageError::Other)?;

        for _ in 0..MAX_DELTA_PAGES {
            let page = self.provider.delta(project_id, cursor).await?;
            report.pages += 1;

            if page.truncated {
                // Курсор старше окна хранения журнала: инкрементом уже не догнать.
                let mut boot = self.bootstrap(project_id).await?;
                boot.pages += report.pages;
                return Ok(boot);
            }

            if page.changes.is_empty() {
                // Догнали. Курсор всё равно принимаем: бэкенд двигает его и на
                // пустом ответе.
                if page.cursor > cursor {
                    cursor = page.cursor;
                }
                break;
            }

            // Страница есть, а курсор не вырос — так бывает только при баге на той
            // стороне. Крутить это вечно нельзя.
            if page.cursor <= cursor {
                return Err(StorageError::Other(format!(
                    "курсор не продвинулся: был {cursor}, пришёл {} при {} событиях",
                    page.cursor,
                    page.changes.len()
                )));
            }

            let st = self
                .index
                .apply_delta(project_id, &page.changes, page.cursor)
                .map_err(StorageError::Other)?;
            report.upserted += st.upserted;
            report.deleted += st.deleted;
            report.skipped += st.skipped;
            cursor = page.cursor;

            if st.needs_resync {
                // Событие не применилось — в индексе дыра. Молча продолжать нельзя.
                let mut boot = self.bootstrap(project_id).await?;
                boot.pages += report.pages;
                boot.skipped += report.skipped;
                return Ok(boot);
            }
        }

        report.cursor = cursor;
        Ok(report)
    }

    /// Один проход по всем известным проектам. Пригодится для «обновить всё»;
    /// ошибка одного проекта не должна ронять остальные.
    #[cfg(test)]
    pub async fn catch_up_all(&mut self) -> Vec<(String, StorageResult<SyncReport>)> {
        let ids: Vec<String> = match self.index.projects(None) {
            Ok(ps) => ps.into_iter().map(|p| p.id).collect(),
            Err(e) => return vec![(String::new(), Err(StorageError::Other(e)))],
        };
        let mut out = Vec::with_capacity(ids.len());
        for id in ids {
            let r = self.catch_up(&id).await;
            out.push((id, r));
        }
        out
    }
}

// ─── Тесты ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::mock::{MockApi, MockState};
    use std::collections::HashMap;

    fn entry(id: &str, folder: &str, name: &str) -> TreeEntry {
        TreeEntry {
            id: id.into(),
            project_id: "p1".into(),
            folder_path: folder.into(),
            name: name.into(),
            is_folder: false,
            s3_key: Some(format!("innohub/projects/p1/{folder}/uuid-{name}")),
            size_bytes: Some(10),
            content_type: None,
            etag: Some("e".into()),
            content_hash: None,
            origin_mtime: None,
            created_at: None,
            updated_at: None,
            last_seq: None,
        }
    }

    fn put(seq: i64, id: &str, folder: &str, name: &str) -> Change {
        Change {
            seq,
            op: ChangeOp::Put,
            key: format!("innohub/projects/p1/{folder}/{name}"),
            project_id: "p1".into(),
            file_id: Some(id.into()),
            name: Some(name.into()),
            folder_path: Some(folder.into()),
            is_folder: Some(false),
            size: Some(10),
            etag: Some("e".into()),
            content_hash: None,
            content_type: None,
            event_time: None,
        }
    }

    fn sync_with(state: MockState) -> (Sync, MockApi) {
        let mock = MockApi::new(state);
        let idx = Index::open_in_memory().unwrap();
        (Sync::new(Provider::Mock(mock.clone()), idx), mock)
    }

    fn one_project() -> ProjectsResponse {
        ProjectsResponse {
            clients: vec![RemoteClient {
                id: "c1".into(),
                display_name: "Мегафон".into(),
            }],
            projects: vec![RemoteProject {
                id: "p1".into(),
                name: "Реклама Q3".into(),
                client_id: Some("c1".into()),
                group_name: "personal".into(),
                is_active: true,
                is_paused: false,
                updated_at: "2026-08-07T00:00:00.000Z".into(),
            }],
        }
    }

    #[tokio::test]
    async fn первый_catch_up_делает_полный_tree() {
        let mut trees = HashMap::new();
        trees.insert("p1".to_string(), vec![entry("f1", "IN", "a.mov")]);
        let (mut s, mock) = sync_with(MockState {
            trees,
            page_size: 2,
            ..Default::default()
        });

        let r = s.catch_up("p1").await.unwrap();
        assert!(r.rebootstrapped, "без tree_at инкремент дал бы дыру");
        assert_eq!(mock.with(|m| m.tree_calls), 1);
        assert_eq!(mock.with(|m| m.delta_calls), 0, "дельту звать было незачем");
        assert_eq!(s.index.list_dir("p1", "IN").unwrap().len(), 1);
    }

    #[tokio::test]
    async fn дельты_листаются_страницами_до_конца() {
        let mut trees = HashMap::new();
        trees.insert("p1".to_string(), vec![]);
        let mut journal = HashMap::new();
        journal.insert(
            "p1".to_string(),
            vec![
                put(1, "f1", "IN", "a.mov"),
                put(2, "f2", "IN", "b.mov"),
                put(3, "f3", "IN", "c.mov"),
                put(4, "f4", "IN", "d.mov"),
                put(5, "f5", "IN", "e.mov"),
            ],
        );
        // Bootstrap отдаст курсор = 5 (последний seq), поэтому сначала обнулим
        // журнал, сделаем bootstrap, и только потом положим события.
        let (mut s, mock) = sync_with(MockState {
            trees,
            page_size: 2,
            ..Default::default()
        });
        s.bootstrap("p1").await.unwrap();
        mock.with(|m| m.journal = journal);

        let r = s.catch_up("p1").await.unwrap();

        // 5 событий по 2 на страницу: 3 страницы с данными + 1 пустая на добивку.
        assert_eq!(r.pages, 4, "цикл обязан крутиться до пустой страницы");
        assert_eq!(r.upserted, 5);
        assert_eq!(r.cursor, 5);
        assert_eq!(s.index.list_dir("p1", "IN").unwrap().len(), 5);
    }

    #[tokio::test]
    async fn truncated_переводит_на_полный_tree() {
        let mut trees = HashMap::new();
        trees.insert("p1".to_string(), vec![entry("f1", "IN", "a.mov")]);
        let (mut s, mock) = sync_with(MockState {
            trees,
            ..Default::default()
        });
        s.bootstrap("p1").await.unwrap();

        // Курсор станет «слишком старым»: журнал уехал вперёд.
        mock.with(|m| {
            m.truncate_before = 1_000;
            m.tree_calls = 0;
        });
        s.index.apply_delta("p1", &[], 1).unwrap(); // курсор = 1

        let r = s.catch_up("p1").await.unwrap();
        assert!(r.rebootstrapped);
        assert_eq!(mock.with(|m| m.tree_calls), 1, "спасает только /tree");
    }

    #[tokio::test]
    async fn неприменимая_дельта_тоже_ведёт_к_tree() {
        let mut trees = HashMap::new();
        trees.insert("p1".to_string(), vec![]);
        let (mut s, mock) = sync_with(MockState {
            trees,
            ..Default::default()
        });
        s.bootstrap("p1").await.unwrap();

        // Put без folder_path применить нельзя — локальный путь строится из него.
        let mut bad = put(1, "f1", "IN", "a.mov");
        bad.folder_path = None;
        mock.with(|m| {
            m.journal.insert("p1".to_string(), vec![bad]);
            m.tree_calls = 0;
        });

        let r = s.catch_up("p1").await.unwrap();
        assert!(r.rebootstrapped, "дыру в индексе оставлять нельзя");
        assert_eq!(mock.with(|m| m.tree_calls), 1);
    }

    #[tokio::test]
    async fn застрявший_курсор_не_вешает_цикл() {
        let mut trees = HashMap::new();
        trees.insert("p1".to_string(), vec![]);
        let (mut s, mock) = sync_with(MockState {
            trees,
            ..Default::default()
        });
        s.bootstrap("p1").await.unwrap();

        // Изображаем баг на той стороне: события есть, а курсор стоит на месте.
        mock.with(|m| {
            m.journal
                .insert("p1".to_string(), vec![put(1, "f1", "IN", "a.mov")]);
            m.freeze_cursor = true;
        });

        let err = s.catch_up("p1").await.unwrap_err();
        assert!(
            matches!(&err, StorageError::Other(m) if m.contains("курсор не продвинулся")),
            "получили: {err}"
        );
    }

    #[tokio::test]
    async fn проекты_кэшируются_локально() {
        let (mut s, _mock) = sync_with(MockState {
            projects: one_project(),
            ..Default::default()
        });

        s.refresh_projects().await.unwrap();
        assert_eq!(s.index.clients().unwrap().len(), 1);
        assert_eq!(s.index.projects(Some("c1")).unwrap().len(), 1);
    }

    #[tokio::test]
    async fn capabilities_пессимистичны_до_первого_запроса() {
        let (mut s, _mock) = sync_with(MockState {
            caps: Capabilities {
                rename: true,
                ..Default::default()
            },
            ..Default::default()
        });

        assert!(!s.caps().rename, "до запроса не умеем ничего");
        s.refresh_capabilities().await.unwrap();
        assert!(s.caps().rename);
    }

    #[tokio::test]
    async fn ошибка_одного_проекта_не_роняет_остальные() {
        let mut trees = HashMap::new();
        trees.insert("p1".to_string(), vec![entry("f1", "IN", "a.mov")]);
        let (mut s, mock) = sync_with(MockState {
            projects: one_project(),
            trees,
            ..Default::default()
        });
        s.refresh_projects().await.unwrap();

        mock.with(|m| m.fail_next = Some(StorageError::Network("обрыв".into())));
        let results = s.catch_up_all().await;
        assert_eq!(results.len(), 1);
        assert!(results[0].1.is_err());

        // Следующий проход должен пройти нормально — отказ был одноразовым.
        let results = s.catch_up_all().await;
        assert!(results[0].1.is_ok());
    }
}
