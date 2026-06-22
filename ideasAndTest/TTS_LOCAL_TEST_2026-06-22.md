# Локальный TTS — тестирование и выбор движка (2026-06-22)

Цель: добавить в fsManager плагин **локальной генерации голоса из текста** (зеркало плагина
`transcribeVA`, только наоборот: не STT, а TTS). Сначала — просто получить звук, потом эмоции,
и только потом UI/плагин.

---

## 1. Supertonic — протестирован, работает, но МОНОТОННЫЙ

**Что это:** github.com/supertone-inc/supertonic — оффлайн multilingual TTS на ONNX Runtime,
~99M параметров, 31 язык (вкл. `ru`/`uk`) + авто-детект `na`, голоса M1–M5/F1–F5, выход
WAV 44.1kHz/16-bit. CPU-first, ~200–400 МБ RAM.

**Как запускали (Python SDK, воспроизводимо):**
```bash
python3 -m venv .venv && . .venv/bin/activate
pip install supertonic                     # встал v1.3.1 + onnxruntime
```
```python
from supertonic import TTS
tts = TTS(model="supertonic-3", auto_download=True)   # модель тянется с HF (~26 файлов, ~42с)
style = tts.get_voice_style("F1")                     # M1..M5 / F1..F5
wav, dur = tts.synthesize(text="Привет!", voice_style=style, lang="ru")
tts.save_audio(wav, "out.wav")
```
> Грабля: `synthesize` возвращает `(wav, dur)`, где **оба — np.ndarray**. `float(dur)` падает.
> Длительность считать как `len(wav)/44100`.

**Производительность (CPU, Intel i9-10910, 20 ядер):**

| Фраза | Аудио | Синтез | RTF |
|---|---|---|---|
| EN, ~6с | 6.13с | 1.50с | **0.24** |
| RU, ~7с | 7.11с | 1.55с | **0.22** |

→ ~4–5× быстрее реалтайма на CPU, полностью оффлайн. Качество чтения нормальное.

### Эмоциональность — ГЛАВНАЯ ПРОБЛЕМА
Звучит «на одной ноте», как ИИ. Разобрались почему:
- **В Supertonic нет «ручки эмоций».** `Style` = два вектора (`ttl` = тембр+просодия,
  `dp` = ритм), снятые с эталонной записи голоса. Интонация целиком зашита в выбранный голос.
- Параметры `synthesize`: `total_steps` (8 деф; 16/32 — чище/натуральнее, но синтез ×2/×4,
  RTF до ~0.75), `speed` (1.05), `silence_duration` — это **качество/темп, НЕ эмоция**.
- **Inline-теги** (`<laugh>`, `<breath>`, `<sigh>`) — НЕ эмоция. Модель посимвольная
  (`unicode_indexer.json` = таблица на 65536 кодпоинтов), `<` `>` препроцессинг не вырезает,
  теги доходят как символы. Но проба 15 кандидатов дала прирост длительности всего +0.1…+0.4с
  и почти одинаковый → это короткий призвук в одном месте, а не интонация на фразу. Полного
  списка «10 тегов» нигде официально не опубликовано.
- Прослушали одну эмоциональную фразу по всем 10 голосам → **все примерно одинаково монотонные**.

**Реальные рычаги выразительности в Supertonic:** (1) выбор голоса — слабый; (2) пунктуация
текста `?! … —`; (3) кастомный эмоциональный эталон через **Voice Builder** (онлайн
supertonic.supertone.ai/voice-builder → JSON → дальше оффлайн). ВАЖНО: локального энкодера
голоса в pip-пакете НЕТ (только text_encoder/duration_predictor/vector_estimator/vocoder) —
снять стиль из своего аудио локально нельзя, только через онлайн Voice Builder.

**Вывод:** монотонность/«AI-звук» во многом **врождённые** для 99M speed-first модели.
Для драматичной эмоции нужен либо кастомный Voice-Builder-профиль с выразительного эталона,
либо другая модель.

**Лицензии Supertonic:** код MIT, веса OpenRAIL-M (use-based ограничения — проверить для коммерции).

---

## 2. Альтернативы (эмоция + русский + локально)

