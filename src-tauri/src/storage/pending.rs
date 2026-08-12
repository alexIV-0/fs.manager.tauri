// Очередь кандидатов на заливку: «вот тут в зеркале что-то появилось, посмотри».
//
// ── Зачем она вообще ────────────────────────────────────────────────────────
// Раньше единственным способом узнать о новом файле был полный обход зеркала
// раз в 15 секунд (`service::pending_uploads`): программа платила обходом диска
// и запросом в индекс на каждый файл — за то, чего в 99 % тиков не происходило.
// Очередь переворачивает схему: о новом файле СООБЩАЮТ (вотчер файловой системы
// или сам раннер), а обход остаётся редкой страховкой.
//
// ── Почему нельзя заливать сразу по событию ─────────────────────────────────
// ffmpeg пишет файл минутами, и события файловой системы идут всё это время.
// Залить по первому событию — залить огрызок и объявить его результатом. Ждать
// события «файл закрыт» тоже нельзя: на macOS FSEvents его не даёт вообще,
// ждать просто нечего.
//
// Поэтому кандидат становится готовым ДВУМЯ путями:
//
//   • ЯВНО — раннер сказал «файл готов» (`mark_ready`). Он это знает точно:
//     шаг завершён, файл закрыт. Ожидания нет, и это основной путь.
//   • ПО ЗАТИШЬЮ — размер и mtime не менялись `quiet_pulses` осмотров подряд.
//     Эвристика, и другой здесь быть не может; она нужна для ручных действий
//     (перетащили файл в папку из Finder), где сообщить о готовности некому.
//
// ── Переполнение — не мелочь ────────────────────────────────────────────────
// `mv` десяти тысяч файлов в зеркало сгенерирует десять тысяч событий. Держать
// их все в памяти незачем: когда кандидатов больше `MAX_ITEMS`, очередь
// поднимает флаг `overflowed` и перестаёт принимать новых. Флаг означает «я
// потеряла картину, сделай полный обход» — то есть деградация к старому,
// медленному, но полному способу, а не молчаливая потеря файлов.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

/// Больше этого числа кандидатов не храним — вместо них поднимаем `overflowed`.
const MAX_ITEMS: usize = 4096;

/// Что мы видели на диске в прошлый осмотр.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Seen {
    pub size: u64,
    pub mtime: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
struct Entry {
    /// `None` — ещё ни разу не осматривали.
    seen: Option<Seen>,
    /// Сколько осмотров подряд размер и время не менялись.
    quiet: u32,
    /// Явное «готов» от раннера: затишья не ждём.
    ready: bool,
}

#[derive(Debug, Default)]
pub struct Pending {
    items: HashMap<PathBuf, Entry>,
    /// Файлы, заливку которых человек ОСТАНОВИЛ вручную, и то, как файл выглядел
    /// в этот момент.
    ///
    /// Без этого «Остановить» держалось ровно до следующего полного обхода (10
    /// минут) или события вотчера: страховка честно видела «файл есть на диске, в
    /// облаке нет» и начинала заливку заново. Формально правильно, а по факту
    /// программа спорила с человеком.
    ///
    /// Запрет снимается двумя способами, и оба — сигнал «намерение изменилось»:
    /// файл на диске стал другим (значит это уже другой файл) или прозвучала явная
    /// команда (`mark_ready` — «Отправить в облако», повтор задачи, конец витка).
    /// Живёт в памяти: после перезапуска программы запрет не сохраняется, и это
    /// осознанно — иначе он превратился бы в невидимый чёрный список.
    declined: HashMap<PathBuf, Option<Seen>>,
    overflowed: bool,
}

impl Pending {
    pub fn new() -> Self {
        Self::default()
    }

    /// Событие файловой системы: путь стоит проверить.
    ///
    /// Затишье сбрасывается — файл, в который только что писали, готовым не
    /// считается, даже если предыдущие осмотры его таковым почти признали.
    pub fn touch(&mut self, path: PathBuf) {
        if !accepts(&path) {
            return;
        }
        if let Some(e) = self.items.get_mut(&path) {
            e.quiet = 0;
            return;
        }
        if self.items.len() >= MAX_ITEMS {
            self.overflowed = true;
            return;
        }
        self.items.insert(path, Entry::default());
    }

