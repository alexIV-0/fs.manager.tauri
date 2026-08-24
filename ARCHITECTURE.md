# Архитектура: карта текущего состояния

Этот файл описывает, **из чего программа состоит сейчас**. Он не про планы и не про правила.

Три вида документации в репозитории, не путать:

| файл | отвечает на вопрос | горизонт |
|---|---|---|
| **`ARCHITECTURE.md`** (этот) | из чего состоит, кто чем владеет, где границы | **сейчас** |
| `CLAUDE.md` (корневой + зональные) | как не сломать: команды проверки, грабли, запреты | сейчас |
| `ideasAndTest/*.md` | как должно стать: планы, спеки, runbook'и | **будущее** |

⚠️ Читая `ideasAndTest/`, помни: там описаны в том числе абстракции, которых в коде **нет**. Раздел «Спроектировано, но не существует» в конце этого файла перечисляет их явно.

## Легенда статусов

- ✅ **работает** — в проде, менять осторожно
- 🔧 **в работе** — код есть, дописывается
- ⏸ **отложено осознанно** — решение принято не делать сейчас, причина в плане
- 🎯 **цель** — спроектировано, кода нет

## Что это за программа

Десктопный файловый менеджер и раннер медиа-пайплайнов. Пользователь раскладывает файлы по папкам-проектам, в отдельном окне рисует граф обработки из нод, программа находит подходящие файлы и прогоняет их через граф, дёргая ffmpeg, After Effects, Moho, ИИ-сервисы. Логика каждого шага живёт в плагине.

Стек: Tauri 2 (Rust) + React + TypeScript, четыре окна-webview, IPC через tauri-specta, ~46 тыс. строк фронта и ~20 тыс. строк Rust.

## Порядок чтения для новичка (человека или модели)

1. Этот файл целиком — карта.
2. Корневой `CLAUDE.md` — команды проверки и жёсткие правила.
3. Зональный `CLAUDE.md` той папки, где предстоит работать.
4. `ideasAndTest/UNIFIED_SOURCES_ENGINE.md` — целевая модель ядра, объясняет, почему обработка, автопостинг и сбор устроены похоже.
5. Код нужного пласта. Комментарии в коде здесь содержательные: причины решений объяснены на месте (`src-tauri/src/lib.rs`, `src-tauri/src/storage/mod.rs`, `src/Utils/tauri-api.ts`, `src/NODE_WIN/hooks/useUndoRedo.ts`).

---

# Часть I. Оболочка — четыре окна

Четыре точки входа Vite, четыре webview, **четыре независимых JS-realm'а**. Zustand-сторы между окнами не шарятся; общение — только broadcast-события Tauri. Это первое, что ломает интуицию: «положить в общий стор» здесь невозможно.

У каждой точки входа свой `ErrorBoundary` (`src/Utils/ErrorBoundary.tsx`, обычный DOM без MUI — чтобы экран-откат не зависел от библиотеки, которая могла упасть). Без него непойманная ошибка рендера размонтировала дерево и окно белело молча, а обработка при этом продолжала идти: цикл живёт в MAIN_WIN (полный) и в NODE_WIN (одна папка), и React-размонтирование его не останавливает. Упавшее окно нельзя починить из соседнего — realm'ы разные, поэтому ловушка нужна в каждом.

| окно | точка входа | папка | объём |
|---|---|---|---|
| главное | `src/main.tsx` | `src/MAIN_WIN/` | 87 файлов / ~17 000 строк |
| редактор нод | `src/mainNode.tsx` | `src/NODE_WIN/` | 158 файлов / ~28 000 строк |
| логи | `src/mainLogWindow.tsx` | `src/LOG_WIN/` | 14 файлов / ~1 600 строк |
| превью | `src/mainPreview.tsx` | `src/PREVIEW_WIN/` | 5 файлов / ~800 строк |

## 1. Главное окно ✅

**Границы.** Три колонки файлового менеджера, настройки всей программы, поиск по проектам, конструктор плагинов, UI хранилища. Не исполняет обработку — только запускает её.

**Где код.** `src/MAIN_WIN/`:
- `MainFolderColumn/` — колонка главных папок (корни, которые добавил пользователь)
- `ProjectFolderColumn/` — колонка проектов внутри главной папки + `ProjectStatsModal`
- `FileExplorerColumn/` — колонка файлов, контекстное меню, drag-n-drop, локальная и облачная версии верхней панели (`TopPanelLocal` / `TopPanelGD`)
- `options/` — все настройки: `tabs/` (Main, Nodes, Paths, Types, Storage, панель загрузки зависимостей), `PluginBuilderWin/`, `plugin/`
- `Storage/` — значки, статус синхронизации, панель передач, диалог добавления облачной папки
- `ProjectSearch/` — модальное окно поиска по проектам с облаком плагинов
- `Universal/` — обёртки над MUI, общие для окна
- `hooks/` — контекстное меню, DnD, навигация по колонкам табом

**Где план.** Отдельного нет; относящееся к настройкам папок — `ideasAndTest/+FOLDER_STATE_SSOT_PLAN.md`.

