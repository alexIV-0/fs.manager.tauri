# YouTube Autopost — план (Модель B / BYO credentials)

> Плагин `autoPostYT` — автопостинг видео в YouTube по принципам VK/TG, но с
> принципиально другой авторизацией. Зеркало `autoPostVK`, встраивается в тот же
> расщеплённый раннер `src/PROCESSING/autoPost/` (Finder → Poster → processItem).

## 0. Модель и ответственность (почему именно Model B)

**Решение:** API-клиентом является ПОЛЬЗОВАТЕЛЬ, а не мы. Каждый юзер заводит своё
Google Cloud приложение, свой OAuth-клиент и отдаёт нашей программе свои
`client_id` / `client_secret` / `refresh_token`. Наша программа — софт, который он у
себя запускает (ровно как self-hosted n8n: n8n-компания не проходит audit — его
проходит пользователь на своём проекте).

Что это даёт (то, ради чего выбрана Model B):
- **Ответственность перед Google — на пользователе** (его API-клиент, его проект).
  Спам/абьюз через приложение бьёт по ЕГО проекту, а не по нашему.
- **Контент** (копирайт, страйки, Community Guidelines) — на владельце канала = юзере,
  автоматически (наказывают загрузивший аккаунт).
- **Квота — его** (10 000 юнитов/день на ЕГО проект, `videos.insert` ≈ 100 юнитов →
  ~100 загрузок/день НА ПОЛЬЗОВАТЕЛЯ). Нет общего потолка на всех — в отличие от Model A.
- **Нам не нужен ни свой домен, ни privacy policy, ни OAuth-верификация, ни audit.**

Что всё равно нужно (честно): для **публичного** постинга видео-лок «private до audit'а»
привязан к ПРОЕКТУ. Значит каждый пользователь обязан пройти YouTube API audit на СВОём
проекте, иначе его видео зальются `private`. Для unlisted/private постинга audit не нужен.
Нам (как софту) это уже не забота — это его проект и его audit.

---

## 1. Runbook пользователя в Google Cloud (one-time на клиента)

Даём как инструкцию (по образцу `TELEGRAM_BOTS_SETUP.md`). Пользователь делает ОДИН РАЗ:

1. **Создать Google Cloud проект** (console.cloud.google.com).
2. **Включить YouTube Data API v3** (APIs & Services → Enable).
3. **OAuth consent screen:**
   - User type = **External**, publishing status = **Production**
     (в Testing refresh-токен умирает через 7 дней — automation ломается еженедельно).
   - Scope = `https://www.googleapis.com/auth/youtube.upload` (минимальный).
   - «Unverified app» — предупреждающий экран остаётся (юзер жмёт Advanced → Proceed),
     но для постинга этого достаточно; долгоживущий refresh-токен уже работает.
4. **Создать OAuth client** типа **Desktop app** → получить `client_id` + `client_secret`.
   (Desktop-тип автоматически разрешает loopback-редирект на 127.0.0.1 с любым портом.)
5. **(Только для ПУБЛИЧНЫХ видео)** подать **YouTube API Compliance Audit**
   (support.google.com/youtube/contact/yt_api_form). Недели ожидания. Без него видео `private`.
6. **Авторизовать каналы** — уже ВНУТРИ нашего приложения (см. §4), по разу на канал.

Пользователь отдаёт нам только `client_id` + `client_secret`. Всё остальное (refresh-токен
на каждый канал) приложение получает само в OAuth-флоу.

---

## 2. Критические отличия от VK (почему сложнее, чем зеркалить VK 1:1)

| Аспект | VK (как есть) | YouTube (что нужно) |
|---|---|---|
| Авторизация | webview-окно + `on_navigation` ловит токен | **Google блокирует webview** (`disallowed_useragent`, в силе с 2023). Нужен **системный браузер + loopback HTTP-сервер** для перехвата `code` |
| Токен | долгоживущий, взял один раз | `access_token` живёт **1 час** → нужен **refresh-флоу** (refresh_token + client creds → новый access_token) |
| Идентичность канала | группа = groupId в токене | **1 refresh_token = 1 канал**; один OAuth-клиент на все каналы, авторизация по разу на канал |
| Загрузка | простой publish | большие файлы → **resumable upload** (стримить с диска в Rust, не через JS-память) |
| Публичность | сразу публично | `private` до прохождения audit'а (проект юзера) |

