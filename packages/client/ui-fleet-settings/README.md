# @deepseek-ai/dsh-client-ui-fleet-settings

Панель лимитов флота в разделе настроек «Общие», browser-половина dual-face клиентского плагина: два целочисленных поля — потолок попыток одного фанлаута и предел вложенности — читают settings-секцию `fleet` (`settings.describe`) и пишут её (`settings.update` с `expectedRevision`), а служба флота применяет значения к следующим фанлаутам без перезапуска. Под строкой — раскрывающийся блок примеров промптов с копированием в буфер (аналог usage-примеров панели оркестрации Orca). Node-половина — пустой `apply`.

## Registration surfaces

- `dsh.client` manifest (browser roster; see the web-app bundle patch)
- `tsconfig.client.json` aggregate reference + `tsconfig.base.json` paths entry
- `packages/bundle/web-app` row + package dependency

## Behavior

- **Чтение** — `settings.describe` находит view секции `fleet` (значение, ревизия, признак writability); композиция без службы флота рендерит только пояснительный текст (`unavailable`), как и отказ провода с его сообщением. Обновление приходит с `settings/document-updated` для `fleet` и на пересоединении к перезапущенному host.
- **Запись** — «Применить» отправляет оба поля одним `settings.update`; ответ view — следующая правда строки, включая отказ (например, нецелое значение) с его сообщением. Правка извне (другая вкладка, открытый на host документ) заменяет неотправленный черновик.
- **Примеры** — «Как пользоваться» раскрывает три готовых промпта (параллельные попытки, разбиение на части, сравнение подходов) с кнопкой «Скопировать». Копирование идёт через async Clipboard API, а вне secure context (браузер по IP Tailscale через plain HTTP) — через легаси-путь `textarea` + `execCommand`; отказ любого пути молчалив — текст остаётся на экране для ручного выделения.

## Model Experience

None, as the row edits host-side limits in the browser; nothing here enters the Session log, model context, or telemetry.

#### KV Cache effect

None: the surface registers no prompt, schema, or request field.

## Known Limitations and Deferred Work

- Поля правятся только парой: отдельная кнопка сброса к composition-base (`replace({})`) отложена — значения базы видны в открытом на host документе настроек.
