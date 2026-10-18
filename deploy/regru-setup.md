# Развёртывание DSH на VPS reg.ru (aiminion.ru / ai-minion.ru)

Пошаговая инструкция аренды сервера, привязки доменов и запуска оркестратора в Docker на площадке reg.ru. Общий обзор компонентов и переменных — в [deploy/README.md](README.md); здесь только конкретика reg.ru.

## 1. Что понадобится

- Аккаунт reg.ru с зарегистрированными доменами `aiminion.ru` и `ai-minion.ru`.
- Локально: заполненный `deploy/.env` (шаблон `deploy/.env.example`); ключ `DEEPSEEK_API_KEY`; домен в `DSH_PUBLIC_HOST`.
- SSH-клиент (Windows: встроенный `ssh` в PowerShell; macOS/Linux: терминал).

## 2. Аренда сервера

В каталоге reg.ru выберите продукт **«Облачный сервер»** (не Windows-VPS и не обычный хостинг сайтов). Минимальная конфигурация: ОС **Ubuntu 24.04**, 2 vCPU, **2 ГБ RAM** (комфортно — 4 ГБ), диск NVMe от 30 ГБ, локация — ближайшая к пользователям. После создания сервера панель покажет публичный IPv4 — запишите его (далее `IP_СЕРВЕРА`) и root-пароль (или добавьте свой SSH-ключ в панели при создании). Актуальные названия разделов панели и тарифы — в поддержке площадки: https://reg.cloud/support/cloud/oblachnyye-servery/.

## 3. DNS: привязка доменов

В личном кабинете reg.ru откройте **Домены → aiminion.ru → DNS-записи** и создайте запись: тип `A`, имя `@`, значение `IP_СЕРВЕРА`, TTL 3600. Повторите то же для `ai-minion.ru`. Проверка распространения (1–60 минут): `nslookup aiminion.ru` должен вернуть `IP_СЕРВЕРА`. TLS-сертификат Caddy выпустит только после того, как домен указывает на сервер, — не начинайте раздел 7 раньше проверки.

## 4. Первый вход и подготовка сервера

```sh
ssh root@IP_СЕРВЕРА
```

Установите Docker с официального репозитория и git:

```sh
apt-get update && apt-get install -y ca-certificates curl git
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" > /etc/apt/sources.list.d/docker.list
apt-get update && apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
docker compose version
```

Настройте firewall (SSH, HTTP для выпуска сертификатов, HTTPS):

```sh
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw --force enable
```

## 5. Код

```sh
git clone https://github.com/icas711/deepseek-harness.git /opt/dsh && cd /opt/dsh
```

Если репозиторий приватный — используйте Personal Access Token (GitHub → Settings → Developer settings → Tokens, права только на чтение): `git clone https://ТОКЕН@github.com/icas711/deepseek-harness.git /opt/dsh`.

## 6. Конфигурация .env

```sh
cp deploy/.env.example deploy/.env
nano deploy/.env
```

Заполните: `DSH_PUBLIC_HOST=aiminion.ru`; `DEEPSEEK_API_KEY=...`; при желании `DSH_TELEGRAM_BOT_TOKEN=...` (бот от @BotFather) и `DSH_WEB_URL=https://aiminion.ru`. Хэши паролей сгенерируйте на сервере без установки Node (одноразовый контейнер с Node 22 монтирует папку deploy):

```sh
docker run --rm -v /opt/dsh/deploy:/deploy -w /deploy node:22-slim node hash-password.mjs admin 'СложныйПароль!'
```

Готовую строку вида `DSH_WEB_USERS='admin:scrypt$16384$8$1$...'` вставьте в `deploy/.env` **целиком в одинарных кавычках** — compose интерполирует `$` и молча портит хэш без кавычек. Для второго пользователя повторите генератор и допишите через запятую. Правило кавычек и остальные переменные описаны в [.env.example](.env.example).

## 7. Сборка и запуск

```sh
docker compose build      # 10–20 минут на 2 vCPU, один раз
docker compose up -d --profile tls
```

Подготовьте каталог кабинетов и проверьте состояние:

```sh
mkdir -p /opt/dsh/workspace && chown -R 1000:1000 /opt/dsh/workspace
docker compose ps && docker compose logs --tail 30 caddy dsh
```

Откройте `https://aiminion.ru/login` — страница входа с валидным сертификатом. Войдите под администратором. Первый вход, роли и устройства — в разделе «Задачи и статусы» и «Администрирование» интерфейса.

## 8. Второй домен (опционально)

Чтобы `ai-minion.ru` обслуживал тот же сервер, в [Caddyfile](Caddyfile) замените адрес сайта на перечисление:

```
{$DSH_PUBLIC_HOST}, ai-minion.ru {
```

и выполните `docker compose restart caddy` — сертификат для второго имени выпустится автоматически.

## 9. Обновление

```sh
cd /opt/dsh && git pull
docker compose build && docker compose up -d --profile tls
```

Перезапуск прерывает активные задачи — обновляйтесь, когда на странице «Задачи» нет статусов «Выполняется» и «Ждёт станцию» (сессии и история сохраняются всегда).

## 10. Бэкапы

Данные: bind-каталог `workspace` (кабинеты) и том `dsh-home` (сессии, пользователи, реестры). Ежедневный cron-пример:

```sh
tar czf /root/backups/workspace-$(date +%F).tar.gz -C /opt/dsh workspace
VOL=$(docker volume ls --format '{{.Name}}' | grep dsh-home | head -1)
docker run --rm -v $VOL:/data -v /root/backups:/backup node:22-slim tar czf /backup/dsh-home-$(date +%F).tar.gz -C /data .
```

Храните копии вне сервера (reg.ru даёт облачное хранилище — можно синкать туда).

## 11. Типовые проблемы

| Симптом | Причина и действие |
|---|---|
| Сайт не открывается | DNS ещё не разошёлся (раздел 3) или закрыты порты 80/443 (раздел 4) |
| Сертификат не выпускается | Домен не указывает на сервер; выпуск виден в `docker compose logs caddy` |
| `/api` отвечает 403 | `DSH_PUBLIC_HOST` не совпадает с адресом в браузере |
| Вход не принимает пароль | Хэш повреждён интерполяцией `$` — пересоздайте с одинарными кавычками (раздел 6) |
| Контейнер не пишет в workspace | На Linux-хосте выполните `chown -R 1000:1000 /opt/dsh/workspace` |
| Задача «Ждёт станцию» не продолжается | Коннектор выключен; на машине станции: `dsh-station run` |

## 12. Коннектор станции на своём компьютере

Получите код (под администратором): `curl -u admin:'Пароль' https://aiminion.ru/api/station.beginPairing -H 'Content-Type: application/json' -d '{}'`. На своей машине: `dsh-station pair --server wss://aiminion.ru/station-ws --code КОД`, затем выберите корневую папку и `dsh-station run`. В композере новой задачи появится выбор «Станция ⟨имя⟩»; при выключении компьютера задача перейдёт в «Ждёт станцию» и продолжится автоматически после возврата.
