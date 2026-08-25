# Plan: Telegram → GDrive Collector Plugin (`autoTGcollect`)

## Статус
🟢 **ФАЗА 1 (MVP) РАБОТАЕТ** (сверено с кодом 2026-08-24), фазы 2–4 не начаты.

| пункт фазы 1 | состояние |
|---|---|
| [A] Rust: менеджер локального сервера + `tg_get_updates` + `tg_fetch_file` | ✅ команды в `src-tauri/src/commands/tg_commands.rs` (`tg_server_start`/`tg_server_stop`/`tg_server_status`, `tg_get_updates`, `tg_fetch_file`, `tg_base_url`, `tg_cloud_log_out`) |
| [B] раннер `src/PROCESSING/tgCollect/` | ✅ `index.ts` — drain → routing → staging → move в IN |
| [C] врезка в `runProcessing` | 🔧 раннер — да (`runTgCollect(getSignal())` в начале витка, параллельно обработке); **старт/стоп локального Bot API сервера — нет**: команды и настройки `tgServer` есть (UI в `TabPaths.tsx` → `DepsDownloadPanel.tsx`), вызовов из цикла нет. Значит сбор идёт через облачный Bot API с лимитом 20 МБ на скачивание. ⏸ **На паузе (решение 2026-08-24):** врезаем, когда появится свой сервер под локальный Bot API и полученные под него `api_id`/`api_hash`. См. раздел «Инфраструктура: локальный Bot API server» |
| [D] routing map в `findAllFilesForProcess` | ✅ `clearTgRoutes` + `addTgRouteFromProject`, пересборка каждый полный скан; то же в `runProcessingForSingleFolder.ts` |
| [E] нода `autoTGcollect` + синк `tgSearch.json` | ✅ `plugins-dev/autoTGcollect/`, свойство `TgSourceProperty.tsx`, `syncTgSearchSidecar.ts` из единой точки сохранения `saveFlow.ts` |
| [F] живой тест | ❔ не зафиксирован; полноценный прогон (файлы >20 МБ) всё равно ждёт локального сервера — см. [C] |

Зеркало-противоположность [autoPostTG](+TELEGRAM_AUTOPOST_PLAN.md):
тот **постит** из программы в Telegram, этот **собирает** медиа из Telegram в папки проектов.
Отдельный плагин, общий с autoPostTG модуль команд (`tg_commands.rs`).

---

## 🎯 Главная идея

**Бот — это сборщик, а не обработчик.** Его атомарная задача: скачать присланные в
Telegram файлы и положить их в папку `IN` нужного проекта. Дальше всё уже умеет
существующая живая очередь — для неё это просто «в папке появился файл», как от любого
другого источника.

Это **ещё один источник триггера**, в один ряд с «появилась папка / руками / сайт» из
[ARCHITECTURE_DISTRIBUTED.md](ARCHITECTURE_DISTRIBUTED.md). Никакой собственной обработки,
машины состояний обработки, Result-сервиса из исходного дока — всё это у нас уже есть.

---

## Ключевые решения (2026-06-24)

