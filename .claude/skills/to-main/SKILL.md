---
name: to-main
description: Предмёрж-гейт перед выпуском: проверки, дрифт-контроль и вливание feature-ветки в main. Использовать при «влить в main», «выпустить релиз», «зарелизить», «смёржить ветку». Пуш в main запускает публичный релиз, поэтому без явного подтверждения не пушить.
---

# Вливание в main = публичный релиз

Пуш в `main` запускает [release.yml](../../../.github/workflows/release.yml): сборка macOS aarch64 + macOS x86_64 + Windows NSIS, updater-артефакты, публикация в репозиторий релизов `alexIV-0/fs.manager.releases`. Это внешнее действие и откатывается плохо.

**Не выполнять merge/push, пока пользователь не подтвердил его в этом же обмене.** Прогнать проверки, показать сводку, спросить, и только потом пушить.

## 1. Состояние

```bash
git status --porcelain
git rev-parse --abbrev-ref HEAD
git log --oneline main..HEAD
git diff --stat main...HEAD
```

Незакоммиченное — остановиться и спросить, что с ним делать. На `main` напрямую не работать.

## 2. Проверки

```bash
npx tsc --noEmit                                 # приложение
npx tsc --noEmit -p plugins-dev/tsconfig.json    # плагины (отдельная программа!)
cargo check --manifest-path src-tauri/Cargo.toml
cargo test  --manifest-path src-tauri/Cargo.toml
```

Вторая строка обязательна: корневой `tsconfig.json` ограничен `"include": ["src"]`, поэтому 9 тысяч строк плагинов он не видит, а esbuild типы не проверяет.

`cargo test` обязателен, а не для галочки: там живёт страж, который ловит команду, зарегистрированную в specta но не в рантайме (почему это смертельно — `src-tauri/CLAUDE.md`).

Любая красная проверка = стоп, о релизе не заговаривать.

## 3. Дрифт по диффу

Смотреть, что изменено в `main...HEAD`, и проверять только релевантное:

| если изменено | проверить |
|---|---|
| `src/Utils/masks.ts` | ручной дубль `apply_vars` в Rust синхронизирован + прогнать `npm run masks:docs` |
| `src-tauri/src/lib.rs` списки команд | `src/bindings.ts` перегенерён (`cargo test export_bindings`) и закоммичен |
| `plugins-dev/**` | сборка `distr-plugins/` **в .gitignore** → релиз приложения эти правки не понесёт, доставка отдельная (п. 5) |
| `jsx/dev/**` | `npm run jsx:build` сделан и `jsx/distr` закоммичен |

## 4. Мёрж

После подтверждения — влить feature-ветку в `main` и запушить. Версию **не трогать**: CI сам определит следующий свободный patch (источник истины — существующие релизы в releases-репо), перепишет её в `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` и закоммитит обратно в `main` сообщением `chore: bump version to X [skip ci]`. Ручной бамп только конфликтует с этим.

Релиз без пуша можно запустить вручную — `workflow_dispatch` во вкладке Actions.

## 5. После пуша — сказать пользователю

- Локальный `main` устарел: CI дописал в него bump-коммит. Перед следующей работой `git checkout main && git pull`, и уже от свежего `main` заводить новую ветку.
- Если в релиз входили правки плагинов — они пользователю **не приедут** с обновлением приложения. Плагины живут в `app_data/plugins` и ставятся отдельно: `npm run plug:pack <id>` → zip → установка.
- Куда смотреть: вкладка Actions (группа concurrency `release`, параллельные запуски не отменяются), готовые артефакты — в `alexIV-0/fs.manager.releases`.
