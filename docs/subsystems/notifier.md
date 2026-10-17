# Уведомления

Сервис `ctx.notifier` ([`@deepseek-ai/dsh-notifier`](../../packages/notify/notifier/README.md)) — шов уведомлений, независимый от канала: определение владеет доставкой, адресованной логину, биндингами «логин → пункт доставки» и одноразовыми кодами сопряжения; транспорт и формулировки — забота провайдера ([`dsh-telegram-notifier`](../../packages/notify/telegram/README.md)). Проектное решение — [Agent Note о Telegram-уведомлениях о задачах](../../.agents/notes/implemented/feature/2026-10-17-telegram-task-notifications.md).

## Доставка

`send({ login, kind, title, sessionId })` доставляет уведомление в пункт доставки, привязанный к логину. Незавершённый логин молча пропускается — доставлять некуда; сбой доставки отклоняется исключением, чтобы звонящий отличал пропуск от сбоя и мог повторить. `kind` — закрытый набор `paused`/`interrupted`/`completed`/`failed`: потребитель в провайдере следит за статусами задач [супервизора](task-supervisor.md) и доставляет человеку уведомления об их смене.

## Биндинги и коды сопряжения

Биндинги живут в документе `telegram-bindings.json` (путь — обязательное поле конфига `bindingsPath`): записи `{ login, chatId, boundAt }`, где `chatId` — брендированный идентификатор пункта доставки. Каждая привязка перечитывает документ под writer-lock из `dsh-atomic-write` и коммитит его одной атомарной заменой с правами `0600`; битый документ роняет загрузку сервиса громко. `beginBinding(login)` выдаёт одноразовый код с ограниченным сроком жизни; коды живут только в памяти процесса — рестарт обнуляет выданные коды, пользователь запрашивает новый.

## Границы

- Страницы привязки и RPC-эндпоинтов нет, поэтому в композиции по умолчанию коды никто не выдаёт: `beginBinding` пока доступен только как API сервиса.
- Отвязки нет: повторная привязка логина перезаписывает `chatId`, записи документа не удаляются.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxnotifier--notifier-abstract-seam"></a>

### `ctx.notifier` — `Notifier` (abstract seam)

The notification service (`ctx.notifier`).

```ts cordis-catalog
/**
 * Begin one pairing: mint a single-use code the user presents to the
 * provider's transport (the Telegram provider accepts it as `/start КОД`).
 * Requesting a new code for a login invalidates that login's previous
 * code; codes are held in memory only, so a restart voids them and the
 * user simply requests a fresh one.
 * @param login - the user asking to bind a destination.
 * @returns the pairing challenge carrying the code.
 * @throws {@link NotifierError} with `invalid-login` when the login cannot
 * key a durable binding.
 */
async beginBinding(login: string): Promise<BindingChallenge>

/**
 * Deliver one notification to the login's bound destination. An unbound
 * login drops the request without an error — there is nowhere to deliver
 * it; delivery failures reject, so callers can distinguish a dropped
 * request from a failed delivery and retry.
 * @param request - the notification to deliver.
 * @returns `sent` after a successful delivery, `unbound` when the login has no binding.
 * @throws whatever the provider's delivery throws.
 */
async send(request: NotificationRequest): Promise<SendResult>

/**
 * Enumerate the logins that currently hold a confirmed binding, in
 * document order. Broadcast-style consumers (the task watcher) address
 * their sends through this list; a per-login UI page will list the same
 * records.
 * @returns the bound logins.
 */
async boundLogins(): Promise<string[]>
```

Source: [`packages/notify/notifier/src/index.ts:55`](../../packages/notify/notifier/src/index.ts)
<!-- END GENERATED cordis-surface -->
