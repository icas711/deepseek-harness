# syntax=docker/dockerfile:1
# Образ веб-GUI DeepSeek Harness (`dsh web`) для удалённого сервера.
# Контекст сборки — корень репозитория; запуск — через deploy/compose.yaml.
# Пошаговая инструкция: deploy/README.md.

# ── Стадия 1: сборка монорепозитория из исходников ──────────────────────────
FROM node:22-slim AS build

# Версия pnpm совпадает с packageManager корневого package.json (pnpm@11.7.0).
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare pnpm@11.7.0 --activate

# build-essential и python3 — нативные модули зависимостей (node-pty и др.);
# musl-tools — статический лаунчер песочницы Landlock; git — инструмент сборки
# и агента.
RUN apt-get update \
  && apt-get install -y --no-install-recommends build-essential python3 musl-tools git ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY . .

# Кэш store ускоряет пересборку после `git pull`: слой COPY сбрасывается любым
# изменением исходников, а скачанные пакеты переиспользуются из store.
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
  pnpm install --frozen-lockfile

# Прекомпилированного бинарника лаунчера в чекауте нет (его публикует нативный
# CI отдельными пакетами), поэтому собираем его в образе. Без него песочница
# процессов внутри контейнера деградирует; внешней границей остаётся сам
# контейнер, так что при желании шаг можно убрать.
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
  pnpm --filter @deepseek-ai/node-addon-landlock-run-workspace run build:native

# lib/ пакетов, бандлы рантайма (tsdown) и dist фронтенда веб-GUI (vite).
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
  pnpm run build

# ── Стадия 2: рантайм ────────────────────────────────────────────────────────
FROM node:22-slim

# В рантайме компиляторов нет: только Node.js, pnpm (им же пользуется
# `dsh plugin`) и git для агента.
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare pnpm@11.7.0 --activate \
  && apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build /app /app

# Весь пользовательский стейт — профиль web, storages с сессиями, credentials —
# живёт под DSH_HOME. Держим его на томе, чтобы он переживал пересоздание
# контейнера и обновления образа. Каталоги готовятся до смены пользователя:
# пустой именованный том dsh-home при первом подключении наследует владельца
# точки монтирования из образа, запись должна быть возможна под node.
ENV DSH_HOME=/data/dsh-home
RUN mkdir -p /data/dsh-home /workspace && chown node:node /data/dsh-home /workspace

# Рантайм — не root: агент исполняет команды на сервере, и непривилегированный
# пользователь срезает цену ошибок песочницы. Следствие для Linux-хоста:
# bind-том workspace должен принадлежать uid 1000 (deploy/README.md).
USER node
# База образа оставляет HOME=/root; без переопределения пользовательские
# каталоги (pnpm store, git config) указывали бы в нечитаемый /root.
ENV HOME=/home/node

# Вызывающий каталог = workspace root агента (кабинеты пользователей — рядом).
WORKDIR /workspace
EXPOSE 3080

# Живость: страница входа должна отвечать. Без настроенных пользователей /login
# отвечает 404 — для проверки живости это тоже годится, важен сам ответ.
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=5 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3080/login').then(r => process.exit(r.status < 500 ? 0 : 1), () => process.exit(1))"]

ENTRYPOINT ["node", "/app/apps/cli/lib/bin.js"]
CMD ["web", "--patch", "/app/deploy/web-remote.patch.yml"]
