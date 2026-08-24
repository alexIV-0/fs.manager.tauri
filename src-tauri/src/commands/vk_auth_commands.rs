// VK OAuth (implicit flow) + валидация токена.
//
// Поток (см. VK_AUTOPOST_PLAN.md, путь B/vk.com):
//   1. vk_auth_open  — открывает webview-окно с oauth.vk.com/authorize
//      (response_type=token), дефолтные настройки webview.
//   2. Перехват токена — В RUST: on_navigation ловит редирект на
//      blank.html#access_token; фоновый polling URL окна — подстраховка;
//      init-script — третий путь (если IPC доступен).
//   3. handle/emit → событие `vk-auth-result` (token + userId) в UI + закрытие окна.
//
// ⚠️ НЕ добавлять сюда custom user_agent / incognito / маскировку window.webkit —
// это ломает VK ID («Unknown method passed [3]»). Дефолты работают.

use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

/// Kate Mobile app_id — offline-токен НЕ привязан к IP (стабильно с любой машины,
/// переживает ребут, не истекает). Минус: нет Клипов (shortVideo) — только Video.
/// Для Клипов нужен vk.com (6287487), но его VK-ID-токен IP-bound. См. план.
const VK_DEFAULT_CLIENT_ID: &str = "2685278";

/// Метка окна логина (единственное — переоткрытие закрывает прошлое).
const VK_AUTH_WINDOW_LABEL: &str = "vkAuthWin";

/// Событие с результатом логина — на него подписан UI ноды.
const VK_AUTH_RESULT_EVENT: &str = "vk-auth-result";

/// Init-script: на каждой странице окна логина ловит токен из URL-фрагмента и
/// один раз пробрасывает его в Rust (`vk_auth_capture`), если IPC доступен.
const VK_AUTH_INIT_SCRIPT: &str = r#"
(function () {
  function tryCapture() {
    try {
      if (window.__vkCaptured) return;
      var h = window.location.hash || '';
      if (h.indexOf('access_token=') === -1) return;
      var p = new URLSearchParams(h.charAt(0) === '#' ? h.slice(1) : h);
      var token = p.get('access_token');
      if (!token) return;
      window.__vkCaptured = true;
      var payload = {
        token: token,
        expiresIn: parseInt(p.get('expires_in') || '0', 10),
        userId: parseInt(p.get('user_id') || '0', 10)
      };
      var inv =
        (window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke) ||
        (window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke) ||
        null;
      if (inv) inv('vk_auth_capture', payload);
    } catch (e) {}
  }
  tryCapture();
  window.addEventListener('hashchange', tryCapture);
  window.addEventListener('load', tryCapture);
})();
"#;

/// Достаёт значение параметра `key` из URL (ищет в hash или query).
fn param_from_url(s: &str, key: &str) -> Option<String> {
    let needle = format!("{}=", key);
    let start = s.find(&needle)? + needle.len();
    let rest = &s[start..];
    let end = rest.find(|c| c == '&' || c == '#').unwrap_or(rest.len());
    let val = &rest[..end];
    if val.is_empty() {
        None
    } else {
        Some(val.to_string())
    }
}

/// Если в URL есть `access_token` — рассылает `vk-auth-result`, закрывает окно
/// логина и возвращает true. Иначе false. Общий для on_navigation и polling.
fn emit_token_from_url(app: &tauri::AppHandle, url: &str) -> bool {
    let Some(token) = param_from_url(url, "access_token") else {
        return false;
    };
    let user_id: i64 = param_from_url(url, "user_id")
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);
    let expires_in: i64 = param_from_url(url, "expires_in")
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);

    let payload = json!({ "token": token, "expiresIn": expires_in, "userId": user_id });
    let _ = app.emit(VK_AUTH_RESULT_EVENT, payload);
    if let Some(w) = app.get_webview_window(VK_AUTH_WINDOW_LABEL) {
        let _ = w.close();
    }
    true
}

/// Открыть окно логина VK. Токен придёт асинхронно событием `vk-auth-result`.
/// `fresh` зарезервирован (revoke=1 — показать диалог даже при активной сессии).
#[tauri::command]
#[specta::specta]
pub fn vk_auth_open(
    app: tauri::AppHandle,
    client_id: Option<String>,
    fresh: bool,
) -> Result<(), String> {
    let cid = client_id
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| VK_DEFAULT_CLIENT_ID.to_string());

    let revoke = if fresh { "&revoke=1" } else { "" };
    // БЕЗ display=mobile: он уводит на старую форму логина (падает с
    // unauthorized.js timeout). Дефолт → VK ID (id.vk.com), который подхватывает
    // сохранённую сессию, показывает выбор аккаунта и завершается token-редиректом.
    let url = format!(
        "https://oauth.vk.com/authorize?client_id={}\
         &scope=video,wall,groups,offline,photos,docs\
         &response_type=token\
         &redirect_uri=https://oauth.vk.com/blank.html\
         &v=5.199{}",
        cid, revoke
    );
    let parsed = tauri::Url::parse(&url).map_err(|e| format!("bad oauth url: {}", e))?;

    // Переоткрытие: закрываем прошлое окно логина, если осталось.
    if let Some(prev) = app.get_webview_window(VK_AUTH_WINDOW_LABEL) {
        let _ = prev.close();
    }

    let captured = Arc::new(AtomicBool::new(false));

    let app_nav = app.clone();
    let cap_nav = captured.clone();
    WebviewWindowBuilder::new(&app, VK_AUTH_WINDOW_LABEL, WebviewUrl::External(parsed))
        .title("Вход в VK")
        .inner_size(540.0, 720.0)
        .initialization_script(VK_AUTH_INIT_SCRIPT)
        .on_navigation(move |url| {
            if !cap_nav.load(Ordering::SeqCst) && emit_token_from_url(&app_nav, url.as_str()) {
                cap_nav.store(true, Ordering::SeqCst);
            }
            true
        })
        .build()
        .map_err(|e| format!("build auth window: {}", e))?;

    // Подстраховка: опрашиваем URL окна (если on_navigation не отдал фрагмент).
    let app_poll = app.clone();
    let cap_poll = captured.clone();
    std::thread::spawn(move || {
        for _ in 0..260 {
            std::thread::sleep(Duration::from_millis(700));
            if cap_poll.load(Ordering::SeqCst) {
                return;
            }
            let Some(w) = app_poll.get_webview_window(VK_AUTH_WINDOW_LABEL) else {
                return;
            };
            if let Ok(u) = w.url() {
                if emit_token_from_url(&app_poll, u.as_str()) {
                    cap_poll.store(true, Ordering::SeqCst);
                    return;
                }
            }
        }
    });

    Ok(())
}

