// YouTube OAuth 2.0 (installed-app / Desktop, PKCE) — Модель B (BYO credentials).
//
// Пользователь заводит СВОЙ Google Cloud проект и OAuth-клиент (тип Desktop app),
// отдаёт нам client_id/client_secret. Мы гоняем auth-code+PKCE флоу в СИСТЕМНОМ
// браузере (Google блокирует OAuth в embedded webview — disallowed_useragent!) с
// loopback-редиректом на 127.0.0.1:<эфемерный порт>, ловим `code`, меняем на
// refresh_token + access_token. Наше приложение у Google НЕ регистрируется — API-клиент
// это проект пользователя. См. ideasAndTest/YOUTUBE_AUTOPOST_PLAN.md.
//
// access_token живёт ~1 час → перед постингом обновляется командой youtube_refresh_token
// (refresh_token долгоживущий в Production-режиме проекта пользователя).

use base64::Engine;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::time::Duration;
use tauri::Emitter;
use tauri_plugin_opener::OpenerExt;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

const SCOPE: &str = "https://www.googleapis.com/auth/youtube.upload";
const AUTH_ENDPOINT: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT: &str = "https://oauth2.googleapis.com/token";
const AUTH_RESULT_EVENT: &str = "youtube-auth-result";
const LOGIN_TIMEOUT_SECS: u64 = 300;

fn b64url(bytes: &[u8]) -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

/// PKCE (verifier, challenge). verifier = base64url(32 случайных байта) → 43 символа;
/// challenge = base64url(sha256(verifier)). Рандом берём из двух UUID v4 (getrandom).
fn pkce_pair() -> (String, String) {
    let mut bytes = Vec::with_capacity(32);
    bytes.extend_from_slice(uuid::Uuid::new_v4().as_bytes());
    bytes.extend_from_slice(uuid::Uuid::new_v4().as_bytes());
    let verifier = b64url(&bytes);
    let challenge = b64url(&Sha256::digest(verifier.as_bytes()));
    (verifier, challenge)
}

/// HTTP-ответ со страничкой в браузере после редиректа.
fn done_page(msg: &str) -> String {
    format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nConnection: close\r\n\r\n\
         <!doctype html><meta charset=utf-8><title>YouTube</title>\
         <body style=\"font-family:sans-serif;text-align:center;padding-top:80px\">\
         <h2>{}</h2><p>Можно закрыть эту вкладку и вернуться в приложение.</p></body>",
        msg
    )
}

/// Вытащить query-параметр из первой строки HTTP-запроса `GET /?code=...&state=... HTTP/1.1`.
fn query_param(request_line: &str, key: &str) -> Option<String> {
    let path = request_line.split_whitespace().nth(1)?; // "/?code=..."
    let url = url::Url::parse(&format!("http://localhost{}", path)).ok()?;
    url.query_pairs()
        .find(|(k, _)| k == key)
        .map(|(_, v)| v.into_owned())
}

/// Разобрать ответ token-эндпоинта (общий для authorization_code и refresh_token).
fn parse_token_body(status: reqwest::StatusCode, body: &str) -> Result<Value, String> {
    let tok: Value =
        serde_json::from_str(body).map_err(|e| format!("parse token json: {} ({})", e, body))?;
    if !status.is_success() {
        let msg = tok
            .get("error_description")
            .and_then(|v| v.as_str())
            .or_else(|| tok.get("error").and_then(|v| v.as_str()))
            .unwrap_or("unknown");
        return Err(format!("token endpoint {}: {}", status, msg));
    }
    Ok(tok)
}

