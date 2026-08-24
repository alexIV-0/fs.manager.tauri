# Plan: VK Auto-Post Plugin

## Статус
🎉 ПРОРЫВ (2026-06-15 вечер): **все 3 режима подтверждены вживую** через токен **vk.com (6287487)**,
включая Клипы и Both. Клипы РАСКОНСЕРВИРОВАНЫ. Готово к реализации — старт следующая сессия.

---

## 🎯 ПЛАН РЕАЛИЗАЦИИ (СТАРТ В СЛЕДУЮЩУЮ СЕССИЮ)

**Что строим:** плагин `autoPostVK` с тремя режимами:
- **`Clips (reels)`** — клип в ленту Клипов (`shortVideo`, вертикаль 9:16)
- **`Both (Post + Reels)`** — клип + дубль в ленту (`shortVideo` `wallpost=1`)
- **`Video (Post)`** — обычное видео на стену/в сообщество (`video.save`+`wall.post`)

Цель — сообщество VK (там монетизация: реклама в видео 120+ сек, Donut, Фонд авторов).

**🔑 Авторизация — РЕШЕНО:** один токен приложения **`vk.com` (`client_id 6287487`)** покрывает
ВСЁ (Клипы + видео). Браузерный implicit-flow → целевой UX «кнопка → логин» сохраняется.
Со scope `offline` токен **бессрочный** (refresh не нужен). НЕ Kate Mobile (у него Клипы скрыты),
НЕ VK Admin (заблокирован), НЕ официальное (direct-auth).
- Сейчас (dev): токен вручную — `scripts/vk-validate.mjs auth-url` (дефолт = vk.com).
- В продукте: кнопка «Добавить аккаунт» → встроенный WebView с логином VK (URL с `client_id=6287487`)
  → перехват `access_token` из `blank.html#...` → сохранение в `options/vk/accounts/{name}.json`.

**Подтверждённые flow (оба проверены вживую):**
```
РЕЖИМ Clips / Both — shortVideo (v5.249):
1. shortVideo.create  {file_size, group_id?}          → {upload_url, video_id, owner_id}
2. POST upload_url  (multipart, поле "file")           → {video_hash, ...}
3. ЖДАТЬ ~80 сек (обработка)
4. shortVideo.edit    {video_id, owner_id, group_id?, description, privacy_view:all, can_make_duet:1}
5. shortVideo.publish {video_id, owner_id, group_id?, license_agree:1, publish_date:0, wallpost:0|1}
   → wallpost=1 даёт wall_post_id (дубль в ленту = Both).  permalink: vk.com/clip{owner}_{video_id}

РЕЖИМ Video (Post):
1. video.save {name, description, group_id?, is_private?} → {upload_url, video_id, owner_id}
2. POST upload_url  (multipart, поле "video_file")        → {video_hash, ...}  (CDN mycdn.me)
3. wall.post {owner_id, message, attachments=video{owner}_{id}, [from_group=1], [publish_date]} → {post_id}
   • группа: owner_id=-group_id, from_group=1   • профиль: owner_id=user_id
```

**Структура плагина** (`plugins-dev/autoPostVK/`): `plugin.json`, `ui.json`, `autoPostVK.ts`,
`_publisher.ts` (обе ветки flow), `_videoPrep.ts`, `_token.ts`.

**Поля ноды (ui.json) — VK aPosting Video:** `inputFile`(link, video), `account`(ddm:
`#vkAccounts`+«Add New Account»), `mode`(ddm: Both/Clips/Video, default Both),
`description`(link, **необяз.**, text|string — пусто = без описания), `interval`(timecode),
`daysOfWeek`(autocomplete, фикс. дни), `window`(timeRange — НОВЫЙ компонент, dual-slider
00:00–24:00, дефолт весь день), `order`(ddm: by Time/by Name/Random, def. by Time).
`target`(профиль/группа) НЕ поле ноды — он в самом аккаунте.
**Видео НЕ конвертируем** (юзер готовит сам) — `_videoCheck` валидирует (ffprobe) под
режим; не подходит → `move_to_errors`. Для Clips/Both: 9:16 / ≤3мин / ≤100MB.
**Планирование: App-timer** (решение 2026-06-16): приложение постит при наступлении
слота; нода при обработке ЗАНОСИТ файл в очередь, реальный пост — фоновым тиком.
`publish_date` VK НЕ используем (постим немедленно по таймеру приложения).
- **Время последнего поста** — из последней записи `_post/*.jsonl` проекта (источник
  истины, едет с проектом/на сайт); LS — только кэш.
- **Catch-up НЕ копим**: пропустили слоты — постим по одному с текущего момента.
- **Очередь** = файлы в IN, отсортированы по `order`.
- **Один пост за слот**: проверяем файл; не прошёл → `move_to_errors` и берём
  СЛЕДУЮЩИЙ; остальные файлы не трогаем.
- **Новые компоненты автосборки:** `timeRange` [✓ 2026-06-16] (MUI dual-slider
  00:00–24:00 + 2 окошка HH:MM) + токен `#vkAccounts` [✓] (accountList по главной
  папке). tsc — 0 ошибок.
