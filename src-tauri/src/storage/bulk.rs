// Массовые операции по папке: скачать поддерево целиком, отправить поддерево целиком.
//
// ── Зачем это отдельно от `ensure_local` ────────────────────────────────────
// Пофайловая гидрация — это «дай байты вот этого файла, я жду». Папка так не
// работает: в ней сотни файлов и десятки гигабайт, и команда, которая ждёт их
// все, держит IPC-вызов часами — интерфейс не знает, что происходит, отменить
// нельзя, а перезапуск программы теряет работу без следа.
//
// Поэтому здесь команда только СТАВИТ работу в очередь и сразу отвечает числами,
// а байты везут фоновые задачи демона. Ровно та же схема, что у заливки
// (`pending.rs`): «о работе сообщают, цикл её разгружает».
//
// ── Чего массовая операция НЕ делает ────────────────────────────────────────
// Не трогает конфликты и ошибки. В конфликте направление не выводится по
// определению, а у ошибки не видно, какая половина отвалилась: файл в состоянии
// `Error` мог не докачаться (тогда нужно скачивание) и мог не залиться (тогда на
// диске лежит единственная копия работы, и скачивание её затрёт). Массовое
// действие обязано быть предсказуемым, поэтому такие файлы считаются отдельно и
// показываются человеку числом — разбирают их по одному, стрелками в строке.
//
// ── Очередь живёт в памяти ─────────────────────────────────────────────────
// После перезапуска её нет, и это осознанно: невидимый список отложенной работы
// хуже честно оборванной операции. Что успело скачаться — видно значками, а
// повторное «скачать папку» доберёт остаток (уже скачанное оно пропустит).

use std::collections::{HashSet, VecDeque};
use std::path::{Path, PathBuf};

use serde::Serialize;

use super::paths::{self, parse_mirror_path, under_mirror};
use super::state::FileState;
use super::{MirrorNode, StorageService};

/// Предохранитель на одну операцию. Проект на сотню тысяч файлов не должен
/// превращать очередь в мегабайты путей в памяти: остаток доберётся повторным
/// вызовом, и об этом честно сообщается флагом `capped`.
const MAX_QUEUE: usize = 20_000;

// ─── Очередь ─────────────────────────────────────────────────────────────────

/// Что человек попросил притащить папками. Дедуп по пути: два «скачать папку»
/// подряд не должны поставить один файл дважды.
#[derive(Debug, Default)]
pub struct DownloadQueue {
    items: VecDeque<(PathBuf, i64)>,
    queued: HashSet<PathBuf>,
    /// Взято в работу и ещё не закончено.
    inflight: usize,
    total: usize,
    done: usize,
    failed: usize,
    /// Объём серии по каталогу — сколько предстояло скачать.
    bytes: i64,
}

impl DownloadQueue {
    /// Поставить пачку. Возвращает `(сколько встало, упёрлись ли в предохранитель)`.
    pub fn push_all(&mut self, files: &[(PathBuf, i64)]) -> (usize, bool) {
        // Новая серия начинается, когда прошлая доработана: счётчик «12 из 47»
        // обязан говорить о том, что человек только что запустил, а не о сумме за
        // всё время работы программы.
        if self.items.is_empty() && self.inflight == 0 {
            self.total = 0;
            self.done = 0;
            self.failed = 0;
            self.bytes = 0;
        }

        let mut added = 0;
        let mut capped = false;
        for (path, size) in files {
            if self.items.len() + self.inflight >= MAX_QUEUE {
                capped = true;
                break;
            }
            if !self.queued.insert(path.clone()) {
                continue;
            }
            self.items.push_back((path.clone(), *size));
            self.total += 1;
            self.bytes += *size;
            added += 1;
        }
        (added, capped)
    }

    pub fn next(&mut self) -> Option<PathBuf> {
        let (path, _) = self.items.pop_front()?;
        self.queued.remove(&path);
        self.inflight += 1;
        Some(path)
    }

    pub fn finish(&mut self, ok: bool) {
        self.inflight = self.inflight.saturating_sub(1);
        if ok {
            self.done += 1;
        } else {
            self.failed += 1;
        }
    }

