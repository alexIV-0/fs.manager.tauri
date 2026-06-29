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
use std::collections::{HashMap, HashSet};
use std::sync::{Mutex, OnceLock};

const TG_CLOUD: &str = "https://api.telegram.org";

// База Bot API: облако по умолчанию; при поднятом локальном сервере → http://127.0.0.1:<port>.
// Меняется в tg_server_start/stop. Все вызовы Bot API читают её через tg_base().
static TG_BASE: OnceLock<Mutex<String>> = OnceLock::new();

fn tg_base_slot() -> &'static Mutex<String> {
    TG_BASE.get_or_init(|| Mutex::new(TG_CLOUD.to_string()))
}
fn tg_base() -> String {
    tg_base_slot()
        .lock()
        .map(|s| s.clone())
        .unwrap_or_else(|_| TG_CLOUD.to_string())
}
fn tg_set_base(url: &str) {
    if let Ok(mut s) = tg_base_slot().lock() {
        *s = url.to_string();
    }
}

// Дочерний процесс локального telegram-bot-api server (None = не запущен).
static TG_SERVER: OnceLock<Mutex<Option<std::process::Child>>> = OnceLock::new();
fn tg_server_slot() -> &'static Mutex<Option<std::process::Child>> {
    TG_SERVER.get_or_init(|| Mutex::new(None))
}

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
    let url = format!("{}/bot{}/getMe", tg_base(), token);
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
    let me = tg_call(&format!("{}/bot{}/getMe", tg_base(), token), &[]).await?;
    let bot_id = me
        .get("id")
        .and_then(|v| v.as_i64())
        .ok_or_else(|| "getMe: нет id бота".to_string())?;

    // 2) сам чат — резолвит title/id/username, заодно проверяет, что бот его «видит».
    let chat_info = tg_call(
        &format!("{}/bot{}/getChat", tg_base(), token),
        &[("chat_id", chat.as_str())],
    )
    .await?;

    // 3) членство бота в чате → право постить.
    let bot_id_str = bot_id.to_string();
    let member = tg_call(
        &format!("{}/bot{}/getChatMember", tg_base(), token),
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
        "isForum": chat_info.get("is_forum").and_then(|v| v.as_bool()).unwrap_or(false),
        "topics": Value::Array(Vec::new()),
        "canPost": can_post,
    }))
}

