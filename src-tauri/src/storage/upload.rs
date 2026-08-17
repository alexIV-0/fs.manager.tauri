// Заливка: presign PUT → передача байтов напрямую в R2 → notify.
//
// Три вещи, из которых состоит вся сложность:
//
// 1. **`/notify` обязателен.** Без него объект в бакете есть, а бэкенд про него не
//    знает: строки в Postgres нет, журнала нет, сайт файла не видит. Заливка без
//    подтверждения — это молчаливый рассинхрон, худший из возможных исходов.
//
// 2. **Одиночный PUT ограничен 5 ГиБ и не возобновляется.** Multipart-эндпоинтов
//    на бэкенде пока нет, поэтому файл крупнее порога должен получить ПОНЯТНЫЙ
//    отказ ДО начала передачи, а не падение на четвёртом гигабайте.
//
// 3. **Ссылку берём в момент старта.** TTL по умолчанию час: пачка ссылок,
//    выписанная на длинную очередь заранее, протухнет в хвосте.

use std::path::Path;

use serde::Serialize;
use sha2::{Digest, Sha256};

use super::types::{Capabilities, StorageError};

// ─── Выбор стратегии ─────────────────────────────────────────────────────────

/// Как заливать. `Multipart` пока не реализован — поля `upload_id`/`parts_done`
/// в `transfers` уже есть, чтобы при появлении эндпоинтов не менять схему.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum UploadStrategy {
    SinglePut,
    Multipart,
}

/// Жёсткий предел одиночного `PUT` в S3/R2. Больше — только multipart.
pub const SINGLE_PUT_LIMIT: i64 = 5 * 1024 * 1024 * 1024;

/// Решить, чем заливать, и **отказать заранее**, если нужного механизма нет.
///
/// Порог `threshold` — из настроек (по умолчанию 96 МБ): выше него multipart
/// выгоднее по скорости и даёт докачку. Но пока `caps.multipart == false`,
/// единственный доступный путь — одиночный PUT, и он работает лишь до 5 ГиБ.
pub fn choose_strategy(
    size: i64,
    threshold: i64,
    caps: &Capabilities,
) -> Result<UploadStrategy, StorageError> {
    let wants_multipart = size > threshold;

    if wants_multipart && caps.multipart {
        return Ok(UploadStrategy::Multipart);
    }

    if size > SINGLE_PUT_LIMIT {
        // Это не «неудобно», а физически невозможно: одиночный PUT такое не примет.
        return Err(StorageError::Unsupported(format!(
            "Файл {} — больше 5 ГиБ, а multipart-загрузка бэкендом пока не поддерживается. \
             Одиночным запросом такой файл залить нельзя.",
            human_size(size)
        )));
    }

    Ok(UploadStrategy::SinglePut)
}

// ─── Имя, пригодное для каталога ─────────────────────────────────────────────

/// Дубль правил `validateLogicalName` бэкенда (`lib/storage/file-names.ts`).
///
/// **Проверять обязаны ДО передачи байтов.** Имя валидирует `/notify`, то есть уже
/// после успешного PUT: объект в бакете есть, строки в каталоге нет, удалить его нам
/// нечем (`delete` работает по `file_id`). Один результат с двоеточием в имени —
/// и мы платим за мусор, который никто не прочитает, а человек видит
/// «Байты залиты, но подтверждение не прошло» вместо причины.
///
/// Ручной дубль правила чужой стороны — как `apply_vars` для масок: сверять глазами.
/// Расхождение безопасно в одну сторону: если бэкенд строже, отказ придёт от него,
/// как раньше. Строже здесь быть нельзя — отклоним то, что он бы принял.
pub fn check_logical_name(name: &str) -> Result<(), StorageError> {
    let trimmed = name.trim();
    let bad = |msg: String| Err(StorageError::Other(msg));

    if trimmed.is_empty() {
        return bad("Пустое имя файла хранилище не примет".into());
    }
    if trimmed == "." || trimmed == ".." {
        return bad("Имя «.» или «..» хранилище не примет".into());
    }
    // Те же символы, что запрещает бэкенд: разделители путей, запретное в Windows
    // и управляющие байты.
    if let Some(ch) = trimmed
        .chars()
        .find(|c| matches!(c, '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|') || c.is_control())
    {
        let shown = if ch.is_control() {
            "управляющий символ".to_string()
        } else {
            format!("«{ch}»")
        };
        return bad(format!(
            "В имени «{trimmed}» есть символ, недопустимый в хранилище: {shown}. \
             Запрещены \\ / : * ? \" < > | и управляющие символы"
        ));
    }
    // Точка в конце — отказ. Пробел в конце бэкенд не отвергает, а СРЕЗАЕТ (`trim`
    // перед проверкой), поэтому и мы здесь молчим: отклонить значило бы не пустить
    // файл, который он бы принял. Побочный эффект чужого `trim` — имя в каталоге
    // окажется без пробела, и локальную копию потом переставит `reconcile_local_paths`.
    if trimmed.ends_with('.') {
        return bad(format!(
            "Имя «{trimmed}» кончается точкой — хранилище такое не примет"
        ));
    }
    if trimmed.len() > MAX_NAME_BYTES {
        return bad(format!(
            "Имя длиннее {MAX_NAME_BYTES} байт ({} байт) — хранилище такое не примет",
            trimmed.len()
        ));
    }
    // Зарезервированные в Windows: `con`, `prn`, `aux`, `nul`, `com1..9`, `lpt1..9`,
    // с расширением или без.
    let stem = trimmed.split('.').next().unwrap_or(trimmed).to_lowercase();
    let reserved = matches!(stem.as_str(), "con" | "prn" | "aux" | "nul")
        || ((stem.starts_with("com") || stem.starts_with("lpt"))
            && stem.len() == 4
            && stem.as_bytes()[3].is_ascii_digit()
            && stem.as_bytes()[3] != b'0');
    if reserved {
        return bad(format!("Имя «{trimmed}» зарезервировано в Windows"));
    }
    Ok(())
}

