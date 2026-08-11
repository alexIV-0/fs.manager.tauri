// Общие HTTP-клиенты для всех модулей, которые ходят в сеть.
//
// Зачем один дом вместо `reqwest::Client::new()` на каждый вызов:
//
// 1. **Таймауты.** У `Client::new()` их нет НИ ОДНОГО. Зависший сервер держал запрос
//    вечно, и в пути автопостинга это означало вечно занятый виток обработки: слот в
//    ResourcePool держится до возврата плагина, а плагин ждёт ответа. Выйти можно было
//    только перезапуском приложения.
//
// 2. **Переиспользование соединений.** Каждый `Client::new()` заводит свой пул, то есть
//    новое TCP+TLS-рукопожатие. Модули опрашивают статусы в циклах (YouTube, VK,
//    Telegram), там это заметно.
//
// Профиля два, потому что запросы разной природы:
//
//   • `api()` — вызовы API, авторизация, опросы статуса. Короткие, им полный таймаут
//     уместен: не ответил за две минуты — считаем мёртвым.
//   • `transfer()` — заливка и скачивание файлов. Полного таймаута НЕТ намеренно:
//     многогигабайтный мастер едет долго и законно. Вместо него таймаут ПРОСТОЯ —
//     живая медленная передача не рвётся, а зависшая без единого байта отваливается.
//
// Значения согласованы с `http_commands.rs`, где эта развилка появилась впервые.

use std::sync::OnceLock;
use std::time::Duration;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
const API_TOTAL_TIMEOUT: Duration = Duration::from_secs(120);
const TRANSFER_IDLE_TIMEOUT: Duration = Duration::from_secs(60);

const USER_AGENT: &str = "fs-manager-tauri";

/// Клиент для API-запросов, авторизации и опросов статуса.
pub fn api() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .user_agent(USER_AGENT)
            .connect_timeout(CONNECT_TIMEOUT)
            .timeout(API_TOTAL_TIMEOUT)
            .build()
            // Сборка падает только на кривой системной TLS-конфигурации. Ронять
            // приложение из-за этого не будем — деградируем до клиента без таймаутов.
            .unwrap_or_else(|e| {
                eprintln!("[http] api-клиент с таймаутами не собрался ({e}), беру дефолтный");
                reqwest::Client::new()
            })
    })
}

/// Клиент для передачи файлов: без полного таймаута, с таймаутом простоя.
pub fn transfer() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .user_agent(USER_AGENT)
            .connect_timeout(CONNECT_TIMEOUT)
            .read_timeout(TRANSFER_IDLE_TIMEOUT)
            .build()
            .unwrap_or_else(|e| {
                eprintln!("[http] transfer-клиент с таймаутами не собрался ({e}), беру дефолтный");
                reqwest::Client::new()
            })
    })
}

#[cfg(test)]
mod tests {
    /// Клиент обязан быть ОДНИМ на процесс: иначе теряется пул соединений, ради
    /// которого он и общий.
    #[test]
    fn клиенты_переиспользуются() {
        assert!(std::ptr::eq(super::api(), super::api()));
        assert!(std::ptr::eq(super::transfer(), super::transfer()));
    }

    /// Профили должны быть РАЗНЫМИ объектами: у них разная политика таймаутов, и
    /// схлопывание их в один тихо вернуло бы полный таймаут на заливку мастера.
    #[test]
    fn профили_не_совпадают() {
        assert!(!std::ptr::eq(super::api(), super::transfer()));
    }
}
