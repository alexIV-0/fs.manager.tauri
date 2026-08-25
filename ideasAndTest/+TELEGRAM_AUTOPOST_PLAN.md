# Plan: Telegram Auto-Post Plugin (`autoPostTG`)

## Статус
🟢 РЕАЛИЗОВАНО (2026-06-23) — код написан, компилируется (cargo + tsc 0 ошибок),
плагин собирается. **Live-тест ⏸ НА ПАУЗЕ (решение 2026-08-24):** вживую не гоняли и не гоняем,
пока не появится свой сервер под локальный Bot API и полученные под него `api_id`/`api_hash` —
тогда и прогон. Отсюда же следствие: платформа `'tg'` в `POSTER_PLATFORM`
([`src/PROCESSING/autoPost/posters.ts`](../src/PROCESSING/autoPost/posters.ts)) пока
закомментирована — раскомментировать вместе с прогоном. Отдельный плагин по принципам VK-автопостинга (`autoPostVK`).
Общую логику (расписание/лог/дедуп) сейчас **скопировали**, позже вынесем в общий
модуль `_template/posting/` (решение юзера: «отдельные плагины, объединим потом»).

**Что сделано (файлы):**
- Rust: `commands/tg_commands.rs` (`tg_validate_token`, `tg_get_chat`,
  `tg_discover_channels`) + `account_add_channel` в `account_commands.rs`;
  зарегистрированы в `lib.rs` (specta + generate_handler), bindings перегенерированы.
- Резолв `#tgAccounts` / `#tgChannels` в `useResolveOptions.ts` + `HASH_OPTIONS`.
- UI: `TgAccountDDM.tsx` (вставка токена бота), `TgChannelsProperty.tsx` (мультивыбор +
  «Найти мои каналы» (авто) + «Добавить вручную»); проводка в `GenericProperty.tsx`.
- Плагин `plugins-dev/autoPostTG/`: `plugin.json`, `ui.json`, `autoPostTG.ts`,
  `_publisher.ts`, `_videoCheck.ts`, `_postLog.ts`. Сборка → `distr-plugins/autoPostTG@0.1`.

**Чек-лист live-теста:** создать бота @BotFather → вставить токен (Add Bot) → добавить
бота админом канала → «Добавить канал» (@username) → выбрать каналы → положить ≤50МБ
видео в IN → проверить пост во все каналы + записи в `_post/$MM.$YYYY.jsonl`.

**Принятые решения (2026-06-23):**
- Платформа: **только Telegram-каналы** (бот). Другие платформы — отдельными плагинами позже.
- Постинг в **несколько выбранных каналов** за слот (мультивыбор).
- Расписание — **как у VK** (App-timer: интервал / дни недели / окно суток / order).
- Лимит файла — **гейт по 50 МБ** (как VK: НЕ конвертируем, юзер готовит сам; >50МБ → errors).
- Статистика v1 — **без живых метрик** (логируем permalink + message_id; просмотры
  ботам недоступны, см. раздел «Статистика»).

---

## 🎯 Главный вывод: TG проще VK, кроме одного места

Авторизация — самая выстраданная часть VK (OAuth implicit-flow + перехват токена из
WebView, серая зона Kate Mobile, IP-binding) — в Telegram **почти исчезает**: токен бота
от @BotFather, юзер вставляет строкой, токен постоянный и официальный.

Зато появляется одна неочевидная сложность: **Bot API не умеет перечислять каналы**,
где бот админ → нет аналога `groups.get` → список каналов держим каталогом в аккаунте.

---

## Что переиспользуется из VK (platform-generic)

| Слой | Файл | Состояние |
|---|---|---|
| **Хранилище аккаунтов/токенов** | `account_commands.rs` | ✅ Уже `platform: String`. `platform:'telegram'` → `accounts/<mainFolder>/telegram.json`. **0 правок.** |
| **Лог постинга + дедуп** | `_postLog.ts` | ✅ `PostRecord.platform` есть. Копируем в плагин; добавить опц. локаторы (`chatId`, `channel`, `messageId`). |
| **Планировщик (App-timer)** | гейт в `autoPostVK.ts` | ✅ день/окно/интервал + `order` + дедуп — чистая логика. Копируем. |
| **Мультивыбор** | `autocomplete multiSelect` (как `daysOfWeek`) | ✅ Инфраструктура есть — каналы это `autocomplete` multi. |
| **HTTP/upload** | `_template/tauri` `http.fetch` / `http.upload` | ✅ `upload` принимает `fields:[{field,value}]` рядом с файлами — ровно для `sendVideo`. |
| **colorType/resourcePool** | `posting` / `online` | ✅ Заведены под VK, переиспользуем. |