**Связи.** Открывает NODE_WIN, передавая **только путь до папки** (окна почти не связаны). Запускает ядро обработки. Читает и пишет состояние на всех четырёх уровнях (см. часть V).

## 2. Редактор нод ✅

**Границы.** Самый большой пласт. Граф обработки: ноды, рёбра, свойства, валидация, undo/redo, документация нод. Приходит извне только путь до папки, дальше окно живёт само.

**Где код.** `src/NODE_WIN/`: `nodes/` (104 файла, из них `properties/` — 40 компонентов контролов), `hooks/` (21), `utils/` (17), `layout/` (10), `definitions/`, `edges/`.

Ключевое устройство: React Flow 12 в **controlled-режиме**, единственная точка изменений — `onNodesChange`/`onEdgesChange` в `hooks/useFlowActions.tsx`. Ноды не пишутся как React-компоненты: `hooks/useFlowTypes.tsx` отдаёт `GenericNode` для всех типов, кроме `spy`, а состав ноды строится из `ui.json` плагина через `nodes/components/GenericProperty.tsx` (`switch (controlType)`).

**Где план.** `ideasAndTest/PLUGIN_HOST_API_PLAN.md` (движок `controlType` = будущая точка расширения).

**Связи.** Читает список нод из плагинов (Rust `plugin_manager_get_all_ui_nodes` → `src/Utils/loadAllUINodes.ts`). Сохраняет граф в `options.json` папки. Слушает broadcast `plugins-changed`.

**Грабли.** Вынесены в `src/NODE_WIN/CLAUDE.md` — каскад через `setTimeout(0)`, `useUpdateNodeInternals`, мерцание от `box-shadow`, рамка мультивыделения.

## 3. Окно логов ✅

**Границы.** Не «окно, куда стекается текст», а **структурированный протокол событий обработки** с четырёхуровневой иерархией и суточным архивом.

**Где код.**
- фронт: `src/LOG_WIN/` — устройство расписано в `src/LOG_WIN/STRUCTURE.md` (иерархия рендера: главная папка → проект → item → step)
- Rust: секция `LOG WINDOW` в `src-tauri/src/commands/window_commands.rs` — семь emit-команд (`log_window_emit_item_start`, `item_log`, `node_update`, `substep_batch`, `item_queued`, `abort_queued`, `item_end`) плюс история, экспорт, «только ошибки»
- `src-tauri/src/commands/diag_log.rs` — диагностический счётчик событий
- `src-tauri/src/commands/log_archive.rs` — архив по дням, чтение, очистка

**Где план.** Нет.

**Связи.** Единственный потребитель протокола — ядро обработки и раннеры (автопостинг, сбор) через `src/PROCESSING/autoPost/logWin.ts` и аналоги.

## 4. Окно превью ✅

**Границы.** Просмотр медиа и точный кадр для настройки фильтров. **Мульти-инстанс:** окон может быть открыто несколько, реестр живёт в `PreviewWindowState`, label формируется как `preview-{type}-{n}`. Прежняя схема с единственным переиспользуемым окном `previewWin` заменена — код, который адресует «то самое окно превью», устарел.

**Где код.** `src/PREVIEW_WIN/`; Rust — секция `PREVIEW WINDOW` в `window_commands.rs` (`preview_open`, `preview_resize`, `preview_detect_alpha`, `preview_transcode_webm`, `preview_delete_temp`), `commands/preview_commands.rs` (рендер кадра), `commands/preview_bounds.rs` (запоминание геометрии окна по типу и ориентации файла). Общие для превью и экспорта графы фильтров — `src/Utils/ffmpegGraphs/`.

**Где план.** Нет.

**Связи.** Открывается из главного окна и из редакторов фильтров в NODE_WIN. Важное свойство: графы фильтров у превью и у экспорта общие, поэтому превью честное.

**Ограничения WKWebView, которые определили дизайн.** `file://` не работает (нужен `src/Utils/toFileUrl.ts`), `ctx.filter` в canvas — no-op (пиксельные операции в `src/Utils/canvasFilters.ts`), `getImageData` требует `crossOrigin="anonymous"`.

---

# Часть II. Ядро

## 5. Файловые операции ✅

**Границы.** Все операции с файлами и папками, атомарность, безопасность путей. Живут в Rust, фронт только вызывает.

**Где код.** `src-tauri/src/commands/fs_commands.rs` (~1 130 строк, 33 команды): `copy_item`, `move_item`, `delete_item`, `rename_folder`, `test_and_create_folder(s)`, `ensure_and_read_dir`, `recursive_find_files`, `hash_file`, `append_file` (настоящий `O_APPEND`, не read-modify-write), `read_media_preview`, `get_stat`, `set_path_mtime`, шрифты, `shell_open_path`. Фронт-обёртки — `src/PROCESSING/utils/fileSystemActions.ts`, буфер обмена — `src/Store/MainWin/clipboardFs_store.ts`.

**Где план.** Нет.

**Связи.** Основа для всего: обработки, плагинов, хранилища.