- **Сбор = асинхронный, отдельной задачей.** Не внутри прохода по папкам. Стартует в начале
  витка и крутится **параллельно и обработке (`startProcessing`), и ожиданию (`finalyWating`)** —
  скачивание сетевое, активной обработке не мешает (в отличие от destructive-`triggerCleanup`
  в [runProcessing.ts:83](src/PROCESSING/runProcessing.ts#L83), который потому и живёт только в
  окне ожидания). Дожидается перед новым сканом (`findAllFilesForProcess(true)`,
  [runProcessing.ts:109](src/PROCESSING/runProcessing.ts#L109)) → готовые файлы уже в `IN`,
  подхватываются как обычно. Чем раньше старт — тем больше времени у больших докачек завершиться
  до `await`.
- **Качаем в папку проекта (уровнем выше IN), готовое — мгновенным move в `IN`.**
  Перемещение на одном диске атомарно даже для гигабайтов → сканер никогда не видит
  недокачанный файл. Никакого `.tmp` внутри `IN`, никакого флага у файла.
- **Локальный Bot API server (`--local`) обязателен.** Снимает лимит скачивания 20 МБ
  (→ до 2 ГБ) и в local-режиме `getFile` отдаёт **уже скачанный локальный путь** — HTTP-загрузка
  из TS не нужна, только move. Поднимается локально при старте обработки, гаснет со Stop.
- **Транспорт — long polling (`getUpdates`).** Нет always-on, нет webhook, нет публичного
  адреса. Telegram копит апдейты ≤24 ч → запустил обработку в течение суток → выгреблось всё.
- **Хранилище — GDrive-синк, без Drive API.** Бот пишет в локальную синк-папку, Google Drive
  Desktop сам зальёт. Service account / OAuth не нужны.
- **Конфиг — нода без in/out** в ReactFlow → пишет правила в `options/tgSearch.json` рядом с
  `options.json` (паттерн `folderConfig` из [VISION.md](VISION.md)). Отдельная БД не нужна.
- **Отдельный бот для сбора** (свой токен от @BotFather), НЕ тот же, что у autoPostTG: у каждого
  бота свой `getUpdates`-поток → нет конфликта единственного потребителя.
- **MVP — одиночный файл** (`collect` = конкретный тип, напр. `video`), move в `IN` с тем же именем
  (поле `targetPath`, пусто = оригинал), пометка ✅ на забранном. Чекбокс `deleteAfterDownload`
  (выкл по умолч.): вкл = удалить исходник в TG (`deleteMessage` — тривиально, бот-админ), выкл = ✅.
  `collect:folder` → сессия-визард (мультифайл) — фаза 2. Полей `dest`/`mode` нет: всегда `IN`,
  режим = выбор `collect` (тип vs folder).
- **Дедуп = offset `getUpdates`, не маркеры/удаление.** Telegram отдаёт каждое сообщение один раз
  по `update_id`; offset персистим per-bot. «Граница скачанного» = offset, ведёт сам Telegram —
  маркерные сообщения/удаление для дедупа НЕ нужны (удаление = только опц. UX). Бот постинга не
  мешает: боты не получают сообщений от других ботов (+ фильтр по `from.is_bot`).
- **`tgSearch.json` — отдельный файл-выжимка из ноды, синкается при сохранении флоу.** Сам флоу и
  все ноды как лежали в `options.json`, так и лежат — **из графа ничего не вырезаем**. При
  сохранении смотрим: есть включённая нода tgCollect → пишем `tgSearch.json` из её настроек; ноды
  нет ИЛИ она выключена → удаляем файл (нода в графе остаётся). **Наличие файла = поиск включён**
  (отдельный флаг `active` не нужен). Файл нужен, чтобы сборщик читал выжимку, а не парсил граф.
- **Routing map пересоздаётся каждый скан, не кэшируется** — живёт ровно один проход, как и очередь
  обработки. Само ловит «папку выключили / правила поменяли / ноду удалили».

---

## Архитектура

### Слои

| Слой | Где живёт | Что делает |
|---|---|---|
| **Конфиг-нода** | плагин `autoTGcollect` (`nodeui`, без in/out) | UI правил сбора → пишет `options/tgSearch.json` |
| **Раннер сбора** | core: `src/PROCESSING/tgCollect/` | Глобальная async-задача в окне ожидания: drain `getUpdates` → роутинг → staging → move в IN |
| **Rust-команды** | `src-tauri/src/commands/tg_commands.rs` (уже есть) | старт/стоп локального сервера, `getUpdates`-drain, `getFile`+move, валидация токена |
| **Локальный Bot API server** | дочерний процесс (`telegram-bot-api`) | мост к Telegram, снимает лимит 20 МБ, `--local` отдаёт локальные пути |
| **Хранилище** | GDrive-синк-папка проекта | файлы в `IN`, правила в `options/tgSearch.json` |

### Точка встраивания в цикл

```
runProcessing()                                  // src/PROCESSING/runProcessing.ts
  startTgServer()                                // [NEW] поднять локальный Bot API server
  findAllFilesForProcess(true)                   // + [NEW] собрать проекты с tgSearch.json → routing map
  while (isScanning):
    tgPromise      = runTgCollect(routingMap)    // [NEW] старт сбора: drain TG → staging → move в IN
                                                 //       крутится параллельно обработке И ожиданию
    startProcessing()                            // обработка очереди (скачивание идёт в фоне)
    cleanupPromise = triggerCleanup()            // окно «очередь пуста» (cleanup только здесь — он destructive)
    await finalyWating(waitTime)                 // ждём (3/15 мин) — сбор всё ещё в фоне, если не закончил
    await cleanupPromise; await tgPromise        // дождаться обоих перед новым сканом
    findAllFilesForProcess(true)                 // новый скан подхватит уже перемещённые файлы
  finally: stopTgServer()                        // [NEW] убить сервер на Stop
```

Раннер сбора похож на `triggerCleanup` (фоновая задача, дожидается перед новым сканом), но
стартует **раньше** — в начале витка, а не в паузе: сбор только ДОБАВЛЯЕТ файлы (атомарный move
в `IN`), поэтому безопасен во время обработки; cleanup же удаляет папки → ему можно только в окне
ожидания. Новые файлы, упавшие в `IN` во время текущей волны, в неё не попадают (очередь уже
построена прошлым сканом) — их берёт следующий скан. Гонки нет.

### Поток сбора (один файл, MVP)

```
1. drain getUpdates(offset) — один вызов отдаёт апдейты ВСЕХ чатов бота.
2. для каждого апдейта:
   a. по (chat_id, message_thread_id) найти проект в routing map (из tgSearch.json).
   b. проверить allowed_types; не подходит → пропустить.
   c. getFile(file_id) → локальный путь в рабочей папке сервера (--local уже скачал).
   d. move в staging проекта: <project>/<имя>      (атомарно, тот же диск)
   e. move staging → <project>/IN/<имя>             (атомарно → виден сканеру)
   f. advance offset ТОЛЬКО после успешного move (краш до этого = перекачаем).
3. сохранить offset.
```

Шаги (d)+(e) можно объединить, но staging-в-проекте — твоя явная модель: пока «в полёте»,
файл не в IN; готов — одним move внутрь.

---

## Инфраструктура: локальный Bot API server

Это **единственный новый кусок инфраструктуры**. Одна строка установки на macOS:

```
brew install telegram-bot-api
```

Запуск (дочерний процесс из Rust, как exec/ffmpeg):

```
telegram-bot-api --local --api-id=<API_ID> --api-hash=<API_HASH> --http-port=8081 --dir=<workdir>
```

- `--api-id` / `--api-hash` — **разовые** креды приложения с https://my.telegram.org (это НЕ
  токен бота; берутся один раз под аккаунт владельца). Храним в app-settings.
- `--local` — поднимает лимит до 2 ГБ И заставляет `getFile` возвращать **абсолютный локальный
  путь** к уже скачанному файлу (вместо ссылки на `api.telegram.org/file/...`).
- Бот ходит на `http://localhost:8081/bot<token>/...` вместо `https://api.telegram.org/...`.
- `--dir` (рабочая папка сервера) держать **на том же томе**, что GDrive-синк-папки → move
  из неё в проект атомарен (иначе будет копирование).

Жизненный цикл = жизнь обработки: `startTgServer()` на старте `runProcessing`, `stopTgServer()`
в `finally`. Health-check перед первым `getUpdates`.

> Бонус: тот же локальный сервер чинит и autoPostTG (там гейт 50 МБ на загрузку → 2 ГБ).
> Можно сделать один общий менеджер сервера на оба плагина.

---

## Каналы / темы: форум-супергруппа на клиента

Целевая модель (создаём вручную, потом — авто через MTProto):

- **одна форум-супергруппа на клиента** (имя = имя клиента / главной папки);
- **каждый проект = тема (topic)** внутри неё → поле `thread_id`;
- бот видит, в какую тему пришло сообщение (`message_thread_id`) → раскладывает в нужный проект.

Ограничения Bot API (как в autoPostTG):
- бот **не перечисляет** ни группы, ни темы → выпадающий список тем в ноде набиваем из тех,
  что бот **уже видел в апдейтах** (`tg_discover_channels`-стиль через `getUpdates`) либо
  записали при создании (`createForumTopic` → `message_thread_id`, фаза 3 MTProto).
- бот должен быть **админом** супергруппы (или privacy mode off у @BotFather), иначе обычные
  медиа-сообщения до него не доходят.
- `chat_id` / `thread_id` фиксируем в `tgSearch.json` при настройке ноды (бот «прописывается»
  при первом сообщении из темы).

MVP можно тестировать и на простом канале/группе без тем (`thread_id` пустой).

---

## Конфиг-нода + `options/tgSearch.json`

Нода **без входов и выходов** (отсеивается из графа обработки, т.к. нет коннекта). При
сохранении пишет правила в `options/tgSearch.json` — раннер сбора читает только этот файл,
не разбирая граф.

Поля ноды (MVP):

| Поле | controlType | Назначение | Компонент |
|---|---|---|---|
| `account` | `ddm` (`#tgCollectAccounts`, «Add Bot») | бот сбора (`platform: telegram_collect`) | обобщённый `TgAccountDDM` |
| `target` | `ddm` (`#tgSources`, freeInput) | ОДИН чат-источник; имя выбираем сами; `chatId` резолвится при синке | новый `TgSourceProperty` |
| `collect` | модалка (`collectScheme`) | кнопка → модалка: MVP выбор одного типа; фаза 2 — визард шагов | новый `CollectProperty` (по образцу ConvertEdit/KeyingEdit) |
| `targetPath` | `autocomplete` (`#pathPattern`/`#historyValue(targetPath)`) | имя/паттерн как в любой ноде; пусто = оригинал в `IN` | `ChipAutocompleteProperty` |
| `deleteAfterDownload` | `checkbox` | вкл = удалить исходник в TG; выкл = пометить ✅ (деф. выкл) | `Checkbox` |

Полей `dest` (всегда `IN`) и `mode` (режим = выбор `collect`: тип vs `folder`) — нет.

`tgSearch.json` (источник истины для раннера):

```json
{
  "account": "client_A_collect_bot",
  "chatId": -1001234567890,
  "threadId": null,
  "collect": { "type": "video" },
  "targetPath": "",
  "deleteAfterDownload": false
}
```

---

## Сессионный сбор: компонент-визард (дизайн фазы 2)

> Реализуем в фазе 2. Дизайн фиксируем сейчас, т.к. конфиг должен выражать **произвольный**
> сценарий — заранее не известно, что и в каком количестве понадобится.

В ноде сессия включается выбором **`collect: folder`** → раскрывается **компонент-визард** (новый,
фаза 2), которым проектируешь шаги. Конкретный тип в `collect` = простой stream.

**Принцип:** «несколько файлов в одну задачу» = всегда **session** (альбом — частный случай, где
элементы пришли разом). Один движок шагов, два входа:

- **Новый сбор** — создаём staging `IN/-<taskName>/`, проходим шаги, завершаем.
- **Добавить материал** — бот читает все `-`папки в `IN` проекта → выбор одной → показывает её
  содержимое списком → тот же движок шагов → завершаем.

**Концовка — всегда две кнопки:** `Завершить` (оставить `-`, доберём позже) и `Завершить и
запустить` (валидация → снять `-` → следующий скан берёт в работу).

**Визард = это сам конфиг.** Порядок шагов и есть сценарий: бот идёт по шагам и подсказывает, что
слать дальше (снимает вопрос «что вставлять следующим» — следующим идёт то, что следующим шагом в
конфиге). Первый шаг-`field` (имя) = имя `-`папки = имя финального файла. `to` у шага — подпуть
**внутри одной** `-`папки (принцип «один item в IN» цел; «разные папки» = подпапки одной задачи).

**Валидация количеств** — на шаг: тип + оператор + число (`==, >=, <=, >, <`; «не 0» = `>=1`).
Гоняется на `Завершить и запустить` (опц. перепроверка на скане перед снятием `-`). Не прошло →
бот сообщает, чего не хватает.

Пример (123GO3: 2 видео + 1 аудио + 1 текст → один ролик):

```jsonc
{
  "mode": "session",
  "taskName": { "field": "fileName", "prompt": "Назовите финальный файл" },
  "steps": [
    { "id": "vid", "type": "video", "prompt": "Пришлите 2 видео", "to": ".",        "count": { "op": "==", "n": 2 } },
    { "id": "aud", "type": "audio", "prompt": "Пришлите аудио",    "to": ".",        "count": { "op": "==", "n": 1 } },
    { "id": "txt", "type": "text",  "prompt": "Напишите текст",    "to": "text.txt", "count": { "op": "==", "n": 1 } }
  ],
  "finish": ["finish", "finish_and_run"],
  "onCollected": "react"
}
```

Под капотом: всё качается в `123GO3/IN/-intro_v2/...` (с `-` → не берётся); `Завершить и
запустить` → валидация → rename `-intro_v2` → `intro_v2` → следующий скан обрабатывает.
Session-state (что собрано, ответы, текущий шаг) — `_session.json` внутри `-`папки (без БД,
переживает рестарт).

⚠️ Пошаговые вопросы под poll-моделью медленные (ответ ↔ следующий вопрос через 3/15 мин) →
полноценный визард-диалог реально работает только в **webhook-фазе**; до неё session даём через
caption / один структурный текст.

---

## Персистентность `tgSearch.json` (точка стыковки 1)

**Флоу не трогаем.** Весь граф и все ноды, включая tgCollect, как пишутся в `options.json`, так и
остаются — ничего не вырезаем и не вставляем заново. `tgSearch.json` — отдельный маленький файл-
выжимка из настроек ноды, нужен только чтобы сборщик не парсил весь граф на каждом `stat`.

При сохранении флоу (оба пути идут через `commands.saveFlowToOptionsFolder` —
[SaveButton.tsx:105](src/NODE_WIN/layout/SaveButton.tsx#L105),
[TopPanel.tsx:35](src/NODE_WIN/layout/TopPanel.tsx#L35)) проверяем ноду tgCollect:

- нода **есть и включена** (`!data.disabled`) → записать `options/tgSearch.json` из её настроек;
- нода **выключена** (`data.disabled === true`) ИЛИ её **нет** (удалили) → удалить `options/tgSearch.json`
  (нода при этом остаётся в графе как была — выпиливать из флоу не нужно).

«Вкл/выкл» = **существующий флаг `node.data.disabled`** ([types.ts:44](src/NODE_WIN/definitions/types.ts#L44),
тоггл в [NodeHeader.tsx:31](src/NODE_WIN/nodes/components/NodeHeader.tsx#L31), очередь уже исключает
выключенные ноды — [createProcessQueue.ts:45](src/PROCESSING/utils/createProcessQueue.ts#L45)). **Новый
чекбокс НЕ нужен.** Возобновить сбор = снять disable с ноды → Save → файл создаётся заново.

**Наличие файла = поиск включён**, отсутствие = выключен. Отдельного флага `active` внутри файла
не нужно — само существование файла и есть тумблер.

Реализация: общий хелпер `syncTgSearchSidecar(path, flow)` сразу после `saveFlowToOptionsFolder`
в обоих местах (либо в самой Rust-команде — атомарно и без дублирования). Файл всегда
перезаписывается из ноды → рассинхрон невозможен.

---

## Правка сканера: routing map (точка стыковки 2)

Сборщику нужна обратная карта `(chat_id, thread_id) → папка проекта`, собранная со всех активных
проектов. Две тонкости из реального сканера:

**1. Сбор НЕ зависит от IN — идёт всегда.** Не важно, пуст IN, лежат там файлы или папки — сбор
из ТГ запускается на каждом проходе безусловно. Но `findFilesForSingleFolder` возвращается ДО
чтения `options`, если IN пуст ([findFilesForSingleFolder.ts:59-61](src/PROCESSING/findFilesForSingleFolder.ts#L59)),
поэтому **привязывать сбор к нему нельзя** — на пустом IN он бы не сработал. Routing map строим в
**оркестраторе** `findAllFilesForProcess`, в том же цикле по активным проектам
([findAllFilesForProcess.ts:120-146](src/PROCESSING/findAllFilesForProcess.ts#L120)), **полностью
независимо** от IN-гейта. Дёшево: сперва `stat` на `options/tgSearch.json`, читаем+парсим только
если файл есть (у большинства папок его нет → только stat).

**2. Пересоздавать каждый проход — да.** Routing map живёт ровно один скан, не кэшируется.
Причины:
- правила могли поменять во время волны обработки → свежее чтение подхватит;
- папку выключили (ручной off-список или auto-disable) → она `continue`-ится
  ([findAllFilesForProcess.ts:124](src/PROCESSING/findAllFilesForProcess.ts#L124)) → нет записи в
  карте → сбор для неё прекращается сам собой;
- ноду удалили → сайдкара нет → нет записи.

Это в точности логика `findAllFilesForProcess(clearQueue=true)`, который и так пересобирает всю
очередь с нуля каждый цикл. Стоимость — один stat/мелкий read на активный проект.

**Выключенный проект — поиск не ведём (решение юзера).** Любой off (ручной чекбокс ИЛИ
auto-disable) → папка просто игнорируется в цикле
([findAllFilesForProcess.ts:124](src/PROCESSING/findAllFilesForProcess.ts#L124)), сбор для неё не
идёт. Никаких исключений для tgSearch-проектов не делаем. Папка никуда не девается; включил
обратно → routing map на следующем проходе снова её увидит → поиск возобновится **автоматически**
(всё держится на пересборке карты каждый скан, отдельного «перезапуска» не нужно).

Единственный edge (помним, не чиним): проект, который живёт ТОЛЬКО на ТГ-интейке, при тишине в
канале > `autoDisableDays` уйдёт в auto-disable, и присланный позже файл не подхватится, пока
папку не включат вручную. Пока канал регулярно что-то шлёт — собранные файлы рефрешат активность
(`addedCount>0` → `setProjectActivity`), и auto-disable до проекта не дотягивается.

---

## Что реально писать (объём)

| Что | Где | Объём |
|---|---|---|
| Менеджер локального сервера: `tg_server_start/stop/health` | `tg_commands.rs` + `process_utils.rs` | spawn/kill дочернего процесса (по образцу exec/deps) |
| `tg_get_updates(token, offset)` — drain | `tg_commands.rs` | reqwest GET к `localhost:8081` |
| `tg_fetch_file(token, fileId, destPath)` — getFile + move | `tg_commands.rs` | getFile → локальный путь (`--local`) → `fs::rename` |
| `tg_validate_token` (getMe) | `tg_commands.rs` | **уже есть** (autoPostTG) — переиспользуем |
| `tg_discover_channels` (темы из getUpdates) | `tg_commands.rs` | **есть** — расширить на supergroup/topic |
| Раннер сбора: drain → routing → staging → move | новый `src/PROCESSING/tgCollect/` | offset-цикл, dedup, идемпотентность |
| Встройка в цикл (start/stop server + `runTgCollect`) | `src/PROCESSING/runProcessing.ts` | 3 вставки рядом с `triggerCleanup` |
| Сбор routing map (проекты с `tgSearch.json`) | `src/PROCESSING/findAllFilesForProcess.ts` | за тот же проход; `stat` до IN-гейта, пересборка каждый скан |
| Синк/удаление сайдкара при сохранении флоу | хук после `saveFlowToOptionsFolder` (`SaveButton.tsx`, `TopPanel.tsx`) | `syncTgSearchSidecar(path, flow)` — write при наличии ноды, delete при отсутствии |
| Резолв `#tgCollectAccounts` / `#tgSources` | `useResolveOptions.ts` + `HASH_OPTIONS` | по образцу `#tgAccounts` / `#tgChannels` |
| Плагин `autoTGcollect/` (нода-конфиг) | `plugins-dev/autoTGcollect/`: `plugin.json`, `ui.json`, `autoTGcollect.ts` (stub) | `type:["nodeui","processing"]` + stub `main` (обязателен); без связей в очередь не попадёт |
| Модалка `collect` (новый controlType `collectScheme`) | `src/NODE_WIN/nodes/properties/CollectProperty.tsx` + `CollectEdit/` | по образцу ConvertProperty/ConvertEdit; MVP = выбор типа; регистрация в `CONTROL_TYPE_REGISTRY` (палитра pluginBuilder) + ветка в `GenericProperty` |
| `TgSourceProperty` + обобщение `TgAccountDDM` | `src/NODE_WIN/nodes/properties/` | single-select source (по тегу `#tgSources`), платформа account-пикера по тегу |
| `HASH_OPTIONS` += `#tgCollectAccounts`, `#tgSources` | `PluginBuilderWin/types.ts` | чтобы хэши выбирались в pluginBuilder (хэши = только account/source, НЕ collect) |

Хранилище аккаунта бота сбора — как у autoPostTG: `accounts/<mainFolder>/telegram_collect.json`
(токен plaintext в app-data, не в облаке). Offset — рядом, `telegram_collect.offset`.

---

## Дедуп / идемпотентность / ошибки

- **offset** (`update_id+1`) персистится per-bot → `getUpdates` не отдаёт повторно.
  Двигаем offset **после** успешного move (краш до move = перекачаем).
- **Окно 24 ч**: если обработку не запускали >суток — старые апдейты Telegram стёр. Для
  локальной pull-модели приемлемо; для мультифайла-во-времени держим в голове (фаза 2).
- **Недокачанный файл**: `--local` сервер отдаёт путь только когда файл скачан целиком →
  move всегда полного файла. Доп. защита — staging вне IN.
- **Дубликаты апдейтов / медиа-группы**: dedup по `update_id`; `media_group_id` — фаза 2.
- **Сбой move / нет места**: лог + не двигаем offset → ретрай на следующем витке.
- **Большой файл дольше окна ожидания**: docачается на следующем витке (offset не двинут),
  либо move происходит, когда сервер закончил — подхватится следующим сканом.

---

## Готчи Telegram

- **Лимит 20 МБ** на `getFile` у облачного Bot API — снимается ТОЛЬКО локальным сервером.
- **Бот — админ** супергруппы (или privacy mode off), иначе не видит медиа-сообщения.
- **`getUpdates` — один потребитель на бота** → бот сбора отдельный от бота постинга.
- **Окно хранения апдейтов ~24 ч** (short-poll).
- **`--local` + `--dir` на том же томе**, что GDrive-папки → move атомарен.
- **`api_id`/`api_hash`** (my.telegram.org) — отдельно от токена бота, нужны серверу.
- **thread_id**: тема форума определяется по `message_thread_id` в апдейте.

---

## Фазы

```
ФАЗА 1 (MVP): одиночный файл, без вопросов.
  [A] Rust: менеджер локального сервера (start/stop/health) + tg_get_updates + tg_fetch_file.
  [B] Раннер src/PROCESSING/tgCollect/ : drain → routing → staging → move в IN.
  [C] Встройка в runProcessing (старт/стоп сервера + runTgCollect, старт в начале витка).
  [D] Routing map в findAllFilesForProcess (tgSearch.json по активным проектам, безусловно, до IN-гейта, пересборка каждый проход).
  [E] Плагин-нода autoTGcollect (без in/out) + collect-модалка (MVP: выбор типа) + sync/delete tgSearch.json при сохранении (есть+вкл нода → пишем, нет/выкл → удаляем) + резолв #tgCollectAccounts/#tgSources.
  [F] Live-тест: бот-сбор админом темы → кинуть видео >50МБ → появилось в IN → обработалось.

ФАЗА 2: мультифайл-папки (см. «Сессионный сбор: компонент-визард»).
  - session-движок: новый сбор / добавить материал; шаги-визард из конфига; finish / finish_and_run.
  - taskName (первый field) = имя `-`папки = имя финального файла; `to` = подпуть внутри задачи.
  - валидация количеств на шаг (op+n) на finish_and_run (+опц. перепроверка на скане).
  - media_group_id (альбомы) + debounce ~1-2с → частный случай session.
  - флаг `-` у папки + правка сканера; finish_and_run снимает `-`; session-state = `_session.json` в `-`папке.
  - addMaterial: список `-`-папок (inline) → добавить в существующую.
  - интерактив (пошаговые вопросы) — реально только в webhook-фазе; до неё caption/структурный текст.

ФАЗА 3: MTProto (user-сессия).
  - авто-создание форум-супергрупп и тем под клиента/проект (зеркало папок ↔ тем).
  - переименование проекта → новая тема, старую помечаем неактивной.
  - перечисление чатов/тем (Bot API не умеет).

ФАЗА 4: перенос на сайт.
  - polling → webhook на always-on хосте (control plane из ARCHITECTURE_DISTRIBUTED).
  - логика бота не меняется, меняется только способ разбудить.
```

---

## Отложено (помним, не делаем сейчас)

- Интерактивные вопросы / формы (Сценарий B исходного дока) — только для мультифайла, фаза 2.
- Флаг `-` и правка сканера под «файл собирается» — фаза 2.
- media_group_id / debounce / подпапки — фаза 2.
- addMaterial / finish / process-команды — фаза 2.
- Session-визард (taskName, steps, `to`) + валидация количеств по типам (op+n) — фаза 2.
- `onCollected: delete` (удаление исходника) — в UI добавить, по умолчанию выкл.
- MTProto и авто-управление каналами — фаза 3.
- Оптимизация «лишних синхронизаций» GDrive (скачал→залил→удалил→синк) — отдельно, не здесь.

---

## Связь с другими планами

- [ARCHITECTURE_DISTRIBUTED.md](ARCHITECTURE_DISTRIBUTED.md) — этот бот = «второй источник
  триггера» / вход в GDrive-шину; при переезде на сайт становится webhook на control plane.
- [+TELEGRAM_AUTOPOST_PLAN.md](+TELEGRAM_AUTOPOST_PLAN.md) — общий `tg_commands.rs`, общий
  менеджер локального сервера, общий стиль хранения аккаунта; бот сбора ОТДЕЛЬНЫЙ от бота постинга.
- [VISION.md](VISION.md) — `tgSearch.json` = частный случай `folderConfig` (конфиг в папке проекта).
- [TELEGRAM_BOTS_SETUP.md](TELEGRAM_BOTS_SETUP.md) — runbook ручной настройки ботов под клиента/проект
  (супергруппа = клиент, тема = проект) + что чем автоматизируется потом.
```