    /// Явное «файл готов, заливай»: осмотры на затишье пропускаются.
    ///
    /// Лимит здесь тоже действует, но переполнение от явных вызовов означает,
    /// что раннер выдал разом больше `MAX_ITEMS` файлов — полный обход их
    /// подберёт, поэтому потери нет.
    pub fn mark_ready(&mut self, path: PathBuf) {
        if !accepts(&path) {
            return;
        }

        if let Some(e) = self.items.get_mut(&path) {
            e.ready = true;
            return;
        }
        if self.items.len() >= MAX_ITEMS {
            self.overflowed = true;
            return;
        }
        self.items.insert(
            path,
            Entry {
                ready: true,
                ..Default::default()
            },
        );
    }

    /// Объявить готовыми всех, кто уже в очереди.
    ///
    /// Это «залей то, что накопилось, не дожидаясь затишья» — вызывается в конце
    /// витка обработки, когда точно известно, что писать больше некому.
    pub fn mark_all_ready(&mut self) -> usize {
        for e in self.items.values_mut() {
            e.ready = true;
        }
        self.items.len()
    }

    pub fn len(&self) -> usize {
        self.items.len()
    }

    pub fn overflowed(&self) -> bool {
        self.overflowed
    }

    /// Снять флаг переполнения — после того, как полный обход всё подобрал.
    pub fn clear_overflow(&mut self) {
        self.overflowed = false;
    }

    /// Человек остановил заливку этого файла: из очереди убрать и сам не возвращать.
    pub fn decline(&mut self, path: PathBuf, seen: Option<Seen>) {
        self.items.remove(&path);
        self.declined.insert(path, seen);
    }

    /// Снять запрет — только по ЯВНОЙ команде человека («Отправить в облако»,
    /// повтор задачи).
    ///
    /// Нарочно отдельно от `mark_ready`: его зовёт и полный обход зеркала, который
    /// «нашёл незалитый файл» — то есть страховка, а не решение. Если бы запрет
    /// снимался там, остановленная заливка возобновлялась бы сама через десять
    /// минут, и кнопка «Остановить» ничего не значила бы.
    pub fn allow(&mut self, path: &Path) {
        self.declined.remove(path);
    }

    /// Остановлена ли заливка этого файла вручную — для вкладки «Не в облаке».
    pub fn is_declined(&self, path: &Path) -> bool {
        self.declined.contains_key(path)
    }

    /// Есть ли запрет — для тестов и диагностики.
    pub fn declined_len(&self) -> usize {
        self.declined.len()
    }

    pub fn clear(&mut self) {
        self.items.clear();
        self.declined.clear();
        self.overflowed = false;
    }

    /// Осмотреть кандидатов и вернуть тех, кого можно заливать.
    ///
    /// `stat` отдаёт `None`, если файла нет или это не файл — такой кандидат
    /// просто выбрасывается: заливать нечего. Функция передаётся аргументом,
    /// чтобы логику затишья можно было проверить тестом, не трогая диск.
    ///
    /// Возвращённые пути из очереди УХОДЯТ: повторная заливка одного файла
    /// каждый осмотр — худшее, что тут может произойти.
    pub fn collect_ready(
        &mut self,
        stat: impl Fn(&Path) -> Option<Seen>,
        quiet_pulses: u32,
        limit: usize,
    ) -> Vec<PathBuf> {
        let mut out = Vec::new();
        let mut drop_list = Vec::new();
        let mut allow_list = Vec::new();

        for (path, e) in self.items.iter_mut() {
            if out.len() >= limit {
                break;
            }
            let Some(now) = stat(path) else {
                // Файл исчез (переместили, удалили, был папкой) — не наш случай.
                drop_list.push(path.clone());
                continue;
            };
            // Остановленный вручную не возвращаем — пока файл тот же самый.
            if let Some(at_stop) = self.declined.get(path) {
                if *at_stop == Some(now) {
                    drop_list.push(path.clone());
                    continue;
                }
                // Файл после остановки изменился: это уже другое содержимое, и
                // прошлый отказ к нему не относится.
                allow_list.push(path.clone());
            }
            if e.ready {
                out.push(path.clone());
                drop_list.push(path.clone());
                continue;
            }
            if e.seen == Some(now) {
                e.quiet += 1;
                if e.quiet >= quiet_pulses {
                    out.push(path.clone());
                    drop_list.push(path.clone());
                }
            } else {
                e.seen = Some(now);
                e.quiet = 0;
            }
        }

        for p in allow_list {
            self.declined.remove(&p);
        }
        for p in drop_list {
            self.items.remove(&p);
        }
        out
    }
}