**Известное решение.** Drag наружу и между колонками **отключён намеренно** (конфликт нативного drag-плагина с внутренней drop-логикой), файловые операции — горячими клавишами. `src/Utils/dragOut.ts` оставлен, но не подключён к строкам.

## 6. Движок обработки ✅

**Границы.** Найти файлы, собрать объект задачи, прогнать через граф, соблюсти лимиты параллелизма, дать прервать.

**Где код.** `src/PROCESSING/` (31 файл, ~3 700 строк). Цепочка:

```
runProcessing
  ├── findAllFilesForProcess ──► reloadFolders ──► findFilesForSingleFolder
  ├── startProcessing ──► createRunPools ──► processItem
  │                                               ├── findItemAndCreateProps
  │                                               │     └── getNeededPropsFromNode
  │                                               ├── executeFunction ──► collectFilesFromFolderFunc
  │                                               └── loadPlugin ──► resolveCallable ──► вызов плагина
  ├── runTgCollect            (сбор, параллельно обработке)
  └── finalyWating / waitingSome
```

- `utils/createProcessQueue.ts` — превращает граф в очередь шагов; проходит сквозь `spy`-ноды (они не исполняются, но передают связь)
- `ResourcePool.ts` — семафоры по **классу ресурса** (`local` / `online` / `ffmpeg` / `helpers`), не по цвету ноды; лимиты из `src/types/appSettings.ts`, а набор семафоров — **на область**, не на процесс и не на вызов (см. «Полосы прогонов» ниже)
- `utils/processingAbort.ts` + `src-tauri/src/commands/processing_commands.rs` — сигнал прерывания, прогресс, накопление ошибок
- `utils/getDesription.ts` — сборка `_description` (контекст проекта, который получает каждый плагин)

**Полосы прогонов — то, что легко сломать заново.** Раннеров ТРИ: локальная обработка, постинг и режим воркера (задачи из очереди сайта). Кнопки разные, часы разные, работают одновременно. Всё, что у них общее по природе, разделено по **полосе** (`src/PROCESSING/runLanes.ts`: `processing` / `posting` / `worker`):

- сигнал прерывания в TS (`startProcessContext(lane)` / `getSignal(lane)` / `abortNow(lane)` — контроллер на полосу, не на модуль);
- флаг прерывания в Rust (`ProcessingState::lane_flag(lane)`), который опрашивают `exec_command`, `ffmpeg_exec_with_progress` и ожидание `run_script_in_ae`.

**Пулы делятся не по полосе, а по области** (`poolScopeOf`): обработка и воркер сидят в ОДНОМ наборе семафоров, постинг — в своём. Лимиты пулов про железо машины, а не про раннера: `local: 1` («один After Effects за раз») обязан остаться единицей, сколько бы раннеров ни работало. Набор живёт, пока в области есть хоть одна активная полоса (`createRunPools(lane, …)` / `disposeRunPools(lane)`), поэтому конец волны локальной обработки не выбрасывает семафоры из-под воркера. Обратная сторона: шаг воркера может долго ждать слот, поэтому `processItem` шлёт `node:wait` перед захватом — по нему воркер продлевает аренду задачи (иначе её заберёт другая машина, пока эта стоит в очереди).

Полоса — **имя**, а не случайный id: обработка исполняется в realm'е NODE_WIN, кнопка Stop есть и в MAIN_WIN, а окна — разные realm'ы без общего состояния. `ctx.exec`/`ctx.ffmpeg.exec`/`ctx.ae.runScript` привязываются к полосе в `processItem`; сам host остаётся без состояния, поэтому загрузчик по-прежнему кэширует модули плагинов. Пустая полоса = обработка (так зовут старые установленные бандлы). Play в окне нод в разделение полос не входит намеренно: это ручной запуск одной локальной папки в своём realm'е, его семафоры воркеру не видны и общими быть не должны.

Что было до разделения (2026-08-11): процессный `pools.clear()` выбрасывал семафоры вместе с очередью ожидающих, и обработка вставала навсегда; единственный флаг прерывания означал, что стоп обработки убивает Moho и whisper-cli постинга, а постинг после остановленной обработки умирает сразу. Страж — `lane_tests` в `processing_commands.rs`.

**Жёсткий стоп против мягкого.** Жёсткий (`abortNow()` + `abortProcessing(lane)`) прерывает на текущей ноде: она достраивает своё, дальше не запускается ничего, дочерние процессы убиваются. Мягкий (`isScanningProcess = false`) сигнал НЕ трогает — текущая задача доходит до конца со всеми плагинами, новые не берутся. В NODE_WIN стоп всегда жёсткий.

**Где план.** `ideasAndTest/UNIFIED_SOURCES_ENGINE.md` — целевая модель: любая автоматизация = **Источник → Граф → Уборка источника**, движок один, различаются корневая нода-источник и триггер. Читать до крупных правок ядра.

**Связи.** Вызывает плагины, пишет в протокол логов, регистрирует статистику, ходит в хранилище через шов `ensureLocal`.

## 7. Автопостинг ✅ и сбор из Telegram ✅

**Границы.** Два отдельных раннера, **сознательно отвязанных** от обработки: у каждого свой триггер, но движок общий с обработкой.

