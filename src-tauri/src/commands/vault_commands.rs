// Сейф учёток внешних сервисов (ключи вендоров: ElevenLabs, ComfyUI, …).
//
// Контракт: `ideasAndTest/VENDOR_KEYS_CONTRACT.md` §6. Коротко о модели:
//   • СЕРВИС — каталог (слаг, единицы, прайс); живёт на сайте, здесь его нет.
//   • УЧЁТКА — именованный секрет под сервисом: `(slug, label)`. Меток может быть
//     несколько на один слаг (`11labs-main` / `11labs-test` / ключ клиента), и
//     именно МЕТКА уезжает в `options.json` ноды. Секрет туда не попадает никогда.
//
// ── Почему метаданные и секрет лежат в РАЗНЫХ местах
//
// `vault/accounts.json` — только метаданные (слаг, метка, источник, версия, срок,
// подсказка `••••4f21`). Он не секретный по построению, поэтому список для дропдауна
// читается без единого обращения к хранилищу ОС — а обращение это на macOS может
// подниматься до диалога разблокировки связки.
//
// Сами поля секрета идут в хранилище учётных данных ОС (Keychain / Credential
// Manager, крейт `keyring`). Это сильнее, чем шифрованный файл рядом с приложением:
// ключа шифрования у нас нет вовсе, а значит его нельзя ни потерять, ни утащить
// вместе с файлом. От `accounts/<mainFolder>/<platform>.json` (plaintext) уходим
// именно поэтому — см. §3 контракта.
//
// ── Источник записи (`source`) — это не пометка, а правило жизни
//
//   `local` — учётку завёл человек на этой машине. На сайт не уезжает, срока нет,
//             задача с ней не может уехать в парк (на чужой машине её просто нет).
//   `site`  — копия выданного сайтом ключа. У неё ОБЯЗАН быть срок (`expiresAt`):
//             копия без срока — вечная копия, и тогда отзыв на сайте не отзывает
//             ничего, а отзыв — единственное, ради чего ключи туда переехали.
//
// ── Ограничение, о которое можно удариться на Windows
//
// Credential Manager держит в blob'е 2560 байт. API-ключи в него влезают с запасом,
// длинный OAuth-набор — уже не факт, поэтому размер проверяется явно и на записи, с
// внятной ошибкой: молчаливый отказ хранилища выглядел бы как «ключ пропал».

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;
use tauri::Manager;

/// Имя «сервиса» в хранилище ОС. Учётка адресуется как `<slug>/<label>`.
const KEYRING_SERVICE: &str = "fs-manager-tauri.vault";

/// Потолок размера секрета. Ограничение Credential Manager (2560 байт), но
/// проверяем на всех платформах: иначе учётка, заведённая на macOS, молча не
/// сохранится на Windows, и разбираться придётся уже по факту пропажи.
const MAX_SECRET_BYTES: usize = 2400;

/// Метаданные учётки. Полей секрета здесь нет и быть не должно: этот тип уходит
/// в renderer целиком (дропдаун, список в настройках).
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VaultAccountMeta {
    /// Слаг сервиса из каталога сайта (`eleven-labs`). Неизменяем: он лежит в
    /// `ui.json` собранных плагинов и в `options.json` чужих проектов.
    pub slug: String,
    /// Метка учётки — то, что человек видит в дропдауне и что уезжает в options.json.
    pub label: String,
    /// `local` | `site` — см. шапку модуля.
    pub source: String,
    /// `••••4f21`, чтобы узнать ключ глазами, не доставая его.
    pub hint: String,
    /// Версия секрета на сайте. У локальных — 0.
    #[serde(default)]
    pub secret_version: i64,
    /// Unix-секунды, до которых копия считается годной. `None` — бессрочно (только `local`).
    #[serde(default)]
    pub expires_at: Option<i64>,
    #[serde(default)]
    pub updated_at: i64,
    /// Копия могла устареть: на сайте менялись секреты (ревизия сейфа выросла).
    ///
    /// Не то же самое, что `expired`. Протухшую копию отдавать нельзя вовсе, а
    /// несвежую — можно: задача, которая уже идёт, не должна рваться на середине
    /// ролика. Флаг влияет на другое — на `known` в следующем запросе ключей:
    /// несвежую версию мы не подтверждаем, и сайт присылает секрет заново.
    #[serde(default)]
    pub stale: bool,
    /// Посчитано на чтении, в файл не пишется: `expiresAt` в прошлом.
    #[serde(default)]
    pub expired: bool,
}

