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
// Сами поля секрета лежат на ДВУХ разных полках, и это не дублирование, а разные
// сроки жизни:
//
//   • учётка, заведённая руками (`local`) → хранилище учётных данных ОС (Keychain /
//     Credential Manager, крейт `keyring`). Это сильнее шифрованного файла рядом с
//     приложением: ключа шифрования у нас нет вовсе, значит его нельзя ни потерять,
//     ни утащить вместе с файлом. От `accounts/*.json` (plaintext) уходим сюда;
//
//   • ключ, выданный сайтом (`site`) → ТОЛЬКО память процесса, диска не касается.
//
// ── Почему ключи с сайта не кладутся в связку
//
// Keychain выдаёт доступ приложению, опознанному по подписи. Пока приложение не
// подписано стабильным Developer ID, каждая новая сборка для macOS — другое
// приложение, и система спрашивает пароль заново ПОСЛЕ КАЖДОГО ОБНОВЛЕНИЯ на каждой
// машине. На парке это неисполнимо: кликать «разрешить» руками негде.
//
// В память они ложатся не как обходной манёвр, а по существу: у выданной копии и так
// короткий `ttlSec`, гейт ходит за ключами перед каждым витком, и «копия не живёт
// дольше, чем нужно» — ровно то, ради чего ключи переехали на сайт. Плата: после
// перезапуска программы офлайн на этих ключах не поработать, нужен один поход к
// сайту. Локальные учётки офлайн работают как работали.
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
    /// Секрет доступен прямо сейчас. Тоже считается на чтении.
    ///
    /// У локальных всегда `true`: проверять означало бы лезть в связку ОС, а это и
    /// есть тот самый запрос пароля — на КАЖДОЕ открытие списка. У выданных сайтом
    /// зависит от памяти процесса: после перезапуска метаданные есть, ключа нет.
    #[serde(default)]
    pub loaded: bool,
    /// Адрес ЭТОЙ установки. Пусто — адрес знает сама нода.
    ///
    /// У вендора с одним публичным API совпадает с сервисным, у своих серверов
    /// различается: два своих ComfyUI — это один сервис и две учётки с разными
    /// адресами, а не два сервиса (у сервиса слаг уникален, и слаг = плагин).
    #[serde(default)]
    pub base_url: String,
    /// `platform` — наша учётка, `client` — клиента. У локальных пусто.
    #[serde(default)]
    pub owner: String,
    /// Есть ли у учётки ключ. `false` — законное состояние: свой сервис рядом
    /// может не требовать авторизации, у него есть только адрес.
    ///
    /// Дефолт `true`, а не `false`: все записи, сделанные до появления поля,
    /// заводились с секретом, и прочитать их как «без ключа» значило бы сломать
    /// работающие учётки при обновлении программы.
    #[serde(default = "default_true")]
    pub has_secret: bool,
}

