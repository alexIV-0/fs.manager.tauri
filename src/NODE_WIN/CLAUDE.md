# NODE_WIN — редактор пайплайнов (React Flow 12)

Отдельное окно, отдельный JS-realm: сторы из `MAIN_WIN` здесь **не видны**, обмен — broadcast-события Tauri (пример: `plugins-changed` в `index.tsx`).

## Controlled flow: единственная точка изменений

RF v12 в controlled-режиме. **Все** изменения графа обязаны проходить через `onNodesChange` / `onEdgesChange` в `hooks/useFlowActions.tsx` — включая императивные `setNodes` / `updateNode` / `deleteElements`. Иначе Undo/Redo (`hooks/useUndoRedo.ts`) не увидит шаг, а каскадная валидация не пересчитает связи.

Undo/Redo: серия изменений схлопывается в один шаг окном 400 мс, глубина 50, `Ctrl+Z` / `Ctrl+Shift+Z` / `Ctrl+Y`. Шум игнорируется: `select` и `dimensions` без `resizing` шаг не создают. Текущее состояние держится в ref, а не в сторе, — иначе при зажатом `Ctrl+Z` шаг проскакивает.

## Каскад считает В ТОПОЛОГИЧЕСКОМ ПОРЯДКЕ

`cascadeValidation` (`hooks/useCascadeValidation.ts`) собирает затронутый подграф и считает ноды по Kahn: нода пересчитывается **ровно раз** и только когда посчитаны все её апстримы внутри подграфа.

До 2026-08-11 здесь был обход в глубину с одним `visited`, и на «ромбе» результат был неверным:

```
mainSearch → B → D(вход 1)
mainSearch → C → D(вход 2)
```

обход шёл `mainSearch → B → D`, вход 2 читался из СТОРА (в этом каскаде `C` ещё не считалась), а когда очередь доходила до `C`, ребро `C → D` упиралось в `visited` — и `D` оставалась со значением от старого `C`. Простой веер (один источник в два входа одной ноды) не страдал: оба входа считаются в одном вызове `validateAndUpdateNode`.

Отсюда правила:

- **Не заменять обход обратно на DFS/`visited`.** Порядок здесь смысловой, а не оптимизация.
- Кто пересчитал ноду сам и хочет каскад ниже — передаёт её состояние **затравкой**: `cascadeValidation(id, { seed, includeStart: false })`. Так делает `handleEdgeRemoval`; без затравки downstream читает target из стора, а он ещё не обновлён.
- Цикл в графе редактор не даёт замкнуть (`useConnection.tsx`), но в старом сохранённом флоу он может лежать — в каскаде есть страховка, считающая такие ноды как есть.

## Валидность property — `utils/validation.ts`

`isValueValid` разводит по `controlType`. **Новый тип контрола = новая ветка там.** Незнакомый тип возвращает `false` и пишет `console.warn`: без этого property с `required` и неучтённым типом делает ноду невалидной навсегда, а причина не видна ниоткуда.

## Загруженный флоу НЕ перевалидируется

`onInit` ставит ноды из `options.json` как есть (обновляются только `cost`/`costUnit` из манифестов через `syncCostsFromManifest`). Значит `isValid`, `computedOutput` и `inheritedValue` в старом флоу — те, что были на момент сохранения. Если `ui.json` плагина с тех пор изменился (свойство удалено, `acceptedTypes` сужены, хендл переименован), расхождение всплывёт только при первом каскаде на этой ноде. Существовавшая заготовка `removeBrokenEdges.ts` эту дыру не закрывала — она никем не вызывалась и удалена; сама дыра остаётся открытой осознанно.

## Каскад — только через setTimeout(0)

После `reactFlow.updateNode` / применения changes каскад (`handleNodePropertyChange`, `cascadeValidation`, `handleEdgeRemoval`) звать **только** отложенно:

```ts
rfOnEdgesChange(changes);
setTimeout(() => { … cascadeValidation(id) … }, 0);
```

Синхронный вызов читает stale-состояние через `getNode` и откатывает только что выбранное значение. Примеры на месте: `useFlowActions.tsx:63` и `:121`.

## Динамическая ширина/высота ноды → useUpdateNodeInternals

Меняешь размер или число хендлов на лету — обязательно `useUpdateNodeInternals()`, иначе рёбра приходят в старую позицию хендла. Уже так сделано в `nodes/properties/*` и `SpyNode.tsx`.

## Мерцание: никаких box-shadow и transition внутри нод

`box-shadow` и анимации на элементах внутри ноды перекрашивают весь GPU-слой канваса — на hover мигает всё полотно. Держать `boxShadow: 'none'`, `transition: 'none'`; валидность и реактивность — через `useNodesData`, а не через анимированные стили. Выстрадано в `nodes/properties/ValueRange.tsx`.

Подсветка выделения: RF рисует `outline` на **обёртке** `.react-flow__node`, а не на твоём элементе. Для нестандартной формы (скруглённая пилюля) гасить `outline` у `.react-flow__node-<type>.selected` и рисовать кольцо самому.

Рамка box-select `.react-flow__nodesselection-rect` по умолчанию имеет `pointer-events: all` и глотает клики по кнопкам нод — погашена в `index.css:112`, не возвращать.

## Свойства нод строятся из ui.json

`nodes/components/GenericProperty.tsx` — движок: `switch (property.controlType)` разводит на компоненты из `nodes/properties/`. Новый тип контрола = новая ветка там + компонент, а не спецкод в конкретной ноде. Это же готовая точка расширения для будущего host-API плагинов.

Тип выходного коннектора считается **двумя путями**: пин (`OutputHandle`) и ребро (`getPropertyData` → `computedOutput`). Для `addLink` / `addPathLink` тип берётся из `value[0]` независимо от `outputType`.

Групповое вкл/выкл выделенных нод: кликнутая нода задаёт направление, применяется ко всем `selected`.
