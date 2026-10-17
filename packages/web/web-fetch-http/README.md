# @deepseek-ai/dsh-web-fetch-http

An anonymous public HTTP(S) `WebFetchProvider` for the harness [web capability seam](../web/README.md) (`ctx.web`). It retrieves a concrete URL and returns a status code plus bounded decoded content.

This is an **implementation** package: it registers a provider into `ctx.web`, it does not own the key and it does not register a model-facing tool. It is a function/namespace plugin (`inject: ['web']`).

## Responsibility split

The provider owns **safe resource retrieval**: URL validation, HTTP transport, redirect policy, a resource-backstop timeout, abort propagation, byte caps, charset decoding, content-type classification, and binary rejection. `@deepseek-ai/dsh-tool-web` owns **presentation** (HTML→markdown, truncation formatting). A non-2xx HTTP response is a *result* (status code + decoded body), not an error; `WebError` is reserved for failures to safely retrieve or represent the resource.

The provider's `timeoutMs` is a resource backstop for direct `ctx.web.fetch()` callers and misconfigured deployments, not the model-facing tool-call budget. [`dsh-tool-call-timeout-policy`](../../guard/timeout-policy/README.md) owns the `web_fetch` tool-call budget by arming `exec.signal`.

A shipping web-tool deployment sets the provider backstop above the tool budget, so model calls normally return `TOOL_TIMEOUT`. If the outer deadline reaches the provider first, the provider reports `WEB_ABORTED` and the outer policy replaces it with `TOOL_TIMEOUT`. `WEB_FETCH_TIMEOUT` therefore identifies a direct service caller whose provider budget elapsed.

## Transport hygiene

- Accepts only `http:` and `https:` URLs; rejects credentials in URLs (`WEB_BLOCKED_URL`) and over-long/malformed URLs (`WEB_INVALID_URL`).
- Enforces a max URL length, response byte cap (`WEB_FETCH_TOO_LARGE`), decoded body character cap, timeout (`WEB_FETCH_TIMEOUT`), and redirect hop cap.
- Propagates the caller's abort signal (`WEB_ABORTED`) into the network request and the streaming read.
- Follows only **same-origin** redirects; a cross-origin redirect fails with `WEB_REDIRECT_BLOCKED`, requiring a fresh tool call (the model of Claude Code's WebFetch).
- Sends an explicit product `User-Agent`, never a browser disguise.
- Rejects unsupported (e.g. binary) content types with `WEB_UNSUPPORTED_CONTENT_TYPE`.

### Защита от SSRF

SSRF-защита реализована и покрыта тестами: провайдер пригоден для монтажа в деплое, где цель запроса выбирает модель. Блокируются приватные, loopback, link-local, metadata- и multicast-адреса — IPv4: `0.0.0.0/8`, RFC 1918 (`10/8`, `172.16/12`, `192.168/16`), `127.0.0.0/8`, `169.254.0.0/16` (включая `169.254.169.254`), `224.0.0.0/4`, `240.0.0.0/4`; IPv6: `::`, `::1`, `fc00::/7`, `fe80::/10`, `ff00::/8` и все встроенные IPv4-формы (`::ffff:0:0/96`, устаревший `::/96`, NAT64 `64:ff9b::/96`); запрещённый адрес отвечает ошибкой `WEB_BLOCKED_URL`. IPv6-зоны (raw- и URL-экранированный вид `%25`) срезаются перед разбором.

Проверка выполняется после DNS-резолва: имя принимается, только если среди ответов резолвера есть публичный адрес, и подключение идёт к уже проверенному адресу — транспорт не перерезолвляет имя, поэтому DNS rebinding между проверкой и соединением не переносит сокет. Каждый same-origin редирект проходит полную повторную проверку: транспортную гигиену, совпадение origin и SSRF-гард. Инвариант закреплён юнит-тестами `tests/ssrf.spec.ts`: прямые URL, замоканные ответы DNS и цели редиректов.

## Config

| Key | Default | Meaning |
|---|---|---|
| `maxUrlLength` | `2048` | Maximum accepted request URL length. |
| `maxResponseBytes` | `5_000_000` | Maximum response body size in bytes. |
| `maxBodyChars` | `100_000` | Maximum decoded body length in characters. |
| `timeoutMs` | `30_000` | Fetch timeout within Node's timer range — a resource backstop for direct `ctx.web.fetch()` callers, not the model-facing tool-call budget (that is `dsh-tool-call-timeout-policy`). |
| `maxRedirects` | `5` | Maximum same-origin redirect hops (`0` follows none). |
| `userAgent` | `deepseek-harness/…` | `User-Agent` header. |

The numeric limits are validated at plugin construction: every cap except `maxRedirects` must be a positive finite number, and `maxRedirects` must be a non-negative integer. An invalid value throws rather than silently constructing a provider with nonsensical limits.

### Секция настроек

Те же шесть полей зарегистрированы как settings-namespace `web-fetch-http` (`WEB_FETCH_HTTP_SETTINGS_NAMESPACE`) по образцу секций поисковых провайдеров. Секретов в секции нет. Слои и семантика override/reset — как у всех секций страницы «Плагины»: схемный дефолт → композиционная запись (`cordis.yml`) → пользовательский слой; «сброс» удаляет поле пользовательского слоя и возвращает композиционное значение. Провайдер читает секцию на каждый `fetch()`, поэтому сохранённое изменение действует со следующего запроса без перезапуска; значение, которое схема выразить не может, отклоняется валидатором секции на самой записи.

## Model Experience

Indirectly, through [`dsh-tool-web`](../tool-web/README.md), which places this provider's `maxBodyChars`-bounded decoded text or markdown-shaped HTML under its fetch-result wrapper and retains provider failures while redirects, headers, and transport mechanics remain hidden.

#### KV Cache effect

No direct invalidation; the named consumer owns any request-prefix changes.

## Known Limitations and Deferred Work

- **Защита от SSRF реализована и покрыта тестами** — контракт гарда (диапазоны, проверка после DNS-резолва, пин проверенного адреса, повторная проверка редиректов) описан в разделе «Защита от SSRF» выше.
- **Only textual content decodes** — html/xhtml and `text/*`-plus-JSON/XML families; a missing `Content-Type` or any binary type throws `WEB_UNSUPPORTED_CONTENT_TYPE`, and text-extractable PDF decoding is named deferred work.
- **Charset comes only from the `Content-Type` header** (UTF-8 default) — an HTML `<meta charset>` declaration is ignored, and a declared-but-unrecognized charset label throws rather than falling back.