**Где код.** `src/PROCESSING/autoPost/` (9 файлов: `scheduler`, `posters`, `postLog`, `logWin`, `adapters/vk`, `usePostingAvailable`), `src/PROCESSING/tgCollect/`. Плагины-гейты: `autoPostVK`, `autoPostTG`, `autoPostYT`, `autoTGcollect`, `tgSend`. Rust-сторона Telegram — `src-tauri/src/commands/tg_commands.rs`.

**Где план.** `+AUTOPOST_DECOUPLED_PLAN.md`, `+VK_AUTOPOST_PLAN.md`, `+YOUTUBE_AUTOPOST_PLAN.md`, `+TELEGRAM_AUTOPOST_PLAN.md`, `INSTAGRAM_AUTOPOST_PLAN.md` (⏸ отложен), `TELEGRAM_GDRIVE_BOT_PLAN.md`, `TELEGRAM_BOTS_SETUP.md`.

**Связи.** Триггер — сайдкар `options/postSources.json` (для сбора — `tgSearch.json`): наличие файла работает как тумблер. Платформа выводится не из сайдкара, а из Poster-ноды в графе (`posters.ts`). Дедуп и тайминг platform-aware, ключ `файл + платформа`.

## 8. Плагины ✅ — три подслоя, не один

Это не один пласт, а три; их путают чаще всего.

**8а. Авторинг.** Как плагин написать. `plugins-dev/<id>/` = `plugin.json` (манифест) + `ui.json` (целиковое определение ноды) + код. 45 плагинов. Спека — `plugins-dev/_template/plugin.md` (236 строк) и `ui.md` (680 строк), UI-конструктор — `src/MAIN_WIN/options/PluginBuilderWin/`. Правила и мины — `plugins-dev/CLAUDE.md`, процедура — скилл `/new-plugin`.

**8б. Host-API — одна живая копия.** Обёртки над IPC (`fs`, `http`, `ffmpeg`, `exec`, `ae`, `paths`, `system`, `fonts`) живут в `src/PluginAPI/host.ts` и передаются плагину третьим аргументом (`ctx`) из `processItem`. Плагин их **не бандлит** — импортирует только тип `PluginContext`, который стирается при сборке. Багфикс в обёртке действует на все 45 плагинов сразу, без пересборки.

До 2026-08-10 эти обёртки лежали в `plugins-dev/_template/tauri.ts` (949 строк) и esbuild инлайнил их в каждый бандл — 38 замороженных копий. Побочный эффект был тяжелее дублирования: плагины держали module-local `sendToMW`, поэтому загрузчик пересоздавал модуль на каждый вызов, а ES-модули из динамического импорта выгрузить нельзя — прогон 500 файлов через 5 нод оставлял 2500 копий бандла в памяти. Признак старого стиля — экспорт `onLoad`; `loader.ts` по нему до сих пор различает режимы и кэширует только новые плагины.

**8в. Рантайм и песочница.** `src/PluginAPI/` — полифилы `node:*` (`fs`, `path`, `os`, `child_process`, `crypto`, `stream`, `url`, `util`, `events`) и `loader.ts`. Импорты внутри плагина переписываются на эти полифилы через importmap, который инжектит `vite.config.ts`, и через Rust-обработчик протокола `plugin://` (`src-tauri/src/commands/plugin_protocol.rs`). Загрузка и реестр — `src-tauri/src/commands/plugin_commands.rs` (~910 строк). Вызов — `resolveCallable` в `src/PROCESSING/processItem.ts` (правила и мины — `plugins-dev/CLAUDE.md`).

**8г. Сборка и доставка.** `plugins-dev/_packScripts/` (esbuild), артефакт → `distr-plugins/<id>@<version>/` (только dev, в `.gitignore`), у пользователя → `app_data/plugins`. **Релиз приложения плагины не несёт** — доставка отдельным каналом через `npm run plug:pack`. `distr-plugins` не чистится автоматически: переименовал ноду — старый бандл остаётся и продолжает грузиться. Так `transcriptJSONnormalize@0.1` пережил переименование в `JSONnormalizeTranscribe` и до 2026-08-10 подсовывал приложению копию со старым SDK.

**8д. Модель доверия — плагину доверяем полностью.** Плагин исполняется с правами приложения: `ctx` даёт `fs`, `exec`, `http`, то есть любой файл, любой процесс, любая сеть. Песочницы нет и не планируется — плагин занимается ровно этим по своей природе. Отсюда: **установка плагина = запуск чужого кода**, единственная граница проходит по источнику архива. Поэтому усиливать имеет смысл границы ВОКРУГ плагинов (потолки на распаковку `ArchiveLimits`, общая с `plugin://` проверка имён `sanitize_relative`, таймауты HTTP-клиентов, потолок на тело ответа, редакция секретов через `without_url`), а не права самого плагина — последнее лишь сломало бы его. Права **окон** — отдельная и сужаемая история: `src-tauri/capabilities/` (`default.json` для всех окон, `main.json` только для главного).

