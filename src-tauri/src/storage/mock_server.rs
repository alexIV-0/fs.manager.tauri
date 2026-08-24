// Крошечный HTTP-сервер для демо-режима: presigned-ссылки мока ведут сюда, и
// байты действительно ходят.
//
// Зачем это нужно. Без него в демо-режиме скачивание падает на несуществующем
// хосте, и половина интерфейса непроверяема: не видно ни прогресса, ни смены
// значков, ни работы вытеснения. С ним демо проигрывает весь путь целиком —
// скачивание, заливка с `notify`, удаление локальных копий — без единой строчки
// на стороне бэкенда.
//
// Это НЕ имитация R2 и не претендует на неё: ровно два метода, ровно столько
// разбора HTTP, сколько нужно нашему же клиенту.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

use super::mock::MockState;

/// Содержимое «бакета»: ключ → байты. Заливка кладёт сюда, скачивание берёт
/// отсюда, поэтому в демо работает полный круг «залил → вытеснил → скачал».
pub type Blobs = Arc<Mutex<HashMap<String, Vec<u8>>>>;

/// Поднять сервер на свободном порту. Возвращает базовый URL.
pub async fn start(state: Arc<Mutex<MockState>>, blobs: Blobs) -> Result<String, String> {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("bind: {e}"))?;
    let addr = listener
        .local_addr()
        .map_err(|e| format!("local_addr: {e}"))?;

    tokio::spawn(async move {
        loop {
            let Ok((sock, _)) = listener.accept().await else {
                return;
            };
            let state = state.clone();
            let blobs = blobs.clone();
            tokio::spawn(async move {
                let _ = handle(sock, state, blobs).await;
            });
        }
    });

    Ok(format!("http://{addr}"))
}

async fn handle(
    mut sock: TcpStream,
    state: Arc<Mutex<MockState>>,
    blobs: Blobs,
) -> std::io::Result<()> {
    let Some(req) = read_head(&mut sock).await? else {
        return Ok(());
    };

    match req.method.as_str() {
        "GET" => {
            let body = resolve_body(&req.path, &state, &blobs);
            respond(&mut sock, 200, &body).await
        }
        "PUT" => {
            let body = read_body(&mut sock, &req).await?;
            blobs
                .lock()
                .unwrap()
                .insert(percent_decode(req.path.trim_start_matches('/')), body);
            respond(&mut sock, 200, b"").await
        }
        _ => respond(&mut sock, 405, b"").await,
    }
}

/// Что отдать на GET.
///
/// Если объект заливали — отдаём его. Если нет (файл из демо-дерева, которого
/// никто не создавал) — генерируем ровно столько байт, сколько объявлено в
/// каталоге. Иначе размеры в интерфейсе разошлись бы с реальностью, а учёт
/// занятого места в зеркале стал бы враньём.
fn resolve_body(path: &str, state: &Arc<Mutex<MockState>>, blobs: &Blobs) -> Vec<u8> {
    let key = percent_decode(path.trim_start_matches('/'));
    let key = key.as_str();

    if let Some(b) = blobs.lock().unwrap().get(key) {
        return b.clone();
    }

    let declared = state
        .lock()
        .unwrap()
        .trees
        .values()
        .flatten()
        .find(|e| e.s3_key.as_deref() == Some(key))
        .and_then(|e| e.size_bytes)
        .unwrap_or(0)
        .max(0) as usize;

    // Повторяющийся узор, а не нули: детерминированно (хэш стабилен между
    // запусками) и заметно в отладчике, если куда-то попало не то.
    const PATTERN: &[u8] = b"fs-manager demo payload\n";
    PATTERN.iter().copied().cycle().take(declared).collect()
}

struct Head {
    method: String,
    path: String,
    content_length: Option<usize>,
    chunked: bool,
    /// Байты тела, которые уже прочитались вместе с заголовками.
    leftover: Vec<u8>,
}