/// Запустить OAuth-флоу для одного канала: открыть системный браузер на экране согласия
/// Google, поймать редирект на loopback, обменять code на токены. Возвращает
/// `{ refreshToken, accessToken, accessTokenExpiry, scope }`. TS сохраняет это как аккаунт.
#[tauri::command]
#[specta::specta]
pub async fn youtube_auth_start(
    app: tauri::AppHandle,
    client_id: String,
    client_secret: String,
) -> Result<Value, String> {
    let client_id = client_id.trim().to_string();
    let client_secret = client_secret.trim().to_string();
    if client_id.is_empty() || client_secret.is_empty() {
        return Err("client_id и client_secret обязательны".into());
    }

    let (verifier, challenge) = pkce_pair();
    let state = uuid::Uuid::new_v4().to_string();

    // Loopback на эфемерном порту (Desktop-клиент Google разрешает 127.0.0.1 с любым портом).
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("bind loopback: {}", e))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("local_addr: {}", e))?
        .port();
    let redirect_uri = format!("http://127.0.0.1:{}", port);

    // URL согласия. access_type=offline + prompt=consent → гарантированно вернётся refresh_token.
    let mut u = url::Url::parse(AUTH_ENDPOINT).map_err(|e| format!("auth url: {}", e))?;
    u.query_pairs_mut()
        .append_pair("client_id", &client_id)
        .append_pair("redirect_uri", &redirect_uri)
        .append_pair("response_type", "code")
        .append_pair("scope", SCOPE)
        .append_pair("access_type", "offline")
        .append_pair("prompt", "consent")
        .append_pair("include_granted_scopes", "true")
        .append_pair("code_challenge", &challenge)
        .append_pair("code_challenge_method", "S256")
        .append_pair("state", &state);
    let auth_url = u.to_string();

    // Открыть в СИСТЕМНОМ браузере (не webview!).
    app.opener()
        .open_url(auth_url, None::<&str>)
        .map_err(|e| format!("открыть браузер: {}", e))?;

    // Ждём редирект (в цикле — игнорируем сторонние запросы вроде favicon).
    let wait = async {
        loop {
            let (mut stream, _) = listener
                .accept()
                .await
                .map_err(|e| format!("accept: {}", e))?;
            let mut buf = vec![0u8; 8192];
            let n = stream
                .read(&mut buf)
                .await
                .map_err(|e| format!("read: {}", e))?;
            let first_line = String::from_utf8_lossy(&buf[..n])
                .lines()
                .next()
                .unwrap_or("")
                .to_string();

            if !first_line.contains("code=") && !first_line.contains("error=") {
                let _ = stream.write_all(done_page("Ожидание входа…").as_bytes()).await;
                let _ = stream.shutdown().await;
                continue;
            }

            let result: Result<String, String> = if let Some(e) = query_param(&first_line, "error") {
                let _ = stream.write_all(done_page("Ошибка авторизации").as_bytes()).await;
                Err(format!("Google вернул error={}", e))
            } else if query_param(&first_line, "state").as_deref() != Some(state.as_str()) {
                let _ = stream.write_all(done_page("Ошибка (state)").as_bytes()).await;
                Err("state не совпал (возможно CSRF)".to_string())
            } else if let Some(c) = query_param(&first_line, "code") {
                let _ = stream.write_all(done_page("Готово ✓").as_bytes()).await;
                Ok(c)
            } else {
                let _ = stream.write_all(done_page("Ошибка").as_bytes()).await;
                Err("нет code в редиректе".to_string())
            };
            let _ = stream.shutdown().await;
            return result;
        }
    };

    let code = match tokio::time::timeout(Duration::from_secs(LOGIN_TIMEOUT_SECS), wait).await {
        Ok(r) => r?,
        Err(_) => return Err("таймаут ожидания входа (5 минут)".into()),
    };

    // Обмен code → токены.
    let params = [
        ("grant_type", "authorization_code"),
        ("code", code.as_str()),
        ("client_id", client_id.as_str()),
        ("client_secret", client_secret.as_str()),
        ("redirect_uri", redirect_uri.as_str()),
        ("code_verifier", verifier.as_str()),
    ];
    let res = reqwest::Client::new()
        .post(TOKEN_ENDPOINT)
        .form(&params)
        .send()
        .await
        .map_err(|e| format!("token request: {}", e))?;
    let status = res.status();
    let body = res.text().await.map_err(|e| format!("read token body: {}", e))?;
    let tok = parse_token_body(status, &body)?;

    let refresh_token = tok.get("refresh_token").and_then(|v| v.as_str()).unwrap_or("");
    let access_token = tok.get("access_token").and_then(|v| v.as_str()).unwrap_or("");
    let expires_in = tok.get("expires_in").and_then(|v| v.as_i64()).unwrap_or(0);
    if refresh_token.is_empty() {
        return Err("Google не вернул refresh_token (нужны access_type=offline + prompt=consent на первом входе)".into());
    }

    let now = chrono::Utc::now().timestamp();
    let record = json!({
        "refreshToken": refresh_token,
        "accessToken": access_token,
        "accessTokenExpiry": now + expires_in,
        "scope": tok.get("scope").cloned().unwrap_or(Value::Null),
    });
    let _ = app.emit(AUTH_RESULT_EVENT, record.clone());
    Ok(record)
}

