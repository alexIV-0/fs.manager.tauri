// Telegram Bot API: валидация токена бота + проверка канала (server-side, без CORS).
//
// Авторизация (см. TELEGRAM_AUTOPOST_PLAN.md): «аккаунт» = бот с токеном @BotFather
// (формат `123456789:ABC...`). Никакого OAuth/WebView — токен вставляется строкой.
//
//   tg_validate_token — getMe: проверяет токен, возвращает { id, username, first_name }.
//   tg_get_chat       — getChat + getChatMember: резолвит канал и проверяет, что бот в
//                        нём админ с правом постить. Bot API НЕ умеет перечислять каналы
//                        бота, поэтому каждый канал добавляется вручную и валидируется тут.

use serde_json::{json, Value};
use std::collections::HashSet;

const TG_API: &str = "https://api.telegram.org";

/// GET к Bot API. Возвращает `result` при `ok:true`, иначе Err с `description` Telegram.
async fn tg_call(method_url: &str, query: &[(&str, &str)]) -> Result<Value, String> {
    let res = reqwest::Client::new()
        .get(method_url)
        .query(query)
        .send()
        .await
        .map_err(|e| format!("request: {}", e))?;
    let body = res.text().await.map_err(|e| format!("read body: {}", e))?;
    let json: Value = serde_json::from_str(&body).map_err(|e| format!("parse: {}", e))?;

    if json.get("ok").and_then(|v| v.as_bool()) == Some(true) {
        return Ok(json.get("result").cloned().unwrap_or(Value::Null));
    }
    let desc = json
        .get("description")
        .and_then(|d| d.as_str())
        .unwrap_or("unknown Telegram error");
    Err(format!("Telegram: {}", desc))
}

/// Проверка токена бота через `getMe`. Возвращает `{ id, is_bot, first_name, username }`
/// или ошибку Telegram (невалидный/отозванный токен → `Unauthorized`).
#[tauri::command]
#[specta::specta]
pub async fn tg_validate_token(token: String) -> Result<Value, String> {
    let url = format!("{}/bot{}/getMe", TG_API, token);
    tg_call(&url, &[]).await
}

/// Резолвит канал (`getChat`) и проверяет, что бот в нём может постить (`getChatMember`).
/// `chat` — `@username` (публичный) или числовой id (`-100…`, приватный).
/// Возвращает `{ id, title, username, type, canPost }`. Бот должен быть администратором
/// канала с `can_post_messages` (или создателем).
#[tauri::command]
#[specta::specta]
pub async fn tg_get_chat(token: String, chat: String) -> Result<Value, String> {
    // 1) id бота (нужен для getChatMember) — лёгкий getMe.
    let me = tg_call(&format!("{}/bot{}/getMe", TG_API, token), &[]).await?;
    let bot_id = me
        .get("id")
        .and_then(|v| v.as_i64())
        .ok_or_else(|| "getMe: нет id бота".to_string())?;

    // 2) сам чат — резолвит title/id/username, заодно проверяет, что бот его «видит».
    let chat_info = tg_call(
        &format!("{}/bot{}/getChat", TG_API, token),
        &[("chat_id", chat.as_str())],
    )
    .await?;

    // 3) членство бота в чате → право постить.
    let bot_id_str = bot_id.to_string();
    let member = tg_call(
        &format!("{}/bot{}/getChatMember", TG_API, token),
        &[("chat_id", chat.as_str()), ("user_id", bot_id_str.as_str())],
    )
    .await?;

    let status = member.get("status").and_then(|s| s.as_str()).unwrap_or("");
    let can_post = status == "creator"
        || (status == "administrator"
            && member
                .get("can_post_messages")
                .and_then(|v| v.as_bool())
                .unwrap_or(false));

    Ok(json!({
        "id": chat_info.get("id").cloned().unwrap_or(Value::Null),
        "title": chat_info.get("title").cloned().unwrap_or(Value::Null),
        "username": chat_info.get("username").cloned().unwrap_or(Value::Null),
        "type": chat_info.get("type").cloned().unwrap_or(Value::Null),
        "canPost": can_post,
    }))
}

/// Проверяет право бота постить в чат (`getChatMember`): creator или administrator
/// с `can_post_messages`. Ошибку трактует как «нельзя».
async fn bot_can_post(token: &str, chat_id: i64, bot_id: i64) -> bool {
    let chat = chat_id.to_string();
    let user = bot_id.to_string();
    match tg_call(
        &format!("{}/bot{}/getChatMember", TG_API, token),
        &[("chat_id", chat.as_str()), ("user_id", user.as_str())],
    )
    .await
    {
        Ok(member) => {
            let status = member.get("status").and_then(|s| s.as_str()).unwrap_or("");
            status == "creator"
                || (status == "administrator"
                    && member
                        .get("can_post_messages")
                        .and_then(|v| v.as_bool())
                        .unwrap_or(false))
        }
        Err(_) => false,
    }
}

/// Авто-обнаружение каналов бота через `getUpdates` (см. TELEGRAM_AUTOPOST_PLAN.md).
///
/// Когда бота добавляют администратором канала, Telegram шлёт событие `my_chat_member`
/// с объектом канала; посты канала дают `channel_post`. Команда собирает уникальные
/// каналы из буфера обновлений (~24ч хранения, short-poll), проверяет право постить
/// и возвращает `[{ id, title, username, canPost }]`. Пользователю не нужно знать chat_id.
///
/// ⚠️ Модель «бот на пользователя»: `getUpdates` глобален для бота, поэтому общий на всех
/// бот выдал бы чужие каналы — здесь у каждого свой бот (изоляция). 409 = у бота активен
/// webhook (наш сценарий — без webhook).
#[tauri::command]
#[specta::specta]
pub async fn tg_discover_channels(token: String) -> Result<Value, String> {
    let me = tg_call(&format!("{}/bot{}/getMe", TG_API, token), &[]).await?;
    let bot_id = me
        .get("id")
        .and_then(|v| v.as_i64())
        .ok_or_else(|| "getMe: нет id бота".to_string())?;

    let updates = tg_call(
        &format!("{}/bot{}/getUpdates", TG_API, token),
        &[("limit", "100"), ("timeout", "0")],
    )
    .await?;
    let arr = updates.as_array().cloned().unwrap_or_default();

    // уникальные каналы (по id) из my_chat_member / channel_post / edited_channel_post
    let mut seen: HashSet<i64> = HashSet::new();
    let mut chats: Vec<Value> = Vec::new();
    for u in &arr {
        let sources = [
            u.get("my_chat_member").and_then(|m| m.get("chat")),
            u.get("channel_post").and_then(|m| m.get("chat")),
            u.get("edited_channel_post").and_then(|m| m.get("chat")),
        ];
        for chat in sources.into_iter().flatten() {
            if chat.get("type").and_then(|t| t.as_str()) != Some("channel") {
                continue;
            }
            let Some(id) = chat.get("id").and_then(|v| v.as_i64()) else {
                continue;
            };
            if seen.insert(id) {
                chats.push(chat.clone());
            }
        }
    }

    let mut out: Vec<Value> = Vec::new();
    for chat in &chats {
        let id = chat.get("id").and_then(|v| v.as_i64()).unwrap_or(0);
        let can_post = bot_can_post(&token, id, bot_id).await;
        out.push(json!({
            "id": chat.get("id").cloned().unwrap_or(Value::Null),
            "title": chat.get("title").cloned().unwrap_or(Value::Null),
            "username": chat.get("username").cloned().unwrap_or(Value::Null),
            "canPost": can_post,
        }));
    }
    Ok(Value::Array(out))
}
