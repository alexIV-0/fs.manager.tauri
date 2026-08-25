# Тестирование повторного открытия Node_WIN (handshake данных)

> **Статус: механизм в проде** (`request_data` зарегистрирована в `lib.rs`, зовётся из
> `src/Utils/tauri-api.ts`). Это не план, а runbook ручной проверки — держим на случай
> регрессии. Хвост файла — образец markdown для проверки рендерера документации.

## Проблема

**Причина**: race-condition — backend эмитит `update-data` сразу после `tauri://loaded`, но React
в окне Node мог ещё не успеть подписаться на событие → данные терялись, при повторном открытии
канвас оставался пустым.

## Решение — handshake через `request_data`

> ⚠️ Раньше handshake звался `requestNodeWindowData` / `request_node_window_data`. Этот вариант
> **удалён** (мёртвый код, 2026-06-08). Текущий механизм — обобщённая команда `request_data`,
> которая по метке webview обслуживает и окно `nodeWin`, и мульти-инстансные `preview-*` окна.

1. Backend хранит последние данные в `NodeWindowState` (`last_data`).
2. `open_node_window` сохраняет данные в это состояние при каждом вызове.
3. Frontend (`src/NODE_WIN/index.tsx`) сначала ставит слушатель `onUpdateData`, **затем** зовёт
   `requestData()` (→ Rust `request_data`) — порядок гарантирует, что подписка готова до эмита.
4. `request_data` смотрит метку вызывающего webview (`nodeWin`), берёт `last_data` и эмитит
   `update-data` обратно именно в это окно.

## Что в коде

### Rust — `src-tauri/src/commands/window_commands.rs`
- `NodeWindowState` — хранит `last_data`.
- `open_node_window` — сохраняет данные при каждом вызове + эмитит при создании/повторном показе окна.
- `request_data` — handshake по метке webview (`nodeWin` / `preview-*`).

### TypeScript — `src/NODE_WIN/index.tsx`
- `window.tauriAPI.onUpdateData(handler)` → затем `window.tauriAPI.requestData()` (один раз, по `initialized` ref).
- На событие `update-data`: `addPath(data)` → создаёт IN/options/OUT и грузит node-obj из `options.json`.

## Сценарии теста

> Логи смотреть в **терминале Tauri** (Rust `println!`). Фронт `index.tsx` в этом потоке не логирует.

### Тест 1 — первое открытие
1. Открыть приложение, кликнуть папку.
2. Ожидаемые логи (терминал Tauri):
    - `[NodeWindow] 🚀 open_node_window called with data: ...`
    - `[NodeWindow] 💾 Saved data to global state`
    - `[NodeWindow] ✨ Creating new window`
    - `[NodeWindow] ⏳ Waiting for window to load...`
    - `[NodeWindow] 📤 Window loaded, emitting update-data`
    - `[NodeWindow] ✅ Initial data sent to new window`
    - `[request_data] called from webview 'nodeWin'` (handshake от React после монтирования)
3. Окно Node показывает имя папки + ноды из `options.json`.

### Тест 2 — повторное открытие (ГЛАВНЫЙ ТЕСТ)
1. **Закрыть окно Node** крестиком.
2. **Снова кликнуть ту же папку** в главном окне.
3. Ожидаемые логи:
    - `[NodeWindow] 🚀 open_node_window called with data: ...`
    - `[NodeWindow] 💾 Saved data to global state`
    - `[NodeWindow] 🔄 Window already exists, showing and sending data`
    - `[NodeWindow] 📤 Emitting update-data to existing window`
    - `[NodeWindow] ✅ Data sent successfully`
    - `[request_data] called from webview 'nodeWin'`
4. Канвас **не пустой**, ноды на месте, TopPanel показывает имя папки.

### Тест 3 — другая папка без закрытия
1. Не закрывая окно Node, кликнуть **другую папку**.
2. Ожидаемо: данные обновляются, TopPanel показывает новое имя, flow грузится из нового `options.json`.

## Признаки проблемы

- `[request_data] no last_data for 'nodeWin'` — backend не сохранил данные → проверить `open_node_window`.
- Пустой канвас при повторном открытии — handshake не сработал → проверить порядок
  `onUpdateData` → `requestData()` в `index.tsx` (слушатель ДО запроса).
- `[request_data] emit_to failed: ...` — окно не найдено по метке → проверить label `nodeWin`.

## Запуск приложения

```bash
# В одном терминале — dev-сервер
npm run dev

# В другом — Tauri
npm run tauri dev
```

## Отладка

1. **DevTools окна Node** (не главного!): на macOS `Cmd+Option+I` когда окно Node активно.
2. **Логи Rust** — в терминале Tauri.
3. Искать последовательность: `open_node_window` → `Saved data to global state` →
   (создание/показ окна) → `[request_data] called from webview 'nodeWin'` → React получил `update-data`.

## Ожидаемое поведение

- ✅ Первое открытие: окно создаётся, данные доходят через initial-emit + handshake.
- ✅ Повторное открытие: окно переиспользуется, handshake отдаёт сохранённые `last_data`.
- ✅ TopPanel всегда показывает имя папки.
- ✅ NodeView отображает ноды из `options.json`.
- ✅ Нет чёрного/пустого канваса при повторном открытии.

---

## Работа с документацией в стиле markdown

**жирный**
_курсив_
**_жирный курсив_**
`инлайн код`
Заголовки (H1–H3 стилизованы, светлые):

# Большой заголовок

## Средний

### Малый

Списки:

- пункт
- пункт
    - вложенный пункт

1. первый
2. второй
   Цитата (с синей левой полосой):

> Важное замечание или предупреждение
> Блок кода:

```
ffmpeg -i input.mp4 output.mp3
```

Картинка:

![описание](/docs/images/file.png)
Ссылка:

[текст ссылки](https://example.com)
Разделитель (горизонтальная линия — работает синтаксически, но стиля нет):

---
