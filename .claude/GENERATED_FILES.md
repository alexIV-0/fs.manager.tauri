# Реестр файлов, созданных Claude

Созданы 2026-08-10 (ветка `someDev`). Все перечисленные ниже файлы **новые**.

**Одно исключение — удаление:** в тот же день удалён отслеживаемый `ideasAndTest/+MIGRATION_NOTES.md` (заметки периода переезда Electron → Tauri). Причина: внутри все восемь пунктов миграции были помечены «🔴 Not started», хотя миграция завершена, а пути указывали в несуществующий каталог `src-tauri/src/services/*` — документ дезинформировал бы любого, кто прочтёт его как описание проекта. Живая часть (шесть «Key Differences» и таблица замен зависимостей) перенесена в `ARCHITECTURE.md`, раздел «Наследство миграции с Electron».

Восстановить:

```bash
git log --diff-filter=D --oneline -- 'ideasAndTest/+MIGRATION_NOTES.md'
git checkout <коммит>^ -- 'ideasAndTest/+MIGRATION_NOTES.md'
```

Пока удаление не закоммичено, хватит `git restore --staged --worktree 'ideasAndTest/+MIGRATION_NOTES.md'`.

Раньше этот реестр назывался `.claude/GENERATED_CLAUDE_MD.md` — переименован, когда к нему добавились скиллы.

## Карта проекта

| файл | когда читается | о чём |
|---|---|---|
| `ARCHITECTURE.md` | по ссылке из `CLAUDE.md`, на входе в незнакомую зону | карта **текущего** состояния: 24 пласта (границы · где код · где план · статус · связи), 4 уровня хранения состояния, швы и дубли, раздел «спроектировано но не существует», соглашения репозитория, честный список пробелов |

## Контекст: CLAUDE.md

| файл | когда грузится | о чём |
|---|---|---|
| `CLAUDE.md` | всегда, в каждой сессии и в каждом субагенте | команды проверки, 4 окна/realm'а, IPC, дублированные источники истины, жёсткие правила, указатель на `ideasAndTest/` |
| `src-tauri/CLAUDE.md` | при работе с файлами `src-tauri/` | новая команда = 3 места + `cargo test export_bindings`, тест-страж двух списков, экспорт биндингов, соглашения по модулям |
| `plugins-dev/CLAUDE.md` | при работе с файлами `plugins-dev/` | пересборка обязательна, **доставка = отдельный канал** (`app_data/plugins`, релиз плагины не несёт), состав плагина, ловушка «ровно одна экспортированная функция», `_item`/`_description`, маски |
| `src/NODE_WIN/CLAUDE.md` | при работе с файлами `src/NODE_WIN/` | controlled flow и единая точка изменений, каскад через `setTimeout(0)`, `useUpdateNodeInternals`, мерцание от `box-shadow`, движок `controlType` |

## Процедуры: скиллы

| файл | вызов | о чём |
|---|---|---|
| `.claude/skills/new-plugin/SKILL.md` | `/new-plugin` | скаффолд плагина: вводные → спека `_template/*.md` + аналог → 3 файла → мины → `plug:build` → проверка. Компонент React не нужен, всё рендерит `GenericNode` |
| `.claude/skills/to-main/SKILL.md` | `/to-main` | предмёрж-гейт: проверки (`tsc`/`cargo check`/`cargo test`), дрифт по диффу, подтверждение, мёрж; версию не бампить — это делает CI |

## Полный откат

```bash
rm ARCHITECTURE.md
rm CLAUDE.md src-tauri/CLAUDE.md plugins-dev/CLAUDE.md src/NODE_WIN/CLAUDE.md
rm -r .claude/skills/new-plugin .claude/skills/to-main
rm .claude/GENERATED_FILES.md
```

`ARCHITECTURE.md` связан с корневым `CLAUDE.md` двумя ссылками (шапка и раздел «Где живут решения») — удаляя карту, убери и их.

Частичный откат — удалить любой отдельный файл или скилл, остальные продолжат работать независимо.

На момент создания эти файлы были **единственным** несохранённым в дереве (всё остальное закоммичено в `c4d9139 add cloud storage`). Если с тех пор появились другие untracked-файлы, `git clean -f` зацепит и их — проверяй `git clean -n` перед запуском, либо пользуйся `rm` выше.

## Что осталось не сделано (сознательно)

- Скрипты `typecheck` / `check:rust` в `package.json` не добавлены, чтобы откат остался чисто аддитивным. Если добавить — блок команд в корневом `CLAUDE.md` можно сократить до имён скриптов.
- Скиллы `add-ipc-command`, `add-mask`, `ffmpeg-filter` **не** создавались осознанно: это уже факты в соответствующих `CLAUDE.md`, а дубль-процедура со временем разойдётся с оригиналом. Скилл релиза с ручным бампом версий не создавался потому, что он воевал бы с CI.
- Зональный файл для `src/PROCESSING/` не создан: раннер подробно закомментирован в `processItem.ts`.

## Правило против дублей

Один факт — один дом, остальные ссылаются. Номера строк (`файл.rs:131`) живут **только** в доме факта, в остальных местах — имя символа, которое не стареет:

| факт | дом |
|---|---|
| три места регистрации команды, тест-страж, экспорт биндингов | `src-tauri/CLAUDE.md` |
| `apply_vars` как дубль масок | `src-tauri/CLAUDE.md` |
| `resolveCallable` и форма экспорта плагина | `plugins-dev/CLAUDE.md` |
| грабли React Flow (каскад, мерцание, рамка выделения) | `src/NODE_WIN/CLAUDE.md` |
| команды проверки | корневой `CLAUDE.md` |
| полная таблица дублей и стражей | `ARCHITECTURE.md`, Часть VI |

Скиллы намеренно не объясняют, а только предписывают действия и ссылаются на дом.

## Проверенные факты (по коду, не по памяти)

- `apply_vars` — `src-tauri/src/commands/db_analytics.rs:131`; маски — `src/Utils/masks.ts:83`; маркеры таблицы — `plugins-dev/_template/ui.md:378`.
- Два списка команд: `collect_commands!` — `src-tauri/src/lib.rs:51`, `generate_handler!` — `:452`; тест-страж — `:724`; экспорт в `"../src/bindings.ts"` — `:249` (под `#[cfg(debug_assertions)]`).
- Rust-тестов ~96 (`#[test]`), плотнее всего в `src-tauri/src/storage/`. Фронт-тестов и линтера нет.
- `resolveCallable` — `src/PROCESSING/processItem.ts:635`; кастомные рендереры нод — `src/NODE_WIN/hooks/useFlowTypes.tsx:12` (всё остальное → `GenericNode`).
- `.react-flow__nodesselection-rect { pointer-events: none }` — `src/NODE_WIN/index.css:112`.
- Релиз: `release.yml` на push в `main` + `workflow_dispatch`; сам бампит версию в трёх файлах и коммитит обратно с `[skip ci]`; артефакты → `alexIV-0/fs.manager.releases`; `plug:build` в CI не вызывается, `distr-plugins` в `.gitignore`; prod-путь плагинов — `app_data/plugins` (`plugin_commands.rs:105`).