/// Предел длины имени у бэкенда — в БАЙТАХ utf-8, не в символах.
const MAX_NAME_BYTES: usize = 180;

pub fn human_size(bytes: i64) -> String {
    const K: f64 = 1024.0;
    let b = bytes as f64;
    if b < K {
        return format!("{bytes} Б");
    }
    let units = ["КБ", "МБ", "ГБ", "ТБ"];
    let mut v = b / K;
    let mut i = 0;
    while v >= K && i + 1 < units.len() {
        v /= K;
        i += 1;
    }
    format!("{:.1} {}", v, units[i])
}

// ─── Content-Type ────────────────────────────────────────────────────────────

/// Тип по расширению — зеркалит `resolveProjectContentType` бэкенда.
///
/// Их политика пропускает `application/octet-stream`, то есть формально можно
/// всегда присылать его. Но точный тип нужен, чтобы **сайт понимал, что можно
/// проиграть в браузере**: с `octet-stream` он этого не узнает.
pub fn guess_content_type(name: &str) -> &'static str {
    let lower = name.to_lowercase();
    let ext = lower.rsplit('.').next().unwrap_or("");
    match ext {
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        "mov" | "qt" => "video/quicktime",
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "ogg" => "audio/ogg",
        "txt" | "md" => "text/plain",
        "csv" => "text/csv",
        "json" => "application/json",
        "pdf" => "application/pdf",
        "zip" => "application/zip",
        // Всё остальное — включая ProRes/HAP в .mov (они уже выше),
        // AE-проекты, EXR, MKV. Политика бэкенда это принимает.
        _ => "application/octet-stream",
    }
}

// ─── Хэш ─────────────────────────────────────────────────────────────────────

