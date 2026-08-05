# План: обогащённая схема статистики — пресет «Локальный архив (JSONL)»

Статус: **схема заморожена (v1), реализация не начата.**
Цель: пофайловый вечный JSONL, из которого на чтении строятся любые графики/агрегаты
(за день/неделю/месяц/год, по проекту, платные/бесплатные, тайминги, hover-превью финала).

Правим пресет `local-archive` → функция `write_local_archive`
([`src-tauri/src/commands/db_analytics.rs:315`](../src-tauri/src/commands/db_analytics.rs)).
Строка `local-archive` в `src/Utils/tauri-api.ts:444` — только пункт дропдауна, логики там нет.

---

## Финальная схема v1 (одна строка на item)

```jsonc
{
  "schemaVersion": 1,            // растим ключи в v2+; имя понятное, не "v"
  "itemId": "1783518294815-f40c4d9b",
  "status": "done",             // на практике только done | error (aborted не долетает)

  "project":    "reels from vid",   // имя проекта   — нужно для сводной по нескольким
  "mainFolder": "newMainFolder",    // имя главной папки
  // projectPathGD НЕ пишем: на разных машинах разный. Корень вычисляем на чтении
  // из расположения самого .jsonl (…/mainFolder/project/options/_stat/07.jsonl → вверх на 2).

  "curItem": "1 - Виталий Быков … .mp4",   // имя исходника
  "inType":  "mp4",                         // расширение входа
  "outType": "mp4",                         // расширение выхода

  "registeredAt": "2026-07-08T13:44:54.816Z",  // нашли файл          ┐ всё UTC, «Z»,
  "startedAt":    "2026-07-08T13:50:12.000Z",  // старт обработки     │ единый формат
  "endedAt":      "2026-07-08T13:55:54.011Z",  // конец               ┘ (мс + Z)

  "outSec":    42,      // хронометраж финального файла(ов), секунды (число!)
  "renderSec": 342,     // endedAt − startedAt — честный рендер БЕЗ времени очереди

  "out": ["OUT/shorts/clip_01.mp4"],   // пути относительно корня проекта

  "totalCost": 0.0915063               // 0 → бесплатно; при error платы не берём (см. правило)
}
```

### Правила чтения (НЕ храним — считаем)
- **Корень проекта / абсолютный путь финала** — из расположения `.jsonl` + `out[]`.
- **Платный / бесплатный** — `status === 'done' && totalCost > 0`. Ошибку не тарифицируем.
- **Файл жив / удалён** — `stat` по `<корень>/out[i]`; есть → hover-превью, нет → бейдж «удалён».
- **Занятое место на диске** — из папки OUT (не храним размеры в записи).
- **Категория `video/image/audio`** — маппинг из `inType`/`outType` при желании.
- **Год / период** — из `registeredAt`/`startedAt`.
- Все агрегаты (сумма `outSec`, сумма `renderSec`, счётчики, спенд) — поверх строк.
- Дом для UI уже зарезервирован: заглушка `ProjectStatsModal.tsx:78` («Статистика проекта появится здесь»).

---

## Ловушки, ради которых всё это (зафиксировать, чтобы не повторить)

1. **`registeredAt` ≠ старт обработки.** Это момент, когда файл *нашли*
   (`chrono::Utc::now()`, `settings_commands.rs:458`). Текущий архив считает
   `renderTime = endedAt − registeredAt` (`db_analytics.rs:72-82`) → в «рендер» затекает
   ожидание в очереди. Правильно: `renderSec = endedAt − startedAt`.
2. **Рассинхрон таймзон.** `registeredAt` из Rust = `…+00:00` (микросекунды),
   `endedAt`/`startTime` из JS = `…Z` (мс). Нормализуем всё к `…Z` (мс).
3. **`duration` в системе = хронометраж РЕЗУЛЬТАТА, не исходника.** Считается ffprobe по
   выходным файлам терминальных шагов (`collectMediaDuration`, `processItem.ts:676-707`).
   Источник не пробится вообще — и это ОК, нам нужен именно финал. → поле `outSec`.

---

## Что убрали и почему

| Убрали | Причина |
|---|---|
| `projectPathGD` | абсолютный путь машины; вычисляем из пути к `.jsonl` |
| размеры in/out | не нужны; занятое место — из папки OUT на чтении |
| `tags` | старые сокращения процессов, отказались |
| отдельный `paid` | выводится из `status`+`totalCost` |
| `year`, `contact`, `size`, `is_folder` | лишнее / выводится из времени |
| host/appVersion, кодек/разрешение источника, breakdown цены, flow | отклонено |

---

## Отложено в v2 (schemaVersion делает это безопасным)

- **`plugins: [...]`** — «какими плагинами больше пользуемся». Единственное поле, требующее
  возни: массив шагов сейчас выбрасывается на регистрации (`db_register_found` игнорирует
  `plugins`, `settings_commands.rs:428`). Поднимаем при желании.
