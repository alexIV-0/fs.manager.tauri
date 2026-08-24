---
name: new-plugin
description: Создать новый плагин-ноду в plugins-dev (скаффолд plugin.json + ui.json + код, сборка, проверка). Использовать при запросах «новый плагин», «новая нода», «добавь плагин <имя>», а также при существенной переделке ui.json существующего плагина.
---

# Новый плагин

Пайплайн полностью декларативный: React-компонент писать **не надо** — `GenericNode` строит ноду из `ui.json`, кастомные рендереры есть только для `spy` (`CUSTOM_NODE_RENDERERS` в `src/NODE_WIN/hooks/useFlowTypes.tsx`). Твоя работа — три файла и сборка.

## 1. Собрать вводные

Спросить у пользователя, чего не хватает (не угадывать):

- `id` папки и человекочитаемое `name`
- что плагин делает: какие входы (типы: `video`/`audio`/`image`/`text`/`aep`/`moho`/`folders`) и что возвращает
- нужны ли внешние npm-пакеты, ffmpeg, внешний бинарь

## 2. Прочитать спеку и аналог

Не восстанавливать формат по памяти — он документирован:

- `plugins-dev/_template/plugin.md` — манифест по полям
- `plugins-dev/_template/ui.md` — `ui.json`: корневые поля, `data`, массив `properties`, все `controlType` с их `controlProps`
- `src/PluginAPI/host.ts` — что доступно внутри плагина: сервисы `fs`, `http`, `ffmpeg`, `exec`, `ae`, `paths`, `system`, `fonts` + тип `PluginContext`. Приходят третьим аргументом (`ctx`), не импортом

Затем прочитать **ближайший существующий плагин** и держать его форму:

| задача | аналог |
|---|---|
| простая файловая операция | `copyFile` |
| ffmpeg-обработка | `convertFile_v2`, `keyingFFmpeg` |
| HTTP / внешний API | `AIparser`, `autoPostVK` |
| логика над массивами | `loop`, `elementFromArray`, `sortByType` |

## 3. Создать `plugins-dev/<id>/`

`plugin.json` — по образцу `copyFile/plugin.json`. `main` = имя **скомпилированного** `.js`, не `.ts`.

`ui.json` — целиковое определение ноды (`type`, `width`/`height`, `data.label`, `data.colorType`, `data.properties[]`).

Код `<main>.ts`:

```ts
import type { PluginContext } from '../../src/PluginAPI/host';

export async function myPluginFunc(_item: any, _description: any, ctx: PluginContext): Promise<string[]> {
	const { fs, sendToMW } = ctx;
	…
}
```

`onLoad` не экспортировать: его наличие запрещает загрузчику кэшировать модуль.

## 4. Мины (проверить каждую перед сборкой)

- **Ровно одна экспортированная функция.** Раннер (`resolveCallable` в `src/PROCESSING/processItem.ts`) берёт `default` → сам модуль → **первую попавшуюся** функцию кроме `onLoad`/`onUnload`. Экспортированный хелпер молча станет точкой входа. Хелперы не экспортировать.
- **`type` в `ui.json` уникален по всем плагинам.** `getNodeTypes()` складывает ноды в объект по `type` — дубль тихо перекроет чужую ноду.
- **Входы приходят как `_item.import.<id>`** (уже разрешённые массивы), обычные свойства — по `id`, динамические (через «+» с `editLabel`) — **по лейблу**.
- **Относительный путь из `pathNavigator`** резолвить от `_description.projectPathGD`, не от `mainWorkFolder`.
- **Свои маски заводить нельзя** — список дублирован в Rust `apply_vars`. Пользоваться `formatNameByPattern` / `createPathForFileByPattern` из `src/Utils/`.
- **`path`, `fs`, `node:*`** — это полифилы `src/PluginAPI/*`, а не Node. Сторонние npm-пакеты только через `"external": ["pkg"]` в манифесте.
- Импорт из `../../src/**` разрешён — esbuild забандлит.

## 5. Собрать и проверить

```bash
npm run plug:build <id>                          # аргумент = имя папки
npx tsc --noEmit -p plugins-dev/tsconfig.json    # проверка типов ПЛАГИНОВ
npx tsc --noEmit                                 # проверка приложения
```

Проверить, что появилась `distr-plugins/<id>@<version>/` — только её грузит приложение. `distr-plugins` в `.gitignore`, коммитить нечего.

Дальше — шаги, которые может сделать только пользователь, их надо ему назвать:

1. Перезапустить NODE_WIN: список нод читается на старте окна через Rust `plugin_manager_get_all_ui_nodes`.
2. Если нода не появилась — проверить, включён ли плагин в настройках (состояния лежат в localStorage `plugins-data`).

## 6. Не путать с доставкой

Сборка в `distr-plugins/` — только для dev. У пользователя плагины лежат в `app_data/plugins` и ставятся отдельно (`npm run plug:pack <id>` → zip). Релиз приложения плагины **не несёт** — см. `plugins-dev/CLAUDE.md`.