| Движок | Эмоция | Как задаётся | RU | Лицензия | На Intel-Mac (CPU) |
|---|---|---|---|---|---|
| **Supertonic** (тек.) | слабая | только выбор голоса | ✅ | OpenRAIL-M | летает (RTF ~0.2) |
| **OpenAudio S1-mini** (Fish), 0.5B | **сильная** | **50+ тегов** `(angry)(excited)(laughing)(whispering)` | ✅ | CC-BY-NC-SA → **НЕ коммерч.** | ❌ не ставится (torch) |
| **Chatterbox Multilingual V3**, 0.5B | **сильная** | категории happy/sad/angry + «exaggeration» дайл | ✅ | **MIT → коммерция ОК** | ❌ не ставится (torch) |
| **XTTS-v2** (Coqui) | средняя | только через reference-клон | ✅ | CPML → **НЕ коммерч.** | ❌ не ставится (torch) |
| **Piper / Kokoro** | почти нет (как Supertonic) | — | Piper ✅ | MIT/Apache | ✅ летает (ONNX) |

Прямой ответ на «указывать эмоции тегами» дают **OpenAudio S1-mini** (теги эмоций в тексте) и
**Chatterbox** (эмоция + ползунок интенсивности, MIT).

---

## 3. СТЕНА: тяжёлые модели не идут на этом железе

Железо: **Intel iMac — Core i9-10910 (20 ядер), 64 ГБ RAM, GPU AMD Radeon Pro 5700 XT (16 ГБ)**.

- PyTorch **не выпускает x86-macOS колёса после 2.2.2** (Apple забросила Intel-маки в 2024).
  Доступный максимум — `torch 2.2.2`.
- Chatterbox прибивает `torch==2.6.0` → `pip install` даёт **`ResolutionImpossible`**.
  Fish/OpenAudio, XTTS, F5 — та же история (нужен свежий torch).
- GPU AMD для PyTorch **бесполезен** (MPS только на Apple Silicon).
- Docker **не установлен**.

→ **Нативно на этой машине идут только ONNX-движки** (Supertonic / Kokoro / Piper) — а они
все слабы по эмоции.

### Пути к эмоциональному локальному TTS
1. **Docker** (Linux/amd64 контейнер, CPU-сборка torch 2.6) — Chatterbox/Fish заведутся прямо
   на iMac. Нужно поставить Docker Desktop, ~неск. ГБ, на CPU медленно (для пакетной 24/7 ок).
2. **Другая машина как сетевой сервис** — Apple Silicon Mac (MPS) или ПК с NVIDIA (CUDA);
   плагин ходит по HTTP (у Chatterbox-TTS-Server OpenAI-совместимый API). Вписывается в
   облачно-плагинную модель fsManager. Лучший баланс скорость/эмоция.
3. **Остаться на ONNX тут** — принять слабую эмоцию (Supertonic как есть).
4. **Облако** (ElevenLabs v3 / Fish S1 4B / Qwen3-TTS) — максимум эмоции, минимум возни,
   но ломает «полностью локально» + деньги.

---

## 4. Статус и решение (отложено)

- Тестовое окружение (`~/supertonic-poc`, кэш `~/.cache/supertonic3`) **удалено** после снятия
  результатов.
- На паузе. Развилка ждёт решения: есть ли доступ к Apple Silicon / NVIDIA машине (→ путь 2),
  ставить ли Docker (→ путь 1), либо остаться на Supertonic (→ путь 3).
- Лицензия для продакшна: держим MIT/Apache (Chatterbox / Piper / Kokoro). OpenAudio S1-mini и
  XTTS-v2 — только некоммерчески (можно как референс эмоции).

### Скрипты-обёртки (были в `~/supertonic-poc`, на случай повтора)
```python
# say.py — python say.py "текст" [lang] [voice]; играет через afplay
from supertonic import TTS; import sys, subprocess, numpy as np
tts = TTS(model="supertonic-3", auto_download=True)
style = tts.get_voice_style(sys.argv[3] if len(sys.argv)>3 else "F1")
wav,_ = tts.synthesize(text=sys.argv[1], voice_style=style,
                       lang=sys.argv[2] if len(sys.argv)>2 else "ru")
tts.save_audio(wav, "out.wav"); subprocess.run(["afplay","out.wav"])
```
