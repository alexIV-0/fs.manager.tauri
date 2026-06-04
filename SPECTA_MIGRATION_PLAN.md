# План миграции IPC на tauri-specta (типобезопасные биндинги)

> Это «пункт 5» из анализа awesome-tauri. Документ — рабочий плейбук, можно начинать прямо с него.
> Статус: **Stage 0 спайк + Stage 1 пилот выполнены.** Stage 0 — каркас specta готов (export-only).
> Stage 1 — модуль `fs_watch` полностью мигрирован на `commands.*` (эталон паттерна, сборка/tsc зелёные).
> Массовая разметка остальных модулей и помодульная миграция call-sites — впереди. Обновлять чек-боксы.

> ## Результаты спайка (Stage 0, выполнен на `ae_commands`)
>
> - ✅ **Версии под Tauri 2.11.2** (компилируется чисто, ~1m40s первая сборка):
>   `specta = "=2.0.0-rc.22"` (feature `serde_json`), `specta-typescript = "0.0.9"`,
>   `tauri-specta = "=2.0.0-rc.21"` (features `derive`, `typescript`). Доступна rc.25 —
>   обновлять по желанию, закреплённый набор стабилен.
> - ⚠️ **BigIntForbidden**: specta-typescript по умолчанию ПАДАЕТ на `u64`/`i64`/`usize`
>   (`timeout_sec: u64` уронил экспорт). Решение — `Typescript::default().bigint(BigIntExportBehavior::Number)`.
>   Это глобально, конфиг в одном месте (`export_specta_bindings()` в lib.rs). Касается всех команд
>   с 64-бит целыми (таймауты, размеры файлов, mtime).
> - ✅ **Паттерн ошибок (главный вопрос спайка): Result-ОБЪЕКТ, не throw.** Команда `-> Result<T, String>`
>   даёт TS `Promise<Result<T, string>>`, где `Result = {status:'ok',data} | {status:'error',error}`.
>   Шаблон переписывания call-site — **проверка status, НЕ try/catch**:
>   ```ts
>   // было:  try { const x = await invoke('cmd', p) } catch(e) {...}
>   // стало: const r = await commands.cmd(args);
>   //        if (r.status === 'ok') { /* r.data */ } else { /* r.error */ }
>   ```
>   (Внутри биндинга есть try/catch, но он РЕ-throw'ит настоящие `Error`; в `{status:'error'}`
>   попадают только не-Error исключения. Логические ошибки команды — всегда через `status`.)
> - ✅ **`serde_json::Value` → рекурсивный тип `JsonValue`** (лучше, чем ожидалось — не голый `any`).
> - ℹ️ **Имена команд camelCase'ятся**: `run_script_in_ae` → `commands.runScriptInAe`
>   (`Ae`, не `AE` — specta опускает регистр аббревиатур; старый шим звал `runScriptInAE`).
> - ℹ️ **Поля структур остаются snake_case** (`ae_path`, `in_obj`), пока на структуру не навесить
>   `#[serde(rename_all="camelCase")]` (specta уважает serde-rename). Решать помодульно.
> - ℹ️ **Пилот `ae_commands` оказался «плагинным»**: его реальный потребитель — плагин AEprocess
>   через `_template/tauri.ts` (он уже шлёт корректный `{args:{snake...}}`), а app-level
>   `tauriAPI.runScriptInAE` — похоже, мёртвая/битая обёртка. Плагины НЕ мигрируем (§6), поэтому
>   **Stage 1 (первый реальный rewrite call-sites) брать на модуле, который зовёт ПРИЛОЖЕНИЕ** —
>   `http_commands` или `icon_commands`, не `ae`.
>
> Генерация биндингов headless: `cargo test export_bindings` (зеркалит debug-экспорт из `run()`).

## 1. Зачем

Убрать Electron-наследие и целый класс багов «молчаливо падающих kebab/camel IPC-вызовов»
(пример из истории: `fonts:get-list` / TitleEdit ломались тихо, чинились алиасами).

**Что должно исчезнуть в финале:**
- `src-tauri/src/commands/camelcase_wrappers.rs` (46 camelCase-обёрток)
- `src-tauri/src/commands/dialog_commands_camel.rs` (12 обёрток)
- `commandAliases` (~93 записи) + маппер аргументов в `src/Utils/tauri-api.ts`
- invoke-шим `window.electronAPI.invoke(...)` (заменяется типизированными `commands.*`)

