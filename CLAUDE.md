# fs.manager.tauri

Tauri 2 + React + Rust. Файловый менеджер / раннер пайплайнов обработки медиа с системой плагинов.

**Карта проекта — `ARCHITECTURE.md`**: из чего состоит программа, кто чем владеет, где границы пластов, где живёт состояние, что спроектировано но ещё не существует. Читать перед работой в незнакомой зоне. Этот файл (`CLAUDE.md`) — только правила и грабли.

## Проверка изменений

```bash
npx tsc --noEmit                                  # приложение (src/)
npx tsc --noEmit -p plugins-dev/tsconfig.json     # ПЛАГИНЫ — отдельная программа
cargo check --manifest-path src-tauri/Cargo.toml  # Rust: компиляция
cargo test  --manifest-path src-tauri/Cargo.toml  # Rust: ~96 тестов (в основном storage)
```

**Плагины проверяются отдельной командой.** Корневой `tsconfig.json` ограничен `"include": ["src"]`, а esbuild типы не смотрит — без второй строки 9 тысяч строк `plugins-dev/` не проверяет вообще ничто.

- Запуск приложения: `npm run tauri:dev`
- **Не звать `npm run build` для проверки** — это `tsc && vite build && tauri build`, полная сборка бандла на минуты.
- **Фронт-тестов и линтера нет вообще** (тестраннер не настроен, eslint не настроен) — не выдумывать `npm test` / `npm run lint` / `npm run typecheck`, таких скриптов в `package.json` нет. Для фронта `tsc --noEmit` — весь доступный контроль, поэтому логику, которую типы не ловят, проверять чтением.
- Тесты есть только в Rust и живут рядом с кодом (`#[cfg(test)] mod`), плотнее всего в `src-tauri/src/storage/`.

## Четыре окна = четыре JS-realm'а

Точки входа: `src/main.tsx` → `MAIN_WIN`, `mainNode.tsx` → `NODE_WIN`, `mainLogWindow.tsx` → `LOG_WIN`, `mainPreview.tsx` → `PREVIEW_WIN`.

Zustand-сторы между окнами **не шарятся** — это разные реалмы. Межоконная координация — только broadcast-события Tauri (пример: `plugins-changed`, слушают и `AppMain.tsx`, и `NODE_WIN/index.tsx`). Решать межоконную задачу «положим в общий стор» нельзя.

## IPC

- Вызовы из фронта — `commands.*` из `src/bindings.ts`; низкоуровневые обёртки — `src/Utils/tauri-api.ts`.
- **`src/bindings.ts` сгенерён tauri-specta — руками не править.**
- `src/Utils/tauri-api.ts` не обходить: там window-scoped `listen` (дефолтный `{kind:'Any'}` ловит чужие `emit_to` и плодит мусорные папки в `src-tauri/`) и пул pending-listen'ов (иначе Rust эмитит до регистрации слушателя и событие теряется).
- Добавление команды — два места + регенерация, см. `src-tauri/CLAUDE.md`.

## Дублированные источники истины

Тайпчекер и `cargo` их не проверяют — сверять глазами при правках:

| источник | дубль | как проверить |
|---|---|---|
| `MASKS` в `src/Utils/masks.ts` | `apply_vars` в `src-tauri/src/commands/db_analytics.rs` (руками) | — |
| `MASKS` | таблица в `plugins-dev/_template/ui.md` (между `<!-- MASKS:START/END -->`) | `npm run masks:docs` предупредит о расхождении |
| `jsx/dev` (исходник) | `jsx/distr` (сборка) | `npm run jsx:build` |
| `plugins-dev/<id>/` (исходник) | `distr-plugins/<id>@<ver>/` (бандл) | `npm run plug:build <id>` |

Правки в `plugins-dev/` и `jsx/dev/` **не действуют** до пересборки. Файлы в `distr-plugins/`, `jsx/distr/` и `src/bindings.ts` — артефакты, не источники.

## Жёсткие правила

- **`main` — релизная ветка** с авто-build GitHub Action. Разработка только в feature-ветках; на `main` ничего не делать без явной просьбы.
- **Не запускать повторные `npm install` / `rm -rf node_modules`** — медленный реестр обрывает установку, текучка файлов вешает машину. Один чистый install в фоне или ручная инструкция.
- JSX для After Effects — ES3-стиль: esbuild не транспилит ниже es2015.
- Drag наружу и между колонками отключён намеренно (конфликт нативного drag-плагина с внутренней drop-логикой). Файловые операции — горячими клавишами. Не предлагать вернуть.

## Где живут решения

Текущее устройство — `ARCHITECTURE.md`. Планы будущего — `ideasAndTest/`; там описаны и абстракции, которых в коде ещё нет (список — в разделе «Спроектировано, но не существует» карты). Файл с `+` в начале имени = план реализован. Что в папке есть и в каком состоянии — `ideasAndTest/README.md` (снимок ревизии; истина про конкретный план — в шапке самого плана).

Перед крупной работой в зоне прочитать её план:

- `VISION.md` — общее направление продукта
- `R2_SYNC_PLAN.md` — уход с Google Drive на Cloudflare R2 через бэкенд-API (программа = локальный клиент; байты у клиента, решения у бэкенда)
- `PLUGIN_HOST_API_PLAN.md` — плагины как contribution points; **отложено осознанно**, новое пишем в ядро, но seam-ready
- `ARCHITECTURE_DISTRIBUTED.md` + `DISTRIBUTED_QUEUE_PLAN.md` — оркестратор и воркеры
- `AUTOPOST_DECOUPLED_PLAN.md` — раннер автопостинга отдельно от обработки

## Язык

Комментарии в коде и общение — по-русски, как в существующих файлах.