- **colorType `posting`** [✓ СДЕЛАНО 2026-06-16] — новый system-тип → пул **online**
  (limit 5). Правки: settings_commands system_types, appSettings.ts
  (DEFAULT_LIMITS / SYSTEM / COLORTYPE_TO_POOL), pathPattern_store (цвет `#5181b8`).
  `plugin.json.resourcePool:"online"` и так роутит по pluginId — colorType добавляет
  визуальную группу + fallback-маршрут.

**Шаги (по порядку):**
1. `plugin.json` + `ui.json` — структура ноды (согласовать поля)
2. `_publisher.ts` — две ветки: shortVideo (Clips/Both) и video.save+wall.post (Video)
3. `autoPostVK.ts` — диспетчер по `mode` + `_videoPrep` (для Клипов 9:16) + дедуп через per-project `_post/*.jsonl`
4. Встройка в pipeline обработки (папки IN → options → `_post/$MM.$YYYY.jsonl`)
5. UI добавления/выбора аккаунта — В НАСТРОЙКАХ НОДЫ (не в настройках программы):
   дропдаун существующих + кнопка «Добавить» (WebView-перехват токена, `client_id=6287487`)

**Готовый инструмент проверки:** [`scripts/vk-validate.mjs`](scripts/vk-validate.mjs)
(`auth-url` → vk.com, `video`, `clip [--wallpost]`, `delete`, `delete-post`).

**Открытые мелочи (проверить при сборке):**
- Отложенная публикация Клипов: `shortVideo.publish` принимает `publish_date` — проверить, работает ли
  (в Video-режиме `wall.post publish_date` точно работает).
- Подтвердить, что vk.com-токен делает и `video.save`+`wall.post` (почти наверняка да — broad scope).
- Клипы в сообщество: `group_id` в shortVideo.* — проверить на реальной группе (нужны админ-права).

**На будущее:** другие платформы (YouTube Shorts и т.п.) — отдельная проработка.

---

## ✅ ЧЕКПОИНТ ВАЛИДАЦИИ (2026-06-15)

Инструмент проверки: [`scripts/vk-validate.mjs`](scripts/vk-validate.mjs) (Node 18+, токен через `VK_TOKEN`).

| Что проверено | Результат | Детали |
|---------------|-----------|--------|
| Kate Mobile токен (`offline`, бессрочный) | ✅ работает | `users.get` ок (аккаунт id 196098718) |
| **Режим `Video (Post)`** — `video.save` → upload → `wall.post` | ✅ **подтверждён end-to-end** | upload HTTP 200 (`video_file`, CDN `mycdn.me`), пост создан |
| Удаление поста (`wall.delete`) + видео (`video.delete`) | ✅ работает | cleanup командами `delete-post` / `delete` |
| **Режим `Clips` + `Both`** — `shortVideo.*` | ✅ **подтверждён end-to-end** (токен vk.com) | create→upload(`file`)→ждать 80с→edit→publish прошли; клип live `clip196098718_456239109`, `wall_post_id:279` (Both), вертикаль 1080×1920, `type:short_video` |
| **Токен `vk.com` (`client_id 6287487`)** | ✅ **ключевая находка** | браузерный flow, не заблокирован, имеет доступ к `shortVideo`; покрывает все 3 режима. (Kate → Клипы скрыты; VK Admin → заблокирован; офиц. → direct-auth) |

**Команды скрипта:** `auth-url [--admin\|--official\|--client <id>]`, `probe`, `video <f> [--publish]`,
`clip <f> [--wallpost] [--group <id>] [--wait <sec>]`, `delete <owner> <video_id>`, `delete-post <owner> <post_id>`.

### РЕЦЕПТ КЛИПОВ (архив — на случай доступа через путь C)
⚠️ Источник рецепта — репо H04X4/vk-clips (авг 2025), где работал токен **VK Admin** (`6121396`).
**НО VK Admin к 2026 заблокирован** (`"application is blocked"`), а `shortVideo` — приватный API.
Поэтому рецепт сейчас НЕ применим; сохранён на случай официального доступа (путь C).
Полный flow (4 метода, v5.249):
```
1. shortVideo.create   {file_size, group_id?}        → {upload_url, video_id, owner_id}
2. upload  POST upload_url, поле "file" (multipart)
3. ЖДАТЬ ~80 сек (обработка ролика)
4. shortVideo.edit     {video_id, owner_id, group_id?, description, privacy_view:all, can_make_duet:1}
5. shortVideo.publish  {video_id, owner_id, group_id?, license_agree:1, publish_date:0, wallpost:0|1}
```
`wallpost=1` в publish → клип + дубль в ленту.