    /// Снять всё, что не начали. Идущие передачи не трогаем: их отменяют поимённо
    /// в списке передач — там видно, что именно обрывается.
    pub fn clear(&mut self) -> usize {
        let n = self.items.len();
        let bytes: i64 = self.items.iter().map(|(_, b)| *b).sum();
        self.items.clear();
        self.queued.clear();
        self.total = self.total.saturating_sub(n);
        self.bytes -= bytes;
        n
    }

    pub fn status(&self) -> DownloadQueueStatus {
        DownloadQueueStatus {
            pending: self.items.len() as i64,
            active: self.inflight as i64,
            done: self.done as i64,
            failed: self.failed as i64,
            total: self.total as i64,
            bytes: self.bytes,
        }
    }
}

/// Состояние очереди для интерфейса.
#[derive(Debug, Clone, Default, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct DownloadQueueStatus {
    /// Ждут своей очереди.
    pub pending: i64,
    /// Качаются прямо сейчас.
    pub active: i64,
    pub done: i64,
    pub failed: i64,
    /// Всего в текущей серии.
    pub total: i64,
    /// Объём серии по каталогу.
    pub bytes: i64,
}

// ─── Что предстоит ───────────────────────────────────────────────────────────

/// План массовой операции: числа, которыми спрашивают человека до её начала.
///
/// Цифры бесплатны — всё уже лежит в индексе, ни одного запроса в сеть.
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SubtreePlan {
    /// `false` — полного обхода проекта ещё не делали, и числа неизвестны. Это НЕ
    /// то же самое, что «пусто», и интерфейс обязан их различать.
    pub known: bool,
    pub files: i64,
    pub bytes: i64,
    /// Уже на диске.
    pub local_files: i64,
    pub local_bytes: i64,
    /// Нет копии или в облаке новее — это и скачается.
    pub missing_files: i64,
    pub missing_bytes: i64,
    /// Есть только здесь или правлено здесь — это и уедет.
    pub upload_files: i64,
    pub upload_bytes: i64,
    /// Конфликты и ошибки: массовая операция их не трогает, разбираются по одному.
    pub unresolved: i64,
}

/// Итог постановки в очередь.
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SubtreeQueued {
    /// Сколько файлов встало в очередь.
    pub queued: i64,
    pub bytes: i64,
    /// Пропущено как уже сделанное.
    pub skipped_done: i64,
    /// Пропущено как требующее разбора (конфликт, ошибка).
    pub skipped_unresolved: i64,
    /// Оставлено оффлайн заодно со скачиванием.
    pub pinned: i64,
    /// Упёрлись в предохранитель — остаток доберётся повторным вызовом.
    pub capped: bool,
}

// ─── Разбор поддерева ────────────────────────────────────────────────────────

/// Внутренний результат разбора: и числа, и сами списки. Обе команды считают одно
/// и то же, поэтому считаем один раз.
struct Survey {
    known: bool,
    files: i64,
    bytes: i64,
    /// Есть копия на диске (в любом состоянии, включая расхождение).
    local_files: i64,
    local_bytes: i64,
    /// Копия на диске совпадает с облаком — скачивать нечего.
    fresh_files: i64,
    unresolved: i64,
    /// `(путь, размер, file_id)` — идентификатор нужен для «оставить оффлайн».
    download: Vec<(PathBuf, i64, String)>,
    upload: Vec<(PathBuf, i64)>,
    /// Пути всех файлов поддерева, известных каталогу (в нижнем регистре).
    /// По нему обход диска отличает «каталог про этот файл не знает» от «знает».
    known_paths: HashSet<String>,
}

