# Автопостинг как отдельный процесс (decoupled) — план

**Статус:** проектирование (2026-06-30). Вариант B (обобщённый раннер, по сайдкару/папке на платформу).
Зеркало уже работающего `tgCollect`. Первый адаптер — VK.

## Зачем

Сейчас постинг — нода в графе (`autoPostVK`, colorType `posting`): файл должен дотечь по
стрелкам до ноды, а судьба запощенного файла решается следующей нодой (copyFile) через
`OutputHandle` → `finalResult`. Минусы: постинг сцеплен с обработкой; настройка через граф
непонятна; `OutputHandle` работает только внутри графа.

Хотим: постинг — отдельный конвейер сбоку от главного цикла (как ТГ-сбор), параллельно
обработке, со своими настройками в файле и своим объектом-маршрутами, по одному файлу за виток.

## Образец: tgCollect (4 части)

| Часть | tgCollect (есть) | autoPost (делаем) |
|---|---|---|
| Сайдкар | `options/tgSearch.json`, пишется при Save (`syncTgSearchSidecar`) | `options/vkPost.json`, `syncVkPostSidecar` |
| Объект-маршруты | модульный `tgRoutes[]` | `postRoutes[]` |
| Сбор маршрутов | `clearTgRoutes()` + `addTgRouteFromProject()` в `findAllFilesForProcess` (безусловно, до IN-гейта) | `clearPostRoutes()` + `addPostRouteFromProject()` рядом |
| Раннер параллельно | `runTgCollect(signal)` в `runProcessing` (начало витка, параллельно обработке/ожиданию) | `runAutoPost(signal)` там же |
| Состояние между витками | offset-карта | дедуп/интервал из `_post/$MM.$YYYY.jsonl` |

## Главное про модель триггера

Постинг НЕ зависит от IN и очереди обработки. Главный цикл `runProcessing` крутится
постоянно (пока Start). Триггер постинга — наличие `options/vkPost.json` (= нода есть и
включена). Раннер каждый виток листает папку `VK_post` проекта НАПРЯМУЮ (Rust-листинг), без
IN-скана. Нода `autoPostVK` — **config-only**, в граф НЕ подключается (как `autoTGcollect`).

## Состав работ

### 1. Новый модуль `src/PROCESSING/autoPost/index.ts`
```ts
interface PostRoute {
  projectPath: string; mainFolder: string; platform: 'vk';
  account: string; target: string; groupId?: number;
  folder: string;            // 'VK_post'
  description: string;       // статичный текст
  interval: number; daysOfWeek: string[]; window: [number, number]; order: string;
  afterPost: { mode: 'move' | 'delete' | 'leave'; targetPath: string[]; deleteAfter: boolean; overwriteOldest: boolean };
}
let postRoutes: PostRoute[] = [];
export function clearPostRoutes(): void
export async function addPostRouteFromProject(projectPath: string): Promise<void>  // читает vkPost.json
export async function runAutoPost(signal?: AbortSignal): Promise<void>             // главная точка
```
`runAutoPost`: на каждый маршрут → гейт (день/окно/интервал из `_post`-лога) → листинг
`<projectPath>/<folder>` по видео-расширениям → дедуп по `_post`-логу → `sortByOrder` →
ОДИН файл → `videoCheck('video')` → диспетч по `platform` → VK-адаптер `publishVideo` →
запись в `_post`-лог → `afterPost`. Остальные файлы не трогает. Все шаги — в log_win
(переиспользуем пошаговые логи + `vkErrorHint`, уже добавленные в плагин).

### 2. VK-адаптер `src/PROCESSING/autoPost/adapters/vk.ts`
Перенос/реэкспорт логики плагина: `_publisher.ts` (publishVideo + VkApiError), `_postLog.ts`,
`_videoCheck.ts`, `vkErrorHint`. Решить: вынести из `plugins-dev/autoPostVK/` в общий модуль
или импортировать. (Раннеру в `src/` удобнее свои копии на `commands.*`, т.к. плагинные хелперы
завязаны на `_template/tauri`.)

### 3. afterPost (замена OutputHandle → copyFile)
Переиспользуем `src/Utils/createPathForFileByPattern` + `formatNameByPattern` (тот же движок,
что в copyFile.ts). После успешного поста:
- `move` (дефолт): построить путь по `targetPath` → `commands.moveItem` → файл уходит из `VK_post`.
  Дефолт `targetPath = ['$projectPathGD', 'POSTED', '$clearName ($random(3))']`.
- `delete`: удалить исходник.
- `leave`: оставить; повторный пост блокирует дедуп по `_post`-логу.

### 4. Синк сайдкара `src/NODE_WIN/utils/syncVkPostSidecar.ts`
Копия `syncTgSearchSidecar`. Нода `autoPostVK` есть и включена → пишем `vkPost.json` И создаём
папку `VK_post` (`commands.testAndCreateFolder`). Нет/выключена → удаляем `vkPost.json`, папку
НЕ трогаем. Резолв `groupId` из каталога групп аккаунта по имени `target`. Вызов — в
`SaveButton.tsx` и `TopPanel.tsx` сразу после `syncTgSearchSidecar`.

### 5. Врезка в цикл
- `findAllFilesForProcess.ts`: `clearPostRoutes()` рядом с `clearTgRoutes()` (стр. ~46);
  `await addPostRouteFromProject(projectPathOnGD)` рядом с `addTgRouteFromProject` (стр. ~137).
- `runProcessing.ts`: `const autoPostPromise = runAutoPost(getSignal())` рядом с `tgCollectPromise`
  (стр. ~74); `await autoPostPromise.catch(()=>{})` рядом (стр. ~113).

