// Затирание секретов в тексте, который покидает машину или ложится на диск.
//
// Зачем: по `VENDOR_KEYS_CONTRACT.md` §3 ключ не должен попадать ни в один лог и ни
// в один дамп ошибки. Логи шагов уезжают на сайт вместе с `progress`, а архив логов
// лежит на диске двое суток — окажись ключ там, вычистить его оттуда нечем.
//
// ── Что здесь НЕ делается и почему
//
// Никакой эвристики «строка выглядит случайной». Имена файлов, хэши, id задач и
// base64-превью прошли бы такую проверку и превратились бы в `••••` — логи стали бы
// нечитаемыми ровно там, где по ним разбирают аварию. Затираются только два класса:
// значение после известного маркера (`Bearer `, `api_key=`, …) и токен с известным
// префиксом (`sk-`, `AIza`, …). Всё остальное остаётся как есть — сознательно, с
// расчётом на то, что плагин не станет писать ключ в лог сам.

const MASK: &str = "••••";

/// Маркеры «дальше идёт секрет». Сравнение регистронезависимое.
const MARKERS: &[&str] = &[
    "bearer ",
    "authorization: ",
    "authorization=",
    "x-api-key: ",
    "xi-api-key: ",
    "api-key: ",
    "api_key=",
    "apikey=",
    "access_token=",
    "refresh_token=",
    "client_secret=",
    "token=",
];

/// Префиксы самодостаточных токенов: по ним ключ узнаётся без маркера рядом.
const PREFIXES: &[&str] = &["sk-", "sk_", "xi-", "vk1.", "ghp_", "AIza", "GOCSPX-"];

/// Минимальная длина хвоста, чтобы считать его секретом. Ниже порога — это скорее
/// обрывок текста, чем ключ, и затирать его значило бы портить лог без причины.
const MIN_TAIL: usize = 12;

/// Символы, из которых состоят токены. Пробел, кавычка, запятая — граница.
fn is_token_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | '~' | '+' | '/' | '=' | ':')
}

/// Длина «хвоста» токена начиная с байтового смещения `from`.
fn token_len(s: &str, from: usize) -> usize {
    s[from..]
        .chars()
        .take_while(|c| is_token_char(*c))
        .map(|c| c.len_utf8())
        .sum()
}

/// Возвращает текст, в котором значения секретов заменены на `••••`.
///
/// Функция дешёвая и идемпотентная: повторный прогон уже затёртой строки её не
/// портит (`••••` не состоит из token-символов).
pub fn redact_secrets(input: &str) -> String {
    let lower = input.to_ascii_lowercase();
    let mut out = String::with_capacity(input.len());
    let mut i = 0usize;

    'outer: while i < input.len() {
        if !input.is_char_boundary(i) {
            i += 1;
            continue;
        }

        // 1. Маркер: затираем то, что идёт следом.
        for m in MARKERS {
            if lower[i..].starts_with(m) {
                let value_start = i + m.len();
                let len = token_len(input, value_start);
                if len >= MIN_TAIL {
                    out.push_str(&input[i..value_start]);
                    out.push_str(MASK);
                    i = value_start + len;
                    continue 'outer;
                }
            }
        }

        // 2. Токен с известным префиксом. Только на границе слова: иначе `sk-` внутри
        //    пути (`.../task-sk-01/...`) утащил бы за собой кусок пути.
        let at_boundary = i == 0 || !input[..i].chars().next_back().is_some_and(is_token_char);
        if at_boundary {
            for p in PREFIXES {
                let p_lower = p.to_ascii_lowercase();
                if lower[i..].starts_with(&p_lower) {
                    let len = token_len(input, i);
                    if len >= p.len() + MIN_TAIL {
                        out.push_str(MASK);
                        i += len;
                        continue 'outer;
                    }
                }
            }
        }

        let ch = input[i..].chars().next().unwrap();
        out.push(ch);
        i += ch.len_utf8();
    }

    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn затирает_значение_после_маркера() {
        assert_eq!(
            redact_secrets("headers: Authorization: Bearer abcdef0123456789xyz"),
            "headers: Authorization: Bearer ••••"
        );
        assert_eq!(
            redact_secrets("GET /v1/x?api_key=0123456789abcdef&n=1"),
            "GET /v1/x?api_key=••••&n=1"
        );
    }

    #[test]
    fn затирает_токен_по_префиксу_без_маркера() {
        assert_eq!(
            redact_secrets("ключ sk-0123456789abcdef протух"),
            "ключ •••• протух"
        );
    }

    #[test]
    fn не_трогает_короткие_хвосты() {
        // «token=1» — это не ключ, а параметр; портить лог незачем.
        assert_eq!(redact_secrets("token=1"), "token=1");
        assert_eq!(redact_secrets("sk-abc"), "sk-abc");
    }

    #[test]
    fn префикс_внутри_слова_не_срабатывает() {
        // Иначе из пути пропал бы целый сегмент.
        let s = "/Users/a/task-sk-0123456789abcdef/out.mp4";
        assert_eq!(redact_secrets(s), s);
    }

    #[test]
    fn обычный_лог_не_меняется() {
        let s = "ffmpeg -i /Vol/IN/клип 01.mov -c:v h264 → OUT/клип 01.mp4 (00:02:34)";
        assert_eq!(redact_secrets(s), s);
    }

    #[test]
    fn идемпотентна() {
        let once = redact_secrets("Bearer abcdef0123456789xyz");
        assert_eq!(redact_secrets(&once), once);
    }

    #[test]
    fn кириллица_не_ломает_смещения() {
        assert_eq!(
            redact_secrets("Ошибка вендора: api_key=0123456789abcdef — отказ"),
            "Ошибка вендора: api_key=•••• — отказ"
        );
    }
}