/// Что в очередь не берём вообще.
///
/// `.part` — наш собственный огрызок недокачанного файла: принять его значило бы
/// залить обратно то, что мы сами качаем. Скрытые файлы (`.DS_Store` и прочее)
/// в облаке не нужны.
fn accepts(path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
        return false;
    };
    !name.starts_with('.') && !name.ends_with(".part")
}

#[cfg(test)]
mod tests {
    /// «Остановить» обязано держаться дольше одного осмотра.
    ///
    /// Иначе полный обход зеркала (страховка) через несколько минут начинает
    /// заливку заново, и человек видит, что его решение отменили.
    #[test]
    fn остановленный_вручную_сам_не_возвращается() {
        use super::*;
        let mut q = Pending::new();
        let p = PathBuf::from("/m/большой.mov");
        let seen = Seen { size: 100, mtime: 7 };

        q.touch(p.clone());
        q.decline(p.clone(), Some(seen));

        // Страховка снова сообщает про этот файл — и не один раз.
        for _ in 0..5 {
            q.touch(p.clone());
            assert!(
                q.collect_ready(|_| Some(seen), 1, 10).is_empty(),
                "остановленный файл не должен уезжать сам"
            );
        }
    }

    /// Файл поменяли после остановки — это уже другое содержимое, запрет не про него.
    #[test]
    fn изменённый_после_остановки_заливается_снова() {
        use super::*;
        let mut q = Pending::new();
        let p = PathBuf::from("/m/большой.mov");
        q.decline(p.clone(), Some(Seen { size: 100, mtime: 7 }));

        let новый = Seen { size: 250, mtime: 9 };
        q.touch(p.clone());
        // Первый осмотр запоминает новое состояние, второй видит затишье.
        assert!(q.collect_ready(|_| Some(новый), 1, 10).is_empty());
        assert_eq!(q.collect_ready(|_| Some(новый), 1, 10), vec![p]);
        assert_eq!(q.declined_len(), 0, "запрет должен сняться сам");
    }

    /// Явная команда человека сильнее прошлой остановки.
    #[test]
    fn отправить_в_облако_снимает_запрет() {
        use super::*;
        let mut q = Pending::new();
        let p = PathBuf::from("/m/большой.mov");
        let seen = Seen { size: 100, mtime: 7 };
        q.decline(p.clone(), Some(seen));

        // Именно `allow` — то, что зовёт явная команда. `mark_ready` сам по себе
        // запрет НЕ снимает: его зовёт и полный обход, а он человеку не указ.
        q.mark_ready(p.clone());
        assert!(
            q.collect_ready(|_| Some(seen), 2, 10).is_empty(),
            "страховка не должна перебивать решение человека"
        );

        q.allow(&p);
        q.mark_ready(p.clone());
        assert_eq!(q.collect_ready(|_| Some(seen), 2, 10), vec![p]);
    }

    use super::*;

    fn seen(size: u64, mtime: i64) -> Option<Seen> {
        Some(Seen { size, mtime })
    }

