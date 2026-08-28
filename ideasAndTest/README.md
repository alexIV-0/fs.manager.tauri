# Указатель папки `ideasAndTest`

Что здесь лежит и в каком состоянии. **Снимок ревизии 2026-08-24**, сверенной с кодом — и своим, и бэкенда сайта (`../innovation-hub`).

Истина о состоянии конкретного плана — в **шапке самого документа**; этот файл только помогает
выбрать, что открывать. Если правишь статус в плане — поправь строку здесь, иначе указатель
разъедется (стража на это нет).

Соглашения: **`+` в начале имени = план реализован** (то же правило описано в `ARCHITECTURE.md`,
раздел «Соглашения репозитория»). Статусы: ✅ сделано · 🔧 частично · ⏸ отложено осознанно ·
🎯 спроектировано, кода нет · 📖 не план (контракт, runbook, справочник, парковка идей).

## Реализовано

| документ | о чём | что осталось |
|---|---|---|
| `+FOLDER_STATE_SSOT_PLAN.md` | вкл/выкл и активность проекта → `options/folderState.json` (гибрид D) | запись состояния с сайта |
| `+STATS_SCHEMA_PLAN.md` | схема v1 пофайлового JSONL, пресет `local-archive` | — |
| `+AUTOPOST_DECOUPLED_PLAN.md` | постинг как отдельный раннер, фазы A и B | удалить мёртвые `adapters/vk.ts`, `logWin.ts` |
| `+VK_AUTOPOST_PLAN.md` | плагин `autoPostVK` | ⏸ Клипы/Both отложены: код есть, свойства режима в `ui.json` нет |
| `+YOUTUBE_AUTOPOST_PLAN.md` | плагин `autoPostYT`, Модель B (BYO credentials) | audit проекта у пользователя (не наша сторона) |
| `+TELEGRAM_AUTOPOST_PLAN.md` | плагин `autoPostTG` | ⏸ живой тест на паузе до своего сервера и `api_id`/`api_hash`; платформа `tg` в `posters.ts` закомментирована |
| `+TELEGRAM_GDRIVE_BOT_PLAN.md` | сбор медиа из Telegram (`tgCollect`), **фаза 1** | ⏸ жизненный цикл локального Bot API сервера — на паузе до своего сервера и `api_id`/`api_hash` (пока лимит 20 МБ); фазы 2 (мультифайл/сессии), 3 (MTProto), 4 (webhook) |
| `+PROJECT_DESCRIPTION_EDITOR_PLAN.md` | редактор `options/description.md` (Tiptap + текстовый режим), проверен вживую 2026-08-24; локальный превью mermaid и тултипы на markdown — сделаны | показ/правка на сайте (их сторона — уже готова), drag-n-drop файла (нужен арбитр дропа на окно) |
| `+SETTINGS_SYNC_PLAN.md` | синхронизация общих словарей с сайтом (трёхстороннее слияние, база-снимок, триггер по ревизии из `/delta`, UI-статус) | §5.2 — три словаря перевести из localStorage в файлы (пока закрыто защитой в слиянии) |

## В работе / частично

| документ | состояние |
|---|---|
| `R2_SYNC_PLAN.md` | 🔧 клиент сделан; **зависимости от бэкенда снялись 2026-08-24** — у него готовы multipart, `/copy`, корзина, `sharing`. Наша работа: multipart-клиент, копирование через `/copy`, корзина/восстановление, `rename`/`copy` в меню |
| `UNIFIED_SOURCES_ENGINE.md` | 🔧 фазы 1–5 закрыты (постинг); ⏸ TG как нода-источник отложен до тестов с большими файлами, дневная уборка — низкий приоритет |
| `DISTRIBUTED_QUEUE_PLAN.md` | 🔧 режим воркера работает (живой прогон 2026-08-18); вопрос токена закрыт (`mch_` + `machineUuid`). ⏸ постинг через очередь отменён — публикует сайт, план у них: `innovation-hub/docs/SOCIAL_POSTING_PLAN.md` |

| `SITE_STATS_LINK_PLAN.md` | ✅ сделано целиком: A и B у нас (2026-08-19), C на сайте (2026-08-27). `itemId` архива = `tasks.id`. Можно переименовать в `+SITE_STATS_LINK_PLAN.md`, если поправить ссылки в `+STATS_SCHEMA_PLAN.md`, `BILLING_NODE_CONTRACT_PLAN.md` и у сайта |
| `PIPELINE_BACKEND_REQUESTS.md` | 🔧 живой список просьб к сайту по конвейеру и воркеру, статусы внутри |

## Спроектировано, кода нет

| документ | почему ещё нет |
|---|---|
| `BILLING_NODE_CONTRACT_PLAN.md` | 🎯 что нужно от нас для оплаты обработки на сайте: оси `payBase`/`payMeter` в ноде `description`, `srcSec` (схема v2), валюта себестоимости. План сайта — `../innovation-hub/docs/BILLING_AND_TRIAL_PLAN.md` |
| `SECRETS_VAULT_SITE_PLAN.md` | 🎯 шов готов (плагины зовут IPC), сейфа на сайте нет |
| `R2_SHARING_PLAN.md` | ✅ **у бэкенда сделано** (`project_members`, роли viewer/editor); десктопу расшаренность не видна по их решению — нам делать нечего, файл = модель |
| `VISION.md` | 🎯 направление продукта; из него в коде нет capability resolver, workspace backend, engine/shell split |
| `ARCHITECTURE_DISTRIBUTED.md` | 🎯 парковка направления (сайт = control plane), механика — в `DISTRIBUTED_QUEUE_PLAN.md` |
| `PLUGIN_HOST_API_PLAN.md` | ⏸ отложено осознанно 2026-08-05; транспорт `ctx` сделан, contribution points — нет. Ценность файла — раздел 4 (как писать seam-ready) |
| `INSTAGRAM_AUTOPOST_PLAN.md` | ⏸ не начато |
| `TTS_LOCAL_TEST_2026-06-22.md` | ⏸ выбор движка не закрыт (Supertonic монотонный), плагина нет |

## Начато, но ещё не сведено

| документ | состояние |
|---|---|
| `SHORTS_PIPELINE_PLAN.md` | 🔧 длинное видео → shorts: транскрипт-сигнал и аудио-слой в проде (3 ноды), скорер / снап границ / виртуальная камера — план |

## Не планы

| документ | роль |
|---|---|
| `DESCRIPTION_FORMAT_CONTRACT.md` + `description.example.md` | 📖 контракт формата описания для нас и сайта + эталонный файл |
| `STORAGE_BACKEND_REQUESTS.md` | 📖 замороженная копия; главная редакция — `innovation-hub/docs/STORAGE_CLIENT_REQUESTS.md` |
| `TELEGRAM_BOTS_SETUP.md`, `YT_SETUP_1_DEV.md`, `YT_SETUP_2_USER.md` | 📖 runbook'и ручной настройки платформ |
| `TESTING_INSTRUCTIONS.md` | 📖 runbook проверки handshake NODE_WIN (механизм в проде) |
| `ffmpeg_plug_ideas.md` | 📖 справочник фильтров ffmpeg под будущие плагины |
| `ideas.md` | 📖 парковка идей; статус отмечен у каждой (нода `jsCode` и децентрализованная статистика — реализованы) |