## 2. Масштаб (замеры на момент планирования)

- ~199 команд в `generate_handler!` (`src-tauri/src/lib.rs`); всего 212 `#[tauri::command]` в `commands/`
- 143 вызова `electronAPI.invoke` в **55** файлах `src/` (замер на 2026-06-02; в плане изначально было 149/72 — дрейф)
- 58 camel-обёрток (46 + 12) к удалению, **69** алиасов (изначально было 93 — часть уже почищена)
- **63** сигнатуры команд с `serde_json::Value` (specta типизирует как рекурсивный `JsonValue` — не блокер)
- Плагины (`plugins-dev/`) ходят в IPC только через `plugins-dev/_template/tauri.ts` — **шим для плагинов оставляем**, мигрируем приложение, не плагины.

Команды по файлам (`#[tauri::command]`): fs_commands 36, window_commands 33, processing_commands 17,
plugin_commands 15, settings_commands 14, dialog_commands 12, ffmpeg_commands 6, log_archive 4,
http_commands 3, diag_log 3, ae/exec/window_state/watch/docs по 2, icon_commands 1
(+ camelcase_wrappers 46, dialog_commands_camel 12 — это обёртки, к удалению).

## 3. Решение по инструменту

**tauri-specta** (НЕ taurpc). Причина: specta — аддитивный (аннотируем существующие команды,
генерируем типы), taurpc требует переписать команды в trait-router. При ~199 командах specta
несравнимо ниже по риску.

Крейты (уточнить актуальные rc-версии на момент старта — они двигаются):
```toml
specta = "=2.0.0-rc.x"
specta-typescript = "0.0.x"
tauri-specta = { version = "=2.0.0-rc.x", features = ["derive", "typescript"] }
```

## 4. Стратегия сосуществования (КЛЮЧЕВОЕ — почему низкий риск)

Стратегия **«export-only» на старте**: НЕ трогаем `generate_handler!` и шим. Specta-builder
используется СНАЧАЛА только для генерации `src/bindings.ts`. Биндинги зовут **snake-команды**
(реальные реализации), а старый шим продолжает звать camel-обёртки — оба работают параллельно,
потому что это разные имена команд (коллизии в рантайме нет).

Требование: каждая snake-реализация, которую дергают биндинги, должна быть зарегистрирована в
`generate_handler!`. Часть уже есть; недостающие **добавляем** (аддитивно, ничего не ломает).
Коллизия `getFileInfo` (обёртка) vs `get_file_info` (snake) возможна только в TS-биндингах — её
избегаем тем, что в `collect_commands!` кладём ТОЛЬКО snake-реализации.

Это полностью снимает спор про имена аргументов: легаси-вызовы остаются на camel-обёртках
(не трогаем), новые — на specta-биндингах (specta сам формирует корректный invoke).

## 5. Этапы

### Stage 0 — Фундамент (аддитивно, поведение не меняется)
- [x] Добавить крейты specta/specta-typescript/tauri-specta в `src-tauri/Cargo.toml`. (версии — см. «Результаты спайка»)
- [~] Навесить `#[derive(specta::Type)]` на ВСЕ структуры из сигнатур команд (аргументы и возвраты).
      Найти: `grep -rn "#\[derive(.*Deserialize\|#\[derive(.*Serialize" src-tauri/src/commands`.
      Для `serde_json::Value` ничего не нужно (есть feature `serde_json` у specta, тип станет `JsonValue`).
      **Сделано только для `ae_commands` (пилот). Остальные модули — TODO.**
- [~] Навесить `#[specta::specta]` рядом с `#[tauri::command]` на **snake-реализациях**
      (fs_commands, window_commands, http_commands, settings_commands, ... — НЕ на camel-обёртках).
      **Сделано только для `ae_commands` (пилот). Остальные модули — TODO.**
- [ ] Убедиться, что все эти snake-команды зарегистрированы в `generate_handler!`; недостающие — добавить.
- [x] Создать `tauri_specta::Builder::<tauri::Wry>::new().commands(collect_commands![ ...snake... ])`
      (в `lib.rs` → `specta_builder()`; пока только 2 команды ae).
- [x] В debug-сборке вызвать `builder.export(...)` (`export_specta_bindings()` в `lib.rs`,
      с `.bigint(Number)` — см. находку BigIntForbidden). `generate_handler!` НЕ тронут.