---

## 1. Авторизация — бот (вместо OAuth)

- «Аккаунт» = **бот** с токеном от @BotFather (формат `123456789:ABC...`).
- Юзер вставляет токен строкой. Никакого OAuth / WebView / перехвата / серой зоны.
- Бот должен быть **администратором** каждого целевого канала с правом `can_post_messages`.
- Валидация токена — новая Rust-команда `tg_validate_token` → `getMe`
  (`{ id, username, first_name }`). Permanent token (до отзыва в BotFather).

UI добавления = `TgAccountDDM` (по образцу `VkAccountDDM.tsx`, **проще**: только диалог
вставки токена, без шага «логин в браузере» и без webview-потока).

---

## 2. Каналы — каталог в аккаунте (нет API-перечисления)

⚠️ Бот не может получить список своих каналов. Поэтому:

- Юзер добавляет канал по `@handle` или числовому `id` → валидируем:
  - `getChat(chat)` → резолвит `{ id, title, username, type }` (бот должен «видеть» чат);
  - `getChatMember(chat, botId)` → подтверждает `status:'administrator'` + `can_post_messages`.
- Сохраняем `{ id, title, username }` в `channels[]` аккаунта (`telegram.json`).
- В ноде поле `channels` = `autocomplete` `multiSelect:true`, `options:["#tgChannels"]`
  (тянется из каталога выбранного аккаунта). Обёртка `TgChannelsProperty` добавляет
  «Найти мои каналы» (авто) + «Добавить вручную» → диалог ввода handle → валидация → upsert в каталог.
- **Значение ноды = ЧИТАЕМОЕ имя канала (title), НЕ chat_id** (решение 2026-06-23: при
  множестве каналов `-100…` нечитаемо). `#tgChannels` отдаёт `title`; chat_id плагин
  резолвит из каталога (`account_list`) при постинге, незнакомое имя = сырой chat_id
  (ручной ввод/сменившийся title). Каверзы: одинаковые title → коллизия в маппинге;
  сменили title в TG после выбора → перевыбрать (re-discover обновит каталог по id).
- ✅ **Авто-обнаружение (РЕАЛИЗОВАНО, основной путь UX):** кнопка «Найти мои каналы» →
  `tg_discover_channels(token)` дёргает `getUpdates`, собирает каналы из `my_chat_member`
  (бота добавили админом) и `channel_post`, проверяет право постить и **сам заносит в
  каталог + выбирает** — пользователю не нужен chat_id. Кнопка «Добавить вручную»
  (`@username`/id) — fallback. Окно хранения updates ~24ч (short-poll) — юзер добавляет
  бота админом и сразу жмёт «Найти».

**Модель бота (решение 2026-06-23): БОТ НА ПОЛЬЗОВАТЕЛЯ.** Каждый юзер создаёт своего
бота (@BotFather, ~2 мин, разово) → его `getUpdates` изолирован, авто-поиск показывает
только его каналы. Общий бот на всех ОТВЕРГНУТ для авто-поиска: `getUpdates` глобален
для бота (выдал бы чужие каналы + конфликт одного потребителя + токен = доступ ко всем
каналам). «Общий бот максимально просто» возможен только с центральным бэкендом
(webhook + роутинг по владельцу) — это будущая распределённая архитектура, не сейчас.

Команды: `tg_get_chat(token, chat)` (getChat + getChatMember) → `{ id, title, username,
canPost }`; `tg_discover_channels(token)` → `[{ id, title, username, canPost }]`.

---

## 3. Хранение аккаунта (`accounts/<mainFolderName>/telegram.json`)

Массив ботов (как у VK — массив аккаунтов платформы). Секрет в локальном app-data, НЕ в
облачной главной папке. Токен plaintext (простота + переносимость, как у VK).