Вывод: YouTube требует **реального Rust-бэкенда** (loopback-сервер, refresh, resumable
upload), тогда как VK был почти целиком на TS + webview. Это больше работы, чем TG.

---

## 3. Хранилище аккаунтов — расширение существующего (без Rust-схемы)

`account_commands.rs` уже платформо-generic и хранит свободный JSON на аккаунт в
`app_data_dir/accounts/<mainFolder>/youtube.json`. Схему менять НЕ нужно — просто кладём
нужные поля. **Одна запись аккаунта = один канал:**

```jsonc
{
  "name": "<название канала>",     // ключ аккаунта (то, что показываем в дропдауне ноды)
  "platform": "youtube",
  "clientId": "...",               // BYO — одни на все каналы юзера (дублируем в каждой записи, self-contained)
  "clientSecret": "...",
  "refreshToken": "...",           // per-channel, долгоживущий — ГЛАВНЫЙ ключ
  "accessToken": "...",            // кэш короткоживущего (1 ч)
  "accessTokenExpiry": 1730000000, // unix sec — когда протух
  "channelId": "UC...",            // метаданные канала
  "mainFolderName": "...",
  "addedAt": 1730000000
}
```

Переиспользуем `account_save` / `account_list` / `account_delete` как есть.
`account_get_token` (отдаёт только `accessToken`) для YT **не годится** — токен может быть
протухшим. Нужен refresh-aware геттер (см. §4).

> Примечание про имя канала: чтобы автоматически подтянуть title канала после авторизации,
> нужен доп. read-scope (`youtube.readonly`) — это расширяет audit-поверхность. Чтобы
> держать scope минимальным, проще дать юзеру **назвать аккаунт вручную** при добавлении.

---

## 4. Новый Rust-модуль `youtube_auth_commands.rs` (зеркало `vk_auth_commands.rs`)

### `youtube_auth_start(client_id, client_secret) -> record`
OAuth-флоу для installed-app (PKCE):
1. Сгенерить PKCE `code_verifier` + `code_challenge`.
2. Поднять loopback `TcpListener` на `127.0.0.1:<ephemeral>`.
3. Открыть **системный браузер** (tauri opener/shell, НЕ webview) на:
   `https://accounts.google.com/o/oauth2/v2/auth`
   `?client_id=...&redirect_uri=http://127.0.0.1:PORT&response_type=code`
   `&scope=https://www.googleapis.com/auth/youtube.upload`
   `&access_type=offline&prompt=consent&code_challenge=...&code_challenge_method=S256`
   (`access_type=offline` + `prompt=consent` гарантируют выдачу refresh_token; при наличии
   нескольких каналов Google сам покажет выбор канала — юзер выбирает нужный.)
4. Поймать редирект `GET /?code=...` на loopback, ответить страничкой «можно закрыть вкладку».
5. Обменять `code` → токены: POST `https://oauth2.googleapis.com/token`
   (`grant_type=authorization_code`, code, client_id, client_secret, redirect_uri, code_verifier).
6. Вернуть `{ refreshToken, accessToken, accessTokenExpiry }` → сохранить через account-стор.
7. Эмитить событие `youtube-auth-result` (по образцу `vk-auth-result`) для UI.

### `youtube_get_access_token(main_folder, name) -> String`
Refresh-aware геттер (вызывает Poster перед загрузкой):
1. Прочитать запись аккаунта.
2. Если `accessTokenExpiry` в будущем (с запасом ~60 c) — вернуть кэш.
3. Иначе POST `https://oauth2.googleapis.com/token`
   (`grant_type=refresh_token`, refresh_token, client_id, client_secret) → новый access_token.
4. Записать новый `accessToken` + `accessTokenExpiry` обратно (persist), вернуть токен.

> Рефактор: сделать `platform_file` / `read_accounts` / `write_accounts` из
> `account_commands.rs` `pub(crate)`, чтобы `youtube_auth_commands` переиспользовал пути/IO
> без дублирования.

---

## 5. Новый Rust: `youtube_upload_video` (resumable upload)

### `youtube_upload_video(access_token, file_path, meta) -> { videoId, url }`
- `meta`: `title` (обязательно), `description`, `tags[]`, `categoryId`, `privacyStatus`
  (`private` | `unlisted` | `public`), `publishAt` (опц., ISO — отложенная публикация).
