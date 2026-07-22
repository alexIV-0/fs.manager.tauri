# План: вкл/выкл проекта → единый источник правды в папке (гибрид D)

**Статус:** РЕАЛИЗОВАНО (2026-07-21, tsc+cargo зелёные). Вариант **D (гибрид)**: файл
`{project}/options/folderState.json` = SSOT, LocalStorage = синхронный кэш горячего пути.
Сайт будет **читать и писать** это состояние (запись с сайта — отдельным шагом).

**Что сделано:**
- Rust: команда `read_folder_states` ([`fs_commands.rs`](../src-tauri/src/commands/fs_commands.rs)),
  зарегистрирована в обоих списках `lib.rs` (`collect_commands!` + `generate_handler!`), биндинги regen.
- Sync-слой [`src/Utils/folderState.ts`](../src/Utils/folderState.ts): `persistEnabled`,
  `recordActivity` (троттлинг ~1/сутки), `hydrateMainFolder` (per-field merge + ленивая миграция),
  guard `pathExists` от воскрешения удалённой папки.
- Write-through: [`useFoldersFromLS.ts`](../src/MAIN_WIN/hooks/useFoldersFromLS.ts) (ручной тогл),
  [`findAllFilesForProcess.ts`](../src/PROCESSING/findAllFilesForProcess.ts) (бамп активности → `recordActivity`,
  auto-off → `persistEnabled('auto')`).
- Гидрация на каждом reload: [`reloadFolders.ts`](../src/PROCESSING/reloadFolders.ts).
- LS-формат НЕ менялся (off-список + `${id}::activity`) — горячий цикл и UI-реактивность нетронуты.

Ниже — исходный дизайн (актуален как справка).

---

### Отличия реализации от исходного плана
- `mainFolderPath` НЕ прокидывали в `ProjectFolderItem` — `folderState` резолвит путь по id из
  `mainFolders_stor` (проще, меньше правок сигнатур).
- `lastActivityAt` пишем в файл (троттлинг ~1/сутки), как и просил юзер, — не выкинули в LS-only.
- Добавлен guard `pathExists` перед записью (не было в плане): `write_file` делает `create_dir_all`,
  и stale-запись после delete/rename воскресила бы папку.

## Зачем

Состояние «папка вкл/выкл» и таймер авто-отключения сейчас живут только в LocalStorage
конкретной машины. Скоро появится сайт, который должен **отображать и менять** состояние
папок. Значит правда должна жить в самой папке (в `options/`), а не в LS одной машины —
первый шаг к модели «папка = единый источник правды» (см. [`ARCHITECTURE_DISTRIBUTED.md`](./ARCHITECTURE_DISTRIBUTED.md)).

---

## Как устроено сейчас (что переносим)

Два независимых хранилища в LS, **ключ по `mainFolderId`** (агрегат по главной папке, не по проекту):

1. **Off-список** — ключ = сам `mainFolderId`, значение `string[]` имён **выключенных** папок.
   Папка включена = её имени нет в массиве.
   - Хаб: [`useFoldersFromLS.ts`](../src/MAIN_WIN/hooks/useFoldersFromLS.ts) (`addFolder`=выкл, `removeFolder`=вкл; событие `folders-off-list-changed`).
   - Чекбокс: [`ProjectFolderItem.tsx:222`](../src/MAIN_WIN/ProjectFolderColumn/ProjectFolderItem.tsx).
   - Скан: [`findAllFilesForProcess.ts:66`](../src/PROCESSING/findAllFilesForProcess.ts) (`getOffArr.includes` → скип; тут же чистка и дозапись авто-off).
   - Prune: [`reloadFolders.ts:19`](../src/PROCESSING/reloadFolders.ts).
   - Жёлтая подсветка «все проекты off»: [`FolderItem.tsx:103`](../src/MAIN_WIN/MainFolderColumn/FolderItem.tsx).

2. **Карта активности** — ключ `${mainFolderId}::activity`, значение `Record<projectName, msEpoch>`.
   Вся логика в [`projectActivityLS.ts`](../src/Utils/projectActivityLS.ts). Дату двигают обработка
   (`addedCount>0`) и ручное включение холодной папки (сутки-грейс).