/// sha256 файла отдельным проходом.
///
/// Считаем ДО заливки, а не по ходу: тело запроса уходит потоком, и вклиниться в
/// него хэшером — заметно больше кода. Лишнее чтение с диска дешевле сложности,
/// а `content_hash` нужен по делу: у multipart-объектов `etag` перестаёт быть
/// хэшем содержимого, и сравнение «устарела ли копия» на нём сломается.
pub fn sha256_file(path: &Path) -> Result<String, String> {
    use std::io::Read;
    let mut f = std::fs::File::open(path).map_err(|e| format!("open {}: {e}", path.display()))?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 1 << 20];
    loop {
        let n = f.read(&mut buf).map_err(|e| format!("read: {e}"))?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn caps(multipart: bool) -> Capabilities {
        Capabilities {
            multipart,
            ..Default::default()
        }
    }

    const MB: i64 = 1024 * 1024;
    const GB: i64 = 1024 * MB;

    #[test]
    fn мелкий_файл_идёт_одиночным_put() {
        assert_eq!(
            choose_strategy(10 * MB, 96 * MB, &caps(false)).unwrap(),
            UploadStrategy::SinglePut
        );
    }

    #[test]
    fn выше_порога_без_multipart_всё_равно_едет_если_влезает() {
        // Порог — про выгоду, а не про возможность: 500 МБ одиночным PUT уедут.
        assert_eq!(
            choose_strategy(500 * MB, 96 * MB, &caps(false)).unwrap(),
            UploadStrategy::SinglePut
        );
    }

    #[test]
    fn выше_порога_с_multipart_выбирает_его() {
        assert_eq!(
            choose_strategy(500 * MB, 96 * MB, &caps(true)).unwrap(),
            UploadStrategy::Multipart
        );
    }

    #[test]
    fn больше_пяти_гиб_без_multipart_отказ_заранее() {
        // Ключевой тест: отказ ДО начала передачи. Иначе четыре гигабайта уедут
        // впустую и упадут на последнем.
        let err = choose_strategy(6 * GB, 96 * MB, &caps(false)).unwrap_err();
        match err {
            StorageError::Unsupported(m) => {
                assert!(m.contains("5 ГиБ"), "сообщение должно объяснять причину: {m}");
                assert!(m.contains("6.0 ГБ"), "и называть размер файла: {m}");
            }
            other => panic!("ожидался Unsupported, получили {other:?}"),
        }
    }

    #[test]
    fn больше_пяти_гиб_с_multipart_проходит() {
        assert_eq!(
            choose_strategy(6 * GB, 96 * MB, &caps(true)).unwrap(),
            UploadStrategy::Multipart
        );
    }

    #[test]
    fn ровно_на_пределе_ещё_можно() {
        assert_eq!(
            choose_strategy(SINGLE_PUT_LIMIT, 96 * MB, &caps(false)).unwrap(),
            UploadStrategy::SinglePut
        );
        assert!(choose_strategy(SINGLE_PUT_LIMIT + 1, 96 * MB, &caps(false)).is_err());
    }

    #[test]
    fn типы_по_расширению() {
        assert_eq!(guess_content_type("a.mp4"), "video/mp4");
        assert_eq!(guess_content_type("A.MOV"), "video/quicktime");
        // ProRes и HAP лежат в .mov — политика бэкенда пропускает video/quicktime,
        // она смотрит MIME, а не кодек внутри.
        assert_eq!(guess_content_type("master_hap.mov"), "video/quicktime");
        assert_eq!(guess_content_type("proj.aep"), "application/octet-stream");
        assert_eq!(guess_content_type("без-расширения"), "application/octet-stream");
    }

    #[test]
    fn читаемый_размер() {
        assert_eq!(human_size(512), "512 Б");
        assert_eq!(human_size(2 * MB), "2.0 МБ");
        assert_eq!(human_size(3 * GB), "3.0 ГБ");
    }

    /// Имя с двоеточием обязано отлетать ДО передачи байтов.
    ///
    /// Живой случай: воркер получил задачу, в которой сайт прислал `findTime` сырой
    /// ISO-строкой, маска `$findTime` попала в имя результата —
    /// `2026-08-17T20:42:18.165Z_….mp4`. Байты уехали, `/notify` отказал 400-м, объект
    /// остался в бакете сиротой, а человек увидел «подтверждение не прошло».
    #[test]
    fn имя_с_запрещённым_символом_не_доходит_до_заливки() {
        let err = check_logical_name("2026-08-17T20:42:18.165Z_123.mp4").unwrap_err();
        let msg = err.to_string();
        assert!(msg.contains(':'), "в сообщении должен быть виден сам символ: {msg}");

        for bad in [r"a\b.mp4", "a/b.mp4", "a*b.mp4", "a?b.mp4", "a\"b.mp4", "a<b.mp4", "a>b.mp4", "a|b.mp4"] {
            assert!(check_logical_name(bad).is_err(), "должно отклоняться: {bad}");
        }
        assert!(check_logical_name("файл\u{1}.mp4").is_err(), "управляющий символ");
    }

    #[test]
    fn нормальные_имена_проходят() {
        for ok in [
            "17.08-11.06_123.mp4",
            "ролик финал.mov",
            "Демо_Letuchiy-Korabl_Rus-ENG.mp4",
            "folderState.json",
        ] {
            assert!(check_logical_name(ok).is_ok(), "должно приниматься: {ok}");
        }
    }

    #[test]
    fn пограничные_правила_имени() {
        assert!(check_logical_name("").is_err(), "пустое");
        assert!(check_logical_name("..").is_err(), "точки");
        assert!(check_logical_name("файл.").is_err(), "точка в конце");
        // Пробел в конце бэкенд СРЕЗАЕТ, а не отвергает — значит и мы пропускаем:
        // отклонять то, что он принимает, нельзя.
        assert!(check_logical_name("файл ").is_ok(), "пробел бэкенд срезает сам");
        assert!(check_logical_name("con").is_err(), "зарезервировано в Windows");
        assert!(check_logical_name("com1.mp4").is_err(), "com1 зарезервировано");
        // `com0` и `common` не зарезервированы — правило не должно быть шире чужого.
        assert!(check_logical_name("com0.mp4").is_ok());
        assert!(check_logical_name("common.mp4").is_ok());
        // Предел в БАЙТАХ: кириллица занимает по два.
        assert!(check_logical_name(&"я".repeat(91)).is_err(), "182 байта");
        assert!(check_logical_name(&"я".repeat(90)).is_ok(), "180 байт");
    }

    #[test]
    fn хэш_считается_и_совпадает_с_известным() {
        let p = std::env::temp_dir().join(format!("fsm-sha-{}.bin", std::process::id()));
        std::fs::write(&p, b"hello world").unwrap();
        assert_eq!(
            sha256_file(&p).unwrap(),
            "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9"
        );
        let _ = std::fs::remove_file(&p);
    }
}
