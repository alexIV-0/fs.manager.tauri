# Обновление зависимостей — ручная инструкция

> Делать на feature-ветке (сейчас `someDev`), НЕ на `main`.
> Проект: `/Users/aleksey.ivanov/Desktop/WORK_CEP_DEV/fs.manager.tauri`

---

## 0. СНАЧАЛА убрать нагрузку на CPU (mds / mds_stores / kernel_task)

Нагрузку даёт не сам install, а **переиндексация Spotlight** при массовой смене файлов в `node_modules`.
Исключи проект из индексации перед установкой:

**GUI:** System Settings → Spotlight → «Privacy» (Конфиденциальность поиска) → `+` →
добавить папку проекта (или хотя бы `node_modules`).

**Или из терминала** (ВАЖНО: `mdutil` работает только по ТОМУ, не по папке — путь к папке даёт
«invalid operation / unknown indexing state»):
```bash
sudo mdutil -a -i off                 # отключить индексацию всех томов
sudo killall -9 mds_stores            # сбросить застрявший процесс (не вернётся, пока индексация off)
# ...поставить зависимости...
sudo mdutil -a -i on                  # вернуть индексацию обратно, когда закончишь
sudo mdutil -as                       # проверить статус по томам
```

**Правила, чтобы не словить тормоза снова:**
- Запускать `npm install` **один раз** и **не прерывать** (Ctrl-C / закрытие посередине ломает
  `node_modules` и оставляет staging-папки `.<имя>-<хеш>` → ошибки `ENOTEMPTY` при следующих установках).
- Не гонять установку повторно в цикле.

---

## Что уже сделано (мной), переделывать не нужно

- ✅ **`src-tauri/Cargo.lock`** — выполнен `cargo update`: `tauri 2.11.2→2.11.3`, `uuid→1.23.4`,
  `chrono→0.4.45` и транзитивные (всё в пределах semver). Готово.
- ✅ **`package.json`** — `@xyflow/react` поднят `^12.8.2 → ^12.11.1`.
- ⚠️ **`package-lock.json`** — пересобран, но `node_modules` сейчас **частичный/битый** (установки
  прерывались). Нужен один чистый `npm install` — см. шаг 1.

### Замечание про менеджер пакетов
В репо есть **и `package-lock.json`, и `yarn.lock`** (оба были изменены ещё до правок). Это конфликт.
Выбери ОДИН и придерживайся его:
- **npm** → удали `yarn.lock`, используй команды ниже как есть.
- **yarn** → удали `package-lock.json`, и везде ниже меняй `npm install` → `yarn`,
  `npm install -D X` → `yarn add -D X`.

---

## Шаг 1 — безопасные обновления (минор/патч) + восстановление node_modules

```bash
cd /Users/aleksey.ivanov/Desktop/WORK_CEP_DEV/fs.manager.tauri

# чистая установка (node_modules сейчас неконсистентный)
rm -rf node_modules
npm install                       # один раз, дождаться конца

# проверка
npx tsc -p tsconfig.json --noEmit         # типы (должно быть без ошибок)
npx vite build                            # сборка фронта
ls dist/assets/plugin-api/                # КОНТРОЛЬ: должно быть 10 файлов-полифилов
ls dist/*.html                            # КОНТРОЛЬ: 4 html (index, nodeWin, previewWin, logWindow)
```

Rust-сторона уже обновлена; если захочешь повторить:
```bash
cd src-tauri && cargo update && cargo check
```

Этого шага достаточно для «безопасного» набора. Версии в пределах `^`: react 19.2.7, zustand 5.0.14,
@xyflow/react 12.11.1, wavesurfer 7.12.8 и т.д. подтягиваются автоматически.

---

## Шаг 2 — Vite 6 → 8 (Rolldown) + @vitejs/plugin-react 4 → 6

> Главный выигрыш по скорости сборки/HMR. Требует Node ≥20.19 или ≥22.12 (у тебя 22.16 / 24.16 — ок).
> Это мажор — делать ОТДЕЛЬНО от шага 1, чтобы при проблеме легко откатить.