3. **Авто-отключение** — [`findAllFilesForProcess.ts:88-119`](../src/PROCESSING/findAllFilesForProcess.ts):
   `cutoff = now − cleanup.autoDisableDays` ([`appSettings.ts:50`](../src/types/appSettings.ts)),
   у первого встреченного проекта засев «сейчас», у холодных (`activity < cutoff`) → дозапись в off-список.
   Если все проекты off → главная папка активна, но цикл файлов пропускается (желтеет в UI).

### Свойства, важные для дизайна
- Ключ по имени → возня с чисткой при rename/delete (в трёх местах). Файл-на-проект её убирает:
  идентичность = сама папка, `state` едет с ней при rename/move, сироты невозможны.
- Чтения синхронные в горячем цикле. Файлы = async + N чтений с диска (Google Drive) за проход →
  нужен кэш + батч-ридер.
- `options/` **намеренно не создаётся** у нетронутых проектов ([`ensureProjectFolders.ts`](../src/NODE_WIN/utils/ensureProjectFolders.ts)) — политика записи не должна плодить его во всех папках.
- Разная частота: `enabled` меняется редко; `lastActivity` дёргается каждый проход с находками →
  в файл писать троттлингом, иначе шум в gsync.

---

## Целевой контракт файла

`{project}/options/folderState.json`:

```jsonc
{
  "schemaVersion": 1,
  "enabled": true,                       // авторская воля: ручной чекбокс / сайт / auto-off
  "disabledReason": null,                // null | "manual" | "auto"
  "disabledAt": null,                    // ISO UTC когда выключили (для сайта); null если on
  "lastActivityAt": "2026-07-21T13:44:54.816Z",  // троттлинг ~1/сутки; merge = max
  "updatedAt": "2026-07-21T13:44:54.816Z",        // для LWW по enabled
  "updatedBy": "app:<machineId>"         // "app:<machineId>" | "site"
}
```

Формат времени — ISO UTC с `Z`, единообразно со [`STATS_SCHEMA_PLAN.md`](./STATS_SCHEMA_PLAN.md).
`projectPathGD` НЕ пишем (на разных машинах разный) — идентичность даёт расположение самого файла.

### Политика записи (без замусоривания)
Файл появляется **только у проектов, которые реально трогали**:
- при смене `enabled` (ручной toggle / auto-off) — пишем сразу;
- при бампе активности (`addedCount>0`) — пишем **троттлингом ~1/сутки** (сравниваем дату дня).

Нетронутый проект (нет тоглов, нечего обрабатывать) файла не получает → `options/` не плодится,
gsync не шумит. Это ровно те проекты, что интересны сайту.

---

## Слияние (per-field, не «весь файл»)

Файл = SSOT. LS = его кэш. На **каждом** reload/проходе перечитываем файлы и подхватываем
внешние правки (сайт/вторая машина через gsync) — не только на первом запуске.

- `enabled` + `disabledReason` + `disabledAt` — **last-write-wins по `updatedAt`**.
  Локальные правки идут write-through в файл сразу, поэтому обычно кэш = файл; интересен только
  случай «файл новее кэша» → адаптируем значение из файла.
- `lastActivityAt` — **merge = max** (свежайшая активность и есть правда; пишут только
  обрабатывающие инстансы). Защищает от машины с отстающими часами, занижающей дату.
- **Авто-отключение остаётся производным**: программа локально считает `merged lastActivityAt`
  vs `autoDisableDays` и при холоде ставит `enabled:false, reason:"auto"`. Auto-off «липкий» до
  ручного включения (как сейчас).

### Известное ограничение (осознанное для шага 1)
gsync — не merge-движок: два инстанса, редактирующие **один файл** в одном окне синка, → gsync
оставит одну версию (или «conflicted copy»). Одновременный тогл одного проекта с двух мест редок;
`updatedAt` позволяет читателю увидеть устаревание. Надёжное решение (сервер-авторитет по `updatedAt`
для правок с сайта, сайт-как-оркестратор) — в [`ARCHITECTURE_DISTRIBUTED.md`](./ARCHITECTURE_DISTRIBUTED.md).
Пока правкам с сайта `updatedAt` ставит сервер (его время авторитетно), а не браузер.

---

## Точки интеграции (что меняется)

