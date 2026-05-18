# Инструкции по тестированию проблемы с повторным открытием Node_WIN

## Решение проблемы

**Причина**: Race condition — событие `update-data` отправлялось до того, как React устанавливал обработчик.

**Решение**: Реализован **handshake механизм**:

1. Бэкенд сохраняет последние данные в `NodeWindowState`
2. Фронтенд после установки обработчика вызывает `requestNodeWindowData()`
3. Бэкенд отправляет сохранённые данные через `emit("update-data")`

## Что изменилось

### Rust (Backend)

- ✅ Добавлено состояние `NodeWindowState` для хранения последних данных
- ✅ Обновлена `open_node_window` — сохраняет данные при каждом вызове
- ✅ Новая команда `request_node_window_data` — отправляет данные по запросу
- ✅ Подробное логирование на всех этапах

### TypeScript (Frontend)

- ✅ Новый метод `requestNodeWindowData()` в tauri-api.ts
- ✅ Обновлён `index.tsx` — handshake после установки обработчика
- ✅ Расширенное логирование в store и компонентах

## Сценарий тестирования

### Тест 1: Первое открытие

1. Откройте приложение
2. Кликните на папку для открытия Node Editor
3. **Ожидаемые логи в DevTools окна Node**:
    - `[NodeApp] 🎧 Setting up update-data listener`
    - `[NodeApp] 🤝 Requesting data from backend (handshake)`
    - `[NodeWindow] 🤝 Frontend requested data` (в терминале Tauri)
    - `[NodeWindow] 📤 Sending saved data to requesting window` (в терминале)
    - `[NodeApp] 📨 Received update-data event`
    - `[NodeApp] 📂 Received path (JSON): /path/to/folder`
    - `[usePathStore] 📍 addPath called with: /path/to/folder`
    - `[NodeApp] ⚙️ Init effect triggered`
    - `[NodeApp] 📂 Loaded savedState`
    - `[TopPanel] 📍 Rendered with title prop: /path/to/folder`

### Тест 2: Повторное открытие (ГЛАВНЫЙ ТЕСТ)

1. **Закройте окно Node** (крестиком)
2. **Снова кликните на ту же папку** в главном окне
3. **Ожидаемые логи в DevTools окна Node**:
    - `[NodeApp] 🎧 Setting up update-data listener`
    - `[NodeApp] 🤝 Requesting data from backend (handshake)`
    - `[NodeWindow] 🚀 open_node_window called with data: {...}` (в терминале Tauri)
    - `[NodeWindow] 💾 Saved data to global state` (в терминале)
    - `[NodeWindow] 🔄 Window already exists` (в терминале)
    - `[NodeWindow] 📤 Emitting update-data to existing window` (в терминале)
    - **ПЛЮС ИЛИ вместо этого:**
    - `[NodeWindow] 🤝 Frontend requested data` (в терминале)
    - `[NodeWindow] 📤 Sending saved data to requesting window` (в терминале)
    - `[NodeApp] 📨 Received update-data event, raw data length: XXXX`
    - `[NodeApp] 📂 Received path (JSON): /path/to/folder`
    - `[usePathStore] 📍 addPath called with: /path/to/folder`
    - `[NodeApp] ⚙️ Init effect triggered, path: /path/to/folder`
    - `[NodeApp] 🔧 Starting initialization with path: /path/to/folder`
    - `[NodeApp] 📂 Loaded savedState: {...}`
    - `[TopPanel] 📍 Rendered with title prop: /path/to/folder`

### Тест 3: Открытие другой папки

1. Не закрывая окно Node, кликните на **другую папку**
2. **Ожидаемое поведение**:
    - Данные должны обновиться
    - TopPanel должен показать новое имя папки
    - Flow должен загрузиться из нового файла options.json

## Ключевые логи для поиска проблемы

### Если handshake НЕ работает:

```
[NodeApp] ❌ Handshake failed: ...
[NodeWindow] ⚠️ No saved data available
```

### Если данные загружены, но не отображаются:

```
[NodeApp] 🎨 Render check - savedState: null/empty shouldShowNodeView: false
```

### Если путь не обновляется:

```
[usePathStore] 📍 addPath called with: (старый путь или пусто)
```

## Запуск приложения

```bash
# В одном терминале - запустить dev сервер
npm run dev

# В другом терминале - запустить Tauri
npm run tauri dev
```

## Отладка

Если проблема сохраняется:

1. **Откройте DevTools окна Node** (не главного окна!)
    - На macOS: `Cmd+Option+I` когда окно Node активно
    - Или через Tauri: вызовите `openDevTools()`
2. **Проверьте логи в терминале Tauri** (там логи Rust backend)
3. **Ищите последовательность**:
    - Frontend: `🤝 Requesting data from backend`
    - Backend: `🤝 Frontend requested data` → `📤 Sending saved data`
    - Frontend: `📨 Received update-data event`

## Ожидаемое поведение

- ✅ При первом открытии: полная инициализация с handshake
- ✅ При повторном открытии: handshake получает сохранённые данные
- ✅ TopPanel всегда показывает имя папки
- ✅ NodeView отображает загруженные ноды из options.json
- ✅ Нет чёрного канваса при повторном открытии
