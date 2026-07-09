# Plan: Instagram Auto-Post Plugin

## Статус
Планирование — не начато (2026-06-15)

---

## Ключевые уточнения

### Загрузка видео — хостинг не нужен
Instagram Graph API поддерживает **resumable upload** (`upload_type=resumable`):
- Видео грузится напрямую из приложения через `multipart/form-data`
- Публичный URL нужен только для изображений (Вариант B — не наш случай)
- Flow для видео: `POST /media (resumable)` → polling статуса → `POST /media_publish`

### Требования к аккаунту
- Нужен **Instagram Business Account** (не Creator, не личный)
- Обязательна привязанная **Facebook Page**
- Получить бесплатно: Настройки → Тип аккаунта → Переключиться на бизнес
- Влияние на монетизацию: открывает Reels бонусы, Shops, партнёрский маркетинг

---

## Архитектура плагина

### Структура файлов
```
plugins-dev/autoPostInstagram/
├── plugin.json
├── ui.json
├── autoPostInstagram.ts    ← основная логика
├── _auth.ts                ← OAuth helpers
└── _videoPrep.ts           ← конвертация видео под требования Instagram
```

### plugin.json
```json
{
  "id": "autoPostInstagram",
  "name": "Auto Post Instagram",
  "version": "0.1",
  "apiVersion": 1,
  "type": ["nodeui", "processing"],
  "main": "autoPostInstagram.js",
  "ui": "ui.json",
  "resourcePool": "online",
  "cost": "1",
  "costUnit": "run"
}
```

### Поля ui.json (ноды)
| Поле | Тип | Назначение |
|------|-----|-----------|
| `inputFile` | `link` | Видео/изображение для постинга |
| `caption` | `text` | Подпись (поддерживает шаблоны) |
| `account` | `ddm` | Выбор аккаунта из сохранённых |
| `mediaType` | `ddm` | `REELS` / `FEED` / `STORIES` |
| `shareToFeed` | `checkbox` | Для Reels — шерить в ленту |

---

## Хранение аккаунтов

Файлы хранятся в `options/instagram/accounts/`:
```json
{
  "name": "my_account",
  "accessToken": "IGAA...",
  "businessAccountId": "123456789",
  "tokenExpiresAt": 1750000000
}
```

---

## Требования к видео

| Тип | Разрешение | Соотношение | Длина | Макс размер | Кодек |
|-----|------------|-------------|-------|-------------|-------|
| Reels | 1080×1920 | 9:16 | 15–90 сек | 100 MB | H.264 + AAC |
| Feed video | 1080×1080 | 1:1 | до 60 сек | 100 MB | H.264 + AAC |
| Stories | 1080×1920 | 9:16 | до 60 сек | 100 MB | H.264 + AAC |

Конвертация через `ffmpeg.exec()` в `_videoPrep.ts` перед постингом.

---

## API Flow (Instagram Graph API)

### Авторизация (один раз)
1. Создать App на developers.facebook.com
2. Получить App ID + App Secret
3. OAuth flow через Tauri WebView окно
4. Разрешения: `instagram_basic`, `instagram_content_publish`, `pages_read_engagement`
5. Сохранить `access_token` + `business_account_id`

### Постинг видео (каждый раз)
```
1. ffmpeg конвертация → temp файл под требования платформы
2. POST /{businessId}/media
     upload_type=resumable
     media_type=REELS|VIDEO
     caption=...
   → { container_id }
3. Polling GET /{container_id}?fields=status_code
     ждём STATUS_CODE = FINISHED (каждые 5 сек, timeout 5 мин)
4. POST /{businessId}/media_publish
     creation_id={container_id}
   → { post_id }
5. GET /{post_id}?fields=permalink
   → { permalink }
6. Записать в posting_stat/
```

---

## Статистика постинга

Файл: `options/posting_stat/YYYY-MM.json` (один файл на месяц)

```json
[
  {
    "ts": 1750000000,
    "platform": "instagram",
    "account": "my_account",
    "file": "video_1.mp4",
    "postId": "18023...",
    "permalink": "https://instagram.com/p/...",
    "status": "published",
    "mediaType": "REELS"
  }
]
```

Используется для дедупликации — плагин проверяет что файл ещё не был запощен по имени.

---

## Обработка ошибок

| Ошибка | Поведение |
|--------|-----------|
| Токен истёк | `sendToMW('error', ...)` → нода красная, требует переавторизации |
| Конвертация не прошла | throw → processItem перемещает в `errors/` |
| API 429 (rate limit) | Retry ×3 с задержкой 10/30/60 сек |
| Polling timeout (5 мин) | throw → `errors/` |
| Файл уже запощен | Пропустить, вернуть существующий permalink |
| Нет интернета | throw с понятным сообщением |

---

## Приоритет реализации

```
[1] OAuth авторизация (Rust: instagram_commands.rs)  ← БЛОКИРУЕТ всё
      ↓
[2] Структура плагина + ui.json
      ↓
[3] _videoPrep.ts — конвертация под требования платформы
      ↓
[4] Основная логика постинга (resumable upload + polling)
      ↓
[5] Статистика + дедупликация
      ↓
[6] UI для управления аккаунтами в настройках
```

---

## Что нужно перед началом

- [ ] Зарегистрировать App на developers.facebook.com
- [ ] Переключить Instagram аккаунт на Business
- [ ] Привязать Facebook Page к Instagram аккаунту
- [ ] Получить App ID + App Secret
- [ ] Для production: пройти Facebook App Review (для теста достаточно Test Users)
