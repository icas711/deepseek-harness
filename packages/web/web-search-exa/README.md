# @deepseek-ai/dsh-web-search-exa

An [Exa](https://exa.ai)-backed `WebSearchProvider` for the harness [web capability seam](../web/README.md) (`ctx.web`). It calls Exa's `POST /search` endpoint with highlight contents and maps the flat `results[]` into the seam's normalized `WebSearchResult`.

This is an **implementation** package: it registers a provider into `ctx.web`, it does not own the `ctx.web` key and it does not register a model-facing tool (that is `@deepseek-ai/dsh-tool-web`). Like `@deepseek-ai/dsh-llm-deepseek`, it is a function/namespace plugin (`inject: ['web']`) that registers its backend, not a default-export service.

## Config

| Key | Default | Meaning |
|---|---|---|
| `apiKey` | (нет) | Литеральный ключ Exa; непустое значение имеет приоритет над `apiKeyEnv`. Предпочитайте `apiKeyEnv`, чтобы секрет не попадал в файлы конфигурации. |
| `apiKeyEnv` | `EXA_API_KEY` | Ссылка на credential, разрешается для каждого поиска. Пустое или отсутствующее значение означает fallback-переменную `$EXA_API_KEY`. |
| `baseURL` | `https://api.exa.ai` | Endpoint base; `/search` is appended. An unparseable value makes the provider unavailable. |
| `searchType` | `auto` | Retrieval mode sent as Exa's `type`: `auto` (Exa decides), `keyword`, or `neural`. |
| `numResults` | (unset) | Default result count when a request carries no `maxResults`. Unset sends no default. Must be a positive integer. |
| `highlightsPerResult` | `1` | Highlight sentences requested per result (Exa's `highlightsPerUrl`). Must be a positive integer. |

```yaml
- id: web-search-exa
  name: '@deepseek-ai/dsh-web-search-exa'
  config:
    apiKeyEnv: EXA_API_KEY
```

## Настройки в веб-GUI (settings-namespace)

Плагин регистрирует settings-namespace `web-search-exa` (`WEB_SEARCH_EXA_SETTINGS_NAMESPACE`), поэтому параметры провайдера доступны в «Настройки → Плагины» без правки композиции. Значение секции разрешается по слоям: схемный дефолт → композиционная запись (слой `base`) → пользовательский слой. Изменение применяется к следующему поиску без перерегистрации провайдера: провайдер проецирует секцию на каждый вызов, а не фиксирует её при регистрации. Присутствие поля в пользовательском слое (`user` дескриптора) помечает его переопределённым; «сброс» удаляет поле пользовательского слоя и возвращает композиционное значение.

Ключ не хранится в настройках: секция несёт только ссылку `apiKeyEnv`, а само значение пишется через credentials-домен. Литеральный `apiKey` из композиции несёт `role('secret')` и никогда не возвращается ответами `settings.describe` — поверхность настройки видит лишь факт «задан/не задан». Пустое значение `apiKeyEnv` означает fallback-переменную `$EXA_API_KEY`, поэтому очистка поля в форме возвращает провайдер к переменной окружения. Отсутствующий ключ завершает вызов ошибкой `WEB_PROVIDER_CREDENTIAL_MISSING` с именем ссылки в сообщении.

## Mapping

Exa returns a flat `results[]` and no generated answer, so `content` is omitted. Each result maps to a `WebSearchSource`: `url` ← `url`, `title` ← `title`, `snippet` ← the first non-empty `highlights[]` entry (a result with no highlight has no portable snippet and is dropped), `publishedAt` ← `publishedDate`. A request's `maxResults` wins over the configured `numResults` default and is sent as Exa's `numResults` for a cost/latency optimization; the final bound is enforced by the seam. Provider failures (HTTP errors, network failure, unparseable or wrong-shape bodies) surface as `WebError` `WEB_PROVIDER_ERROR`; an aborted request surfaces as `WEB_ABORTED`. HTTP redirects are rejected before the `Location` target is contacted and surface as `WEB_PROVIDER_ERROR`.

## Model Experience

Indirectly, through [`dsh-tool-web`](../tool-web/README.md), which retains this provider's `maxResults`-bounded URLs, titles, first highlights, and publication dates or its exact `Exa search aborted`, `Exa search request failed: <error>`, and `Exa returned an unprocessable response body: <error>` failures under the consumer's error wrapper while generated answers and provider-private fields remain outside context.

#### KV Cache effect

No direct invalidation; the named consumer owns any request-prefix changes.

## Known Limitations and Deferred Work

- **A result with no non-blank highlight is dropped entirely** — no portable snippet to map, so fewer sources than the requested count can return.
- **Only `searchType`/`numResults`/`highlightsPerResult` are exposed** — Exa's other controls (livecrawl, category, domain/date filters, full-text contents) wait on provider-neutral Service Definition fields ([seam Agent Note](../../../.agents/notes/implemented/architecture/2026-06-24-web-capability-seam.md)).
- **Abort classification is error-shape-based** — only a `DOMException` named `AbortError` maps to `WEB_ABORTED`; an abort carrying a custom reason (e.g. `dsh-timeout`'s `TimeoutReason`) surfaces as `WEB_PROVIDER_ERROR`.
