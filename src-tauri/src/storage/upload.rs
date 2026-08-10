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