/// Обновить access_token по refresh_token (перед постингом). Возвращает
/// `{ accessToken, accessTokenExpiry }`. refresh_token долгоживущий (Production).
#[tauri::command]
#[specta::specta]
pub async fn youtube_refresh_token(
    client_id: String,
    client_secret: String,
    refresh_token: String,
) -> Result<Value, String> {
    let params = [
        ("grant_type", "refresh_token"),
        ("refresh_token", refresh_token.as_str()),
        ("client_id", client_id.as_str()),
        ("client_secret", client_secret.as_str()),
    ];
    let res = reqwest::Client::new()
        .post(TOKEN_ENDPOINT)
        .form(&params)
        .send()
        .await
        .map_err(|e| format!("refresh request: {}", e))?;
    let status = res.status();
    let body = res.text().await.map_err(|e| format!("read refresh body: {}", e))?;
    let tok = parse_token_body(status, &body)?;

    let access_token = tok.get("access_token").and_then(|v| v.as_str()).unwrap_or("");
    let expires_in = tok.get("expires_in").and_then(|v| v.as_i64()).unwrap_or(0);
    if access_token.is_empty() {
        return Err("Google не вернул access_token при refresh (токен отозван/протух?)".into());
    }
    let now = chrono::Utc::now().timestamp();
    Ok(json!({ "accessToken": access_token, "accessTokenExpiry": now + expires_in }))
}

/// Свежий access_token для YouTube-аккаунта (для постинга). Читает запись из
/// accounts/<mainFolder>/youtube.json: если accessToken ещё жив (>60с запаса) — отдаёт его,
/// иначе обновляет по refresh_token (clientId/secret из записи), persist'ит новый
/// accessToken+expiry и возвращает. Секреты не покидают Rust. Зеркало account_get_token, но
/// с учётом протухания (у VK токен долгоживущий, там refresh не нужен).
#[tauri::command]
#[specta::specta]
pub async fn youtube_get_access_token(
    app: tauri::AppHandle,
    main_folder_name: String,
    name: String,
) -> Result<String, String> {
    let path = crate::commands::account_commands::platform_file(&app, &main_folder_name, "youtube")?;
    let mut accounts = crate::commands::account_commands::read_accounts(&path);
    let idx = accounts
        .iter()
        .position(|a| a.get("name").and_then(|n| n.as_str()) == Some(name.as_str()))
        .ok_or_else(|| format!("нет YouTube-аккаунта '{}'", name))?;

    let now = chrono::Utc::now().timestamp();
    let acc = &accounts[idx];
    let access = acc.get("accessToken").and_then(|v| v.as_str()).unwrap_or("");
    let expiry = acc.get("accessTokenExpiry").and_then(|v| v.as_i64()).unwrap_or(0);
    if !access.is_empty() && expiry > now + 60 {
        return Ok(access.to_string());
    }

    let client_id = acc.get("clientId").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let client_secret = acc.get("clientSecret").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let refresh = acc.get("refreshToken").and_then(|v| v.as_str()).unwrap_or("").to_string();
    if client_id.is_empty() || client_secret.is_empty() || refresh.is_empty() {
        return Err(format!("у аккаунта '{}' нет clientId/clientSecret/refreshToken", name));
    }

    let params = [
        ("grant_type", "refresh_token"),
        ("refresh_token", refresh.as_str()),
        ("client_id", client_id.as_str()),
        ("client_secret", client_secret.as_str()),
    ];
    let res = reqwest::Client::new()
        .post(TOKEN_ENDPOINT)
        .form(&params)
        .send()
        .await
        .map_err(|e| format!("refresh request: {}", e))?;
    let status = res.status();
    let body = res.text().await.map_err(|e| format!("read refresh body: {}", e))?;
    let tok = parse_token_body(status, &body)?;
    let new_access = tok.get("access_token").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let expires_in = tok.get("expires_in").and_then(|v| v.as_i64()).unwrap_or(0);
    if new_access.is_empty() {
        return Err("Google не вернул access_token при refresh (токен отозван/протух?)".into());
    }

    if let Some(obj) = accounts[idx].as_object_mut() {
        obj.insert("accessToken".into(), json!(new_access));
        obj.insert("accessTokenExpiry".into(), json!(now + expires_in));
    }
    crate::commands::account_commands::write_accounts(&path, &accounts)?;
    Ok(new_access)
}