fn default_true() -> bool {
    true
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
    /// Учётки, пропавшие с сайта (удалены или отозваны) — их копии мы стёрли.
    pub revoked: Vec<VaultSyncedAccount>,
    /// Каталожная часть: адрес, состав учёток и поля секрета по каждому сервису.
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

/// Досчитывает то, что не хранится: протухание и наличие секрета.
///
/// Считается на чтении, а не пишется в файл: иначе флаги пришлось бы обновлять по
/// таймеру, и они врали бы ровно в тот момент, когда важны.
fn mark_computed(list: &mut [VaultAccountMeta], now: i64) {
    for m in list.iter_mut() {
        m.expired = matches!(m.expires_at, Some(exp) if exp <= now);
        m.loaded = if m.source != "site" {
            true
        } else if !m.has_secret {
            // Сервис без авторизации: грузить нечего, значит и «не загружено» нет.
            true
        } else {
            site_loaded(&address(&m.slug, &m.label))
        };
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

// ─── Ключи с сайта: только память ────────────────────────────────────────────

/// Секреты, выданные сайтом. Живут ровно столько, сколько живёт процесс.
///
/// Статик, а не поле состояния Tauri, по той же причине, по которой сейф вообще
/// существует: сюда ходят и команды из renderer, и демон, и им нужен один набор.
static SITE_SECRETS: std::sync::OnceLock<
    std::sync::Mutex<std::collections::HashMap<String, BTreeMap<String, String>>>,
> = std::sync::OnceLock::new();

fn site_secrets(
) -> &'static std::sync::Mutex<std::collections::HashMap<String, BTreeMap<String, String>>> {
    SITE_SECRETS.get_or_init(|| std::sync::Mutex::new(std::collections::HashMap::new()))
}

fn site_put(addr: String, fields: BTreeMap<String, String>) {
    if let Ok(mut m) = site_secrets().lock() {
        m.insert(addr, fields);
    }
}

fn site_get(addr: &str) -> Option<BTreeMap<String, String>> {
    site_secrets().lock().ok()?.get(addr).cloned()
}

fn site_forget(addr: &str) {
    if let Ok(mut m) = site_secrets().lock() {
        m.remove(addr);
    }
}

fn site_loaded(addr: &str) -> bool {
    site_secrets()
        .lock()
        .map(|m| m.contains_key(addr))
        .unwrap_or(false)
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
    mark_computed(&mut list, now_sec());
    list.sort_by(|a, b| (&a.slug, &a.label).cmp(&(&b.slug, &b.label)));
    Ok(list)
}

/// Завести/обновить учётку. `fields` — набор именованных полей секрета
/// (`apiKey`, либо `login`+`password`, либо OAuth-набор): состав диктует описание
/// сервиса в каталоге, здесь он произвольный.
///
/// `ttl_sec` осмыслен только для `source = "site"`: у выданной сайтом копии обязан
/// быть срок. Локальной учётке срок не ставится — её никто не отзывает.
///
/// `base_url` — адрес этой установки. Вендору с одним публичным API не нужен, его
/// знает плагин; для своего сервера, поднятого рядом, это главное поле: два своих
/// ComfyUI — это одна нода, один слаг и две учётки с разными адресами.
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
    base_url: Option<String>,
) -> Result<VaultAccountMeta, String> {
    save_account(
        &app,
        &slug,
        &label,
        fields,
        source.as_deref().unwrap_or("local"),
        secret_version,
        ttl_sec,
        base_url.as_deref().unwrap_or("").trim(),
        "",
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
    base_url: &str,
    owner: &str,
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

    // Секрет — первым: если запись не удастся, метаданные не должны обещать учётку,
    // которой нет. Куда именно — решает источник: выданный сайтом ключ в связку не
    // кладём вовсе (см. шапку модуля).
    let addr = address(&slug, &label);
    if source == "site" {
        site_put(addr, fields.clone());
    } else {
        os_store::put(&addr, &blob)?;
    }

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
        loaded: true,
        base_url: base_url.trim().to_string(),
        owner: owner.to_string(),
        has_secret: true,
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

/// Что мы готовы подтвердить сайту как актуальное: `слаг/метка` → пара.
///
/// Ключ с меткой, потому что по одному сервису мы держим несколько учёток, и без
/// метки вторая затирала бы первую. Пара, а не версия: нумерация у каждой учётки
/// своя, и `v3` у `main` совпал бы с `v3` у `test`.
///
/// Несвежие и протухшие сюда не попадают намеренно: подтвердив такую версию, мы
/// получили бы в ответ `fresh` и остались бы с копией, которую сами же считаем
/// сомнительной. Ноль тоже не подтверждаем — у сайта версии начинаются с единицы.
fn known_keys(
    list: &[VaultAccountMeta],
    now: i64,
) -> BTreeMap<String, crate::storage::types::VendorKnownKey> {
    let mut out = BTreeMap::new();
    for m in list {
        if m.source != "site" || m.stale || m.secret_version <= 0 || !m.has_secret {
            continue;
        }
        // Секрет живёт в памяти процесса: после перезапуска метаданные с версией на
        // диске есть, а ключа нет. Подтверди мы такую версию — сайт ответил бы
        // «актуально», и мы остались бы с меткой без ключа.
        if !site_loaded(&address(&m.slug, &m.label)) {
            continue;
        }
        if matches!(m.expires_at, Some(exp) if exp <= now) {
            continue;
        }
        out.insert(
            format!("{}/{}", m.slug, m.label),
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

    let addr = address(&slug, &label);

    if meta.source == "site" {
        // Ключа в памяти нет — программу перезапустили либо сайт был недоступен.
        // Это не «сломалось», а «ещё не привезли»: чинится запросом, а не руками.
        return site_get(&addr).ok_or_else(|| {
            format!(
                "ключ '{}' ({}) не загружен с сайта — обнови учётки перед запуском",
                label, slug
            )
        });
    }

    let blob = os_store::get(&addr)?.ok_or_else(|| {
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

    // Чистим обе полки, даже если метаданных нет: иначе рассинхрон оставил бы
    // «осиротевший» секрет в связке навсегда. Какая из них занята — зависит от
    // источника, но удаление пустого места ничего не стоит.
    let addr = address(&slug, &label);
    site_forget(&addr);
    os_store::delete(&addr)?;

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

    let path = meta_file(&app)?;
    let known = known_keys(&read_meta(&path), now_sec());

    let resp = state.vault_keys(&slugs, &known, task_id.as_deref()).await?;

    // Адрес и владелец лежат в каталожной части, а не в выданном ключе: секрет
    // приходит только при устаревшей версии, а адрес нужен каждый раз.
    let endpoint = |slug: &str, label: &str| {
        resp.services
            .iter()
            .find(|e| e.slug == slug)
            .and_then(|e| e.accounts.iter().find(|a| a.label == label))
    };

    let mut issued = Vec::new();
    for key in &resp.keys {
        let (base_url, owner) = endpoint(&key.slug, &key.account)
            .map(|a| (a.base_url.clone(), a.owner.clone()))
            .unwrap_or_default();
        save_account(
            &app,
            &key.slug,
            &key.account,
            key.fields.clone(),
            "site",
            Some(key.version),
            Some(key.ttl_sec),
            &base_url,
            &owner,
        )?;
        issued.push(VaultSyncedAccount {
            slug: key.slug.clone(),
            label: key.account.clone(),
        });
    }

    let mut list = read_meta(&path);
    let mut dirty = false;

    // Каталожная часть: обновляем адрес и владельца у всех известных учёток и
    // заводим запись без секрета для тех, у кого ключа нет по решению — это
    // законное состояние (свой сервер рядом может не требовать авторизации), и
    // отличать его от «выдача не сработала» нода должна явно.
    for e in &resp.services {
        for a in &e.accounts {
            let slug = e.slug.clone();
            match list
                .iter_mut()
                .find(|m| m.slug == slug && m.label == a.label && m.source == "site")
            {
                Some(m) => {
                    if m.base_url != a.base_url || m.owner != a.owner || m.has_secret != a.has_secret
                    {
                        m.base_url = a.base_url.clone();
                        m.owner = a.owner.clone();
                        m.has_secret = a.has_secret;
                        dirty = true;
                    }
                }
                None if !a.has_secret => {
                    list.push(VaultAccountMeta {
                        slug,
                        label: a.label.clone(),
                        source: "site".into(),
                        // Ключа нет — и подсказка про него была бы враньём.
                        hint: "—".into(),
                        secret_version: 0,
                        expires_at: None,
                        updated_at: now_sec(),
                        stale: false,
                        expired: false,
                        loaded: true,
                        base_url: a.base_url.clone(),
                        owner: a.owner.clone(),
                        has_secret: false,
                    });
                    dirty = true;
                }
                None => {}
            }
        }
    }

    // Что пропало с сайта, должно пропасть и здесь: сервис недоступен целиком либо
    // учётка удалена. Именно это делает отзыв отзывом, а не пожеланием до конца
    // TTL. Локальные учётки не трогаем — они к сайту отношения не имеют.
    let mut revoked = Vec::new();
    list.retain(|m| {
        if m.source != "site" {
            return true;
        }
        let gone = resp.unavailable.contains(&m.slug)
            || resp
                .services
                .iter()
                .find(|e| e.slug == m.slug)
                .map(|e| !e.accounts.iter().any(|a| a.label == m.label))
                .unwrap_or(false);
        if gone {
            let addr = address(&m.slug, &m.label);
            site_forget(&addr);
            let _ = os_store::delete(&addr);
            revoked.push(VaultSyncedAccount {
                slug: m.slug.clone(),
                label: m.label.clone(),
            });
        }
        !gone
    });
    if !revoked.is_empty() {
        dirty = true;
    }
    if dirty {
        write_meta(&path, &list)?;
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
        revoked,
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

    fn one_field() -> BTreeMap<String, String> {
        [("secret".to_string(), "x".to_string())].into_iter().collect()
    }

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
            loaded: true,
            base_url: String::new(),
            owner: String::new(),
            has_secret: true,
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
            loaded: true,
            base_url: String::new(),
            owner: String::new(),
            has_secret: true,
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

        // Секрет живёт в памяти процесса, поэтому «годная копия» — это ещё и
        // «ключ у нас на руках». Кладём только для s-ok.
        site_put(address("s-ok", "main"), one_field());

        let known = known_keys(&list, 150);
        assert_eq!(known.get("s-ok/main").map(|k| k.version), Some(7));
        assert_eq!(known.get("s-ok/main").map(|k| k.account.as_str()), Some("main"));
        // Несвежую версию подтверждать нельзя: в ответ придёт `fresh`, и мы
        // останемся с копией, которую сами считаем сомнительной.
        assert!(!known.contains_key("s-stale/main"));
        assert!(!known.contains_key("s-old/main"), "протухшая копия не подтверждается");
        assert!(!known.contains_key("s-local/мой ключ"), "локальные сайту не показываем");
        assert!(!known.contains_key("s-zero/main"), "у сайта версии начинаются с единицы");
        assert_eq!(known.len(), 1);
        site_forget(&address("s-ok", "main"));
    }

    #[test]
    fn known_различает_учётки_одного_сервиса() {
        // Ключ с меткой, иначе вторая учётка затирала бы первую и сайт подтвердил
        // бы `test` версией от `main`.
        let list = vec![
            meta("eleven-labs", "main", "site", 7),
            meta("eleven-labs", "test", "site", 3),
        ];
        site_put(address("eleven-labs", "main"), one_field());
        site_put(address("eleven-labs", "test"), one_field());

        let known = known_keys(&list, 150);
        assert_eq!(known.get("eleven-labs/main").map(|k| k.version), Some(7));
        assert_eq!(known.get("eleven-labs/test").map(|k| k.version), Some(3));
        assert_eq!(known.len(), 2);

        // Перезапуск программы: метаданные с версией остались, память пуста.
        // Подтверди мы такую версию — сайт ответил бы «актуально», и мы остались бы
        // с меткой без ключа.
        site_forget(&address("eleven-labs", "test"));
        let after_restart = known_keys(&list, 150);
        assert_eq!(after_restart.len(), 1, "неподгруженную версию не подтверждаем");
        site_forget(&address("eleven-labs", "main"));
    }

    #[test]
    fn учётка_без_ключа_сайту_не_подтверждается() {
        // Сервис без авторизации: подтверждать нечего, версии у него нет.
        let mut no_key = meta("comfyui", "свой сервер", "site", 0);
        no_key.has_secret = false;
        assert!(known_keys(&[no_key], 150).is_empty());
    }

    #[test]
    fn ключ_с_сайта_живёт_в_памяти_а_не_в_связке() {
        // Смысл теста — зафиксировать развилку: у выданного сайтом ключа `loaded`
        // зависит от памяти процесса, у локального всегда true (лезть в связку ради
        // списка нельзя — это и есть запрос пароля на каждое открытие).
        let mut site = meta("comfyui", "forTest", "site", 7);
        let local = meta("comfyui", "мой", "local", 0);
        site.has_secret = true;

        let mut list = vec![site, local];
        mark_computed(&mut list, 150);
        assert!(!list[0].loaded, "секрета в памяти нет — значит не загружен");
        assert!(list[1].loaded, "локальный считаем доступным без обращения к связке");

        site_put(
            address("comfyui", "forTest"),
            [("secret".to_string(), "x".to_string())].into_iter().collect(),
        );
        mark_computed(&mut list, 150);
        assert!(list[0].loaded, "после выдачи ключ доступен");
        site_forget(&address("comfyui", "forTest"));
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
                loaded: true,
                base_url: String::new(),
                owner: String::new(),
                has_secret: true,
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
                loaded: true,
                base_url: String::new(),
                owner: String::new(),
                has_secret: true,
            },
        ];
        mark_computed(&mut list, 150);
        assert!(list[0].expired, "site-копия со сроком в прошлом протухла");
        assert!(!list[1].expired, "у локальной срока нет — не протухает никогда");
    }
}