### 6. Нода autoPostVK → config-only
ui.json: убрать link-вход `inputFile` и `output.sourceProperty`; `description` link → textedit
(статичный текст); добавить `folder` (дефолт `VK_post`), `afterPost` (mode + Target Path как у
copyFile + deleteAfter/overwriteOldest). Логику постинга из `autoPostVK.ts` забирает раннер;
сам файл плагина в графе больше не исполняется (нода только конфиг).

## Дедуп / судьба файлов
- `_post/$MM.$YYYY.jsonl` — источник времени последнего поста (интервал) + дедуп по имени файла.
- При `move`/`delete` файл покидает `VK_post` → не найдётся повторно; при `leave` спасает дедуп.

## Сайдкар `options/vkPost.json`
```json
{
  "platform": "vk", "account": "myAcc", "target": "MyGroup", "groupId": -123456,
  "folder": "VK_post", "description": "текст поста",
  "interval": 3600, "daysOfWeek": ["Mon","Tue"], "window": [600, 1320], "order": "by Time",
  "afterPost": { "mode": "move", "targetPath": ["$projectPathGD","POSTED","$clearName ($random(3))"], "deleteAfter": false, "overwriteOldest": false }
}
```

## Фазы
1. ✅ СДЕЛАНО (2026-06-30). Раннер `src/PROCESSING/autoPost/` (index+types+postLog+adapters/vk)
   + врезка в `findAllFilesForProcess` (clear/addRoute) и `runProcessing` (параллельно).
   Читает `vkPost.json` написанный руками; листинг `VK_post` через `getSomeFromFolder`;
   гейт день/окно/интервал; дедуп+order; videoOk (размер); publishVideo; запись в `_post`;
   afterPost: leave (деф.) / delete; move отложен. Логи в log_win через `send_log`. tsc чистый.
2. ✅ СДЕЛАНО (2026-06-30). `syncVkPostSidecar.ts` (зеркало tg-синка: пишет vkPost.json +
   создаёт папку folder; резолвит groupId по target на сохранении; нет/выключена → удаляет
   сайдкар, папку не трогает). Вызовы в `SaveButton.tsx` и `TopPanel.tsx` после tg-синка.
   Нода autoPostVK → config-only: ui.json без inputFile, `output:{}`, description→textedit
   (статичный), + folder (деф. VK_post), + afterPostMode/targetPath/overwriteOldest/deleteAfter.
   Плагинный main → стаб `export { onLoad }`. plugin.json описание обновлено. Пересобрано в
   distr-plugins (dev грузит оттуда). tsc чистый.
3. ✅ ЧАСТИЧНО (2026-06-30). afterPost: leave/delete/move. move = перенос в подпапку
   `<folder>/_posted/` (вне top-level скана; решает «отделить запощенное»). Кастомный
   targetPath по паттерну (createPathForFileByPattern) — ещё НЕ реализован (deferred).
4. Telegram-адаптер (повтор п.2 адаптера) — раннер не трогаем.

LOG_WIN ИНТЕГРАЦИЯ ✅ (2026-06-30): постинг теперь виден в окне log_win как ITEM со
step'ами (video.save/upload/wall.post). Канал — `log_window_emit_*` (item-start/log/
node-update/item-end), как у processItem. send_log (processing-event) окном НЕ показывается —
поэтому был виден только в devtools. Хелпер: `src/PROCESSING/autoPost/logWin.ts`. publishVideo
получил onStep + onLog(msg, stepId). Route-level диагностика (виток/гейты) осталась в
console/send_log (devtools), т.к. она не пер-итемная.

ОТДЕЛЬНЫЙ ПРОЦЕСС + КНОПКА ✅ (2026-06-30, «Фаза A»):
- `src/PROCESSING/autoPost/scheduler.ts` — `startPostScheduler`/`stopPostScheduler`, свой
  AbortController, тик 30с. Сам перечисляет проекты (reloadFolders, минуя IN-скан) →
  collectPostRoutes → runAutoPost (гейт интервала внутри). Honors поминутные интервалы.
- Стор `src/Store/Processing/usePosting_store.ts` (isPosting).
- Вторая кнопка «START POSTING / Stop posting» в AppMain (второй ряд под обработкой).
- Врезка постинга в runProcessing/findAllFilesForProcess УБРАНА — постинг теперь полностью
  независимый процесс со своей кнопкой.

РЕШЕНО (2026-06-30): «Вариант Y» — Poster отдаёт реальный выход в граф. Это СЛЕДУЮЩАЯ большая
фаза (B): split ноды на Finder (источник, как mainSearch) + Poster (настоящий плагин), и
планировщик строит work-item с корнем на Finder → зовёт processItem (движок обработки). Тогда
выход Poster'а течёт в copyFile/любые ноды, а логи в log_win — автоматом от processItem.
Технический риск — сборка work-item для не-IN корня (повтор логики findFilesForSingleFolder).
Фаза A (выше) — фундамент под это (кнопка/процесс/часы уже есть).

ВАЖНО: прежние plugins-dev/autoPostVK/_publisher|_postLog|_videoCheck.ts теперь ОРФАНЫ
(логика в раннере src/PROCESSING/autoPost). Оставлены как референс, не импортируются.

## Открытые вопросы
- Куда физически переносить общую логику VK (адаптер в `src/` vs остаётся в `plugins-dev`).
- Нужен ли Rust-листинг папки по расширениям или уже есть команда (проверить `commands.*`).