**Где план.** `PLUGIN_HOST_API_PLAN.md`. Транспорт host-API (сервисы через `ctx`) **сделан** — см. 8б. Остальное из плана — contribution points, регистрация возможностей плагином — ⏸ отложено осознанно: новое пишем в ядро, плагин остаётся тонким гейтом.

## 9. Онлайн-хранилище 🔧

**Границы.** Локальный клиент облачного хранилища. Решения о хранилище принимает бэкенд коллеги (`innovation-hub`, `/api/storage/v1`), **байты везём мы** — сервер физически не может залить файл, которого у него нет.

**Где код.** `src-tauri/src/storage/` (16 модулей, ~8 600 строк) — самая покрытая тестами зона проекта. Роли модулей заданы в их шапках:

| модуль | роль |
|---|---|
| `provider` | единая точка, через которую всё говорит с бэкендом |
| `client` | HTTP-клиент: один метод — один эндпоинт |
| `service` | владеет состоянием, следит за дисциплиной блокировок |
| `daemon` | фоновый синхронизатор — то, что делает зеркало зеркалом |
| `sync` | наполняет локальный индекс из каталога |
| `index` | копия каталога бэкенда + состояние этой машины |
| `layout` / `paths` | раскладка зеркала человеческими именами ↔ логические пути |
| `state` | единственное место, где считается, какой значок показать |
| `upload` | presign PUT → байты напрямую в R2 → notify |
| `evict` | вытеснение локальных копий: политика на один файл |
| `mock` / `mock_server` | локальная имитация бэкенда для разработки без сети |

Команды — `commands/storage_commands.rs` (31 команда). UI — `src/MAIN_WIN/Storage/` + `TabStorage.tsx`. Шов для остального кода — `src/Utils/storageSeam.ts` (`ensureLocal`).

**Где план.** `R2_SYNC_PLAN.md` (ревизия 2026-08-06, есть раздел «Что умерло в ревизии»), `R2_SHARING_PLAN.md`, `STORAGE_BACKEND_REQUESTS.md` (чего на бэкенде нет: multipart, rename под v1, copy, расшаривание → закрыто capability-флагами).

**Связи.** Ядро обработки не знает про облако: оно зовёт `ensureLocal` и получает локальный путь.

---

# Часть III. Внешние движки

## 10. ffmpeg ✅

**Границы.** Единственный путь к ffmpeg — Rust. Сборка ffmpeg проверяется на наличие нужных фильтров.

**Где код.** `commands/ffmpeg_commands.rs` (`ffmpeg_exec_with_progress`, `ffprobe_get_info`, `ffmpeg_get_video_thumbnail`), гейт возможностей `src-tauri/ffmpeg_requirements.json` + `src/Utils/ffmpegCaps.ts`, сканер `npm run ffmpeg:scan` (`scripts/ffmpeg-scan.mjs`), общие графы фильтров `src/Utils/ffmpegGraphs/`. Плагины: `convertFile_v1/v2`, `keyingFFmpeg`, `ffSwitch`, `overlayAndOffset`, `splitFile`, `join`, `music2signal`, `speech2signal`.

**Где план.** `ffmpeg_plug_ideas.md` — каталог фильтров, ярусы сборки, что взять и что отбросить.

## 11. After Effects ✅ и скрипты ExtendScript ✅

**Границы.** Программа генерирует `.jsx` и отдаёт его AE; AE считается «слоном в комнате» для будущей распределёнки.

**Где код.** `commands/ae_commands.rs` (`run_script_in_ae`, `launch_ae_with_script`). Скрипты: `jsx/dev/` — исходник, `jsx/distr/` — сборка esbuild (`npm run jsx:build` / `jsx:watch`), код в ES3-стиле, потому что esbuild не транспилит ниже es2015. Локальная отладка — `jsx/_playground/` (`npm run jsx:play`). Плагины: `AEprocess`, `addTitle`.

**Где план.** Роль AE в распределённой модели — `ARCHITECTURE_DISTRIBUTED.md`, раздел «After Effects — слон в комнате».

## 12. Moho ✅

**Границы.** Генерация проектов и рендер через плагины `mohoProject`, `mohoRender`; отдельного Rust-слоя нет, работает через общий `exec`.

**Где код.** `plugins-dev/mohoProject/`, `plugins-dev/mohoRender/`, поверх `commands/exec_commands.rs`.

## 13. Произвольные внешние процессы ✅

`commands/exec_commands.rs` — `exec_command`, `kill_all_exec_processes`; `commands/process_utils.rs`; `commands/http_commands.rs` (`http_fetch`/`http_upload`/`http_download`). Через них работают whisper, ИИ-сервисы, Moho.

## 14. Управление зависимостями ✅

**Границы.** Программа сама скачивает ffmpeg/ffprobe и модели whisper — пользователь не собирает их руками.

**Где код.** `commands/deps_commands.rs` (~840 строк), UI — `src/MAIN_WIN/options/tabs/DepsDownloadPanel.tsx` и `TabPaths.tsx`, пути программ — `program_paths_get/set` в `settings_commands.rs`. Источники сборок ffmpeg: martin-riedl и BtbN. Гейт корректности сборки — `ffmpeg_requirements.json`.