### ФАКТ: shortVideo — приватный API (подтверждено офиц. списком методов, 2026-06-15)
В публичной документации VK раздел `Video` содержит `save/add/edit/get/...`, но **методов
`shortVideo.*` там НЕТ** — это внутренний/приватный API first-party приложений. Поэтому
сторонние токены дают `"Unknown method passed"`. SMM-сервисы (postmypost, SMMplanner),
которые постят Клипы, имеют **индивидуально согласованный партнёрский доступ** к `shortVideo`
(или обрабатывают полные креды пользователя на сервере). → Единственный легальный путь
к Клипам для нас — **путь C** (запрос доступа в `devsupport@corp.vk.com` на своё приложение).

**Проверено и отвергнуто (чтобы не возвращаться):**
- `vk_ref=clips` — это метка источника запуска мини-приложения, НЕ API публикации.
- VK Bridge: есть `VKWebAppShowStoryBox`/`VKWebAppShowWallPostBox`, но **метода для клипов НЕТ**;
  и Bridge работает только ВНУТРИ VK Mini App в клиенте VK (не из десктопа) + интерактивно
  (не для фонового автопостинга). → для нашего сценария не подходит.

### РЕШЕНИЕ ПО ИТОГАМ ВАЛИДАЦИИ (финал)
- **`Video (Post)`** — ✅ подтверждён, **строим плагин на нём.**
- **`Clips`/`Both`** — ❌ **запарковано.** Проверено живьём: VK Admin токен (рецепт из репо)
  → `"application is blocked"`; других живых браузерных app_id для `shortVideo` нет;
  сам `shortVideo` — не публичный API (см. факт выше).
  Возврат к Клипам возможен только если:
  - (C) VK одобрит официальный доступ к твоему приложению на `shortVideo` (запрос в devsupport), либо
  - (фрагильно) появится новый рабочий browser-flow app_id — но это whack-a-mole, VK их блокирует,
    и для продукта это ненадёжный фундамент.
- Скрипт умеет пробовать произвольный app_id: `auth-url --client <id>` (если захочется разведать
  ещё кандидатов вручную — напр. VK Me 6146827 — но без гарантий и не как основа продукта).

---

## ⚠️ ГЛАВНЫЙ ВЫВОД РАЗВЕДКИ (2026-06-15)

Авторизация в VK для постинга — **главная сложность проекта**, и она НЕ такая простая,
как казалось вначале. Подтверждённые факты:

1. **VK ID токены (`vk2.a.*`) НЕ работают с методами API** (`wall.post`, `video.save`).
   Ошибка `1051 "Method is not available for this profile type"`. VK ID — это
   только «Войти через VK» (identity), не доступ к API.
   *(Источник: postiz-app issue #1408, открыт 15.04.2026 — актуально.)*

2. **Регистрация новых Standalone-приложений** для API частично прикрыта/мутна;
   `wall` scope для пользовательского токена выдаётся только по запросу в
   `devsupport@corp.vk.com` «в исключительных случаях».

3. **Токен сообщества (community token)** — РАБОЧИЙ официальный путь для групп:
   генерится в `Сообщество → Управление → Работа с API → Ключи доступа`,
   **не истекает**, scope включает `wall`. Но **`video` scope недоступен** для
   community-токена (ошибка `Access to group denied: !enable_video`) — то есть
   **загрузка видео community-токеном проблематична**.

4. **Kate Mobile / VK Admin app_id** — де-факто решение сообщества для
   пользовательского токена с правами `video`+`wall`. Работает, но серая зона ToS.

5. **ВАЛИДАЦИЯ (live, 2026-06-15):** Kate Mobile токен подтверждён (`users.get` ок).
   НО `shortVideo.create` (Клипы) с ним → ошибка `3 "Unknown method passed"` —
   **clips-методы скрыты от стороннего app_id**, доступны токену **официального
   приложения VK** (`client_id 2274003`). Следствие:
   - **`Video (Post)`** (`video.save`+`wall.post`) — работает с Kate Mobile ✅
   - **`Clips`/`Both`** (`shortVideo.create`) — нужен официальный VK-токен (серее,
     капризнее, под вопросом anti-abuse) — проверяем отдельно.

---

## Три реальных пути авторизации

| Путь | Видео в группу | Истечение токена | Легальность | Сложность кода |
|------|----------------|------------------|-------------|----------------|
| **A. Community token** | ❌ (video scope закрыт) | ∞ не истекает | ✅ официально | минимум (вставка токена) |
| **B. User token (Kate Mobile)** | ✅ работает | долго (refresh) | ⚠️ серая зона | средняя |
| **C. Standalone + запрос wall** | ✅ работает | зависит | ✅ официально | средняя + ⏳ ожидание |

### Для ВИДЕО-автопостинга (основная цель проекта)
Чистый community-token путь **не закрывает видео**. Реалистично нужен
**пользовательский токен с scope `video`** (путь B или C):

```
1. video.save(group_id=X, name=...) → upload_url   [нужен user token c video]
2. POST файла на upload_url                          [прямая загрузка]
3. wall.post(owner_id=-X, from_group=1,              [wall scope]
             attachments=video{-X}_{id}, message=...)
```

### Хранение токена (упрощено относительно OAuth-плана)
- Путь A/B: пользователь **вставляет готовый токен** в настройках плагина —
  WebView OAuth-flow и refresh-логика НЕ нужны (токен сообщества не истекает).
- Путь C: возможен полноценный OAuth, если VK одобрит Standalone.

### Параметры доступа (scopes) — для пользовательского токена

| Scope | Что даёт | Доступность |
|-------|----------|-------------|
| `video` | Загрузка видео + управление | ✅ в OAuth (user token) / ❌ community |
| `wall` | Постинг на стену | ⚠️ gated для user / ✅ в community |
| `groups` | Работа с сообществами | ✅ |
| `offline` | refresh_token (иначе ~1 день) | ✅ |

---

## РЕШЕНИЕ: Гибрид B + C (выбрано 2026-06-15)

**Строим на пути B (пользовательский Kate Mobile токен) сейчас**, параллельно
запускаем путь C (официальный запрос) фоном. Когда/если VK одобрит — переключаемся.

### Путь B — получение токена (проверено, работает в 2026)
- **VK Admin токены отключены с апреля 2026**, но **Kate Mobile токен живёт**.
- Implicit flow через `oauth.vk.com/authorize`:
  ```
  https://oauth.vk.com/authorize?
    client_id={KATE_MOBILE_APP_ID}
    &scope=video,wall,groups,offline,photos,docs
    &response_type=token
    &redirect_uri=https://oauth.vk.com/blank.html
    &display=mobile
    &v=5.199
  ```
- Со scope `offline` → токен **постоянный** (не истекает годами) → refresh НЕ нужен.
- Токен формата `vk1.a.*` достаётся из URL после логина (фрагмент `#access_token=...`).
- Инвалидируется только при смене пароля / «завершить все сеансы».
- **Получение токена — две фазы:**
  - *Сейчас (тест):* вручную копируем токен из URL (`scripts/vk-validate.mjs auth-url`).
  - *В продукте:* кнопка «Добавить аккаунт» → встроенное Tauri-окно с логином VK →
    человек логинится → приложение **само перехватывает** `access_token` из
    `blank.html#access_token=...` (событие навигации WebView) → сохраняет и
    привязывает к имени аккаунта → окно закрывается. Конечный (неподготовленный)
    пользователь НЕ видит URL/токен — только «вошёл → готово».
  - В ноде выбирается **аккаунт по имени**, токен подставляется автоматически.
  - UX одинаков для Kate и официального токена (разница лишь в `client_id`).

- **Стратегия токена:** официальный VK-токен — надмножество (Клипы + видео).
  Если подтвердится на `shortVideo.create` → используем ОДИН официальный токен
  на все три режима. Kate — запасной (без Клипов). *Подтвердить на тесте.*

### Путь C — официальный запрос (фоном, параллельно)
- Зарегистрировать Standalone-приложение (если регистрация доступна).
- Написать в `devsupport@corp.vk.com` с обоснованием: запросить `wall` scope
  (и подтвердить доступ к `video.save`) для своего приложения.
- При одобрении — заменить источник токена на собственный `client_id`.

### Первый шаг реализации (валидация перед кодом плагина)
Прежде чем писать плагин — **вручную проверить весь flow** на своём аккаунте:
получить Kate Mobile токен → `video.save(group_id)` → upload → `wall.post`.
Если видео реально появляется в группе — фундамент подтверждён.

---

## Хранение аккаунтов и токена

**Решение (2026-06-16):** разделение по чувствительности. Главная папка — ОБЛАЧНАЯ,
поэтому секреты туда не кладём; публичную статистику — можно (даже плюс).

- **Статистика (публичные данные — permalink/id/метрики)** → в папке проекта
  (`{project}/options/_post/$MM.$YYYY.jsonl`). Облачный синк тут ПЛЮС: статистика
  путешествует с контентом между машинами сама.
- **Токен + метаданные аккаунта (секрет, привязан к человеку)** → НЕ в облаке,
  в локальном app-data, сегментировано по главной папке И ПЛАТФОРМЕ:
  `~/Library/Application Support/<app-id>/accounts/<mainFolderName>/<platform>.json`
  (напр. `vk.json`, `instagram.json`) — **массив аккаунтов** этой платформы.
  - файл привязан к платформе → плагин читает свой `<platform>.json` напрямую;
  - токен лежит **plaintext** в записи (простота + переносимость; ужесточение —
    позже, за абстракцией `TokenStore`, без правок плагина);
  - переносимо: скопировал папку `accounts/` на другой комп → данные там;
  - сегментация по `mainFolderName` → аккаунты разных людей не смешиваются; внутри
    записи дублируем `mainFolderPath` (страховка от совпадения имён) — дропдаун в
    ноде фильтруется по нему;
  - нода знает свою главную папку из пути флоу `.../mainFolder/projectName`
    (`mainFolderName = basename(dirname(projectPath))`);
  - в будущем → сайт (`FileTokenStore` → `RemoteTokenStore`, файлы уйдут; папка
    `options/` проекта на сайте скрыта от юзера).

```json
// accounts/<mainFolderName>/vk.json — МАССИВ аккаунтов платформы:
[{
  "name": "my_vk_account",
  "platform": "vk",
  "tokenSource": "vk.com",        // "vk.com" (client_id 6287487) | "kate_mobile" | "own_app"
  "accessToken": "vk1.a_...",     // plaintext, постоянный (offline scope) — refresh не нужен
  "userId": 123456789,
  "mainFolderName": "person_A",       // для папки/отображения
  "mainFolderPath": "/.../person_A",  // настоящий ключ фильтрации (имена могут совпасть)
  "targetType": "group",          // "profile" | "group"
  "targetId": 987654321,          // user_id или group_id (БЕЗ минуса; минус добавляем при вызове)
  "groupName": "My Group",        // отображение в UI если group
  "addedAt": 1750000000           // когда токен сохранён (для диагностики инвалидации)
}]
```

**Абстракция `TokenStore`** (бэкенд подменяемый — сегодня файл, завтра сайт):
```ts
interface TokenStore {
  list(mainFolder: string, platform: string): Promise<AccountMeta[]>;            // без токенов
  getToken(mainFolder: string, platform: string, name: string): Promise<string>;
  save(mainFolder: string, platform: string, account: AccountWithToken): Promise<void>;
  remove(mainFolder: string, platform: string, name: string): Promise<void>;
}
// сейчас: FileTokenStore → команды account_save/list/get_token/delete (App Support)
// потом:  RemoteTokenStore (запрос к сайту) — публикатор не меняется
```

> При постинге в группу: `owner_id = -targetId`, `from_group = 1`.
> При постинге в профиль: `owner_id = userId`, `from_group` не нужен.

---

## Структура файлов плагина

```
plugins-dev/autoPostVK/
├── plugin.json
├── ui.json
├── autoPostVK.ts         ← основная логика
├── _token.ts             ← TokenStore (file/App Support) + валидация токена
├── _videoCheck.ts        ← ВАЛИДАЦИЯ под VK (ffprobe); не прошёл → errors/
└── _publisher.ts         ← video.save + upload + wall.post логика
```

### plugin.json

```json
{
  "id": "autoPostVK",
  "name": "Auto Post VK",
  "version": "0.1",
  "apiVersion": 1,
  "type": ["nodeui", "processing"],
  "main": "autoPostVK.js",
  "ui": "ui.json",
  "resourcePool": "online",
  "cost": "1",
  "costUnit": "run"
}
```

### ui.json (нода в графе)

| Поле | Тип | Назначение | Обязательный |
|------|-----|-----------|-------------|
| `inputFile` | `link` (video) | Видео для загрузки | Да |
| `account` | `ddm` | `#vkAccounts` (из главной папки) + «Add New Account» | Да |
| `mode` | `ddm` | Режим: Both / Clips / Video | Да (default: Both) |
| `description` | `link` (text\|string) | Текст поста; пусто = без описания | Нет |
| `interval` | `timecode` | Шаг между постами (App-timer) | Да |
| `daysOfWeek` | `autocomplete` | Дни недели (фикс. список); пусто = все дни | Нет |
| `window` | `timeRange` (НОВЫЙ) | Окно суток, dual-slider 00:00–24:00 `[startMin,endMin]` (def. весь день) | Нет |
| `order` | `ddm` | Порядок: by Time (mtime) / by Name / Random (def. by Time) | Нет |

**Режимы (label → внутренний ключ → поведение):**
- **`Clips (reels)`** → `clip` → `shortVideo.create` `wallpost=0` → только лента Клипов
- **`Both (Post + Reels)`** → `both` → `shortVideo.create` `wallpost=1` → Клипы **и** дубль в ленте (1 upload)
- **`Video (Post)`** → `video` → `video.save` + `wall.post` → обычное (не-клип) видео на стене

---

## Требования к видео

VK принимает видео широко, но рекомендует:

| Параметр | Значение |
|----------|----------|
| **Формат контейнера** | MP4, WebM, MOV |
| **Видео кодек** | H.264, H.265 |
| **Аудио кодек** | AAC, MP3 |
| **Разрешение** | 240p–4K (адаптивно) |
| **Соотношение сторон** | Любое (адаптивно в ленте) |
| **Максимальный размер** | 2 GB |
| **Длительность** | До 10 часов (в теории; практика — до 60+ мин в нормальном качестве) |
| **Битрейт видео** | 500 kbps–50 Mbps |
| **FPS** | 24–60 |

Таблица выше — для режима **`video`** (обычное видео, требования свободные).

**Режим `clip` (Клипы, аналог Reels) — требования жёсткие:**
- Соотношение: **вертикаль 9:16** (обязательно, иначе не попадёт в ленту Клипов)
- Длина: 15 сек – 3 мин
- Вес: до 100 MB

**Проверка (решение 2026-06-16): НЕ конвертируем — пользователь готовит файл сам.**
`_videoCheck.ts` (ffprobe) валидирует под режим:
- режим `clip`/`both` → 9:16 + ≤3 мин + ≤100 MB; не подходит → `move_to_errors` (errors/)
- режим `video` → мягко (контейнер / ≤2 GB); не подходит → errors/
Никакого crop/pad — просто гейт.

---

## VK API Flow — три режима

Плагин ветвится по полю `mode`:
- **`Clips (reels)`** (`clip`) → `shortVideo.create` (`wallpost=0`) — только лента Клипов
- **`Both (Post + Reels)`** (`both`) → `shortVideo.create` (`wallpost=1`) — Клипы + дубль в ленте (1 upload)
- **`Video (Post)`** (`video`) → `video.save` + `wall.post` — обычное видео в ленте/видеотеке

Режимы `Clips` и `Both` используют один и тот же flow `shortVideo.create`,
отличаются только параметром `wallpost`.

---

## РЕЖИМ `clip` — Клипы (shortVideo.create)

### Step 1: Создать клип и получить upload_url

```
POST https://api.vk.com/method/shortVideo.create?
  access_token={user token c video+wall}
  v=5.199
  description={caption + хештеги}
  file_size={размер файла в байтах}
  wallpost={1|0}        // 1 = продублировать в ленту
  group_id={id}         // опц., если клип от лица сообщества

Ответ:
{
  "owner_id": 123456789,    // или -group_id
  "video_id": 456789,
  "upload_url": "https://..."   // быстро истекает — грузить сразу
}
```

### Step 2: Загрузить файл на upload_url

```
POST {upload_url}
Content-Type: multipart/form-data; boundary=...
  поле file = видео, Content-Type: video/mp4
  (user-agent желательно «живой»)

→ клип публикуется в Клипы (отдельного publish-шага нет)
```

### Ссылка
`https://vk.com/clip{owner_id}_{video_id}` (構ируем из owner_id+video_id).

### ⚠️ Готчи режима clip (подтвердить на валидации)
- Ошибка `403 "Can't get file item containing data"` при неверном формате multipart —
  загрузка клипов капризна (точный формат поля/boundary, иногда без поля `data`).
- `upload_url` живёт недолго — между Step 1 и Step 2 минимум задержки.
- Комментарии у API-клипов по умолчанию **выключены** (`shortVideo.edit` их не включает).
- Видео обязано быть вертикальным 9:16, ≤ 3 мин — иначе отклонит/не попадёт в ленту Клипов.

---

## РЕЖИМ `video` — обычное видео (video.save + wall.post)

### Step 1: Получить upload URL (video.save)

```
GET https://api.vk.com/method/video.save?
  access_token={token}
  v=5.199
  name=Название видео
  description=Описание
  is_private=0  (или 1, если приватное)

Ответ:
{
  "upload_url": "https://upload.video.vk.com/...",
  "video_id": 123456789,
  "owner_id": -987654321,  // Если в группу; если личный профиль — положительный
  "title": "..."
}
```

**Параметры `video.save`:**
- `name` (обязательный) — название видео
- `description` (опциональный) — описание
- `wallpost` (bool) — нужно ли постить на стену сразу? (обычно `false` — постим через `wall.post`)
- `group_id` (опциональный, число) — если постим в группу, её ID

### Step 2: Загрузить видео на upload_url

```
POST {upload_url}
Content-Type: multipart/form-data

[бинарные данные видео файла]

Ответ:
{
  "server": 123,
  "video_id": 123456789,
  "hash": "abc123def456"
}
```

Это долгая операция — файл может грузиться минуты (VK асинхронно обрабатывает).

### Step 3: Опубликовать на стену (wall.post)

**Если пост сразу (`publishNow: true`):**
```
POST https://api.vk.com/method/wall.post?
  access_token={token}
  v=5.199
  owner_id={user_id или -group_id}
  attachments=video{owner_id}_{video_id}
  message={caption}

Ответ:
{
  "post_id": 123456789
}
```

**Если отложено (`publishNow: false`, задана `publishDate`):**
```
POST https://api.vk.com/method/wall.post?
  ...
  publish_date={unix_timestamp}
  
Пост будет опубликован в указанное время VK автоматически.
```

**Для группы:**
```
attachments=video{-group_id}_{video_id}
owner_id=-{group_id}  // Минус обязателен!
```

### Step 4: Получить ссылку (опционально)

После публикации ссылка: `https://vk.com/wall{owner_id}_{post_id}`

---

## Статистика постинга

**Решение (2026-06-16):** истина живёт РЯДОМ С КОНТЕНТОМ, формат — **JSONL**
(append-only), файлы разбиты ПО МЕСЯЦАМ для ограничения blast-radius.

- **Источник истины — помесячные логи в проекте:** `{project}/options/_post/{$MM}.{$YYYY}.jsonl`
  (напр. `06.2026.jsonl`; одна JSON-запись на строку, поле `platform` — VK/Instagram вместе).
  Месяц берётся из даты публикации (`publishedAt`, иначе `ts`).
- **Зачем по месяцам:** повредился файл — теряется максимум один месяц, а не вся
  статистика; плюс ограничивает размер. Имя — через существующую маску `$MM.$YYYY`.
- **Почему JSONL, а не JSON-массив:** постинг = append-only поток. Дописать = open(append)
  + одна строка (без read-modify-write). Оборванная последняя строка теряет максимум одну
  запись. JSON-массив пришлось бы перечитывать/пересобирать целиком и рисковать всем
  файлом при обрыве.
- **Запись — это УКАЗАТЕЛЬ, не снимок метрик.** Поля: `file` (ключ дедупа), `project`,
  локаторы (`permalink`, `ownerId`, `videoId`/`postId`), `ts` (записано), `publishedAt`
  (когда опубликовано/запланировано — для разбивки по дням), контекст
  (platform/account/mode/target/status). Просмотры/лайки НЕ кэшируем — тянем живьём по
  клику (`video.get`/`wall.getById`; токен из App Support, в логе его нет).
- **`project`** дублируем в запись (выводится из имени папки, но так дешевле при сводках).
- **Размер:** запись ~0.3 КБ; даже 10 000 записей = ~3 МБ — для чтения/парсинга не
  проблема. При помесячной разбивке столько в одном файле и не накопится.
- **Дедуп — локальный:** читаем ВСЕ `*.jsonl` в `_post/` этого проекта, ищем по `file`
  (репост мог быть в файле прошлого месяца).
- **Страница статистики проекта** = прочитать `_post/*.jsonl` → группировка по дням из
  `publishedAt` → по клику подтянуть свежие метрики живьём.
- **Сводка по всем проектам человека (rollup)** = обойти папки проектов, слить логи,
  сгруппировать. Станет медленно → производный кэш в App Support (НЕ сейчас).
- **На будущее (опц.):** историю метрик — теми же JSONL-строками (снимки
  `{"type":"metrics",...}`), читать сворачивая по последнему.

```jsonl
{"ts":1750000100,"publishedAt":1750000100,"project":"projectA","platform":"vk","account":"my_vk_account","file":"video_1.mp4","mode":"both","ownerId":-987654321,"videoId":456239109,"postId":279,"permalink":"https://vk.com/clip-987654321_456239109","status":"published"}
{"ts":1750003200,"publishedAt":1750003200,"project":"projectA","platform":"vk","account":"my_vk_account","file":"video_2.mp4","mode":"video","ownerId":-987654321,"videoId":456239110,"postId":280,"permalink":"https://vk.com/wall-987654321_280","status":"published"}
```

Дедуп: плагин читает `_post/*.jsonl` проекта — если `file` уже есть, пропускает.

---

## Обработка ошибок и retry

| Ошибка | Поведение |
|--------|-----------|
| Токен инвалидирован (смена пароля / сброс сессий) | `sendToMW('error')`, просим вставить новый токен (refresh для Kate Mobile невозможен) |
| Видео не прошло конвертацию ffmpeg | throw → `errors/` папка |
| API 429 (rate limit) | Retry ×3 с задержкой 10/30/60 сек |
| `video.save` вернул ошибку (неверные параметры) | throw с описанием ошибки VK |
| Upload на `upload_url` timeout (>10 мин) | throw |
| `wall.post` не прошёл (группа заблокирована и т.п.) | Логируем в stat как `status: "failed"` с описанием |
| Файл уже запощен | Пропускаем, возвращаем существующий permalink |

---

## Управление токенами

**Путь B (Kate Mobile + offline scope):** токен **постоянный** — refresh-механизм НЕ нужен.
Перед вызовами достаточно лёгкой проверки валидности (например, `users.get`):
- Если токен ещё жив → работаем.
- Если VK вернул ошибку авторизации (5 / 1116 и т.п.) → токен инвалидирован
  (смена пароля / «завершить все сеансы») → `sendToMW('error')`, просим вставить новый.

**Путь C (own app):** возможен полноценный OAuth с refresh — добавим при переключении.

---

## Приоритет реализации

```
[✓] Валидация всех 3 режимов — СДЕЛАНО live (токен vk.com 6287487).
[A] Фундамент — аккаунты + токен:
      • [✓ СДЕЛАНО 2026-06-16] Rust-команды (specta) account_save/list/get_token/delete
        (параметр platform): App Support accounts/<mainFolderName>/<platform>.json —
        массив аккаунтов платформы (plaintext токен; list — БЕЗ токена; санитизация
        имён). bindings.ts перегенерирован.
      • FileTokenStore (TS-обёртка над командами + рантайм-кэш) — TODO
      • [✓ СДЕЛАНО 2026-06-16, нужен live-тест] WebView-перехват токена:
        vk_auth_open (окно oauth.vk.com + init-script) → vk_auth_capture
        (событие `vk-auth-result` + закрытие) + валидация vk_validate_token
        (users.get через reqwest, server-side). client_id 6287487.
      • UI — В НАСТРОЙКАХ НОДЫ (НЕ в настройках программы): выбрать существующий /
        добавить новый / удалить аккаунт. Нода знает свою главную папку → фильтрует
        аккаунты по ней, оттуда же берёт токен при постинге.
      ↓  итог: аккаунт заводится в ноде и привязан к её главной папке
[B] Скелет плагина:
      plugin.json + ui.json (mode/inputFile/account/caption/publishNow/publishDate)
      + autoPostVK.ts-диспетчер; дропдаун аккаунтов фильтруется по mainFolderPath
      ↓
[C] Публикатор — ВСЕ 3 РЕЖИМА СРАЗУ:
      • _videoPrep: video→нормализация при необходимости; clip/both→9:16/≤3мин/≤100MB
      • _publisher ветка video:     video.save → upload → wall.post
      • _publisher ветка shortVideo: create → upload → ждать ~80с → edit → publish (wallpost 0/1)
      • запись в {project}/options/_post/$MM.$YYYY.jsonl (помесячно) + дедуп по file; permalink в выход
      ↓
[E] Полировка: страница статистики проекта (читает _post/*.jsonl; метрики живьём
      video.get/wall.getById). Опц. позже: история метрик, rollup-кэш в App Support.
[bg] (фоном) офиц. запрос в devsupport@corp.vk.com на доступ к shortVideo для своего app
```

---

## Что нужно перед началом

- [ ] Иметь права администратора в целевой группе VK (для постинга от сообщества)
- [ ] Получить **пользовательский Kate Mobile токен** со scope `video,wall,groups,offline`
      (через встроенный WebView или `vkhost.github.io`)
- [ ] Узнать `group_id` целевой группы
- [ ] **Вручную прогнать flow** (шаг [0]) до написания кода плагина
- [ ] (фоном, путь C) подать официальный запрос в `devsupport@corp.vk.com`

---

## Отличия от Instagram-плана

| Аспект | Instagram | VK |
|--------|-----------|-----|
| Загрузка | Нужен публичный URL или resumable upload | Прямая загрузка на `upload_url` |
| Авторизация | OAuth 2.0, требует App Review | Kate Mobile токен (путь B) — серая зона, либо офиц. запрос (путь C) |
| Постинг в группы | Нет (только бизнес-профиль) | Да, с отдельным `group_id` |
| Отложенная публикация | Есть, но требует отдельного эндпоинта | Встроена в `wall.post` как `publish_date` |
| Token lifetime | 60 дней (access), infinity (refresh) | Постоянный (Kate Mobile + offline scope) — refresh не нужен |
| Требования к видео | Строгие (9:16 для Reels, до 90MB) | Свободные (любое разрешение, до 2GB) |

---

## Статистика по опубликованному клипу/видео (будущая фича)

По сохранённым в `posting_stat` `owner_id`+`video_id` можно периодически опрашивать API
и обновлять метрики.

**Клип / видео — `video.get` (`videos={owner_id}_{video_id}`):**
- ✅ `views` — просмотры
- ✅ `likes.count` — лайки
- ✅ `reposts.count` (+ `wall_count`, `mail_count`) — репосты
- ✅ `comments` — комментарии

**Пост на стене (режим Both, `wall_post_id`) — `wall.getById` (`posts={owner_id}_{post_id}`):**
- ✅ те же метрики для записи в ленте
- ✅ охват — `stats.getPostReach` (для сообществ)

**⚠️ Чего НЕТ в публичном API:** разбивка просмотров по источникам (лента Клипов / стена /
рекомендации) — только суммарные числа. Детальная разбивка есть лишь в VK Studio (UI).

Идея: нода/режим «обновить статистику» — проходит по `posting_stat`, дёргает `video.get`
пачкой, дописывает свежие метрики в запись (с датой среза).

---

## Будущие типы контента (ПОСЛЕ видео — пока не делаем)

Все они — публичный, документированный API (в отличие от приватного `shortVideo`).

| Контент | Как публиковать (методы) | Куда |
|---------|--------------------------|------|
| **Фото** | `photos.getWallUploadServer` → upload → `photos.saveWallPhoto` → `wall.post` с `attachments=photo{owner}_{id}` | стена профиля/сообщества |
| **Пост фото+текст** | `wall.post` с `message` + `attachments` (несколько фото через запятую) | стена |
| **Карточка товара (Market)** | `market.add` (+ `market.getProductPhotoUploadServer` → `market.saveProductPhoto`) | раздел «Товары» сообщества |
| **Альбом фото** | `photos.createAlbum` → загрузка фото → attach | альбомы сообщества/профиля |
| **Истории (Stories)** | `stories.getVideoUploadServer`/`getPhotoUploadServer` → `stories.save` | истории |

Архитектурно ложится так же: отдельные режимы/ноды, общий токен vk.com, запись в `posting_stat`.

---

## Прочие расширения

1. **Раздельные объекты** — вертикальный клип + отдельное горизонтальное видео за один проход
   (режим `both` покрывает обычную потребность одним upload'ом)
2. **Scheduling** — отложенная публикация (`publish_date` в `wall.post`; для Клипов — проверить
   `shortVideo.publish publish_date`)
3. **Multi-group posting** — один файл в несколько сообществ за раз
4. **Cross-posting** — VK + Telegram + др. платформы в одной ноде