async fn read_head(sock: &mut TcpStream) -> std::io::Result<Option<Head>> {
    let mut buf = Vec::with_capacity(2048);
    let mut tmp = [0u8; 1024];

    let split = loop {
        let n = sock.read(&mut tmp).await?;
        if n == 0 {
            return Ok(None);
        }
        buf.extend_from_slice(&tmp[..n]);
        if let Some(i) = find_headers_end(&buf) {
            break i;
        }
        if buf.len() > 64 * 1024 {
            return Ok(None);
        }
    };

    let head = String::from_utf8_lossy(&buf[..split]).to_string();
    let mut lines = head.lines();
    let mut first = lines.next().unwrap_or_default().split_whitespace();
    let method = first.next().unwrap_or_default().to_string();
    let path = first.next().unwrap_or_default().to_string();

    let mut content_length = None;
    let mut chunked = false;
    for l in lines {
        let Some((k, v)) = l.split_once(':') else { continue };
        let k = k.trim().to_ascii_lowercase();
        let v = v.trim();
        if k == "content-length" {
            content_length = v.parse::<usize>().ok();
        } else if k == "transfer-encoding" && v.to_ascii_lowercase().contains("chunked") {
            chunked = true;
        }
    }

    Ok(Some(Head {
        method,
        path,
        content_length,
        chunked,
        leftover: buf[split + 4..].to_vec(),
    }))
}

/// Percent-декодирование пути.
///
/// Имена файлов у нас кириллические, и HTTP-клиент кодирует их в пути
/// (`ролик` → `%D1%80%D0%BE…`). Без декодирования поиск по ключу не находит
/// ничего и сервер молча отдаёт пустое тело — ровно на этом и попался тест.
fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

fn find_headers_end(buf: &[u8]) -> Option<usize> {
    buf.windows(4).position(|w| w == b"\r\n\r\n")
}

/// Тело запроса. Поддерживаем обе формы: с `Content-Length` и chunked —
/// потоковая заливка может прислать любую, в зависимости от того, как reqwest
/// решит оформить `wrap_stream`.
async fn read_body(sock: &mut TcpStream, head: &Head) -> std::io::Result<Vec<u8>> {
    if head.chunked {
        return read_chunked(sock, head.leftover.clone()).await;
    }
    let want = head.content_length.unwrap_or(0);
    let mut body = head.leftover.clone();
    let mut tmp = [0u8; 8192];
    while body.len() < want {
        let n = sock.read(&mut tmp).await?;
        if n == 0 {
            break;
        }
        body.extend_from_slice(&tmp[..n]);
    }
    body.truncate(want.min(body.len()));
    Ok(body)
}

async fn read_chunked(sock: &mut TcpStream, mut pending: Vec<u8>) -> std::io::Result<Vec<u8>> {
    let mut out = Vec::new();
    let mut tmp = [0u8; 8192];

    loop {
        // Строка с размером куска.
        let line = loop {
            if let Some(i) = pending.windows(2).position(|w| w == b"\r\n") {
                let l = String::from_utf8_lossy(&pending[..i]).to_string();
                pending.drain(..i + 2);
                break l;
            }
            let n = sock.read(&mut tmp).await?;
            if n == 0 {
                return Ok(out);
            }
            pending.extend_from_slice(&tmp[..n]);
        };

        let size = usize::from_str_radix(line.trim().split(';').next().unwrap_or("0").trim(), 16)
            .unwrap_or(0);
        if size == 0 {
            return Ok(out);
        }

        while pending.len() < size + 2 {
            let n = sock.read(&mut tmp).await?;
            if n == 0 {
                out.extend_from_slice(&pending);
                return Ok(out);
            }
            pending.extend_from_slice(&tmp[..n]);
        }
        out.extend_from_slice(&pending[..size]);
        pending.drain(..size + 2); // сам кусок и завершающий CRLF
    }
}