- [x] Проверка: `cargo check`✓; `bindings.ts` сгенерился✓; `tsc --noEmit` зелёный✓; рантайм не изменён (export-only).
- [x] **Спайк по ошибкам:** specta отдаёт `Result`-ОБЪЕКТ (`{status:'ok'|'error'}`). Паттерн — проверка
      `status`, НЕ try/catch. Зафиксировано в «Результаты спайка».

### Stage 1 — Пилот ✅ ВЫПОЛНЕН на `fs_watch` (watch_commands)
> ⚠️ Важно: `http_commands`/`ae_commands` НЕ годятся в пилот — у них НЕТ app-вызовов
> (их зовут только плагины через `_template/tauri.ts`, а плагины не мигрируем, §6).
> Пилот делать на модуле, который реально дёргает ПРИЛОЖЕНИЕ. Взяли `fs_watch` (2 команды,
> 2 call-site в `UniversalFolderView.tsx`, полный набор обёртка+алиас+маппер для зачистки).

**Эталонный паттерн (что сработало, повторять для остальных модулей):**
- [x] `#[specta::specta]` на snake-команды (`fs_watch_start`/`fs_watch_stop`). Структур у них нет
      (`folder_path: String` + injected `State`/`AppHandle` — specta их скрывает).
- [x] Добавить snake-команды в `collect_commands!` (lib.rs `specta_builder()`).
- [x] `cargo test export_bindings` → `src/bindings.ts` обновился (`commands.fsWatchStart(folderPath)`).
- [x] Call-sites: `window.electronAPI.invoke('fs-watch:start', p)` → `import { commands } from '@/bindings'`
      + `commands.fsWatchStart(p)`. (Тут fire-and-forget; где нужен результат — `const r = await ...;
      if (r.status === 'ok') r.data else r.error`.)
- [x] Удалить отработавшее: camel-обёртки `fsWatchStart/Stop` (camelcase_wrappers.rs + строки в
      `generate_handler!`), алиасы `'fs-watch:*'` и argMappers в `tauri-api.ts`.
      **snake-команды в `generate_handler!` НЕ трогать** — биндинг зовёт их через рантайм.
- [x] Проверка: `cargo test export_bindings` (компиляция Rust + реген) зелёный; `tsc --noEmit` зелёный.
- [x] Ручной тест в `tauri:dev` ✅: `commands.fsWatchStart` вернул `{status:'ok'}`, события `fs-changed`
      приходят, колонка рефрешится. **Подтверждено в рантайме:** Tauri сам конвертирует имя аргумента
      биндинга `folderPath` → Rust-параметр `folder_path` (specta генерирует camelCase, работает из коробки).

### Stage 2..N — Помодульная миграция (повторять)

> **Общий хелпер `unwrap()` (введён на path-модуле, `src/Utils/specta.ts`):** большинство команд
> возвращают `Result`. `unwrap(await commands.x(...))` разворачивает `data` и БРОСАЕТ на ошибке —
> это 1:1 поведение старого `invoke` (он реджектил при Err), поэтому call-sites переписываются
> в одну строку без правки обработки ошибок. Импортировать `{ commands, unwrap } from '@/Utils/specta'`
> (а не из авто-генерируемого `@/bindings`). Где нужна не-бросающая обработка — проверять `r.status`.

