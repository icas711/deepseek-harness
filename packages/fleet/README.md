# fleet/ — оркестрация worktree-фанлаута

Семейство даёт паттерн «один промпт → N параллельных попыток в изолированных git worktree»: каждая попытка — обычная сессия в собственном worktree, видимая во всех существующих поверхностях (Web GUI, браузер телефона, персистентность).

| Пакет | Роль | ключ ctx |
|---|---|---|
| [`worktree/`](worktree/README.md) | Git-worktree и ветки: create/list/remove, diff, merge (Definition + локальный провайдер) | `ctx.worktrees` |
| [`fleet/`](fleet/README.md) | Служба фанлаута: worktree + workspace + сессия на попытку, статусы, уведомления владельцу | `ctx.fleet` |
| [`tool-fleet/`](tool-fleet/README.md) | Инструменты `fleet_*` для модели: запуск, статус, диффы, слияние победителя, очистка | регистрируется на `ctx.tools` |

Дизайн и отвергнутые альтернативы — в [заметке о фанлауте](../../.agents/notes/implemented/feature/2026-10-11-worktree-fanout-fleet.md).
