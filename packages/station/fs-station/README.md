# @deepseek-ai/dsh-fs-station

Провайдер файловой системы над мостом станций: тот же шов `ctx.fs`, что и
локальный/удалённый бэкенды, но каждый ход — операция протокола станции
(`fs/stat` с lstat-режимом, `fs/list`, `fs/read`, `fs/write`, `fs/mkdir`,
`fs/unlink`). Цель — абсолютный путь в языке платформы станции; версия —
метка фактов stat коннектора, гварды `createIfAbsent`/`replaceIfVersion`
проверяются до отправки и повторно на станции.

Конфиг: `{ stationId, readLimitBytes? }` — идентификатор станции из реестра
`ctx.stations` и транспортный лимит чтения (умолчание 50 МиБ — страховка
провода, не политика). Провайдер пассивен к офлайну в `resolve` (ключ пути
стабилен без связи) и падает понятным `FS_IO_ERROR`/`FS_NOT_FOUND` в
операциях к офлайн-станции.

Изоляция путей двоится: `resolve` удерживает путь в корне реестра
(`resolveWithinRoot`, платформенные правила), коннектор повторяет проверку
лексикой и realpath перед исполнением. Бинарное и не-UTF-8 содержимое
отклоняется теми же кодами шва, что и у локального бэкенда.

## Model Experience

None, as the package is an execution-world provider reached through tool consumers composed in 5b; nothing here reaches a model request by itself.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Сессионная привязка — этап 5b**: провайдер адресуется конфигом
  `stationId`; механику выбора станции для сессии (preset/isolate) делает
  следующий этап.
- **`streamText` читает файл целиком** в пределах `readLimitBytes` и отдаёт
  кусками; настоящий потоковый канал поверх моста (окна, backpressure) —
  отложенная работа.
- **Spill-файлы моста отсутствуют**: полный вывод, превысивший окно,
  теряется головой с честным `lossy` (это поведение провайдера процессов;
  файловый spill через мост — 5b).