- Resumable:
  1. POST `https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status`
     с JSON-метаданными + `Authorization: Bearer` → получить `Location` (upload URL).
  2. PUT байты файла на upload URL (стримить с диска, поддержка чанков/резюма).
  3. Ответ → `videoId`; url = `https://youtu.be/<videoId>`.
- Обработка ошибок: `quotaExceeded` (403) → писать cooldown как VK; `uploadLimitExceeded`;
  сетевые — резюм с последнего байта.
- Помнить: `privacyStatus: public` молча станет `private`, если проект юзера без audit'а.

---

## 6. Плагин `autoPostYT` (зеркало `autoPostVK`)

- `PLATFORM = 'youtube'`.
- **Постинг:** `youtube_get_access_token(mainFolder, account)` → `youtube_upload_video(...)`
  → `appendRecord({ platform: 'youtube', file: basename, videoId, permalink, status })`
  через `fs.append` (уже настоящий append после последней правки).
- **UI (`ui.json`):**
  - Дропдаун аккаунта (= канала) через `account_list`.
  - Кнопка «Добавить канал» → ввод `client_id`/`client_secret` + имя → `youtube_auth_start`.
  - Поля метаданных: title-паттерн, description, tags, categoryId, privacyStatus, publishAt.
- **Тайминг/дедуп:** уже platform-aware в раннере (`route.platform`), отдельный от VK лог
  внутри того же `_post/$MM.$YYYY.jsonl` (дедуп по `file+platform`).

---

## 7. Интеграция с раннером / сайдкар

**СДЕЛАНО (2026-07-01):** сайдкар переименован `vkPost.json` → единый `options/postSources.json`
(writer `syncPostSourcesSidecar.ts`). Платформа НЕ хранится полем — выводится из Poster-ноды в
пайплайне (`src/PROCESSING/autoPost/posters.ts`, карта `POSTER_PLATFORM` + `platformFromPipeline`).
Дедуп/интервал platform-aware (`route.platform`, ключ `file+platform`).

Под YT останется:
- Добавить `autoPostYT: 'youtube'` в `POSTER_PLATFORM` (одна строка) — и финдер, соединённый в
  графе с YT-постером, автоматически станет YouTube-маршрутом (платформа выведется из пайплайна).
- Несколько finder'ов на разные папки уже работают (`finders[]` — массив, маршрут на каждый,
  свой дедуп/интервал/расписание).
- `deleteAfter` / afterPost: для сценария «один файл → и VK, и YouTube» из одной папки —
  `deleteAfter: false` на всех кроме последней площадки, либо отдельные папки/копии
  (дедуп по `file+platform` уже пускает файл на вторую площадку независимо).

---

## 8. Порядок реализации (spike-first)

1. ✅ **Rust auth-спайк СДЕЛАН (2026-07-01):** `youtube_auth_commands.rs` — `youtube_auth_start`
   (системный браузер + loopback 127.0.0.1 + PKCE S256 + обмен code→refresh_token) и
   `youtube_refresh_token` (обновление access_token). Обе в биндингах (`commands.youtubeAuthStart`/
   `youtubeRefreshToken`). tokio получил фичи net+io-util. `shell.open` deprecated (мигрировать на
   tauri-plugin-opener позже). Refresh-aware геттер (читает аккаунт → refresh если протух →
   persist) — навесим в плагине/TS поверх `youtube_refresh_token`. ЖИВЬЁМ ещё не тестировано.
2. **Rust upload-спайк:** `youtube_upload_video` — залить один файл (как `private`) на этот
   канал. Убедиться в resumable + метаданных.
3. **Плагин `autoPostYT`:** auth-UI + Poster, привязка к account-стору, запись в `_post`-лог.
4. **Раннер:** обобщение сайдкара + platform per finder.
5. **(Параллельно, силами юзера)** YouTube API audit на его проекте — для публичных видео.

## 9. Ответственность — итог

| Слой | Кто | Механизм в Model B |
|---|---|---|
| Контент видео (копирайт, страйки) | Пользователь | Заливается на его канал под его аккаунтом |
| Поведение API-клиента (спам, политики, данные) | Пользователь | Его Google Cloud проект / его OAuth-клиент |
| Квота | Пользователь | Его 10 000 юнитов/день, ~100 загрузок/день |
| Audit / верификация | Пользователь | На его проекте (для публичных видео) |
| Наш софт | Посредник | Хранит его creds локально, гоняет OAuth+upload от его имени |