```json
[{
  "name": "My Channel Bot",          // botUsername или кастомное имя
  "platform": "telegram",
  "tokenSource": "botfather",
  "accessToken": "123456789:ABC...", // bot token, plaintext, постоянный
  "botId": 123456789,
  "botUsername": "my_channel_bot",
  "mainFolderName": "person_A",
  "mainFolderPath": "/.../person_A",
  "channels": [                      // КАТАЛОГ (нет API-перечисления)
    { "id": -1001234567890, "title": "My Channel", "username": "mychannel" }
  ],
  "addedAt": 1750000000
}]
```

`account_list` уже вырезает `accessToken` из выдачи (каталог `channels` остаётся —
он не секрет). Токен достаётся `account_get_token` только при постинге.

---

## 4. Публикатор — `sendVideo` + переиспользование `file_id`

```
POST https://api.telegram.org/bot<token>/sendVideo
  multipart: video=<file>, chat_id=<@channel|id>, caption=<text>, supports_streaming=true
→ { ok:true, result:{ message_id, video:{ file_id }, chat:{...} } }
```

**Ключевая оптимизация для мультиканала: грузим файл ОДИН раз.**
- Первый канал = реальная загрузка через `http.upload`
  (`files:[{field:'video',path,mime:'video/mp4'}]`,
   `fields:[{field:'chat_id',...},{field:'caption',...},{field:'supports_streaming',value:'true'}]`).
- Из ответа берём `result.video.file_id`.
- Остальные каналы = `http.fetch` POST (form-urlencoded, как `vkApi`) с `video=<file_id>` —
  **без повторной загрузки**. Для N каналов: 1 upload + (N−1) лёгких вызовов.

permalink:
- публичный канал: `https://t.me/<username>/<message_id>`;
- приватный: `https://t.me/c/<internalId>/<message_id>` (из `chat.id` убрать префикс `-100`).

**Поле `sendAs` (опц., default `Video`):**
- `Video` → `sendVideo` (стримится в клиенте, TG может перекодировать).
- `Document` → `sendDocument` (оригинал без перекодирования, без in-app стрима).
  Поле `document` вместо `video`, `file_id` берём из `result.document.file_id`.

---

## 5. Расписание / дедуп (как VK, поправка на мультиканал)