```bash
cd /Users/aleksey.ivanov/Desktop/WORK_CEP_DEV/fs.manager.tauri
npm install -D vite@^8 @vitejs/plugin-react@^6

# собрать и СВЕРИТЬ, что мульти-entry полифилы и importmap не сломались под Rolldown
npx vite build
ls dist/assets/plugin-api/        # снова должно быть 10 файлов
ls dist/*.html                    # снова 4 html

# проверить dev-режим вживую (особенно загрузку плагинов через plugin.localhost):
npm run dev
```

**На что смотреть (риски Rolldown):**
- В [vite.config.ts](vite.config.ts) — `rollupOptions.input` (мульти-entry), `preserveEntrySignatures: 'strict'`
  и кастомный `entryFileNames` для `plugin-api/*`. Именно тут возможны отличия Rolldown vs Rollup.
  Если полифилы перестали попадать в `dist/assets/plugin-api/*.js` или плагины не грузятся — копать сюда.
- Инъекция `<script type="importmap">` через `transformIndexHtml` (`order: 'pre'`) — проверить, что тег
  на месте в собранных html.

**Откат, если что-то сломалось:**
```bash
npm install -D vite@^6 @vitejs/plugin-react@^4
```

---

## Шаг 3a — tsgo (быстрый typecheck, ~10×)

> В [tsconfig.json](tsconfig.json) уже `noEmit:true` + `strict:true`, поэтому `tsc` = чистая проверка типов.
> tsgo (нативный Go-компилятор, основа TS 7) заходит как drop-in для проверки. `typescript` в package.json
> оставляем 5.9 — tsgo ставится РЯДОМ, отдельно.

```bash
npm install -D @typescript/native-preview
npx tsgo --noEmit -p tsconfig.json        # проверить, что проходит так же, как tsc
```

Добавить в `package.json` → `scripts`:
```json
"typecheck": "tsgo --noEmit -p tsconfig.json"
```
Использовать `npm run typecheck` для быстрой проверки во время работы. Боевая сборка (`npm run build`)
по-прежнему через обычный `tsc` — менять её не нужно.

---

## Шаг 3b — Rust: zip 0.6 → 8 и notify 6 → 8

> API call-sites используют только стабильную часть (zip: read-методы; notify: `RecommendedWatcher::new`+`watch`),
> тулчейн Rust 1.94.1 проходит MSRV. Риск низкий.

В [src-tauri/Cargo.toml](src-tauri/Cargo.toml) поменять:
```toml
zip = "8"        # было "0.6"
notify = "8"     # было "6"
```
Затем:
```bash
cd src-tauri
cargo check          # должно скомпилироваться без правок
```

**Если zip 8 даст ошибки компиляции**, чинить в 2 местах (оба — только распаковка):
- [src-tauri/src/commands/plugin_commands.rs](src-tauri/src/commands/plugin_commands.rs#L669) (~строка 669)
- [src-tauri/src/commands/deps_commands.rs](src-tauri/src/commands/deps_commands.rs#L312) (~строка 312)

**notify** используется в [src-tauri/src/commands/watch_commands.rs](src-tauri/src/commands/watch_commands.rs)
— `RecommendedWatcher::new(closure, Config::default())` + `.watch(path, mode)`, в v8 без изменений.

zip 8 по умолчанию включает много бэкендов сжатия (zstd/xz/lzma/deflate64/bzip2) — это плюс (любой
скачанный архив распакуется), но сборка чуть тяжелее. Если хочешь только нужное:
```toml
zip = { version = "8", default-features = false, features = ["deflate"] }
```
(но тогда архивы в других форматах не распакуются — для ffmpeg/whisper лучше оставить дефолт).

---

## Итоговая проверка перед коммитом

```bash
# фронт
npx tsc -p tsconfig.json --noEmit && npx vite build
# rust
cd src-tauri && cargo check && cd ..
# полная сборка приложения (тяжёлая, по желанию)
npm run build
```

Коммитить логическими порциями (шаг 1 / шаг 2 / шаг 3) — чтобы при регрессе откатить точечно.