/// Пара «сервис + метка» в отчёте о синхронизации.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VaultSyncedAccount {
    pub slug: String,
    pub label: String,
}

/// Итог похода за ключами. Секретов здесь нет — только что с чем случилось.
#[derive(Debug, Clone, Default, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VaultSyncReport {
    /// Учётки, по которым приехал новый секрет.
    pub issued: Vec<VaultSyncedAccount>,
    /// Версия совпала — секрет по сети не поехал, работаем своей копией.
    pub fresh: Vec<VaultSyncedAccount>,
    /// Нет сервиса, пауза, отзыв или `proxy`. Копии с сайта по ним мы удалили.
    pub unavailable: Vec<String>,
    /// Учёток несколько, а метка не названа. Сайт не выбирает за ноду — выбрать
    /// должен человек в поле Account.
    pub ambiguous: Vec<String>,
    /// Каталожная часть: адрес и наличие ключа по каждому доступному сервису.
    /// Приходит и тогда, когда секрет не менялся, — адрес нужен всегда.
    pub services: Vec<crate::storage::types::VendorServiceEndpoint>,
    pub vault_revision: i64,
}

// ─── Чистая часть: файл метаданных ───────────────────────────────────────────
//
// Вынесено из команд намеренно: хранилище ОС в тестах недоступно (на CI связки нет
// вовсе), а правила upsert'а, подсказки и протухания проверить надо.

fn now_sec() -> i64 {
    chrono::Utc::now().timestamp()
}

/// Слаг сервиса: строгий kebab. Строгость не косметическая — слаг идёт в ключ
/// хранилища ОС как `<slug>/<label>`, и `/` внутри слага дал бы коллизию адресов.
fn validate_slug(raw: &str) -> Result<String, String> {
    let s = raw.trim().to_ascii_lowercase();
    if s.is_empty() {
        return Err("slug пустой".into());
    }
    if s.len() > 64 {
        return Err("slug длиннее 64 символов".into());
    }
    if !s.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err(format!("slug '{}': допустимы только a-z, 0-9 и дефис", raw));
    }
    Ok(s)
}

/// Метка учётки: человекочитаемая, но без управляющих символов — она едет в
/// `options.json` и в ключ хранилища ОС.
fn validate_label(raw: &str) -> Result<String, String> {
    let s = raw.trim();
    if s.is_empty() {
        return Err("метка учётки пустая".into());
    }
    if s.chars().count() > 64 {
        return Err("метка длиннее 64 символов".into());
    }
    if s.chars().any(|c| c.is_control()) {
        return Err("метка содержит управляющие символы".into());
    }
    Ok(s.to_string())
}

/// `••••4f21` — четыре последних символа самого длинного поля. Самого длинного, а
/// не первого попавшегося: у OAuth-набора первым по алфавиту идёт `client_id`, а
/// узнают ключ по хвосту секрета.
fn make_hint(fields: &BTreeMap<String, String>) -> String {
    let longest = fields.values().max_by_key(|v| v.chars().count());
    match longest {
        Some(v) if v.chars().count() >= 4 => {
            let tail: String = v.chars().skip(v.chars().count() - 4).collect();
            format!("••••{}", tail)
        }
        _ => "••••".to_string(),
    }
}

fn meta_file(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {}", e))?
        .join("vault");
    fs::create_dir_all(&dir).map_err(|e| format!("create_dir_all: {}", e))?;
    Ok(dir.join("accounts.json"))
}

/// Битый файл — пустой список, а не ошибка: единственная кривая строка не должна
/// делать неработоспособными все учётки разом.
fn read_meta(path: &PathBuf) -> Vec<VaultAccountMeta> {
    match fs::read_to_string(path) {
        Ok(s) => serde_json::from_str::<Vec<VaultAccountMeta>>(&s).unwrap_or_default(),
        Err(_) => Vec::new(),
    }
}

fn write_meta(path: &PathBuf, list: &[VaultAccountMeta]) -> Result<(), String> {
    let content =
        serde_json::to_string_pretty(list).map_err(|e| format!("to_string_pretty: {}", e))?;
    super::fs_commands::write_atomic(path, content.as_bytes())
}