async fn respond(sock: &mut TcpStream, code: u16, body: &[u8]) -> std::io::Result<()> {
    let reason = match code {
        200 => "OK",
        405 => "Method Not Allowed",
        _ => "Error",
    };
    let head = format!(
        "HTTP/1.1 {code} {reason}\r\nContent-Length: {}\r\nAccept-Ranges: bytes\r\nConnection: close\r\n\r\n",
        body.len()
    );
    sock.write_all(head.as_bytes()).await?;
    if !body.is_empty() {
        sock.write_all(body).await?;
    }
    sock.flush().await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::mock::demo_state;

    #[tokio::test]
    async fn отдаёт_столько_байт_сколько_объявлено_в_каталоге() {
        // Иначе размеры в интерфейсе разойдутся с тем, что легло на диск, и учёт
        // занятого места в зеркале превратится в вымысел.
        let state = Arc::new(Mutex::new(demo_state()));
        let blobs: Blobs = Arc::new(Mutex::new(HashMap::new()));
        let base = start(state.clone(), blobs).await.unwrap();

        // Файл выбираем ПО ИМЕНИ, а не «первый попавшийся»: обход HashMap не
        // детерминирован, и такой тест падал бы через раз без всякой причины.
        let (key, declared) = {
            let g = state.lock().unwrap();
            let e = g
                .trees
                .values()
                .flatten()
                .find(|e| e.name == "ролик_финал.mp4")
                .expect("демо-данные должны содержать этот файл")
                .clone();
            (e.s3_key.clone().unwrap(), e.size_bytes.unwrap())
        };

        let body = reqwest::get(format!("{base}/{key}"))
            .await
            .unwrap()
            .bytes()
            .await
            .unwrap();
        assert_eq!(body.len() as i64, declared);
    }

    #[test]
    fn кириллица_в_пути_декодируется() {
        assert_eq!(
            percent_decode("innohub/p1/OUT/uuid-%D1%80%D0%BE%D0%BB%D0%B8%D0%BA.mp4"),
            "innohub/p1/OUT/uuid-ролик.mp4"
        );
        // Обычный путь не должен пострадать.
        assert_eq!(percent_decode("a/b/c.mov"), "a/b/c.mov");
    }

    #[tokio::test]
    async fn залитое_возвращается_обратно() {
        // Полный круг: залил → скачал. Без него в демо не проверить ни заливку,
        // ни повторную гидрацию после вытеснения.
        let state = Arc::new(Mutex::new(demo_state()));
        let blobs: Blobs = Arc::new(Mutex::new(HashMap::new()));
        let base = start(state, blobs).await.unwrap();

        let client = reqwest::Client::new();
        let key = "innohub/projects/p1/OUT/uuid-новый.mp4";
        client
            .put(format!("{base}/{key}"))
            .body("содержимое результата".to_string())
            .send()
            .await
            .unwrap();

        let back = reqwest::get(format!("{base}/{key}"))
            .await
            .unwrap()
            .text()
            .await
            .unwrap();
        assert_eq!(back, "содержимое результата");
    }

    #[tokio::test]
    async fn понимает_chunked_тело() {
        // Потоковая заливка может прислать chunked вместо Content-Length — от того,
        // как reqwest оформит `wrap_stream`. Не поддержать значит терять заливки.
        let state = Arc::new(Mutex::new(demo_state()));
        let blobs: Blobs = Arc::new(Mutex::new(HashMap::new()));
        let base = start(state, blobs).await.unwrap();

        let chunks: Vec<Result<Vec<u8>, std::io::Error>> =
            vec![Ok(b"part1-".to_vec()), Ok(b"part2".to_vec())];
        let body = reqwest::Body::wrap_stream(futures_util::stream::iter(chunks));

        let key = "innohub/projects/p1/OUT/uuid-chunked.bin";
        reqwest::Client::new()
            .put(format!("{base}/{key}"))
            .body(body)
            .send()
            .await
            .unwrap();

        let back = reqwest::get(format!("{base}/{key}"))
            .await
            .unwrap()
            .text()
            .await
            .unwrap();
        assert_eq!(back, "part1-part2");
    }
}