/// Проверяет право бота постить в чат (`getChatMember`): creator или administrator
/// с `can_post_messages`. Ошибку трактует как «нельзя».
async fn bot_can_post(token: &str, chat_id: i64, bot_id: i64) -> bool {
    let chat = chat_id.to_string();
    let user = bot_id.to_string();
    match tg_call(
        &format!("{}/bot{}/getChatMember", tg_base(), token),
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
    let me = tg_call(&format!("{}/bot{}/getMe", tg_base(), token), &[]).await?;
    let bot_id = me
        .get("id")
        .and_then(|v| v.as_i64())
        .ok_or_else(|| "getMe: нет id бота".to_string())?;

    let updates = tg_call(
        &format!("{}/bot{}/getUpdates", tg_base(), token),
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

/// Регистрирует чат в карте (dedup по id, сохраняя порядок первого появления).
fn register_chat(chat: &Value, chats: &mut HashMap<i64, Value>, order: &mut Vec<i64>) {
    if let Some(id) = chat.get("id").and_then(|v| v.as_i64()) {
        chats.entry(id).or_insert_with(|| {
            order.push(id);
            chat.clone()
        });
    }
}

/// Имя темы из сообщения: служебное `forum_topic_created`/`forum_topic_edited` или из
/// корня темы (`reply_to_message.forum_topic_created`). None, если имя недоступно.
fn topic_name_from_msg(m: &Value) -> Option<String> {
    let from = |v: &Value| {
        v.get("forum_topic_created")
            .or_else(|| v.get("forum_topic_edited"))
            .and_then(|t| t.get("name"))
            .and_then(|n| n.as_str())
            .map(str::to_string)
    };
    from(m)
        .or_else(|| m.get("reply_to_message").and_then(from))
}

/// Авто-обнаружение чатов-источников для СБОРА (плагин autoTGcollect) через `getUpdates`.
///
/// В отличие от `tg_discover_channels` (постинг): НЕ проверяет право постить — для сбора
/// достаточно, чтобы бот видел чат (он должен быть админом супергруппы или с выключенным
/// privacy mode). Включает группы/супергруппы/каналы. Возвращает
/// `[{ id, title, username, type, isForum, topics: [{ threadId, name }] }]`, уникальные по id.
/// Темы (форум-супергруппы) собираются из `message_thread_id` апдейтов; имя — из
/// `forum_topic_created` (Bot API не умеет перечислять темы, только ловить из апдейтов).
#[tauri::command]
#[specta::specta]
pub async fn tg_discover_sources(token: String) -> Result<Value, String> {
    let updates = tg_call(
        &format!("{}/bot{}/getUpdates", tg_base(), token),
        &[("limit", "100"), ("timeout", "0")],
    )
    .await?;
    let arr = updates.as_array().cloned().unwrap_or_default();

    let mut chats: HashMap<i64, Value> = HashMap::new();
    let mut order: Vec<i64> = Vec::new();
    // chat_id -> (thread_id -> name?)
    let mut topics: HashMap<i64, HashMap<i64, Option<String>>> = HashMap::new();

    for u in &arr {
        // апдейты, несущие сообщение (chat + возможный thread)
        let msgs = [
            u.get("message"),
            u.get("edited_message"),
            u.get("channel_post"),
            u.get("edited_channel_post"),
        ];
        for m in msgs.into_iter().flatten() {
            if let Some(chat) = m.get("chat") {
                register_chat(chat, &mut chats, &mut order);
                if let (Some(cid), Some(tid)) = (
                    chat.get("id").and_then(|v| v.as_i64()),
                    m.get("message_thread_id").and_then(|v| v.as_i64()),
                ) {
                    let name = topic_name_from_msg(m);
                    let slot = topics.entry(cid).or_default().entry(tid).or_insert(None);
                    if slot.is_none() {
                        if let Some(n) = name {
                            *slot = Some(n);
                        }
                    }
                }
            }
        }
        // апдейты только с чатом (бота добавили/сменили права)
        if let Some(chat) = u.get("my_chat_member").and_then(|m| m.get("chat")) {
            register_chat(chat, &mut chats, &mut order);
        }
    }

    let mut out: Vec<Value> = Vec::new();
    for id in &order {
        let chat = &chats[id];
        let chat_type = chat.get("type").and_then(|t| t.as_str()).unwrap_or("");
        if !matches!(chat_type, "group" | "supergroup" | "channel") {
            continue;
        }
        // темы чата, отсортированные по threadId для стабильного порядка
        let mut tlist: Vec<Value> = Vec::new();
        if let Some(tm) = topics.get(id) {
            let mut keys: Vec<i64> = tm.keys().cloned().collect();
            keys.sort_unstable();
            for tid in keys {
                let name = tm.get(&tid).cloned().flatten();
                tlist.push(json!({ "threadId": tid, "name": name }));
            }
        }
        out.push(json!({
            "id": chat.get("id").cloned().unwrap_or(Value::Null),
            "title": chat.get("title").cloned().unwrap_or(Value::Null),
            "username": chat.get("username").cloned().unwrap_or(Value::Null),
            "type": chat.get("type").cloned().unwrap_or(Value::Null),
            "isForum": chat.get("is_forum").and_then(|v| v.as_bool()).unwrap_or(false),
            "topics": Value::Array(tlist),
        }));
    }
    Ok(Value::Array(out))
}

// ======================= РАННЕР СБОРА (autoTGcollect) =======================
// Облачный Bot API (≤20 МБ). Переход на локальный telegram-bot-api server = смена tg_base()
// на http://localhost:8081 + ветка «file_path абсолютный → move» в tg_fetch_file (она уже есть).

/// `getUpdates` для раннера сбора. `offset` (Some) подтверждает на сервере апдейты < offset
/// и возвращает >= offset; None → все непрочитанные. Хранение апдейтов Telegram ~24ч.
#[tauri::command]
#[specta::specta]
pub async fn tg_get_updates(token: String, offset: Option<i64>) -> Result<Value, String> {
    let off = offset.map(|o| o.to_string());
    let mut q: Vec<(&str, &str)> = vec![("limit", "100"), ("timeout", "0")];
    if let Some(ref o) = off {
        q.push(("offset", o.as_str()));
    }
    tg_call(&format!("{}/bot{}/getUpdates", tg_base(), token), &q).await
}

/// Скачивает файл Telegram в `dest_path`. `getFile` → `file_path`:
///   - облако: качаем `<tg_base()>/file/bot<token>/<file_path>` (лимит 20 МБ);
///   - локальный server (`--local`): `file_path` абсолютный → move/copy без скачивания.
/// Возвращает `dest_path`. >20МБ на облаке → getFile вернёт ошибку «file is too big».
#[tauri::command]
#[specta::specta]
pub async fn tg_fetch_file(token: String, file_id: String, dest_path: String) -> Result<String, String> {
    let info = tg_call(
        &format!("{}/bot{}/getFile", tg_base(), token),
        &[("file_id", file_id.as_str())],
    )
    .await?;
    let file_path = info
        .get("file_path")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "getFile: нет file_path (файл >20МБ для облачного Bot API?)".to_string())?;

    if let Some(parent) = std::path::Path::new(&dest_path).parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("mkdir: {}", e))?;
    }

    // Локальный Bot API server (--local) отдаёт АБСОЛЮТНЫЙ локальный путь → move вместо скачивания.
    if std::path::Path::new(file_path).is_absolute() {
        std::fs::rename(file_path, &dest_path)
            .or_else(|_| std::fs::copy(file_path, &dest_path).map(|_| ()))
            .map_err(|e| format!("move local file: {}", e))?;
        return Ok(dest_path);
    }

    let url = format!("{}/file/bot{}/{}", tg_base(), token, file_path);
    let res = reqwest::Client::new()
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("download request: {}", e))?;
    if !res.status().is_success() {
        return Err(format!("download: HTTP {}", res.status()));
    }
    let bytes = res.bytes().await.map_err(|e| format!("download body: {}", e))?;
    std::fs::write(&dest_path, &bytes).map_err(|e| format!("write file: {}", e))?;
    Ok(dest_path)
}