- Гейт день/окно/интервал + `order` + дедуп по `file` — копия логики `autoPostVK.ts`.
- Нет нативного отложенного постинга у Bot API → **App-timer обязателен** (как VK).
- **Один слот = один файл → постим во ВСЕ выбранные каналы.**
  - Дедуп по `file`: файл «закрыт», когда ушёл в каналы этого слота.
  - В лог — **по строке на канал** (для permalink'ов/метрик).
  - Частичный провал (C2 упал, C1 ок): грузим один раз, рассылаем; упавшие каналы
    логируем `status:"failed"`, файл всё равно считаем обработанным (ретрай упавших — потом).

---

## 6. Требования к видео + гейт (50 МБ)

`_videoCheck.ts` (ffprobe) — мягкий гейт под Telegram:

| Параметр | Значение |
|---|---|
| Контейнер | MP4 (рекоменд.), MOV/WebM |
| Видео кодек | H.264 (для in-app preview/стрима) |
| Аудио | AAC |
| **Размер** | **≤ 50 МБ** (Bot API) — >50МБ → `errors/`, берём следующий |

НЕ конвертируем (решение: как VK). Опц. сжатие под 50МБ — отдельным этапом позже
(у юзера есть convert-инфраструктура).

> 2 ГБ возможны только через self-hosted `telegram-bot-api` сервер (api_id/api_hash +
> бинарь) — отложено, тяжело для v1.

---

## 7. Статистика — просмотры по permalink (без MTProto)

⚠️ **У ботов НЕТ счётчика просмотров через Bot API.** `sendVideo` отдаёт только `message_id`.
НО для **публичных** каналов метрики достаём по той же ссылке, что и логируем:

**Путь v1 — парсинг embed-виджета (по клику, как «метрики живьём» у VK):**
```
GET https://t.me/<username>/<messageId>?embed=1&mode=tme   (через Rust http.fetch, без CORS)
```
В HTML:
- `<span class="tgme_widget_message_views">1.2K</span>` → **просмотры** (👁) — надёжно;
- `tgme_widget_message_reactions` → счётчики реакций (если включены) — как повезёт;
- `<time datetime="…">` → дата поста.

**Оговорки:**
- **Только публичные каналы** (с `@username`). Приватные (`t.me/c/…`) веб-превью не имеют.
- Числа **округлённые** («1.2K», «15.3K»), не точные.
- Парсинг HTML → хрупко к смене вёрстки TG (данные публичные, но не офиц. API).
- По клику + кэш, не дёргать массово.

**Путь «будущее» — MTProto** (`channels.getMessages` → `Message.views`; охват
`stats.getBroadcastStats`) через **пользовательскую сессию** (не бот): точные числа +
приватные каналы. Отдельная авторизация (api_id/api_hash + phone) → отложено.

`PostRecord` (доп. поля к существующим): `chatId` (число), `channel` (`@username`/title),
`messageId` (= `postId`). `videoId`/`ownerId` для TG не используются. Из `channel`+`messageId`
восстанавливается embed-URL для подтяжки просмотров.

---

## 8. Что реально писать (объём)

| Что | Где | Объём |
|---|---|---|
| `tg_validate_token` (getMe), `tg_get_chat` (getChat+getChatMember) | новый `src-tauri/src/commands/tg_commands.rs` | 2 крошечных reqwest-GET (по образцу `vk_validate_token`); регистрация в `lib.rs` + specta |
| Резолв `#tgAccounts`, `#tgChannels` | `useResolveOptions.ts` + `HASH_OPTIONS` в `PluginBuilderWin/types.ts` | по образцу `#vkAccounts`/`#vkGroups`; `#tgChannels` — из каталога аккаунта, НЕ live-запрос |
| `TgAccountDDM` + `TgChannelsAutocomplete` (с «Добавить канал») | новые `.tsx` в `NODE_WIN/nodes/properties/` | проще VK (нет webview) |
| Плагин `autoPostTG/` | `plugin.json`, `ui.json`, `autoPostTG.ts`, `_publisher.ts`, `_videoCheck.ts`, `_postLog.ts` | dispatcher + публикатор; `colorType:'posting'`, `resourcePool:'online'` |

**Без новых Rust-команд для постинга** — `sendVideo`/`sendDocument` идут через `http.upload`/
`http.fetch` из TS (как VK-публикатор). `getMe`/`getChat` тоже можно было бы из TS, но для
консистентности с VK (валидация из React UI) делаем Rust-команды.

---

## 9. ui.json — поля ноды «TG aPosting Video»

| Поле | Тип | Назначение | Обяз. |
|---|---|---|---|
| `inputFile` | `link` (video) | Видео для публикации | Да |
| `account` | `ddm` | `#tgAccounts` + «Add Bot» | Да |
| `channels` | `autocomplete` (multiSelect) | `#tgChannels` (каталог аккаунта) + «➕ Добавить канал» | Да (≥1) |
| `caption` | `link` (text\|string) | Текст поста; пусто = без подписи | Нет |
| `sendAs` | `ddm` | Video (стрим) / Document (оригинал), def. Video | Нет |
| `interval` | `timecode` | Шаг между постами (App-timer) | Да |
| `daysOfWeek` | `autocomplete` (multi) | Дни недели; пусто = все | Нет |
| `window` | `valueRange` | Окно суток `[startMin,endMin]`, def. весь день | Нет |
| `order` | `ddm` | by Time / by Name / Random, def. by Time | Нет |

---

## 10. Порядок реализации

```
[A] Rust: tg_commands.rs (tg_validate_token, tg_get_chat) + регистрация + specta bindings.
[B] Резолв-теги: #tgAccounts (accountList platform=telegram), #tgChannels (из каталога).
[C] UI: TgAccountDDM (вставка токена бота) + TgChannelsAutocomplete (мультивыбор + «Добавить канал»).
[D] Плагин autoPostTG: plugin.json + ui.json + dispatcher (копия гейта/дедупа из VK) +
    _videoCheck (≤50МБ) + _publisher (sendVideo: 1 upload → file_id для остальных каналов).
[E] Лог: _postLog.ts (копия; +chatId/channel/messageId) + permalink в выход.
[refactor] Позже: вынести расписание/лог/дедуп в общий _template/posting/ (VK + TG общий).
[bg] Опц.: getUpdates-автообнаружение каналов; MTProto-статистика; self-hosted Bot API (2ГБ).
```

---

## 11. Готчи Telegram (проверить на сборке)

- **50 МБ** — жёсткий потолок Bot API на загрузку файла. Гейт обязателен.
- **Бот — админ канала** с `can_post_messages`, иначе `sendVideo` → `403 forbidden`.
- **chat_id**: публичный = `@username`; приватный = числовой `-100...` (из `getChat`).
- **`file_id` переиспользуется** только в рамках **того же бота** — у нас так и есть.
- **`supports_streaming=true`** для in-app перемотки видео.
- **Rate limits**: ~20 сообщений/мин в один чат, ~30 сообщений/сек суммарно — App-timer
  c интервалами это с запасом покрывает; на пачке каналов за слот учесть `429 retry_after`.
- **Подпись (caption)**: лимит 1024 символа; длиннее — обрезать или отдельным `sendMessage`.
- **parse_mode** (HTML/MarkdownV2) — если в caption разметка; иначе экранировать.

---

## Отличия от VK-плана

| Аспект | VK | Telegram |
|---|---|---|
| Авторизация | OAuth implicit + WebView-перехват, серая зона | Bot token (@BotFather), вставка строкой, официально |
| Список целей | `groups.get` (live API) | НЕТ API → каталог каналов в аккаунте |
| Цель постинга | 1 (Profile/группа) | **N каналов** (мультивыбор) |
| Загрузка | `video.save`→upload→`wall.post` (3 шага) | `sendVideo` (1 шаг) + `file_id` для доп. каналов |
| Лимит файла | 2 ГБ | **50 МБ** (Bot API) |
| Статистика | `video.get`/`wall.getById` (просмотры/лайки) | Бот не даёт; но просмотры публичных каналов — парсингом embed по permalink (точные/приватные — MTProto) |
| Отложка | `publish_date` в API | НЕТ → только App-timer |

---

## Будущее: чаты / супергруппы / форумы (отложено — решение 2026-06-23)

**v1 = ТОЛЬКО каналы.** Постинг в чаты технически возможен, но отложен в идеи.

Что умеет бот (на будущее):
- **Группа / супергруппа** — `sendVideo` работает, бот должен быть **участником** (админ НЕ
  обязателен, в отличие от канала; слать может любой неограниченный участник). Privacy mode
  на отправку не влияет (только на чтение); событие `my_chat_member` при добавлении приходит
  всегда → авто-поиск возможен.
- **Личка (ЛС)** — только если человек **первым написал боту** (`/start`); бот не может сам
  инициировать ЛС.

Что доработать, когда возьмёмся за чаты:
1. **`canPost` ветвить по типу чата.** Сейчас канало-специфично (`administrator` +
   `can_post_messages`). Для группы это неверно — обычный участник постит, а `can_post_messages`
   у него нет (право только каналов). Нужно: канал → creator/(admin+can_post_messages);
   группа → не left/kicked, если restricted → проверить `can_send_messages`/медиа.
2. **Авто-обнаружение.** В `tg_discover_channels` сейчас фильтр `type === 'channel'` — добавить
   `group`/`supergroup` (ловить из `my_chat_member` + `message`/`edited_message`).
3. **Форум-супергруппы (несколько «бесед»/тем).** Если нужно постить в КОНКРЕТНУЮ тему форума —
   у `sendVideo` есть параметр **`message_thread_id`** (id топика). Понадобится: определять, что
   супергруппа = форум (`getChat` → `is_forum`), получать список тем и поле выбора темы в ноде.
   Список топиков через Bot API ограничен → возможно, тоже ручной ввод `message_thread_id` или
   обнаружение из апдейтов.

Публикатор (`sendVideo`) и хранилище менять почти не придётся — `chat_id` группы/супергруппы
работает так же (`-100…`). Уместность: канал = вещание (постинг логичен), группа = разговор
(авто-видео часто воспринимается как спам) — продуктовый выбор.
