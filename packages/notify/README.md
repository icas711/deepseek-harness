# notify/ — уведомления человеку

Семейство возможности уведомлений разделяет контракт доставки и её провайдера:

| Пакет | Роль | ctx-ключ |
|---|---|---|
| [`notifier/`](notifier/README.md) | Service Definition: адресованные логину уведомления и биндинги по коду сопряжения | `ctx.notifier` |
| [`telegram/`](telegram/README.md) | Telegram-провайдер (`sendMessage` + `getUpdates`) и наблюдатель статусов задач | регистрирует `ctx.notifier` |

Провайдер один — Telegram, но контракт (`send`, `beginBinding`) не знает ни о боте, ни о чатах: провайдер владеет транспортом, текстами и приёмом кода сопряжения. Наблюдатель задач живёт в провайдере, потому что он же решает, кому доставлять уведомление; при появлении второго провайдера наблюдатель переедет в отдельный пакет-Consumer.

Без `DSH_TELEGRAM_BOT_TOKEN` строка провайдера в композиции пассивна: сервис не монтируется, таймеров и сетевых эффектов нет.

## Model Experience

None, as `notifier` and `telegram` are notification plumbing: nothing they own enters a model request, and the texts they send travel to a human's Telegram chat, not to the model.

### KV Cache effect

No direct effect: the packages add no prompt sections, no tools, and no logged input.