/// Upsert по паре `(slug, label)` — она и есть идентичность учётки.
fn upsert_meta(list: &mut Vec<VaultAccountMeta>, entry: VaultAccountMeta) {
    match list
        .iter_mut()
        .find(|m| m.slug == entry.slug && m.label == entry.label)
    {
        Some(slot) => *slot = entry,
        None => list.push(entry),
    }
}

/// Помечает протухшие копии. Считается на чтении, а не хранится: иначе флаг пришлось
/// бы обновлять по таймеру, и он врал бы ровно в тот момент, когда важен.
fn mark_expired(list: &mut [VaultAccountMeta], now: i64) {
    for m in list.iter_mut() {
        m.expired = matches!(m.expires_at, Some(exp) if exp <= now);
    }
}

// ─── Хранилище ОС ────────────────────────────────────────────────────────────

#[cfg(any(target_os = "macos", target_os = "windows"))]
mod os_store {
    use super::KEYRING_SERVICE;

    fn entry(address: &str) -> Result<keyring::Entry, String> {
        keyring::Entry::new(KEYRING_SERVICE, address)
            .map_err(|e| format!("хранилище учётных данных недоступно: {}", e))
    }

    pub fn put(address: &str, blob: &str) -> Result<(), String> {
        entry(address)?
            .set_password(blob)
            .map_err(|e| format!("не записать в хранилище учётных данных: {}", e))
    }