/// Удаляет сообщение в Telegram (`deleteMessage`). Бот-админ может удалять чужие сообщения
/// в окне ~48ч (мы удаляем сразу после скачивания). Best-effort на стороне вызывающего.
#[tauri::command]
#[specta::specta]
pub async fn tg_delete_message(token: String, chat_id: i64, message_id: i64) -> Result<bool, String> {
    let chat = chat_id.to_string();
    let msg = message_id.to_string();
    tg_call(
        &format!("{}/bot{}/deleteMessage", tg_base(), token),
        &[("chat_id", chat.as_str()), ("message_id", msg.as_str())],
    )
    .await
    .map(|_| true)
}

/// Ставит реакцию-эмодзи на сообщение (`setMessageReaction`, POST с JSON). Пометка «забрано».
/// `emoji` должен быть из стандартного набора реакций Telegram (напр. 👍).
#[tauri::command]
#[specta::specta]
pub async fn tg_set_reaction(token: String, chat_id: i64, message_id: i64, emoji: String) -> Result<bool, String> {
    let body = json!({
        "chat_id": chat_id,
        "message_id": message_id,
        "reaction": [{ "type": "emoji", "emoji": emoji }],
    });
    let res = reqwest::Client::new()
        .post(&format!("{}/bot{}/setMessageReaction", tg_base(), token))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("request: {}", e))?;
    let json: Value = res.json().await.map_err(|e| format!("parse: {}", e))?;
    if json.get("ok").and_then(|v| v.as_bool()) == Some(true) {
        Ok(true)
    } else {
        let desc = json
            .get("description")
            .and_then(|d| d.as_str())
            .unwrap_or("setMessageReaction failed");
        Err(format!("Telegram: {}", desc))
    }
}

/// Создаёт тему форума (`createForumTopic`, POST). Бот должен быть админом супергруппы-форума
/// с правом `can_manage_topics`. Возвращает `{ threadId, name }`. Имя темы по конвенции = имя
/// папки проекта. Дубли по имени Telegram НЕ предотвращает — вызывающий сам проверяет каталог.
#[tauri::command]
#[specta::specta]
pub async fn tg_create_forum_topic(token: String, chat_id: i64, name: String) -> Result<Value, String> {
    let body = json!({ "chat_id": chat_id, "name": &name });
    let res = reqwest::Client::new()
        .post(&format!("{}/bot{}/createForumTopic", tg_base(), token))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("request: {}", e))?;
    let json: Value = res.json().await.map_err(|e| format!("parse: {}", e))?;
    if json.get("ok").and_then(|v| v.as_bool()) == Some(true) {
        let r = json.get("result").cloned().unwrap_or(Value::Null);
        return Ok(json!({
            "threadId": r.get("message_thread_id").cloned().unwrap_or(Value::Null),
            "name": r.get("name").cloned().unwrap_or(Value::String(name)),
        }));
    }
    let desc = json
        .get("description")
        .and_then(|d| d.as_str())
        .unwrap_or("createForumTopic failed");
    Err(format!("Telegram: {}", desc))
}

