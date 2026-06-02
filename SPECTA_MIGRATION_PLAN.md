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

Порядок по app-call-sites (от простого к сложному): ~~path-утилиты (→ pure TS, не specta)~~ → dialog (selectFolders/Files,
shell:openPath) → preview (preview:*) → fs_commands (getFileInfo/getSomeFromFolder/copyItem/moveItem/…) →
processing → window_commands → log-window → settings. **http/icon/ae/exec — отдельно/в конце или вместе
с плагинами: у них нет app-вызовов** (зовут только плагины через `_template/tauri.ts`). Для каждого модуля:
- [ ] Найти call-sites: `grep -rn "electronAPI.invoke('<имена модуля>'" src/`.
- [ ] Переписать на `commands.<camelName>(...)`.
- [ ] Удалить отработавшие camel-обёртки + алиасы (как только нет легаси-вызовов).
- [ ] `tsc` + точечный тест.
Каждый модуль = отдельный коммит/PR (легко откатить).

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