**Где план.** Нет.

## 15. ИИ и транскрибация ✅

**Границы.** Реализовано плагинами, ядро о них не знает.

**Где код.** Плагины `transcribeVA` (whisper: пословный JSON + пересборка форматов, DTW-тайминги, VAD), `AItranslateVA`, `AIrevoicer`, `AIparser`, `AIcomfyUI`, `AIstyledVid`, `promptUpdater`, `retimeVA`, `JSONnormalizeTranscribe`. Утилиты ядра: `src/Utils/whisperTranscript.ts`, `audioEnvelope.ts`, `runUserCode.ts` (общее eval-ядро для ноды `jsCode`).

**Где план.** `TTS_LOCAL_TEST_2026-06-22.md` (сравнение локальных TTS), `ideas.md`.

---

# Часть IV. Сквозные слои

## 16. Шов IPC ✅

**Границы.** Единственная граница фронт ↔ Rust. 160 команд.

**Где код.** Реализации — `src-tauri/src/commands/` (28 модулей, ~11 700 строк). Типы — `src/bindings.ts`, **сгенерён tauri-specta, руками не править**. Обёртки — `src/Utils/tauri-api.ts` и `src/Utils/specta.ts`.

**Критично.** Список команд в `lib.rs` **один** (`collect_commands!`) — он даёт и типы, и рантайм (`.invoke_handler(specta.invoke_handler())`). До 2026-08-11 списков было два, и пропуск второго давал «command not found» при зелёной сборке и зелёных тестах; так умер весь клиент хранилища (26 команд). Сторожат `список_команд_ровно_один` (что второй список не вернулся) и `сырые_invoke_из_ts_существуют_в_рантайме` (вызовы строкой типы обходят). Подробно — `src-tauri/CLAUDE.md`.

## 17. Маски и пути ✅

**Границы.** `$`-переменные в именах и путях (`$clearName`, `$random(3)`, …) — общий движок для нод, плагинов и обработки.

**Где код.** Единый источник — `src/Utils/masks.ts` (`MASKS`). Резолверы — `formatNameByPattern.ts`, `createPathForFileByPattern.ts`, `projectPath.ts`. Реестр домашних паттернов — `src/Store/MainWin/pathPattern_store.ts` + `pathPatternDomainRegistry.ts`. Документация генерится: `npm run masks:docs` вставляет таблицу в `plugins-dev/_template/ui.md` между маркерами `<!-- MASKS:START/END -->`.

**Дубль.** `apply_vars` в `src-tauri/src/commands/db_analytics.rs` — ручная копия для Rust-стороны (точное место — `src-tauri/CLAUDE.md`). Расхождение молча ломает пути; свои маски в плагинах заводить нельзя.

## 18. Реестры типов ✅

**Границы.** Три разных реестра с похожими именами — источник постоянной путаницы.

| реестр | что описывает | где |
|---|---|---|
| `colorTypes` | **типы данных** (video, audio, image, text, aep, moho…) и их цвета | `color_types_*` в `settings_commands.rs`, файл `app_data/colorTypes.json`, сборка `src/Store/Color/buildColorTypes.ts` |
| `fileTypes` | сопоставление расширений типам данных | `file_types_get/set` там же, `src/Utils/getFileTypeByExt*.ts` |
| `typeOfNodes` | **плагины** и их раскладка по группам/цветам | localStorage `typeOfNodes`, `src/MAIN_WIN/options/tabs/TabNodes.tsx` |

Правило: цвет плагина берётся из `typeOfNodes`, **не** из `colorTypes`. На этом уже ломался поиск по проектам.

## 19. Статистика и аналитика ✅

**Границы.** Пофайловая статистика обработки: атомарные факты пишутся при обработке, агрегаты считаются на чтении.

**Где код.** `commands/db_analytics.rs` (~560 строк) — JSONL с ключами по дню/месяцу/году (`write_by_day` / `write_by_month` / `write_by_year`), регистрация — `db_register_found` в `settings_commands.rs` и `src/PROCESSING/utils/sendFindItemToRegistrationProcessDatabase.ts`. Фронт: `src/Store/Processing/useProcessingStats_store.ts`, UI — `ProjectStatsModal.tsx`.

**Где план.** `+STATS_SCHEMA_PLAN.md` — схема заморожена v1. Три ловушки записаны там же: `registeredAt` ≠ старт (`renderSec = ended − startedAt`), рассинхрон часовых поясов, `duration` = хронометраж результата.

## 20. Аккаунты, токены, каналы 🔧

**Границы.** Учётки внешних платформ и их секреты. Сейчас хранятся локально.

**Где код.** `commands/account_commands.rs` (`account_save`, `account_list`, `account_get_token`, `account_add_channel`, `account_remove_channel`, `account_delete`), `commands/vk_auth_commands.rs`, `commands/youtube_auth_commands.rs`, `commands/tg_commands.rs`.