// ======================= ЛОКАЛЬНЫЙ Bot API SERVER =======================
// Снимает лимит скачивания 20 МБ (→ 2 ГБ) и в режиме --local отдаёт getFile локальным путём
// (tg_fetch_file тогда делает move вместо скачивания). Когда сервер поднят, ВСЕ вызовы бота
// идут на localhost (бот «живёт» на одном сервере). Перевод бота с облака на локальный требует
// разового tg_cloud_log_out (иначе локальный сервер не пустит «занятого» облаком бота).

/// Текущая база Bot API (для плагинов-публикаторов, которые строят URL в TS).
#[tauri::command]
#[specta::specta]
pub fn tg_base_url() -> Result<String, String> {
    Ok(tg_base())
}

/// Запускает локальный telegram-bot-api server и переключает базу на localhost.
/// `bin_path` — путь к скомпилированному бинарю; `work_dir` — рабочая папка для скачанных файлов
/// (желательно на том же томе, что GDrive-папки, чтобы move в IN был атомарным).
#[tauri::command]
#[specta::specta]
pub fn tg_server_start(
    bin_path: String,
    api_id: String,
    api_hash: String,
    port: u16,
    work_dir: String,
) -> Result<String, String> {
    let base = format!("http://127.0.0.1:{}", port);
    let slot = tg_server_slot();
    let mut guard = slot.lock().map_err(|_| "server state lock".to_string())?;

    // уже запущен и жив → просто убедимся, что база указывает на localhost
    if let Some(child) = guard.as_mut() {
        if matches!(child.try_wait(), Ok(None)) {
            tg_set_base(&base);
            return Ok(base);
        }
        // процесс умер — вычистим и перезапустим
        *guard = None;
    }

    if bin_path.trim().is_empty() {
        return Err("не задан путь к telegram-bot-api (Настройки)".into());
    }
    if api_id.trim().is_empty() || api_hash.trim().is_empty() {
        return Err("не заданы api_id / api_hash (my.telegram.org)".into());
    }
    if !work_dir.trim().is_empty() {
        std::fs::create_dir_all(&work_dir).ok();
    }

    let mut cmd = std::process::Command::new(&bin_path);
    cmd.arg("--local")
        .arg(format!("--api-id={}", api_id))
        .arg(format!("--api-hash={}", api_hash))
        .arg(format!("--http-port={}", port));
    if !work_dir.trim().is_empty() {
        cmd.arg(format!("--dir={}", work_dir));
    }
    let child = cmd
        .spawn()
        .map_err(|e| format!("не удалось запустить telegram-bot-api ({}): {}", bin_path, e))?;
    *guard = Some(child);
    tg_set_base(&base);
    Ok(base)
}

/// Останавливает локальный сервер и возвращает базу на облако.
#[tauri::command]
#[specta::specta]
pub fn tg_server_stop() -> Result<bool, String> {
    if let Ok(mut guard) = tg_server_slot().lock() {
        if let Some(mut child) = guard.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
    tg_set_base(TG_CLOUD);
    Ok(true)
}

/// Статус сервера: `{ running, base }`.
#[tauri::command]
#[specta::specta]
pub fn tg_server_status() -> Result<Value, String> {
    let running = tg_server_slot()
        .lock()
        .map(|mut g| match g.as_mut() {
            Some(child) => matches!(child.try_wait(), Ok(None)),
            None => false,
        })
        .unwrap_or(false);
    Ok(json!({ "running": running, "base": tg_base() }))
}

/// logOut на ОБЛАЧНОМ сервере — освобождает бота для перевода на локальный сервер.
/// Вызывается один раз при миграции бота. Идемпотентно-терпимо: уже разлогиненный → Err (ловим выше).
#[tauri::command]
#[specta::specta]
pub async fn tg_cloud_log_out(token: String) -> Result<bool, String> {
    let url = format!("{}/bot{}/logOut", TG_CLOUD, token);
    tg_call(&url, &[]).await.map(|_| true)
}