> **✅ path-утилиты — ВЫПОЛНЕНО, но НЕ через specta (исключение!).** Сначала мигрировали на
> `commands.path*`+unwrap, потом осознали: basename/dirname/extname/join — чистые строковые
> операции, им незачем IPC-round-trip (pathBasename звался ×14 async'ом). Итог: 23 call-site в 11
> файлах переведены на **синхронный чистый TS** `import { basename, dirname, extname, join } from '@/Utils/path'`.
> - `src/Utils/path.ts` — единый app-фасад, ре-экспорт из `src/PluginAPI/path.ts` (кросс-платформенный
>   полифил node:path: POSIX/Windows/UNC). `src/Utils/joinPath.ts` → тонкий ре-экспорт (убран дубль).
> - Rust: `path_basename/dirname/extname/parse/relative` + `PathInfo` **удалены**; `path_join`
>   ОСТАВЛЕН обычной `#[tauri::command]` (его зовут ПЛАГИНЫ через IPC, `_template/tauri.ts`), НЕ в specta.
> - **Вывод-правило:** чистые строковые/вычислительные операции, дублирующие JS — переводить в renderer,
>   а не типизировать IPC. specta — для команд с реальной работой в Rust (fs/dialog/processing/…).
> `unwrap()` (`src/Utils/specta.ts`) остаётся для будущих Result-модулей. cargo+tsc зелёные.
> Ручной тест в приложении ✅: переименование файла, превью, запуск обработки — всё работает.

> **✅ dialog — ВЫПОЛНЕНО (первый «ловушечный» модуль, A-вариант).** Реальный код был в camel-файле,
> snake — мёртвые заглушки. Сделали честно: `dialog_commands_camel.rs` УДАЛЁН целиком; реальные
> реализации перенесены в `dialog_commands.rs` под snake-именами + `#[specta::specta]`; 18 call-sites
> в 11 файлах → `unwrap(await commands.*)` (первое реальное применение unwrap на Result-командах);
> мёртвый стаб-файл перезаписан; argMappers + мёртвые типизированные `tauriAPI`-методы удалены.
> Нюансы: `getNodeObjFromFile` → `JsonValue` (каст `as unknown as SavedState`); `flow` в
> `saveFlowToOptionsFolder` → `as any` (динамический JSON). `openDevTools` оставлен (это
> window_commands.open_devtools, не dialog). **Это снесло ОДИН из двух файлов-обёрток (цель плана).**
> cargo+tsc зелёные; ручной тест — выбор папок/файлов (была ловушка!), save/load flow, clipboard.

> **✅ preview — ВЫПОЛНЕНО.** 5 команд (`preview_open`/`preview_resize`/`preview_detect_alpha`/
> `preview_transcode_webm`/`preview_delete_temp`) размечены, `PreviewResizeOpts` (в fs_commands.rs) +
> `specta::Type`. 9 call-sites в 5 файлах (4× preview:resize, preview:open, detect-alpha/transcode/delete-temp)
> → `commands.preview*`. camel `previewResize/previewOpen` удалены, 6 алиасов + 5 argMappers убраны.
> Нюансы: `preview_open(data: string)` — JSON-строка (передаём `JSON.stringify`); 3 стаба имели `_file_path`
> — переименованы в `file_path` (+`let _ =`) чтобы биндинг был чистый `filePath`, а не `_filePath`;
> в `.then`-цепочках (VideoPreview) `unwrap(r)` внутри then → ошибка уходит в существующий `.catch`.
> cargo+tsc зелёные; ручной тест — открыть превью видео/аудио/картинки/текста, ресайз окна.

> **⚠️ КЛЮЧЕВАЯ НАХОДКА (2026-06-02): fs_commands СИЛЬНО завязан на плагины.** Плагины через тот же
> шим (`window.electronAPI.invoke` в `_template/tauri.ts`) зовут МНОГО fs-camel-обёрток: getFileInfo,
> copyItem, moveItem, getSomeFromFolder, readFileSync, writeFile, deleteItem, testAndCreateFolder,
> recursiveFindFiles, shellOpenPath, fontsGetList, getCpuCount, getOptionsFolder, getPlatformTarget,
> getPluginsDevPath + snake get_stat/hash_file/os_tmpdir/write_binary_file. → **эти обёртки+мапперы+алиасы
> УДАЛЯТЬ НЕЛЬЗЯ** (сломаем плагины, §6). Из «мелких» модулей плагины зовут только `sendLog`/`setStatusBar`.
>
> **Следствия:**
> - Для fs миграция = только перевод app-call-sites на `commands.*` (type-safety на горячих путях),
>   обёртки остаются для плагинов. Cruft-removal ≈ 0. Поэтому fs отложен на plugin-aware проход.
> - Финал «удалить camelcase_wrappers.rs целиком» ЗАБЛОКИРОВАН до миграции плагинов (перевод
>   `_template/tauri.ts` на snake-имена + пересборка плагинов). Это отдельный кусок.
> - **Полностью чистые модули (нет плагинного overlap): window, log-window, settings, docs.** Их и
>   мигрируем сейчас — обёртки/алиасы удаляются чисто. processing — почти чистый (кроме sendLog/setStatusBar).

> **✅ settings — ВЫПОЛНЕНО (чистый от плагинов модуль).** 14 команд (app_settings/color_types/
> file_types/program_paths + cleanup_auto_delete/db_register_found) размечены `#[specta::specta]`
> (структур нет — все возвращают `serde_json::Value`/`String`). Call-sites: `appSettings_client.ts`
> (8), `pathPattern_store.ts` (фабрику `createTauriPatternStore` отрефакторил: строки-каналы →
> типизированные load/save-функции), `TabMain.tsx`, `runProcessing.ts`, `sendFindItem...ts`.
> Удалены 14 kebab-алиасов + 14 argMappers (camel-обёрток у settings не было). Нюанс: `Value` → `JsonValue`,
> касты к доменным типам через `as unknown as AppSettings/ColorTypesFile`. cargo+tsc зелёные.
> Ручной тест: настройки (вкладки), color/file types, program paths, cleanup, db-register при обработке.

Порядок (ПЕРЕСМОТРЕН — сначала чистые от плагинов): ~~path (pure TS)~~ → ~~dialog~~ → ~~preview~~ →
> **✅ window-state — ВЫПОЛНЕНО.** `save_window_state`/`load_window_state` + `specta::Type` на `WindowState`.
> Единственный call-site `src/Utils/windowAutoSave.ts` → `commands.saveWindowState(label, state)`. Удалены
> camel-обёртки saveWindowState/loadWindowState + argMappers + мёртвые типизированные методы tauriAPI.
> Загрузка стейта — в Rust на старте (JS loadWindowState не использовался). cargo+tsc зелёные.
> (Остальное в window_commands — node-window data-flow/open_node_window — завязано на события, отложено на этап событий.)

> **✅ log_archive — ВЫПОЛНЕНО (часть 1 log-window).** 4 команды (log_archive_list_days/get_day/cleanup/clear)
> + `specta::Type` на `ArchiveDay`. Call-sites: runProcessing (logs:cleanup), LogApp ×3 (list-days/get-day/clear-archive).
> Удалены 4 logs:* алиаса + 4 argMappers. cargo+tsc зелёные. **Осталось log_window (UI): open/close/clear/
> get_history/export/has_errors/get_recent/get_errors/emit_* + структуры LogHistory; diag_log и мёртвые
> (toggle/status/quick/errors_only/console/log_message) — не трогаем.**

> **✅ log_window UI — ВЫПОЛНЕНО (часть 2, log-window завершён).** 10 команд (open/clear/get_history/
> export/emit_item_log/node_update/item_end/substep_batch/item_queued/abort_queued) + `specta::Type` на
> `LogHistory`. Call-sites в 6 файлах (MainTopPanel/Toolbar/LogApp/startProcessing/findFiles/processItem)
> → `commands.logWindow*`. Удалены мёртвые `tauriLogWindow` + `hasErrors/getRecentLogs/getErrors` + все
> log-window:* алиасы/мапперы. Мёртвые команды (toggle/get_status/open_quick/open_errors_only/
> emit_item_start/intercept_console/restore_console/log_message) и diag_log оставлены snake-командами. cargo+tsc зелёные.

> **✅ processing (app-only) — ВЫПОЛНЕНО.** 6 живых команд (abort_processing, move_to_errors, send_node_start/
> done/error, send_process_complete) + `specta::Type` на `MoveToErrorsResult`. Call-sites: TopPanel/AppMain
> (abort), processItem (moveToErrors/sendNode*/complete), startProcessing (complete). Удалены camel-обёртки
> abortProcessing/processItem/sendNode*/sendProcessComplete + их алиасы/argMappers. **Оставлены (плагинные):
> set_status_bar/send_log/path_exists** (camel setStatusBar/sendLog + path_exists на шиме). Дохлые
> tauriAPI-методы (isProcessingAborted/resetProcessingSignal/setProcessingProgress/getProcessingProgress/
> addProcessingError/processingDeleteItem/getItemInfo/processItem + abort/move/sendNode/complete) — НЕ зовутся,
> оставлены на финальную dead-code зачистку tauri-api.ts. process_item — заглушка. cargo+tsc зелёные.

> **✅ fs_commands — APP call-sites ВЫПОЛНЕНО (2026-06-03).** ~30 snake-команд размечены
> `#[specta::specta]` (sed) + `specta::Type` на FileInfo/CopyMoveOptions/FontInfo/StatInfo/SearchEntry +
> в `collect_commands!`. path_join остался plain (плагины). Все app-call-sites (батчи 1–4: processing-fs,
> node-win, main-win, utils, preview) переведены на `commands.*` + `unwrap`. cargo+tsc зелёные. Нюансы:
> `getFileTypeByExtname(ext)` берёт расширение (старый маппер извлекал из пути!); non-Result у
> `osTmpdir`/`getCpuCount`/`getPlatformTarget`/`getFileTypeByExtname` (без unwrap); `copyItem`/`moveItem`
> (options: CopyMoveOptions|null); `getSomeFromFolder(path, search: SearchEntry[]|null)` → `Result<JsonValue>`
> (каст `: any`); `listSubfolders` → `Result<JsonValue>` (каст `as unknown as Record<string,string[]>`).
> **`path_exists` тоже размечен specta** (был plugin-shared snake-only) — app зовёт `commands.pathExists`,
> плагины оставят raw `invoke('path_exists', {path})`. Остаточные не-fs в app-слое (НЕ трогаем сейчас):
> `setStatusBar`/`sendLog` (plugin-shared), `ffprobe_get_info` (ffmpeg), `plugins:*`/`open-node-window` (др. модули).
> **`PluginAPI/fs.ts`+`os.ts` (11) — плагинный слой, следующий шаг (→ snake invoke, НЕ commands).**

> **🚧 Плагинный слой — ПЕРЕПИСАН, ждёт теста (2026-06-03).** Два потребителя camel/positional-имён мигрированы:
> (A) `src/PluginAPI/fs.ts`+`os.ts` (app-bundled vite-чанк, importmap) → `commands.*` + `unwrap`.
> (B) `plugins-dev/_template/tauri.ts` (esbuild-bundle в КАЖДЫЙ плагин) → snake-имена + single named-payload
> (`{filePath}`/`{sourcePath,destinationPath,options}`/`{path,search}` и т.д.; Tauri camelCase→snake).
> getOptionsFolder→get_user_data_path, getPluginsDevPath→get_plugins_dev_path, getPlatformTarget/getCpuCount/
> fontsGetList→snake. ffmpeg/http/exec/ae/log/setStatusBar/path_join — НЕ трогали. `npm run plug:build:all`
> пересобрал все 35 (distr-plugins gitignore; snake-команды уже в generate_handler! → не ломаются).
> **В tauri-api.ts удалены 4 КОНФЛИКТУЮЩИХ snake-argMapper: get_stat/path_exists/hash_file/write_binary_file**
> (named-payload иначе «мялся»). camel-argMappers (readFileSync/writeFile/copyItem/…) и camel-ОБЁРТКИ в Rust
> ОСТАВЛЕНЫ как страховка — удалить ТОЛЬКО после ручного теста плагинов (безопасный порядок). tsc+cargo зелёные.

> **✅✅ ФИНАЛ ВЫПОЛНЕН (2026-06-04).** Юзер подтвердил работу плагинов → `camelcase_wrappers.rs` УДАЛЁН
> целиком (28 обёрток), camel убраны из `generate_handler!` (snake-двойники open_node_window/set_status_bar/
> send_log/shell_open_path остались). По пути найден баг: `shell_open_path` был только в collect_commands!,
> не в generate_handler! → кнопка «открыть в проводнике» падала (добавлен). setStatusBar/sendLog мигрированы
> на snake (шаблон + app), updater.ts (прямой shellOpenPath) → snake, плагины пересобраны. tauri-api.ts:
> удалены мёртвые fs-camel argMappers/aliases + весь dead PROCESSING-блок typed-методов. cargo+tsc+export зелёные.
> Остаток (опц.): события node-window; остаточные plugins:* kebab-алиасы (плагин-система).

~~settings~~ → ~~docs~~ → ~~window-state~~ → ~~log-window~~ → ~~processing (app-only)~~ →
~~fs call-sites (батчами)~~ → ~~плагинный слой~~ → ~~удалить camelcase_wrappers.rs + fs-алиасы/argMappers~~ →
~~dead-code зачистка tauri-api.ts~~ → события (опц., node-window data-flow) →
**fs_commands и плагинный шаблон — В КОНЦЕ, plugin-aware проходом**. http/icon/ae/exec — плагинные. Для каждого модуля:
- [ ] Найти call-sites: `grep -rn "electronAPI.invoke('<имена модуля>'" src/`.
- [ ] Переписать на `commands.<camelName>(...)`.
- [ ] Удалить отработавшие camel-обёртки + алиасы (как только нет легаси-вызовов).
- [ ] `tsc` + точечный тест.
Каждый модуль = отдельный коммит/PR (легко откатить).

> ⚠️⚠️ **ОБЯЗАТЕЛЬНЫЙ шаг 0 для каждого модуля — проверить, ГДЕ реальная реализация (snake или camel).**
> Допущение «snake = реальный код» НЕ всегда верно:
> - `camelcase_wrappers.rs` (path, fs_watch, fs_commands, …) — ИСТИННЫЕ тонкие обёртки: camel зовёт snake.
>   Здесь snake real → план работает как есть.
> - **`dialog_commands_camel.rs` — ПЕРЕВЁРНУТО:** camel-функции содержат РЕАЛЬНЫЕ реализации
>   (`selectFolders`/`selectFiles` открывают нативный диалог через `tauri_plugin_dialog`;
>   `saveFlowToOptionsFolder`/`getNodeObjFromFile` пишут/читают `{path}/options/options.json`),
>   а snake-двойники в `dialog_commands.rs` — МЁРТВЫЕ ЗАГЛУШКИ (`select_folders` → `Ok(vec![])`,
>   не зарегистрированы в `generate_handler!`, не используют dialog-плагин). Слепая миграция на
>   snake СЛОМАЛА бы выбор папок/файлов и записала flow не туда.
> Проверка: `grep -nE "^\s+<cmd>,?\s*$" lib.rs` (что зарегистрировано) + сравнить тела snake vs camel.

### Stage Events (опционально, после команд)
- [ ] Типизировать события (`processing-event`, `update-data`, `give-data`, лог-события) через
      `#[derive(Clone, specta::Type, tauri_specta::Event)]` + `collect_events![...]` + `builder.mount_events(app)`.
- [ ] На фронте `events.processingEvent.listen(cb)` вместо `onProcessingEvent`.
- Низкий приоритет; команды важнее.

### Finale — Зачистка
- [ ] Переключить `tauri::Builder` на `builder.invoke_handler()` (snake-команды), убрать `generate_handler!`.
- [ ] Удалить `camelcase_wrappers.rs`, `dialog_commands_camel.rs`, их `pub mod` в `commands/mod.rs`.
- [ ] Удалить `commandAliases` + маппер аргументов + invoke-шим в `tauri-api.ts`
      (оставить только то, что нужно ПЛАГИНАМ — см. §6).
- [ ] `cargo check` + `tsc` + полный прогон.

## 6. Плагины (не мигрируем сейчас)

`plugins-dev/_template/tauri.ts` оборачивает `window.electronAPI.invoke` и встраивается в бандл
каждого плагина (esbuild). Биндинги в плагины тащить дорого. Решение: **оставить шим/snake-команды
для плагинов**. Т.е. на финале НЕ удалять полностью invoke-механизм — оставить тонкий путь, которым
пользуются плагины (snake-команды + минимальный invoke). Полную миграцию плагинов — отдельно, позже.

## 7. Риски и подводные камни

- **Имена аргументов**: на стратегии export-only не всплывает (легаси на camel-обёртках, новое на
  биндингах). Всплывёт только если решим резать обёртки раньше времени — не делаем.
- **Параллельность двух списков** (`generate_handler!` ↔ `collect_commands!`) во время перехода —
  держать в синхроне; можно добавить тест/комментарий-чеклист.
- **serde_json::Value (47)** → `any` в биндингах: команды работают, но без типобезопасности по этим
  полям (processing `process_item`, plugin-команды и т.п.). По желанию позже завести нормальные структуры.
- **Возврат Result в биндингах** — уточнить паттерн в Stage 0 спайке, чтобы единообразно переписывать.
- **Многооконность** (main/nodeWin/previewWin/logWindow) — биндинги работают из любого окна, проблем нет.
- **DragOverlay/прочее уже стабилизировано** — IPC-миграция их не касается.

## 8. Как возобновить работу

1. Прочитать этот файл + память `project_specta_migration_plan`.
2. Проверить статус чек-боксов.
3. Если Stage 0 не сделан — начать с него (он аддитивный, безопасный).
4. Перед массовой миграцией обязательно выполнить спайк по Result/ошибкам (Stage 0).