- **`srcSec`** — хронометраж исходника: только отдельным ffprobe-проходом по источнику.
- **`database-sync` / онлайн-БД** — пуш этой же схемы на удалённый URL (`storage.onlineDb`,
  сейчас заглушка без Rust-обработчика). Схема v1 = готовый payload под это.

---

## Реализация — чек-лист по файлам

### A. Rust — `write_local_archive` (основная работа, чистый Rust)
Файл `src-tauri/src/commands/db_analytics.rs:315-347`. Переписать тело `entry`:
- [ ] `schemaVersion: 1` (константа).
- [ ] переименовать ключи: `projectName`→`project`, `mainFolderName`→`mainFolder`.
- [ ] убрать `projectPathGD` из вывода (но `record.project_path_gd` нужен внутри — см. `out`).
- [ ] `inType` — расширение из `record.cur_item` (`rfind('.')`, как `clear_name` в `apply_vars:106`).
- [ ] `outType` — расширение из первого элемента `out_files`.
- [ ] `registeredAt` — нормализовать к `…Z` (мс) через новый хелпер (см. C).
- [ ] `startedAt` — из нового параметра `started_at` (нормализовать).
- [ ] `outSec` — `parse_duration_secs(duration)` (helper уже есть, `:47`). **Прокинуть `duration`
      в сигнатуру** — сейчас `write_analytics` его получает, но в `write_local_archive` НЕ передаёт
      (сравни вызовы `:425-429`).
- [ ] `renderSec` — `render_secs(started_at, ended_at)` (helper `:72`, но со `started_at`, не с registered!).
- [ ] `out` — каждый путь из `out_files` относительно `record.project_path_gd`
      (`Path::strip_prefix`; если файл не под корнем — оставить как есть/basename, залогировать).
- [ ] `totalCost` — как есть.

### B. Rust — прокинуть новые данные до writer'а
- [ ] `write_analytics` (`db_analytics.rs:352`) — добавить параметры `started_at: &str`,
      `out_files: &[String]`; в ветке `local-archive` (`:429`) передать их + `duration`.
      (Остальные шаблоны параметры игнорируют.)
- [ ] `log_window_emit_item_end` (`window_commands.rs:1498-1506`) — извлечь:
      - `started_at` из `finished_group["startTime"]` (группа уже в руках, `:1494`);
      - `out_files` из `payload["outFiles"]` (новое поле, см. C-фронт).
      И передать в `write_analytics`.

### C. Frontend — отдать пути выходных файлов (единственная правка фронта)
Файл `src/PROCESSING/processItem.ts`:
- [ ] `collectMediaDuration` (`:676-707`) — вернуть не только сумму секунд, но и список путей
      выходных файлов терминальных шагов (пути уже читаются на `:691-693`, сейчас теряются).
      Для `out[]` собирать **все** терминальные выходы (не только media); `outSec` по-прежнему
      суммировать только по media-расширениям.
- [ ] item:end payload (`:370` и обёртка `:195-204`) — добавить `outFiles: string[]` (абсолютные пути).

### D. Rust — хелпер нормализации времени (новый)
- [ ] `fn iso_utc_z(s: &str) -> String` — распарсить rfc3339, привести к UTC,
      форматировать `%Y-%m-%dT%H:%M:%S%.3fZ`. Применять к `registeredAt`/`startedAt`
      (endedAt из JS уже в этом формате, но прогнать защитно не мешает).

### Связанное, опционально (вне скоупа v1)
- Те же `by-day/by-month/...` считают `renderTime` от `registeredAt` (ловушка №1). Если захотим
  честные агрегатные тайминги — переключить их на `startedAt` тем же приёмом. Пока не трогаем.

---

## Дефолтная запись в настройках (сделано)

Чтобы пресет не надо было настраивать заново на каждой машине/у клиента — прописан дефолт
в ОБА источника (держать синхронно, дрифт-риск):
- Rust `default_app_settings()` — `settings_commands.rs`
- TS `DEFAULT_APP_SETTINGS` — `src/types/appSettings.ts`

```jsonc
{ "enabled": true, "templateId": "local-archive",
  "path": ["$projectPathGD", "options", "_stats", "$YYYY.$MM"] }
```
→ `<project>/options/_stats/2026.07.jsonl`. Папка `_stats`, маска `$YYYY.$MM` (хронологичная
сортировка). **Только свежие установки:** `app_settings_get` читает существующий `settings.json`
как есть (дефолты мёржатся лишь при отсутствии файла), миграцию существующих НЕ делаем.

## Проверка после реализации
- Обработать 1-2 файла (done) + 1 с ошибкой → глянуть строки в `<project>/options/_stat/<YYYY>.<MM>.jsonl`.
- Убедиться: `renderSec` не включает время простоя в очереди; `out[]` резолвится в живой файл;
  все три метки времени в едином `…Z`-формате; `totalCost=0` у ошибки.
- Свести дневной агрегат вручную из строк и сверить с `by-day` (`07_July.json`): `files`,
  `successCount`, `errorCount`, сумма `outSec`↔`duration`, сумма `renderSec`↔`renderTime`.