**Где план.** `SECRETS_VAULT_SITE_PLAN.md` — 🎯 переезд секретов в сейф на сайте (модель B: сайт = UI + сейф, машины авторизуются и тянут токены с TTL). Сейчас реализован только шов: плагины зовут IPC, меняться будет Rust-бэкенд. Платформенные runbook'и: `YT_SETUP_1_DEV.md`, `YT_SETUP_2_USER.md`, `TELEGRAM_BOTS_SETUP.md`.

**Грабли.** VK-логину нельзя подменять UA и ставить `display=mobile` — ломает VK ID. Google блокирует OAuth в webview → системный браузер + loopback + PKCE.

## 21. Наблюдение за файловой системой ✅

`commands/watch_commands.rs` (~85 строк): `fs_watch_start`, `fs_watch_stop`, `stop_all_watchers`. Плана нет.

## 22. Документация внутри программы 🔧

**Границы.** Движок есть, контента почти нет — это осознанное состояние.

**Где код.** `commands/docs_commands.rs` (`docs_list`, `docs_read`), `src/NODE_WIN/layout/DocModal.tsx`, `src/MAIN_WIN/options/MarkdownText.tsx`. Источник текстов — markdown-файлы плагинов (`plugin.md`, `ui.md`).

## 23. Обновление приложения и релиз ✅

**Границы.** Публичный релиз собирается CI, версия — не в файлах, а в релизах.

