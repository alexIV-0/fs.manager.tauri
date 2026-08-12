// Вотчер зеркала: единственная страховка для файлов, о которых нам не сообщили.
//
// ── Место в схеме триггеров ─────────────────────────────────────────────────
// Заливку запускают три вещи, и порядок важен:
//
//   1. явный вызов раннера («результат готов») — 99 % случаев, точный;
//   2. ЭТОТ вотчер — ручные действия: перетащили файл в папку, положили из
//      Finder, распаковали архив. Сообщить о готовности тут некому;
//   3. редкий полный обход — если вотчер не поднялся или очередь переполнилась.
//
// Вотчер НЕ решает, когда заливать: он только кладёт путь в очередь кандидатов
// (`pending.rs`), а готовность определяется затишьем. Иначе первое же событие от
// ffmpeg отправило бы в облако недописанный файл.
//
// ── Про эхо ─────────────────────────────────────────────────────────────────
// Вотчер видит и наши собственные записи: скачивание, вытеснение, переименование
// локальной копии. Дёшево гасится в два слоя — `.part` и скрытые файлы очередь не
// принимает вообще (`pending::accepts`), а скачанный файл к моменту финального
// rename уже есть в каталоге и его baseline совпадает с диском, поэтому заливка
// его отбрасывает. Полностью подавлять эхо отдельным списком «мы это сами
// тронули» смысла нет: цена ложного кандидата — один stat.
//
// ── Чего вотчер не делает ───────────────────────────────────────────────────
// Удаления игнорируются. Удалить файл в облаке — отдельное осознанное действие
// (`delete` в API), и выводить его из события файловой системы нельзя: вытеснение
// локальной копии по TTL выглядит для вотчера точно так же, как удаление
// человеком, а стирать по нему файл в облаке — потеря данных.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex as StdMutex};

use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};

use super::pending::Pending;

/// Живой вотчер. Пока значение живо — слежка идёт; `drop` её снимает.
pub struct MirrorWatcher {
    _inner: RecommendedWatcher,
    root: PathBuf,
}

impl MirrorWatcher {
    pub fn root(&self) -> &Path {
        &self.root
    }
}

/// Поднять слежку за корнем зеркала.
///
/// Рекурсивно и намеренно: файл может появиться в любой папке любого проекта, а
/// нерекурсивная слежка за открытыми колонками (та, что обновляет интерфейс)
/// зависит от того, что человек открыл, — для заливки это негодный критерий.
pub fn start(root: &Path, pending: Arc<StdMutex<Pending>>) -> Result<MirrorWatcher, String> {
    if root.as_os_str().is_empty() {
        return Err("Корень зеркала не задан".into());
    }
    if !root.is_dir() {
        return Err(format!("Корень зеркала не папка: {}", root.display()));
    }

    let mut watcher = RecommendedWatcher::new(
        move |res: Result<Event, notify::Error>| {
            let Ok(event) = res else { return };
            if !interesting(&event.kind) {
                return;
            }
            let Ok(mut q) = pending.lock() else { return };
            for p in event.paths {
                q.touch(p);
            }
        },
        Config::default(),
    )
    .map_err(|e| format!("вотчер зеркала не создан: {e}"))?;

    watcher
        .watch(root, RecursiveMode::Recursive)
        .map_err(|e| format!("слежка за {} не поднялась: {e}", root.display()))?;

    Ok(MirrorWatcher {
        _inner: watcher,
        root: root.to_path_buf(),
    })
}

/// Событие, после которого файл имеет смысл проверить.
///
/// `Access` отбрасываем: чтение файла — не повод для заливки, а на некоторых
/// платформах таких событий больше, чем всех остальных вместе.
fn interesting(kind: &EventKind) -> bool {
    matches!(
        kind,
        EventKind::Create(_) | EventKind::Modify(_) | EventKind::Any | EventKind::Other
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn чтение_файла_не_событие_для_заливки() {
        assert!(!interesting(&EventKind::Access(
            notify::event::AccessKind::Read
        )));
        assert!(!interesting(&EventKind::Remove(
            notify::event::RemoveKind::File
        )));
    }

    #[test]
    fn создание_и_запись_интересны() {
        assert!(interesting(&EventKind::Create(
            notify::event::CreateKind::File
        )));
        assert!(interesting(&EventKind::Modify(
            notify::event::ModifyKind::Data(notify::event::DataChange::Content)
        )));
    }

    #[test]
    fn без_корня_не_поднимается() {
        let q = Arc::new(StdMutex::new(Pending::new()));
        assert!(start(Path::new(""), q.clone()).is_err());
        assert!(start(Path::new("/нет/такой/папки/точно"), q).is_err());
    }

    /// Проверяем главное свойство: событие о новом файле доходит до очереди.
    /// Без этого вотчер — украшение.
    #[test]
    fn событие_доходит_до_очереди() {
        let tmp = std::env::temp_dir().join(format!("mirror-watch-{}", std::process::id()));
        std::fs::create_dir_all(&tmp).unwrap();

        let q = Arc::new(StdMutex::new(Pending::new()));
        let _w = start(&tmp, q.clone()).expect("вотчер должен подняться");

        std::fs::write(tmp.join("clip.mov"), b"hello").unwrap();

        // Событие асинхронное: ждём до 3 секунд, проверяя очередь.
        let mut seen = false;
        for _ in 0..30 {
            std::thread::sleep(std::time::Duration::from_millis(100));
            if q.lock().unwrap().len() > 0 {
                seen = true;
                break;
            }
        }
        let _ = std::fs::remove_dir_all(&tmp);
        assert!(seen, "путь нового файла обязан попасть в очередь кандидатов");
    }
}
