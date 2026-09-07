# syntax=docker/dockerfile:1
# Образ веб-GUI DeepSeek Harness (`dsh web`) для удалённого сервера.
# Контекст сборки — корень репозитория; запуск — через deploy/compose.yaml.
# Пошаговая инструкция: deploy/README.md.

# ── Стадия 1: сборка монорепозитория из исходников ──────────────────────────
FROM node:24-bookworm-slim AS build

# build-essential и python3 — нативный модуль node-pty; musl-tools — статический
# лаунчер песочницы Landlock; git — инструмент сборки и агента.
RUN apt-get update \
  && apt-get install -y --no-install-recommends build-essential python3 musl-tools git ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && npm install -g pnpm@11.7.0

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
FROM node:24-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && npm install -g pnpm@11.7.0

COPY --from=build /app /app

# Весь пользовательский стейт — профиль web, storages с сессиями, credentials —
# живёт под DSH_HOME. Держим его на томе, чтобы он переживал пересоздание
# контейнера и обновления образа.
ENV DSH_HOME=/data/dsh-home

# Вызывающий каталог = workspace root агента.
WORKDIR /workspace
EXPOSE 3080

ENTRYPOINT ["node", "/app/apps/cli/lib/bin.js"]
CMD ["web", "--patch", "/app/deploy/web-remote.patch.yml"]
