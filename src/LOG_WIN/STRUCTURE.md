# LOG_WIN — структура

Окно логов. Разбито на компоненты, чтобы не держать одну простыню на 1300 строк.

## Файлы

```
src/LOG_WIN/
├── LogApp.tsx              352  — главный shell: IPC, state, оркестровка
├── types.ts                 53  — LogEntry, StepInfo, ProcessingItemGroup, ArchiveDay,
│                                  SourceFilter, TabKey
├── utils.ts                114  — константы (LEVEL_COLOR, STEP_COLOR, LIVE_FINISHED_LIMIT,
│                                  LEVELS) и чистые хелперы (fmt*, effectiveCounts,
│                                  groupByHierarchy, progress, sumStepMs, ...)
├── hooks.ts                 23  — useElapsed, useStepElapsed
└── components/
    ├── StepSquare.tsx       22  — цветной квадратик-статус (queued/running/done/error)
    ├── LogLine.tsx          45  — одна строка лога (timestamp + level + message)
    ├── StepRow.tsx          99  — уровень 4: один плагин (step) внутри item
    ├── ItemAccordion.tsx   190  — уровень 3: один item (файл в обработке)
    ├── ProjectGroup.tsx     79  — уровень 2: проект (группа item'ов)
    ├── MainFolderGroup.tsx  77  — уровень 1: главная папка (группа проектов)
    ├── SectionHeader.tsx    35  — SectionHeader + EmptyState
    ├── Toolbar.tsx         158  — верхняя панель (chips, фильтры, поиск, кнопки)
    ├── LiveView.tsx         86  — вкладка «Текущие»
    └── ArchiveView.tsx      99  — вкладка «Архив»
```

## Иерархия рендера

```
LogApp
 ├── Toolbar                    (статы + фильтры + поиск + экспорт/очистка)
 ├── Tabs (Текущие | Архив)
 └── LiveView | ArchiveView
      └── MainFolderGroup       уровень 1 — главная папка
           └── ProjectGroup     уровень 2 — проект
                └── ItemAccordion  уровень 3 — item (файл)
                     ├── LogLine[] (itemLogs без stepId)
                     └── StepRow   уровень 4 — плагин/шаг
                          └── LogLine[] (логи шага)
```

## Контракт данных

- Данные приходят с Rust по IPC: `log-window:item-start`, `:item-log`, `:node-update`, `:item-end`,
  `:cleared` и `log-window:get-history` (snapshot при монтаже).
- Hot buffer держится в `itemsMap` (useRef), пересборка массива дебаунсится через
  `requestAnimationFrame` — чтобы при шторме log-событий ре-рендерить дерево максимум раз в кадр.
- Лимит «Завершено (сессия)» = `LIVE_FINISHED_LIMIT = 40` (синхронизирован с
  `HOT_BUFFER_FINISHED_LIMIT` на Rust-стороне). Старые завершённые уходят в архив на диск.

## Источники данных по вкладкам

- **Текущие** — RAM hot-buffer. Активные (running/queued) + последние 40 завершённых сессии.
- **Архив** — файлы `app_data_dir/logs/YYYY-MM-DD.jsonl`, читаются командами `logs:list-days`
  и `logs:get-day`. Не висят в памяти — подгружаются по клику на день.

## Подводный камень: счётчики ошибок в архиве

`group.errorCount` / `warnCount` в архивных файлах = 0, потому что Rust пишет на диск группу в том
виде, в котором она пришла на `emit_item_start`, и не инкрементит счётчики на log-событиях
(инкремент делает только renderer в RAM, см. `LogApp.tsx` → `onItemLog`).

Поэтому `utils.ts → effectiveCounts(group)` восстанавливает реальные счётчики из того,
что **точно сохраняется** в архиве:

- `step.status === 'error'`
- записи `level: 'error'` / `'warn'` внутри `step.logs` и `itemLogs`

Берётся максимум от хранимого и вычисленного, чтобы live-вкладка (где renderer уже наинкрементил)
тоже работала корректно.

Применяется везде, где раньше читались сырые `g.errorCount` / `g.warnCount`:
`ItemAccordion`, `ProjectGroup`, `MainFolderGroup`, фильтр «Только с ошибками», `stats` в Toolbar.

## Точка входа

`src/mainLogWindow.tsx` импортирует дефолтный экспорт из `LOG_WIN/LogApp` — путь и сигнатура
после разбиения не менялись.
