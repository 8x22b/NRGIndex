# NRG / INDEX

Коллективный тирлист энергетиков: сервер на Node.js + Express, база SQLite, личный кабинет и админ-панель.

## Стек

- Node.js 22, Express 5, better-sqlite3 (WAL), миграции через `PRAGMA user_version`
- Пароли — `scrypt` (N=32768, r=8, p=1, соль на пользователя), сравнение через `timingSafeEqual`
- Сессии — в БД (хранится SHA-256 от токена), cookie `httpOnly` + `SameSite=Lax`, `Secure` автоматически за TLS-прокси
- Защита API: обязательный заголовок `X-NRG-Request` + проверка Origin на изменяющих запросах, rate-limit логина
- ИИ (OpenRouter) и поиск фото (Wikimedia Commons) выполняются только на сервере — ключи не попадают в браузер
- Фронтенд — ванильный JS (`public/`), админка — `admin/`, без сборки

## Структура

```
server/          Express-приложение: app.js, db.js, auth.js, routes/, lib/
public/          Публичный сайт и кабинет (статика)
admin/           Админ-панель (отдаётся только ролям editor/admin)
scripts/         create-admin.js, seed-legacy.js
tests/           node:test — unit и интеграционные API-тесты
deploy/          systemd-юнит для сервера
legacy/          Старые data.js/participants.js для однократного переноса в БД
```

## Локальный запуск

```bash
npm ci
npm test
DB_PATH=./data/nrg.db UPLOADS_DIR=./data/uploads PORT=3000 npm start
```

Первый администратор:

```bash
npm run create-admin -- --username admin --name "Ваше имя"
```

Схема БД и базовые тиры создаются автоматически при первом запуске.

## Роли

- `admin` — всё: напитки, оценки, тиры, пользователи, настройки, журнал
- `editor` — напитки, оценки, публикация
- `user` — свои оценки и свои добавленные банки

Пользователей создаёт админ в панели: выдаётся временный пароль, при первом входе требуется сменить его.

## Перенос старых данных

Данные из `legacy/data.js` и `legacy/participants.js` заливаются один раз:

```bash
npm run seed        # откажется работать, если база не пуста
```

Пользователи создаются без паролей: админ выдаёт им временные пароли в панели (или `npm run create-admin`). После переноса папку `legacy/` можно удалить.

## Деплой

Ветка `production` — точка деплоя. На push GitHub Actions запускает:

1. `Pre-deploy tests` — `npm ci` + `npm test` на self-hosted runner
2. `Deploy site` — `npm ci --omit=dev`, dry-run миграций на временной БД, rsync в `/opt/nrgindex`, обновление systemd-юнита, рестарт, health-check `/api/health` и автоматический откат при провале

Конфиг сервиса — `/etc/nrgindex.env`:

```
PORT=80
DB_PATH=/var/lib/nrgindex/nrgindex.db
UPLOADS_DIR=/var/lib/nrgindex/uploads
TRUST_PROXY=10.10.20.25    # IP обратного прокси; X-Forwarded-* принимаются только от него
COOKIE_SECURE=auto
SESSION_TTL_DAYS=30
SESSION_IDLE_DAYS=14
OPENROUTER_KEY=            # можно задать в админке (Настройки)
```

systemd-юнит обновляется вручную: скопировать `deploy/nrgindex.service` в `/etc/systemd/system/`, затем `systemctl daemon-reload && systemctl restart nrgindex`. Деплой обновляет только код — у runner'а нет прав на изменение юнита.

Данные (БД и загрузки) лежат в `/var/lib/nrgindex` и в репозиторий не попадают.