Идея: **LS-формат не трогаем** (агрегат по `mainFolderId`) — горячий цикл остаётся синхронным.
Добавляем sync-слой, который транслирует агрегат ↔ per-project файлы.

**Новый модуль** `src/Utils/folderState.ts` (sync-слой):
- `hydrateMainFolder(mainFolderId, mainFolderPath, projectNames)` — батч-читает файлы,
  мёржит в LS-кэш (off-список + activity), фиксит внешние правки. Зовётся из `reloadFolders`.
- `setEnabled(mainFolderPath, projectName, enabled, reason)` — write-through: правит агрегат в LS
  + пишет `folderState.json` (с `updatedAt`/`updatedBy`) + шлёт `folders-off-list-changed`.
- `bumpActivity(mainFolderPath, projectName, ts)` — правит LS-карту; в файл пишет троттлингом.
- Синхронные геттеры для горячего цикла (читают из LS-кэша, как сейчас).

**Правки существующего:**
| Файл | Что делаем |
|---|---|
| [`useFoldersFromLS.ts`](../src/MAIN_WIN/hooks/useFoldersFromLS.ts) | `add/removeFolder` → зовут `folderState.setEnabled`, а не пишут LS напрямую |
| [`projectActivityLS.ts`](../src/Utils/projectActivityLS.ts) | `setProjectActivity` → через `bumpActivity` (троттлинг + файл) |
| [`ProjectFolderItem.tsx`](../src/MAIN_WIN/ProjectFolderColumn/ProjectFolderItem.tsx) | toggle/`reactivateOnManualEnable` → через sync-слой (нужен `mainFolderPath`, не только id) |
| [`findAllFilesForProcess.ts`](../src/PROCESSING/findAllFilesForProcess.ts) | чтения из кэша (как есть); авто-off и засев активности → через sync-слой |
| [`reloadFolders.ts`](../src/PROCESSING/reloadFolders.ts) | добавить `hydrateMainFolder` (читаем диск → и файлы состояния); prune LS-кэша остаётся |
| [`FolderItem.tsx`](../src/MAIN_WIN/MainFolderColumn/FolderItem.tsx) | без изменений (читает LS-кэш, слушает то же событие) |

**Новая Rust-команда** `read_folder_states(main_folder_path) -> Vec<{ name, state }>`:
одним вызовом читает `<project>/options/folderState.json` по всем подпапкам (иначе N round-trip к GD).
Запись — существующей `commands.writeFile` (JSON pretty). Отсутствующий файл → `null`/пропуск.

---

## Миграция из LS (ленивая)

В `hydrateMainFolder`, для каждого проекта:
1. Файл есть → он источник правды, мёржим в кэш (см. слияние).
2. Файла нет, но проект в **legacy off-списке** → одноразово пишем файл
   `{enabled:false, disabledReason:"manual", disabledAt:now, updatedBy:"app:<id>"}`
   (manual vs auto из legacy не различить → трактуем как sticky-manual, безопаснее).
3. Файла нет, проект включён → **ничего не пишем**. Таймер активности пере-засеется «сейчас»
   (как текущее поведение «первая встреча = seed now»); задним числом ничего не отключится.

Legacy-ключи LS (`mainFolderId`, `${id}::activity`) оставляем как кэш — они больше не SSOT.

---

## Фазы

1. **Контракт + Rust-ридер.** `folderState.json` (schemaVersion 1), команда `read_folder_states`.
2. **Sync-слой** `folderState.ts` + разводка write-through в `useFoldersFromLS`/`projectActivityLS`.
   Прокинуть `mainFolderPath` в `ProjectFolderItem` (сейчас там только id).
3. **Hydrate + миграция** в `reloadFolders`; на каждом reload подхватываем внешние правки.
4. **Троттлинг активности** (1/сутки) в `bumpActivity`.
5. **Проверка**: rename/move проекта (state едет с папкой, off-список не осиротел), внешняя правка
   файла подхватывается на reload, нетронутые проекты файла не получают.

## Открытый вопрос
- `updatedBy: "site"` требует, чтобы `updatedAt` ставил сервер (часы сайта авторитетны). Формат уже
  готов; сама запись с сайта — вне этого шага (появится с сайтом-оркестратором).
