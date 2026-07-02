# YouTube API — настройка для РАЗРАБОТКИ (для меня)

> Цель: получить `client_id` + `client_secret`, чтобы разрабатывать и тестировать плагин
> `autoPostYT` на **своём** канале. Видео при этом будут заливаться в **private** (это
> нормально для теста — потом удалишь). Публичный постинг и аудит тут НЕ нужны — они в
> документе для пользователя (`YT_SETUP_2_USER.md`).

## Что мы вообще делаем и почему (Модель B)

Мы работаем по **Модели B (BYO credentials)**: API-клиентом является владелец проекта, а не
абстрактное «наше приложение». Google не знает про «fs.manager» — он видит только твой (или
пользовательский) OAuth-клиент. Поэтому:
- нам НЕ нужно регистрировать/верифицировать своё приложение у Google;
- ответственность, квота и аудит лежат на владельце проекта.

Для разработки владелец проекта = **ты**, канал = **твой**. Ты получаешь свои `client_id`/
`client_secret`, вводишь их в плагин и логинишься своим Google-аккаунтом.

## Термины (чтобы понимать, что делаешь)

- **Google Cloud проект** — контейнер, в котором включается YouTube Data API и создаётся
  OAuth-клиент. У проекта своя суточная квота (10 000 юнитов; загрузка ≈ 100 юнитов).
- **OAuth client (тип Desktop app)** — «удостоверение приложения». Даёт `client_id` (публичный)
  и `client_secret` (секрет). Тип Desktop нужен, потому что мы ловим ответ на loopback
  `http://127.0.0.1:<порт>` — Desktop-клиент разрешает такой редирект автоматически.
- **Scope `youtube.upload`** — разрешение «загружать видео». Мы просим только его (минимально).
- **access_token** — короткоживущий (1 час), им делается запрос загрузки.
- **refresh_token** — долгоживущий, им выписываются новые access_token'ы. Это то, что мы храним.

## Пререквизиты

- Google-аккаунт, на котором есть **YouTube-канал** (если канала нет — зайди на youtube.com и
  создай канал под этим аккаунтом).

## Шаги

### 1. Создать проект
Открой [console.cloud.google.com/projectcreate](https://console.cloud.google.com/projectcreate)
→ Project name, напр. `fsmanager-yt-dev` → **Create**. Дождись создания и выбери проект вверху.

### 2. Включить YouTube Data API v3
Открой [YouTube Data API v3 в Library](https://console.cloud.google.com/apis/library/youtube.googleapis.com)
(убедись, что выбран нужный проект) → **Enable**.
Пояснение: без этого шага любые вызовы API вернут «API not enabled».

### 3. Настроить OAuth consent screen (экран согласия)
Открой [OAuth consent screen](https://console.cloud.google.com/apis/credentials/consent).
- **User type: External** → Create. *(Internal доступен только для Google Workspace-организаций.)*
- Заполни обязательное: App name (напр. `fsmanager-dev`), User support email (твой),
  Developer contact (твой email) → сохраняй по шагам.
- **Scopes** — можно ничего не добавлять (мы запрашиваем scope прямо из кода). Save and Continue.
- **Test users → Add users** → добавь **свой** Google-аккаунт (владельца канала).
  ⚠️ В режиме Testing авторизоваться могут ТОЛЬКО добавленные тест-юзеры.
- **Publishing status: оставь `Testing`.**
  Пояснение: в Testing refresh_token живёт **7 дней** (для теста нормально; в проде — Production,
  где токен бессрочный). Для разработки 7 дней хватает; протухнет — просто пере-логинишься.

> Примечание: Google периодически перекраивает это меню (иногда называется «Google Auth
> Platform» с вкладками Branding / Audience / Clients). Суть та же: External + тест-юзеры + тип
> клиента Desktop.

### 4. Создать OAuth client (Desktop app)
Открой [Credentials](https://console.cloud.google.com/apis/credentials) → **Create Credentials
→ OAuth client ID**:
- **Application type: Desktop app**.
- Name: напр. `fsmanager-desktop` → **Create**.
- Во всплывшем окне скопируй **Client ID** и **Client secret** (их же можно позже скачать/
  посмотреть на странице Credentials).

Готово — это те самые creds, которые вводятся в плагин.

### 5. Аудит для теста НЕ нужен
Твой проект не проходил аудит → каждое видео зальётся `private` и залочится. Для проверки
механики это ок. Публичный постинг = отдельный аудит (см. документ пользователя).

## Как проверить прямо сейчас (без UI плагина)

1. Запусти приложение (`tauri:dev`), открой DevTools (F12).
2. В консоли:
```js
await window.__TAURI_INTERNALS__.invoke('youtube_auth_start', {
  clientId: 'ТВОЙ_CLIENT_ID',
  clientSecret: 'ТВОЙ_CLIENT_SECRET'
})
```
3. Откроется системный браузер → выбери аккаунт → выбери канал → «Google hasn't verified this
   app» → **Advanced → Proceed** (это твоё же тестовое приложение) → Allow.
4. Браузер: «Готово ✓», а промис вернёт объект с **`refreshToken`**.
5. Проверка refresh:
```js
await window.__TAURI_INTERNALS__.invoke('youtube_refresh_token', {
  clientId: 'ID', clientSecret: 'SECRET', refreshToken: 'ПОЛУЧЕННЫЙ_refreshToken'
})
```
→ вернётся новый `accessToken`.

## Возможные ошибки

- **«Google hasn't verified this app»** — ожидаемо для неверифицированного приложения. Advanced
  → Proceed. Это не ошибка.
- **`access_denied` / приложение не в списке test users** — добавь свой аккаунт в Test users
  (шаг 3) или проверь, что логинишься тем же аккаунтом.
- **Нет `refresh_token` в ответе** — Google отдаёт его только с `access_type=offline` +
  `prompt=consent` на согласии (в коде так и есть) и обычно на ПЕРВОМ согласии. Если тестируешь
  повторно и refresh_token не пришёл — отзови доступ на
  [myaccount.google.com/permissions](https://myaccount.google.com/permissions) и залогинься заново.
- **`redirect_uri_mismatch`** — не должно случаться с типом Desktop (loopback разрешён
  автоматически). Если видишь — проверь, что клиент именно **Desktop app**, а не Web.
- **Токен «протух» через неделю** — это режим Testing (7 дней). Для постоянной работы переведи
  consent screen в Production.

## Полезные ссылки
- [OAuth для Desktop-приложений (Google)](https://developers.google.com/identity/protocols/oauth2/native-app)
- [videos.insert — справочник](https://developers.google.com/youtube/v3/docs/videos/insert)
- [Квоты YouTube Data API](https://developers.google.com/youtube/v3/getting-started#quota)
- [Управление доступом приложений (отозвать доступ)](https://myaccount.google.com/permissions)
