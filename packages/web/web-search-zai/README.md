# @deepseek-ai/dsh-web-search-zai

A [Z.ai](https://z.ai)-backed `WebSearchProvider` for the harness [web capability seam](../web/README.md) (`ctx.web`). It calls the standalone Web Search API (`POST /web_search`) and maps the structured results into the seam's normalized `WebSearchResult`.

This is an **implementation** package: it registers a provider into `ctx.web`, it does not own the key and it does not register a model-facing tool. Like `@deepseek-ai/dsh-web-search-perplexity`, it is a function/namespace plugin (`inject: ['web']`). The wire shape is a provider-private detail — this is not an LLM request and does **not** depend on `ctx.llm`.

## Config

| Key | Default | Meaning |
|---|---|---|
| `apiKey` | (unset) | Literal Z.ai API key. A non-empty literal wins; prefer `apiKeyEnv` so no secret enters configuration files. |
| `apiKeyEnv` | `ZAI_API_KEY` | Credential reference resolved for each search through `ctx.credentials`, or the launch environment when that seam is absent. |
| `baseURL` | `https://api.z.ai/api/paas/v4` | Endpoint base; `/web_search` is appended. `$ZAI_SEARCH_BASE_URL` feeds the same field; `$ZAI_BASE_URL` is deliberately not reused because deployments point it at the coding-plan endpoint, which does not serve `/web_search`. |
| `searchEngine` | `search-prime` | Search engine tier sent as `search_engine`. Required by the API (HTTP 400 code 1214 when empty). |
| `count` | `10` | Requested result count when the search carries no `maxResults`; range 1–50. |

```yaml
- id: web-search-zai
  name: '@deepseek-ai/dsh-web-search-zai'
  config:
    apiKeyEnv: ZAI_API_KEY
```

## Mapping

`content` is never set: the API is a search engine, not a chat model, so no answer text exists. `sources[]` maps `search_result[]` (`url` ← `link`, `title` ← `title`, `snippet` ← `content`, `publishedAt` ← `publish_date`); blank fields are omitted. `maxResults` is applied at the request layer as `count` (clamped into the API's 1–50 range) and still enforced on the way back by the seam. Provider failures surface as `WebError` `WEB_PROVIDER_ERROR`; an aborted request surfaces as `WEB_ABORTED`. HTTP redirects are rejected before the `Location` target is contacted and surface as `WEB_PROVIDER_ERROR`.

## Model Experience

### Search request

#### What the model sees

Nothing directly: the conversation model submits only `<query>` through `dsh-tool-web`, and the query goes verbatim to the Web Search API. No provider model request exists.

#### Token effect

No provider LLM tokens are incurred; the API bills per search request. Result sources enter the conversation only through the tool result.

#### KV Cache effect

No provider model request exists, so there is no provider cache; the conversation request cache is unaffected by the search itself.

### Conversation tool result, indirectly

#### What the model sees

Through [`dsh-tool-web`](../tool-web/README.md), the conversation model sees the structured sources. This provider's exact failures are `Z.ai search aborted`, `Z.ai search request failed: <error>`, and `Z.ai returned an unprocessable response body: <error>`; HTTP failures preserve the provider message. The consumer owns the error wrapper.

#### Token effect

Zero direct conversation tokens from registration. Source tokens are data-dependent, capped by the API's 50-result bound, and the retained result or error is resent until compaction.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

- **No generated answer** — the API returns structured results only, so `content` stays unset and the tool renders sources without a summary.
- **`count` is bounded to 1–50 by the API** — a `maxResults` above 50 cannot be honored at the request layer; the seam simply never sees more than 50 sources.
- **Only `searchEngine`/`count` are exposed** — the API's domain filter, recency filter, and content-size controls wait on provider-neutral Service Definition fields ([seam Agent Note](../../../.agents/notes/implemented/architecture/2026-06-24-web-capability-seam.md)).
- **The Web Search API is not part of the coding-plan subscription** — a key whose balance covers only `api.z.ai/api/coding/paas/v4` chat fails with HTTP 429 error code 1113 (`Insufficient balance or no resource package`); a funded resource package is required.
- **Abort classification is error-shape-based** — only a `DOMException` named `AbortError` maps to `WEB_ABORTED`; an abort carrying a custom reason (e.g. `dsh-timeout`'s `TimeoutReason`) surfaces as `WEB_PROVIDER_ERROR`.
