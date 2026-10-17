# @deepseek-ai/dsh-subprocess-station

Провайдер процессов над мостом станций: тот же шов `ctx.subprocess`, что и
локальный бэкенд. Деревья и stdio живут на станции (`proc/spawn`,
`proc/write`, `proc/close-stdin`, `proc/kill`, `proc/list`, события
`proc/stdout|stderr|exit`); сбор вывода, offset-чтение окон и эскалация
`SIGTERM → graceMs → SIGKILL` (Windows — сразу `taskkill /T /F`) — на хосте.

Конфиг: `{ stationId }`. Каждый spawn вычищает окружение хоста
(`scrubbedParentEnv`) и накладывает явные записи спеки — итог едет по
проводу целиком, коннектор не подмешивает своё окружение. Отмена спеки и
dispose сервиса ведут к `terminate()` — единственному глаголу завершения
шва; разрыв моста отклоняет `done` и ожидающих.

`resolveExecutable` исполняется на станции (`proc/resolve`: PATH/PATHEXT
станции), поэтому «где лежит node» отвечает машина пользователя.

## Model Experience

None, as the package is an execution-world provider reached through tool consumers composed in 5b; nothing here reaches a model request by itself.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **`spawnTerminal` не поддержан** — PTY, фореграунд-группы и resize через
  мост появляются на этапе 5b; вызов падает с явной ошибкой.
- **Окно collect — 512 КиБ хвоста без spill-файла**: полный вывод сверх
  окна теряется головой с честным `lossy`; файловый spill на хосте — 5b.
- **`inherit`-потоки уходят в консоль станции** — диагностика ребёнка видна
  на машине пользователя, а не в сессии хоста.
- **События без backpressure** — буферизация ограничена окном TCP;
  границы применяет хост-провайдер.