impl StorageService {
    /// Разобрать поддерево: что качать, что заливать, что не наше дело.
    ///
    /// `None` — путь не папка проекта в зеркале. Владелец целиком сюда не входит
    /// намеренно: «скачать всё» не имеет ни одного честного числа, пока каталоги
    /// его проектов не загружены, а загружать их все ради подсказки — залп запросов
    /// на ровном месте.
    ///
    /// `verify` — сверять ли локальные копии с диском (см. ниже). Для ЧИСЕЛ он
    /// выключен, для ДЕЙСТВИЯ включён: подсказку человек ждёт мгновенно, а
    /// правильность решения важнее скорости.
    async fn survey_subtree(&self, path: &Path, verify: bool) -> Result<Option<Survey>, String> {
        let root = self.mirror_root();
        if !under_mirror(&root, path) {
            return Ok(None);
        }
        let Some(MirrorNode::Folder {
            project_id,
            folder_path,
        }) = paths::classify(&root, &self.dirs(), path)
        else {
            return Ok(None);
        };

        // Дерево проекта могло не загружаться ни разу (папку не открывали) — тогда
        // индекс пуст, и без обхода мы бы честно ответили «здесь нечего скачивать».
        self.ensure_catalog(&project_id).await?;
        self.touch_project(&project_id);

        let pid = project_id.clone();
        let fp = folder_path.clone();
        let (known, mut files) = self
            .with_sync(move |s| {
                Ok((
                    s.index.tree_at(&pid)?.is_some(),
                    s.index.subtree_states(&pid, &fp)?,
                ))
            })
            .await?;

        // ── Сверка с диском ДО решения ──────────────────────────────────────
        //
        // Метка «правлено локально» появляется только от явной сверки: движок
        // значков диска не касается, а фоновый проход идёт раз в минуту. В эту
        // минуту массовое скачивание считало бы копию актуальной — и затёрло бы
        // файл, который правили руками. Цена ошибки несимметрична: лишний `stat`
        // против потерянной работы.
        //
        // Сверяем только те, у которых копия числится совпадающей с baseline:
        // «правлено», «конфликт» и «ошибка» массовая операция и так не трогает, а
        // у «только в облаке» сверять нечего.
        //
        // Для ПЛАНА сверки нет: он рисует вопрос человеку, и ждать `stat` по
        // тысяче файлов ради цифры в диалоге — платить временем отклика за
        // точность, которая всё равно перепроверится через секунду. Числа в
        // вопросе — оценка по индексу, решение — по диску.
        for f in files.iter_mut() {
            if !verify || !matches!(f.state, FileState::Fresh | FileState::Stale) {
                continue;
            }
            if self.detect_local_change(&f.file_id).await?.is_none() {
                continue;
            }
            // Состояние сменилось — перечитываем его движком, а не берём ответ
            // сверки: та про облако ничего не знает и «правлено локально» вернёт
            // и там, где на самом деле конфликт.
            let id = f.file_id.clone();
            if let Some(b) = self.with_sync(move |s| s.index.badge_state(&id)).await? {
                f.state = b.state;
            }
        }

        // Раскладка по графам. Лок каталога здесь уже не нужен — все решения
        // приняты выше, осталась арифметика и сборка путей.
        let dirs = self.dirs();
        let mut survey = Survey {
            known,
            files: files.len() as i64,
            bytes: 0,
            local_files: 0,
            local_bytes: 0,
            fresh_files: 0,
            unresolved: 0,
            download: Vec::new(),
            upload: Vec::new(),
            known_paths: HashSet::new(),
        };

        for f in files {
            survey.bytes += f.size_bytes;
            let Some(local) =
                paths::mirror_path(&root, &dirs, &project_id, &f.folder_path, &f.name)
            else {
                // Проекта нет в раскладке — путь на диске не собрать. Такое бывает
                // только на устаревшей карте.
                continue;
            };
            survey
                .known_paths
                .insert(local.to_string_lossy().to_lowercase());

            // Копия на диске есть у всего, кроме «только в облаке».
            if !matches!(f.state, FileState::Cloud) {
                survey.local_files += 1;
                survey.local_bytes += f.size_bytes;
            }

            match f.state {
                // Скачать: копии нет либо в облаке новее.
                FileState::Cloud | FileState::Stale => {
                    // Без ключа байтов нет — качать нечего.
                    if f.has_key {
                        survey.download.push((local, f.size_bytes, f.file_id));
                    }
                }
                // Залить: есть только здесь либо правили здесь.
                FileState::LocalOnly | FileState::LocalModified => {
                    survey.upload.push((local, f.size_bytes));
                }
                // Требует человека — массовая операция мимо.
                FileState::Conflict | FileState::Error => survey.unresolved += 1,
                FileState::Fresh => survey.fresh_files += 1,
                // Уже едет: ставить второй раз незачем.
                FileState::Downloading | FileState::Uploading => {}
            }
        }

        // Файлы, которых каталог не знает вовсе: результаты обработки в OUT,
        // положенное руками. В индексе их нет по определению — значит искать их
        // можно только на диске.
        //
        // Запроса на файл здесь НЕ делаем: выборка выше покрывает поддерево
        // целиком, поэтому «нет в `known_paths`» и означает «каталог не знает».
        // Сравнение в нижнем регистре: на macOS `IN/a.mov` и `in/A.MOV` — один файл.
        for (p, size) in disk_files(path) {
            if survey
                .known_paths
                .contains(&p.to_string_lossy().to_lowercase())
            {
                continue;
            }
            // Путь обязан разбираться в логические координаты — иначе заливать
            // его некуда (файл вне структуры проекта).
            if parse_mirror_path(&root, &self.dirs(), &p).is_none() {
                continue;
            }
            survey.files += 1;
            survey.bytes += size;
            survey.local_files += 1;
            survey.local_bytes += size;
            survey.upload.push((p, size));
        }

        Ok(Some(survey))
    }