    pub fn get(address: &str) -> Result<Option<String>, String> {
        match entry(address)?.get_password() {
            Ok(v) => Ok(Some(v)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(format!("не прочитать из хранилища учётных данных: {}", e)),
        }
    }

    pub fn delete(address: &str) -> Result<(), String> {
        match entry(address)?.delete_credential() {
            Ok(()) => Ok(()),
            Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(format!("не удалить из хранилища учётных данных: {}", e)),
        }
    }
}

// Linux и прочее: приложение туда не собирается (CI — только macOS и Windows), но
// компилироваться должно везде. Класть секреты в файл «на всякий случай» нельзя —
// это ровно то, от чего уходим, поэтому здесь честный отказ.
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
mod os_store {
    const MSG: &str = "сейф учёток поддержан только на macOS и Windows";
    pub fn put(_a: &str, _b: &str) -> Result<(), String> {
        Err(MSG.into())
    }
    pub fn get(_a: &str) -> Result<Option<String>, String> {
        Err(MSG.into())
    }
    pub fn delete(_a: &str) -> Result<(), String> {
        Err(MSG.into())
    }
}

fn address(slug: &str, label: &str) -> String {
    format!("{}/{}", slug, label)
}

// ─── Команды ─────────────────────────────────────────────────────────────────

/// Список учёток БЕЗ секретов. `slug: None` — все, иначе только этого сервиса.
///
/// Хранилище ОС здесь не трогается вовсе: дропдаун открывается часто, а запрос к
/// связке — операция с возможным диалогом.
#[tauri::command]
#[specta::specta]
pub fn vault_list(
    app: tauri::AppHandle,
    slug: Option<String>,
) -> Result<Vec<VaultAccountMeta>, String> {
    let path = meta_file(&app)?;
    let mut list = read_meta(&path);
    if let Some(s) = slug {
        let s = validate_slug(&s)?;
        list.retain(|m| m.slug == s);
    }
    mark_expired(&mut list, now_sec());
    list.sort_by(|a, b| (&a.slug, &a.label).cmp(&(&b.slug, &b.label)));
    Ok(list)
}

/// Завести/обновить учётку. `fields` — набор именованных полей секрета
/// (`apiKey`, либо `login`+`password`, либо OAuth-набор): состав диктует описание
/// сервиса в каталоге, здесь он произвольный.
///
/// `ttl_sec` осмыслен только для `source = "site"`: у выданной сайтом копии обязан
/// быть срок. Локальной учётке срок не ставится — её никто не отзывает.
#[tauri::command]
#[specta::specta]
pub fn vault_save(
    app: tauri::AppHandle,
    slug: String,
    label: String,
    fields: BTreeMap<String, String>,
    source: Option<String>,
    secret_version: Option<i64>,
    ttl_sec: Option<i64>,
) -> Result<VaultAccountMeta, String> {
    save_account(
        &app,
        &slug,
        &label,
        fields,
        source.as_deref().unwrap_or("local"),
        secret_version,
        ttl_sec,
    )
}

/// Общее тело записи: им пользуются и команда, и выдача с сайта.
fn save_account(
    app: &tauri::AppHandle,
    slug: &str,
    label: &str,
    fields: BTreeMap<String, String>,
    source: &str,
    secret_version: Option<i64>,
    ttl_sec: Option<i64>,
) -> Result<VaultAccountMeta, String> {
    let slug = validate_slug(slug)?;
    let label = validate_label(label)?;
    if fields.is_empty() {
        return Err("не задано ни одного поля секрета".into());
    }
    if fields.values().any(|v| v.trim().is_empty()) {
        return Err("пустое значение поля секрета".into());
    }

    let source = match source {
        "local" => "local",
        "site" => "site",
        other => return Err(format!("неизвестный source '{}': local | site", other)),
    };

    let blob = serde_json::to_string(&fields).map_err(|e| format!("сериализация: {}", e))?;
    if blob.len() > MAX_SECRET_BYTES {
        return Err(format!(
            "секрет {} байт — больше потолка хранилища учётных данных ({})",
            blob.len(),
            MAX_SECRET_BYTES
        ));
    }

    let now = now_sec();
    let expires_at = if source == "site" {
        // Копия без срока = вечная копия, отзыв перестаёт работать. Дефолт — час,
        // ровно как presign: короткий срок, который всегда можно продлить запросом.
        Some(now + ttl_sec.filter(|t| *t > 0).unwrap_or(3600))
    } else {
        None
    };

    // Секрет — первым: если упадёт хранилище ОС, метаданные не должны обещать
    // учётку, которой нет.
    os_store::put(&address(&slug, &label), &blob)?;

    let entry = VaultAccountMeta {
        slug: slug.clone(),
        label: label.clone(),
        source: source.to_string(),
        hint: make_hint(&fields),
        secret_version: secret_version.unwrap_or(0),
        expires_at,
        updated_at: now,
        // Запись только что приехала (или её только что завели руками) — она свежая
        // по определению, что бы ни лежало на этом месте раньше.
        stale: false,
        expired: false,
    };

    let path = meta_file(app)?;
    let mut list = read_meta(&path);
    upsert_meta(&mut list, entry.clone());
    write_meta(&path, &list)?;
    Ok(entry)
}

/// Пометить копии, выданные сайтом, несвежими. Возвращает число помеченных.
///
/// Зовётся демоном, когда ревизия сейфа на сайте изменилась. Не команда: это
/// внутренняя реакция на пульс, из renderer её дёргать незачем.
pub fn mark_site_stale(app: &tauri::AppHandle) -> Result<usize, String> {
    let path = meta_file(app)?;
    let mut list = read_meta(&path);
    let mut n = 0usize;
    for m in list.iter_mut() {
        if m.source == "site" && !m.stale {
            m.stale = true;
            n += 1;
        }
    }
    if n > 0 {
        write_meta(&path, &list)?;
    }
    Ok(n)
}

/// Что мы готовы подтвердить сайту как актуальное: слаг → пара «учётка + версия».
///
/// Пара, а не версия: нумерация у каждой учётки своя, и `v3` у `main` совпал бы с
/// `v3` у `test`. Ключ карты — слаг, поэтому подтверждаем ровно ту учётку, которую
/// спрашивает нода; не назвала метку — не подтверждаем по этому сервису ничего.
///
/// Несвежие и протухшие сюда не попадают намеренно: подтвердив такую версию, мы
/// получили бы в ответ `fresh` и остались бы с копией, которую сами же считаем
/// сомнительной. Ноль тоже не подтверждаем — у сайта версии начинаются с единицы.
fn known_keys(
    list: &[VaultAccountMeta],
    wanted: &BTreeMap<String, String>,
    now: i64,
) -> BTreeMap<String, crate::storage::types::VendorKnownKey> {
    let mut out = BTreeMap::new();
    for (slug, label) in wanted {
        let Some(m) = list
            .iter()
            .find(|m| &m.slug == slug && &m.label == label && m.source == "site")
        else {
            continue;
        };
        if m.stale || m.secret_version <= 0 {
            continue;
        }
        if matches!(m.expires_at, Some(exp) if exp <= now) {
            continue;
        }
        out.insert(
            slug.clone(),
            crate::storage::types::VendorKnownKey {
                account: m.label.clone(),
                version: m.secret_version,
            },
        );
    }
    out
}

/// Достать поля секрета — только в момент вызова вендора.
///
/// Зеркало `account_get_token`: список отдаёт метаданные, секрет отдаёт отдельная
/// команда. Протухшую копию не отдаём вовсе — иначе TTL был бы украшением.
#[tauri::command]
#[specta::specta]
pub fn vault_get_secret(
    app: tauri::AppHandle,
    slug: String,
    label: String,
) -> Result<BTreeMap<String, String>, String> {
    let slug = validate_slug(&slug)?;
    let label = validate_label(&label)?;

    let path = meta_file(&app)?;
    let list = read_meta(&path);
    let meta = list
        .iter()
        .find(|m| m.slug == slug && m.label == label)
        .ok_or_else(|| format!("нет учётки '{}' для сервиса '{}'", label, slug))?;

    if let Some(exp) = meta.expires_at {
        if exp <= now_sec() {
            return Err(format!(
                "срок копии ключа '{}' ({}) истёк — нужен новый запрос к сайту",
                label, slug
            ));
        }
    }

    let blob = os_store::get(&address(&slug, &label))?.ok_or_else(|| {
        format!(
            "учётка '{}' ({}) есть в списке, но секрета в хранилище ОС нет",
            label, slug
        )
    })?;
    serde_json::from_str(&blob).map_err(|e| format!("секрет учётки не разобран: {}", e))
}

/// Удалить учётку целиком. `false` — такой не было.
#[tauri::command]
#[specta::specta]
pub fn vault_delete(app: tauri::AppHandle, slug: String, label: String) -> Result<bool, String> {
    let slug = validate_slug(&slug)?;
    let label = validate_label(&label)?;

    // Секрет удаляем всегда, даже если метаданных нет: иначе рассинхрон оставил бы
    // «осиротевший» секрет в связке навсегда.
    os_store::delete(&address(&slug, &label))?;

    let path = meta_file(&app)?;
    let mut list = read_meta(&path);
    let before = list.len();
    list.retain(|m| !(m.slug == slug && m.label == label));
    let removed = list.len() != before;
    if removed {
        write_meta(&path, &list)?;
    }
    Ok(removed)
}

// ─── Обмен с сайтом ──────────────────────────────────────────────────────────

/// Сходить на сайт за ключами нужных сервисов и положить их в сейф.
///
/// Звать ПЕРЕД задачей и только по тем сервисам, которые ей нужны, — не весь сейф
/// (§3 контракта). Запрос дешёвый: в `known` уходят версии, которые у нас уже есть,
/// и на совпадении секрет по сети не едет вовсе.
///
/// Секрет в renderer не возвращается ни в каком виде: сюда приезжает ответ сайта,
/// здесь же он кладётся в сейф, наружу уходит только отчёт «что с чем случилось».
#[tauri::command]
#[specta::specta]
pub async fn vault_sync_from_site(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::storage::StorageService>,
    services: Vec<String>,
    accounts: BTreeMap<String, String>,
    task_id: Option<String>,
) -> Result<VaultSyncReport, String> {
    let mut slugs = Vec::with_capacity(services.len());
    for s in &services {
        slugs.push(validate_slug(s)?);
    }
    slugs.sort();
    slugs.dedup();
    if slugs.is_empty() {
        return Ok(VaultSyncReport::default());
    }

    // Метки, которые нода знает из поля проекта. Не знает — сайт выберет сам по
    // владельцу задачи либо по единственной учётке, а если их несколько, честно
    // ответит `ambiguous`, вместо того чтобы угадывать между `main` и `test`.
    let mut wanted = BTreeMap::new();
    for (slug, label) in &accounts {
        let slug = validate_slug(slug)?;
        let label = validate_label(label)?;
        if slugs.contains(&slug) {
            wanted.insert(slug, label);
        }
    }

    let path = meta_file(&app)?;
    let known = known_keys(&read_meta(&path), &wanted, now_sec());

    let resp = state
        .vault_keys(&slugs, &known, &wanted, task_id.as_deref())
        .await?;

    let mut issued = Vec::new();
    for key in &resp.keys {
        if key.fields.is_empty() {
            // Сервис без ключа — законное состояние (свой сервер рядом может не
            // требовать авторизации), но записывать пустую учётку незачем.
            continue;
        }
        save_account(
            &app,
            &key.slug,
            &key.account,
            key.fields.clone(),
            "site",
            Some(key.version),
            Some(key.ttl_sec),
        )?;
        issued.push(VaultSyncedAccount {
            slug: key.slug.clone(),
            label: key.account.clone(),
        });
    }

    // Недоступный сервис — это пауза, отзыв или `proxy`. Копии по нему держать
    // нельзя: именно их удаление и делает отзыв отзывом, а не пожеланием до конца
    // TTL. Локальные учётки не трогаем — они к сайту отношения не имеют.
    if !resp.unavailable.is_empty() {
        let mut list = read_meta(&path);
        let doomed: Vec<(String, String)> = list
            .iter()
            .filter(|m| m.source == "site" && resp.unavailable.contains(&m.slug))
            .map(|m| (m.slug.clone(), m.label.clone()))
            .collect();
        for (slug, label) in &doomed {
            let _ = os_store::delete(&address(slug, label));
        }
        if !doomed.is_empty() {
            list.retain(|m| !(m.source == "site" && resp.unavailable.contains(&m.slug)));
            write_meta(&path, &list)?;
        }
    }

    Ok(VaultSyncReport {
        issued,
        fresh: resp
            .fresh
            .iter()
            .map(|f| VaultSyncedAccount {
                slug: f.slug.clone(),
                label: f.account.clone(),
            })
            .collect(),
        unavailable: resp.unavailable.clone(),
        ambiguous: resp.ambiguous.clone(),
        services: resp.services.clone(),
        vault_revision: resp.vault_revision,
    })
}

/// Отправить потребление сайту — в единицах, не в деньгах.
///
/// Звать сразу после ответа вендора, не дожидаясь конца задачи: вендор уже получил
/// свои деньги, и упади машина следом — расход всё равно должен быть учтён.
///
/// ⚠️ Ответ надо разбирать: `unpriced` и `noRate` означают, что строка НЕ записана
/// и расход надо прислать позже. Буфера переотправки здесь нет — он принадлежит
/// раннеру, который знает, когда повторить.
#[tauri::command]
#[specta::specta]
pub async fn vault_report_usage(
    state: tauri::State<'_, crate::storage::StorageService>,
    task_id: String,
    project_id: Option<String>,
    entries: Vec<crate::storage::types::VendorUsageEntry>,
) -> Result<crate::storage::types::VendorUsageResult, String> {
    if entries.is_empty() {
        return Err("нечего отправлять: список строк потребления пуст".into());
    }
    state
        .vault_usage(&task_id, project_id.as_deref(), &entries)
        .await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn f(pairs: &[(&str, &str)]) -> BTreeMap<String, String> {
        pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect()
    }

    #[test]
    fn слаг_только_kebab() {
        assert_eq!(validate_slug(" Eleven-Labs ").unwrap(), "eleven-labs");
        assert!(validate_slug("eleven/labs").is_err());
        assert!(validate_slug("eleven labs").is_err());
        assert!(validate_slug("").is_err());
    }

    #[test]
    fn слаг_без_слеша_чтобы_адрес_не_схлопнулся() {
        // `a/b` + `c` и `a` + `b/c` дали бы один адрес в хранилище ОС.
        assert!(validate_slug("a/b").is_err());
        assert_eq!(address("a", "b/c"), "a/b/c");
    }

    #[test]
    fn метка_обрезается_и_не_пускает_управляющие() {
        assert_eq!(validate_label("  мой ключ 1 ").unwrap(), "мой ключ 1");
        assert!(validate_label("плохая\nметка").is_err());
        assert!(validate_label("   ").is_err());
    }

    #[test]
    fn подсказка_по_самому_длинному_полю() {
        // client_id первый по алфавиту, но узнают ключ по хвосту секрета.
        let hint = make_hint(&f(&[("client_id", "123.apps"), ("client_secret", "GOCSPX-ab4f21")]));
        assert_eq!(hint, "••••4f21");
    }

    #[test]
    fn подсказка_не_течёт_на_коротком_значении() {
        assert_eq!(make_hint(&f(&[("apiKey", "ab")])), "••••");
        assert_eq!(make_hint(&BTreeMap::new()), "••••");
    }

    #[test]
    fn upsert_по_паре_слаг_метка() {
        let mut list = vec![];
        let mk = |slug: &str, label: &str, hint: &str| VaultAccountMeta {
            slug: slug.into(),
            label: label.into(),
            source: "local".into(),
            hint: hint.into(),
            secret_version: 0,
            expires_at: None,
            updated_at: 0,
            stale: false,
            expired: false,
        };
        upsert_meta(&mut list, mk("eleven-labs", "main", "••••1111"));
        upsert_meta(&mut list, mk("eleven-labs", "test", "••••2222"));
        // тот же слаг и та же метка — замена, а не второй ряд
        upsert_meta(&mut list, mk("eleven-labs", "main", "••••3333"));
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].hint, "••••3333");
    }

    fn meta(slug: &str, label: &str, source: &str, ver: i64) -> VaultAccountMeta {
        VaultAccountMeta {
            slug: slug.into(),
            label: label.into(),
            source: source.into(),
            hint: "••••".into(),
            secret_version: ver,
            expires_at: None,
            updated_at: 0,
            stale: false,
            expired: false,
        }
    }

    #[test]
    fn known_подтверждает_только_годные_копии() {
        let mut stale = meta("s-stale", "main", "site", 3);
        stale.stale = true;
        let mut old = meta("s-old", "main", "site", 4);
        old.expires_at = Some(100);

        let list = vec![
            meta("s-ok", "main", "site", 7),
            stale,
            old,
            meta("s-local", "мой ключ", "local", 0),
            meta("s-zero", "main", "site", 0),
        ];

        let wanted: BTreeMap<String, String> = [
            ("s-ok", "main"),
            ("s-stale", "main"),
            ("s-old", "main"),
            ("s-local", "мой ключ"),
            ("s-zero", "main"),
        ]
        .iter()
        .map(|(a, b)| (a.to_string(), b.to_string()))
        .collect();

        let known = known_keys(&list, &wanted, 150);
        assert_eq!(known.get("s-ok").map(|k| k.version), Some(7));
        assert_eq!(known.get("s-ok").map(|k| k.account.as_str()), Some("main"));
        // Несвежую версию подтверждать нельзя: в ответ придёт `fresh`, и мы
        // останемся с копией, которую сами считаем сомнительной.
        assert!(!known.contains_key("s-stale"));
        assert!(!known.contains_key("s-old"), "протухшая копия не подтверждается");
        assert!(!known.contains_key("s-local"), "локальные сайту не показываем");
        assert!(!known.contains_key("s-zero"), "у сайта версии начинаются с единицы");
        assert_eq!(known.len(), 1);
    }

    #[test]
    fn known_молчит_про_сервис_без_названной_метки() {
        // Метку не назвали — подтверждать нечего: у сервиса может быть и `main`, и
        // `test`, и подтверждение «версия 7» относилось бы неизвестно к какой.
        let list = vec![meta("eleven-labs", "main", "site", 7)];
        let known = known_keys(&list, &BTreeMap::new(), 150);
        assert!(known.is_empty());
    }

    #[test]
    fn протухание_считается_на_чтении() {
        let mut list = vec![
            VaultAccountMeta {
                slug: "s".into(),
                label: "старая".into(),
                source: "site".into(),
                hint: "••••".into(),
                secret_version: 7,
                expires_at: Some(100),
                updated_at: 0,
                stale: false,
                expired: false,
            },
            VaultAccountMeta {
                slug: "s".into(),
                label: "локальная".into(),
                source: "local".into(),
                hint: "••••".into(),
                secret_version: 0,
                expires_at: None,
                updated_at: 0,
                stale: false,
                expired: true, // прилетело из файла — должно быть пересчитано
            },
        ];
        mark_expired(&mut list, 150);
        assert!(list[0].expired, "site-копия со сроком в прошлом протухла");
        assert!(!list[1].expired, "у локальной срока нет — не протухает никогда");
    }
}