**Где код.** `.github/workflows/release.yml` — на push в `main` и по `workflow_dispatch`: определяет следующий свободный patch (источник истины — релизы в `alexIV-0/fs.manager.releases`), сам переписывает версию в `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, коммитит обратно с `[skip ci]`, собирает macOS aarch64 + macOS x86_64 + Windows NSIS, публикует updater-артефакты. Клиент обновления — `tauri_plugin_updater`, ключ и endpoints в `tauri.conf.json`.

Версию руками не бампить. Процедура вливания — скилл `/to-main`.

## 24. Локализация и тема ✅

`src/Store/AppLang_store.ts`, `src/theme/`. Небольшие, плана нет.

---

# Часть V. Где живёт состояние

Самый недооценённый пласт: **четыре независимых уровня хранения**. Записать не туда — типовая ошибка.

| уровень | что там | кто владеет |
|---|---|---|
| `app_data/settings.json` | настройки приложения: лимиты пулов ресурсов, авто-удаление, поведение | `app_settings_get/set/patch` в `settings_commands.rs`, кэш — `src/Store/Settings/appSettings_client.ts`. Лимиты применяются **при старте**, hot-reload нет |
| `app_data/colorTypes.json` | реестр типов данных и цветов | `color_types_*` |
| `app_data/plugins/` | установленные плагины (только прод) | `plugin_commands.rs` |
| **localStorage окна** | `mainFolders` (главные папки), `localFolder`, `options_store`, `plugins-data` (вкл/выкл плагинов), `typeOfNodes`, `<mainFolderId>` (список выключенных проектов), `<mainFolderId>::activity` (даты активности), `doc-sidebar-groups`, `sidebar-accordion-groups`, плюс два persist-стора (`userInputHistory`, `nodeQuickAdd`) | разные сторы; ключи частью литеральные, частью из констант и шаблонов — единого перечня в коде нет |
| **папка проекта** | `options.json` — граф нод и настройки папки; `options/folderState.json` — вкл/выкл и активность (новый SSOT, файл = источник истины под будущий сайт) | `src/Store/MainWin/options_store.ts`, `src/Utils/folderState.ts`, Rust `read_folder_states` |
| **сайдкары в папке** | `options/postSources.json` (автопостинг), `options/tgSearch.json` (сбор) — наличие файла работает как тумблер | `syncPostSourcesSidecar.ts` и аналог для сбора |

**Направление движения.** Из localStorage в файлы папки проекта: `+FOLDER_STATE_SSOT_PLAN.md` (гибрид D) уже перевёл вкл/выкл и активность. Причина: файл в папке синхронизируется и виден сайту, localStorage — нет.

**Почему активность проектов не по mtime папки.** gsync-демон Google переписывает время каталога на серверное, и папка, которой пользуются, через сутки выглядит «холодной». Дату двигают обработка и ручное включение — см. комментарий в `src/Utils/projectActivityLS.ts`.

---

# Часть VI. Швы и дубли

Места, где одна и та же истина живёт в двух экземплярах. Компилятор их не проверяет.

| дубль | страж |
|---|---|
| `MASKS` в `masks.ts` ↔ `apply_vars` в `db_analytics.rs` | **нет** — только глазами |
| `MASKS` ↔ таблица в `_template/ui.md` | `npm run masks:docs` предупреждает |
| `plugins-dev/<id>` ↔ `distr-plugins/<id>@<ver>` | **нет** — забыл `plug:build`, правка не действует |
| `jsx/dev` ↔ `jsx/distr` | **нет** — `npm run jsx:build` вручную |
| версия приложения в трёх файлах | CI (руками не трогать) |

Осознанные швы-абстракции, через которые проходят границы пластов:

- `src/Utils/storageSeam.ts` (`ensureLocal`) — ядро не знает, локальный файл или облачный
- `src/Utils/tauri-api.ts` — единственная точка IPC: window-scoped `listen` и пул pending-listen'ов
- `src/PluginAPI/*` — плагин думает, что он в Node
- `GenericProperty` / `controlType` — UI ноды строится из декларации, а не из кода

---

# Часть VII. Спроектировано, но не существует

Читая `ideasAndTest/`, легко принять цель за реальность. Проверено по коду — этого **нет**:

| абстракция | где описана | что есть на самом деле |
|---|---|---|
| Capability resolver (видимость нод = функция от доступных возможностей) | `VISION.md` §C.1 | 🎯 только точечные гейты: `ffmpegCaps.ts`, `usePostingAvailable.ts`, `useHasAnyPlugin` |
| Workspace backend (`local` / `cloud` за одним интерфейсом) | `VISION.md` §C.2 | 🎯 нет ни типа, ни модуля; вместо него шов `ensureLocal` |
| Engine / Shell split, один API на двух транспортах | `VISION.md` §C.3 | 🎯 нет; всё в одном приложении |
| Единый event-stream engine→shell | `VISION.md` §C.4 | 🎯 нет; логи и прогресс — раздельные механизмы |
| `folderConfig` с версиями, историей и правами | `VISION.md` §D | 🔧 частично: `options.json` + `folderState.json`, без версий и истории |
| Host-API плагинов: contribution points | `PLUGIN_HOST_API_PLAN.md` | ⏸ отложено; **транспорт через `ctx` уже сделан** (см. §8б) |
| Распределённая очередь, оркестратор, воркеры | `DISTRIBUTED_QUEUE_PLAN.md`, `ARCHITECTURE_DISTRIBUTED.md` | 🎯 |
| Сейф секретов на сайте | `SECRETS_VAULT_SITE_PLAN.md` | 🎯 шов готов, бэкенда нет |
| Расшаривание файлов из хранилища | `R2_SHARING_PLAN.md` | 🎯 на бэкенде нет |
| Единый источнико-ориентированный движок целиком | `UNIFIED_SOURCES_ENGINE.md` | 🔧 движок общий, но источники ещё не приведены к одной форме |

---

# Наследство миграции с Electron

Программа выросла из Electron-версии (`fs.manager.electron.MUI`), переезд на Tauri завершён. Шесть решений оттуда объясняют, почему многое устроено именно так:

1. **В main-процессе нет Node.js.** Все операции с ФС и внешними процессами идут через Rust-команды — отсюда 160 команд IPC вместо прямых вызовов.
2. **Плагины исполняются в renderer**, а не в отдельном Node-процессе. Поэтому им нужны полифилы `src/PluginAPI/` и протокол `plugin://`: плагин думает, что он в Node, а на деле в webview.
3. **Watchers на Rust-крейте `notify`** вместо `chokidar`.
4. **Настройки на `tauri-plugin-store`** вместо `electron-store`.
5. **Обновление на `tauri-plugin-updater`** вместо `electron-updater`.
6. **Мультиоконность родная для Tauri 2**, но API отличается от Electron — отсюда отдельные точки входа и раздельные realm'ы вместо общего процесса рендера.

Что было выброшено при переезде: `electron`, `electron-store`, `electron-updater`, `electron-builder`, `vite-plugin-electron`, `chokidar`, `winston`. Что сохранилось: React 19, MUI v7, Zustand v5, `@xyflow/react`, `@dnd-kit/*`, monaco-editor. `adm-zip` остался, но только внутри плагинов и упаковочных скриптов, не в приложении.

История переезда подробно велась в `ideasAndTest/+MIGRATION_NOTES.md`; файл удалён 2026-08-10 как устаревший — его статусы («не начато») и пути (`src-tauri/src/services/*`) противоречили реальности. Восстановить при нужде: `git log --diff-filter=D -- 'ideasAndTest/+MIGRATION_NOTES.md'`.

---

# Соглашения репозитория

- **`+` в начале имени файла в `ideasAndTest/`** — план реализован (например `+FOLDER_STATE_SSOT_PLAN.md`). Без плюса — цель, идея или незакрытый план.
- **Генерённые файлы, править нельзя:** `src/bindings.ts` (`cargo test export_bindings`), таблица масок в `_template/ui.md` (`npm run masks:docs`), `distr-plugins/**` (`plug:build`), `jsx/distr/**` (`jsx:build`).
- **Артефакты вне git:** `distr-plugins/`, `dist/`, `release/`.
- **Язык:** комментарии и документация — по-русски.
- **Проверка изменений:** команды и их ограничения — в корневом `CLAUDE.md`, раздел «Проверка изменений». Коротко: фронт-тестов и линтера нет, Rust-тесты есть.

# Что не описано нигде

Честный список пробелов на 2026-08-10 — ни в этом файле подробно, ни в планах:

- поведение при конфликтах в хранилище (файл изменён и локально, и в облаке)
- политика повторов и таймаутов для внешних процессов (ffmpeg, AE, HTTP)
- формат и версионирование `options.json` (миграции при смене схемы графа)
- контент документации внутри программы (движок готов, текстов нет)