    /// Что предстоит массовой операции по этой папке. `None` — не папка зеркала.
    pub async fn subtree_plan(&self, path: &Path) -> Result<Option<SubtreePlan>, String> {
        let Some(s) = self.survey_subtree(path, false).await? else {
            return Ok(None);
        };
        Ok(Some(SubtreePlan {
            known: s.known,
            files: s.files,
            bytes: s.bytes,
            local_files: s.local_files,
            local_bytes: s.local_bytes,
            missing_files: s.download.len() as i64,
            missing_bytes: s.download.iter().map(|(_, b, _)| *b).sum(),
            upload_files: s.upload.len() as i64,
            upload_bytes: s.upload.iter().map(|(_, b)| *b).sum(),
            unresolved: s.unresolved,
        }))
    }

    /// Поставить в очередь скачивание всего, чего здесь нет. `None` — не наш путь.
    ///
    /// `pin = true` — заодно «оставить оффлайн»: без этого скачанную папку через
    /// несколько часов уносит вытеснение по TTL, и человек, скачавший её ради
    /// работы, остаётся ни с чем. Пин — единственное, что от вытеснения защищает.
    pub async fn queue_subtree_download(
        &self,
        path: &Path,
        pin: bool,
    ) -> Result<Option<SubtreeQueued>, String> {
        let Some(s) = self.survey_subtree(path, true).await? else {
            return Ok(None);
        };

        let items: Vec<(PathBuf, i64)> = s
            .download
            .iter()
            .map(|(p, b, _)| (p.clone(), *b))
            .collect();
        let (added, capped) = {
            let mut q = self.downloads.lock().unwrap();
            q.push_all(&items)
        };

        let mut pinned = 0;
        if pin {
            let ids: Vec<String> = s.download.iter().map(|(_, _, id)| id.clone()).collect();
            pinned = self
                .with_sync(move |s| {
                    let mut n: i64 = 0;
                    for id in ids {
                        s.index.set_pinned(&id, true)?;
                        n += 1;
                    }
                    Ok(n)
                })
                .await?;
        }

        // Значки в колонке должны шевельнуться сразу: постановка в очередь — уже
        // событие, а первый байт может поехать через несколько секунд.
        self.emit_changed(&[path.to_string_lossy().to_string()]);

        Ok(Some(SubtreeQueued {
            queued: added as i64,
            bytes: items.iter().map(|(_, b)| *b).sum(),
            // Актуальная копия уже лежит на диске — такие файлы не качаем.
            skipped_done: s.fresh_files,
            skipped_unresolved: s.unresolved,
            pinned,
            capped,
        }))
    }

    /// Отправить в облако всё, что есть только здесь. `None` — не наш путь.
    ///
    /// Байты везёт та же очередь заливки, что и всегда (`pending.rs`): здесь только
    /// явное «эти файлы готовы» — с ним заливка не ждёт затишья и снимает прошлую
    /// ручную остановку, потому что это прямая команда человека.
    pub async fn queue_subtree_upload(&self, path: &Path) -> Result<Option<SubtreeQueued>, String> {
        let Some(s) = self.survey_subtree(path, true).await? else {
            return Ok(None);
        };

        let paths: Vec<PathBuf> = s.upload.iter().map(|(p, _)| p.clone()).collect();
        for p in &paths {
            self.allow_upload(p);
        }
        let queued = self.mark_dirty(&paths, true);
        self.emit_changed(&[path.to_string_lossy().to_string()]);

        Ok(Some(SubtreeQueued {
            queued: queued as i64,
            bytes: s.upload.iter().map(|(_, b)| *b).sum(),
            // Всё, что не требует заливки и не требует разбора, в облаке уже есть.
            skipped_done: s.files - s.upload.len() as i64 - s.unresolved,
            skipped_unresolved: s.unresolved,
            pinned: 0,
            capped: false,
        }))
    }