    #[test]
    fn явный_готов_заливается_без_ожидания_затишья() {
        let mut p = Pending::new();
        p.mark_ready(PathBuf::from("/m/p/OUT/a.mov"));

        let ready = p.collect_ready(|_| seen(10, 100), 2, 10);
        assert_eq!(ready.len(), 1, "явный файл обязан уйти с первого осмотра");
        assert_eq!(p.len(), 0, "и уйти из очереди, чтобы не залиться дважды");
    }

    #[test]
    fn растущий_файл_не_заливается_пока_растёт() {
        let mut p = Pending::new();
        let path = PathBuf::from("/m/p/OUT/big.mov");
        p.touch(path.clone());

        // Каждый осмотр файл другого размера — ffmpeg всё ещё пишет.
        let mut size = 10;
        for _ in 0..5 {
            size += 10;
            let ready = p.collect_ready(|_| seen(size, 100), 2, 10);
            assert!(ready.is_empty(), "недописанный файл не должен уезжать");
        }

        // Запись кончилась: размер стабилен два осмотра подряд.
        assert!(p.collect_ready(|_| seen(size, 100), 2, 10).is_empty());
        assert_eq!(p.collect_ready(|_| seen(size, 100), 2, 10).len(), 1);
    }

    #[test]
    fn новое_событие_сбрасывает_затишье() {
        let mut p = Pending::new();
        let path = PathBuf::from("/m/p/OUT/big.mov");
        p.touch(path.clone());

        assert!(p.collect_ready(|_| seen(10, 100), 2, 10).is_empty());
        // Пришло событие — счётчик затишья обнулился, и одного осмотра
        // снова недостаточно.
        p.touch(path.clone());
        assert!(p.collect_ready(|_| seen(10, 100), 2, 10).is_empty());
        assert_eq!(p.collect_ready(|_| seen(10, 100), 2, 10).len(), 1);
    }

    #[test]
    fn исчезнувший_файл_выбрасывается() {
        let mut p = Pending::new();
        p.touch(PathBuf::from("/m/p/OUT/gone.mov"));
        assert!(p.collect_ready(|_| None, 2, 10).is_empty());
        assert_eq!(p.len(), 0, "кандидата без файла держать незачем");
    }

    #[test]
    fn огрызки_и_скрытые_не_попадают_в_очередь() {
        let mut p = Pending::new();
        p.touch(PathBuf::from("/m/p/OUT/clip.mov.part"));
        p.touch(PathBuf::from("/m/p/OUT/.DS_Store"));
        p.mark_ready(PathBuf::from("/m/p/OUT/other.mov.part"));
        assert_eq!(p.len(), 0);
    }

    #[test]
    fn переполнение_поднимает_флаг_а_не_ест_память() {
        let mut p = Pending::new();
        for i in 0..(MAX_ITEMS + 50) {
            p.touch(PathBuf::from(format!("/m/p/OUT/f{i}.mov")));
        }
        assert_eq!(p.len(), MAX_ITEMS);
        assert!(p.overflowed(), "потеря картины обязана быть видна");

        p.clear_overflow();
        assert!(!p.overflowed());
    }

    #[test]
    fn лимит_за_осмотр_соблюдается_и_остальные_остаются() {
        let mut p = Pending::new();
        for i in 0..10 {
            p.mark_ready(PathBuf::from(format!("/m/p/OUT/f{i}.mov")));
        }
        let ready = p.collect_ready(|_| seen(1, 1), 2, 4);
        assert_eq!(ready.len(), 4);
        assert_eq!(p.len(), 6, "остальные ждут следующего осмотра, а не теряются");
    }

    #[test]
    fn flush_объявляет_готовыми_накопившихся() {
        let mut p = Pending::new();
        p.touch(PathBuf::from("/m/p/OUT/a.mov"));
        p.touch(PathBuf::from("/m/p/OUT/b.mov"));
        assert!(p.collect_ready(|_| seen(1, 1), 5, 10).is_empty());

        assert_eq!(p.mark_all_ready(), 2);
        assert_eq!(p.collect_ready(|_| seen(1, 1), 5, 10).len(), 2);
    }
}