/// Вызывается init-скриптом при перехвате токена (если IPC доступен). Рассылает
/// событие в UI и закрывает окно. Внутренняя команда (не в TS-биндингах).
#[tauri::command]
#[specta::specta]
pub fn vk_auth_capture(
    app: tauri::AppHandle,
    token: String,
    expires_in: Option<i64>,
    user_id: Option<i64>,
) -> Result<(), String> {
    let payload = json!({
        "token": token,
        "expiresIn": expires_in.unwrap_or(0),
        "userId": user_id.unwrap_or(0),
    });
    app.emit(VK_AUTH_RESULT_EVENT, payload)
        .map_err(|e| format!("emit {}: {}", VK_AUTH_RESULT_EVENT, e))?;

    if let Some(win) = app.get_webview_window(VK_AUTH_WINDOW_LABEL) {
        let _ = win.close();
    }
    Ok(())
}

/// Список админ-сообществ пользователя (`groups.get filter=admin`) — для выбора
/// цели постинга (#vkGroups). Возвращает массив `{ id, name }`.
#[tauri::command]
#[specta::specta]
pub async fn vk_groups_get(token: String) -> Result<Value, String> {
    let url = format!(
        "https://api.vk.com/method/groups.get?access_token={}&filter=admin&extended=1&v=5.131",
        token
    );
    let res = super::http_client::api()
        .get(&url)
        .send()
        .await
        // `without_url()`: у VK access_token лежит в query, а Display у reqwest::Error
        // дописывает ` for url (...)`. Текст ошибки уходит в окно логов и в архив на
        // диске — то есть токен ложился бы в файл открытым текстом.
        .map_err(|e| format!("request: {}", e.without_url()))?;
    let body = res
        .text()
        .await
        .map_err(|e| format!("read body: {}", e.without_url()))?;
    let json: Value = serde_json::from_str(&body).map_err(|e| format!("parse: {}", e))?;

    if let Some(err) = json.get("error") {
        let msg = err
            .get("error_msg")
            .and_then(|m| m.as_str())
            .unwrap_or("unknown VK error");
        return Err(format!("VK: {}", msg));
    }

    let items = json
        .get("response")
        .and_then(|r| r.get("items"))
        .and_then(|i| i.as_array())
        .cloned()
        .unwrap_or_default();
    let out: Vec<Value> = items
        .iter()
        .map(|g| {
            json!({
                "id": g.get("id").cloned().unwrap_or(Value::Null),
                "name": g.get("name").cloned().unwrap_or(Value::Null),
            })
        })
        .collect();
    Ok(Value::Array(out))
}

/// Проверка токена через `users.get` (server-side, без CORS).
/// Возвращает объект пользователя `{ id, first_name, last_name }` или ошибку VK.
#[tauri::command]
#[specta::specta]
pub async fn vk_validate_token(token: String) -> Result<Value, String> {
    let url = format!(
        "https://api.vk.com/method/users.get?access_token={}&v=5.199",
        token
    );
    let res = super::http_client::api()
        .get(&url)
        .send()
        .await
        // `without_url()`: у VK access_token лежит в query, а Display у reqwest::Error
        // дописывает ` for url (...)`. Текст ошибки уходит в окно логов и в архив на
        // диске — то есть токен ложился бы в файл открытым текстом.
        .map_err(|e| format!("request: {}", e.without_url()))?;
    let body = res
        .text()
        .await
        .map_err(|e| format!("read body: {}", e.without_url()))?;
    let json: Value = serde_json::from_str(&body).map_err(|e| format!("parse: {}", e))?;

    if let Some(err) = json.get("error") {
        let msg = err
            .get("error_msg")
            .and_then(|m| m.as_str())
            .unwrap_or("unknown VK error");
        return Err(format!("VK: {}", msg));
    }

    json.get("response")
        .and_then(|r| r.as_array())
        .and_then(|a| a.first())
        .cloned()
        .ok_or_else(|| "empty users.get response".to_string())
}