    pub fn download_queue_status(&self) -> DownloadQueueStatus {
        self.downloads.lock().unwrap().status()
    }

    /// Снять из очереди всё, что ещё не начали. Возвращает, сколько снято.
    pub fn cancel_download_queue(&self) -> i64 {
        self.downloads.lock().unwrap().clear() as i64
    }

    /// Взять следующий файл — для фоновой задачи демона.
    pub(super) fn take_download(&self) -> Option<PathBuf> {
        self.downloads.lock().unwrap().next()
    }

    pub(super) fn finish_download(&self, ok: bool) {
        self.downloads.lock().unwrap().finish(ok);
    }
}

/// Файлы поддерева НА ДИСКЕ, рекурсивно. Скрытое и огрызки недокачанного мимо.
fn disk_files(root: &Path) -> Vec<(PathBuf, i64)> {
    let mut out = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(rd) = std::fs::read_dir(&dir) else {
            continue;
        };
        for de in rd.flatten() {
            let name = de.file_name().to_string_lossy().to_string();
            if name.starts_with('.') || name.ends_with(".part") {
                continue;
            }
            if de.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                stack.push(de.path());
                continue;
            }
            let size = de.metadata().map(|m| m.len() as i64).unwrap_or(0);
            out.push((de.path(), size));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(name: &str, size: i64) -> (PathBuf, i64) {
        (PathBuf::from(format!("/m/{name}")), size)
    }

    #[test]
    fn дубли_не_встают_дважды() {
        let mut q = DownloadQueue::default();
        assert_eq!(q.push_all(&[item("a", 10), item("b", 20)]), (2, false));
        // Второе «скачать папку» по той же папке не должно удвоить работу.
        assert_eq!(q.push_all(&[item("a", 10), item("c", 5)]), (1, false));
        let s = q.status();
        assert_eq!(s.pending, 3);
        assert_eq!(s.total, 3);
        assert_eq!(s.bytes, 35);
    }

    #[test]
    fn серия_считается_заново_только_после_доработки() {
        let mut q = DownloadQueue::default();
        q.push_all(&[item("a", 10)]);
        let p = q.next().unwrap();
        // Пока файл в работе, новая пачка продолжает ту же серию — иначе счётчик
        // «1 из 2» врал бы человеку прямо во время скачивания.
        q.push_all(&[item("b", 10)]);
        assert_eq!(q.status().total, 2);
        q.finish(true);
        assert_eq!(q.status().done, 1);
        assert_eq!(p, PathBuf::from("/m/a"));

        // Доработали всё — следующая пачка начинает счёт с нуля.
        assert_eq!(q.next(), Some(PathBuf::from("/m/b")));
        q.finish(true);
        q.push_all(&[item("c", 7)]);
        let s = q.status();
        assert_eq!((s.total, s.done, s.bytes), (1, 0, 7));
    }

    #[test]
    fn отмена_убирает_только_неначатое() {
        let mut q = DownloadQueue::default();
        q.push_all(&[item("a", 10), item("b", 20), item("c", 30)]);
        q.next();
        assert_eq!(q.clear(), 2);
        let s = q.status();
        // Один файл остаётся в работе: его обрывают поимённо в списке передач.
        assert_eq!((s.pending, s.active, s.total), (0, 1, 1));
        assert_eq!(s.bytes, 10);
    }

    #[test]
    fn предохранитель_не_даёт_очереди_расти_бесконечно() {
        let mut q = DownloadQueue::default();
        let many: Vec<(PathBuf, i64)> = (0..MAX_QUEUE + 10)
            .map(|i| item(&format!("f{i}"), 1))
            .collect();
        let (added, capped) = q.push_all(&many);
        assert_eq!(added, MAX_QUEUE);
        assert!(capped, "переполнение обязано быть видно вызывающему");
    }
}
