# Agent Note: Z.ai web search provider on the standalone Web Search API

Status: implemented

English | [中文](2026-08-24-web-search-zai-provider.zh.md)

## Problem

The base bundle's default `web_search` route was `web-search-deepseek`, which resolves `DEEPSEEK_API_KEY`. A deployment whose chat runs through the Z.ai adapter (`llm-zai`, `ZAI_API_KEY`) has no valid DeepSeek key, so every model-facing search failed with `WEB_PROVIDER_ERROR` carrying the provider's "invalid api key" reply. Chat and search read different credential domains, and search had no provider that reads the chat-side key.

Z.ai serves two distinct search-capable surfaces, and the choice between them is a real decision: the chat-completions API accepts a `web_search` server tool (an auxiliary LLM request with retrieval, the shape `web-search-deepseek` uses on the DeepSeek side), and a standalone Web Search API (`POST /web_search`) returns structured results with no generated answer.

## Decision

`@deepseek-ai/dsh-web-search-zai` (`packages/web/web-search-zai`) implements the standalone Web Search API, not the chat-completions `web_search` server tool. It registers on `ctx.web` with provider id `zai`, mirroring `web-search-perplexity`'s package shape (function plugin, `inject: ['web']`, provider-private `fetch` client, redirect-`error` policy).

The standalone API is chosen because it is the honest mapping for a search-only seam call: structured `search_result[]` maps to `sources[]` (`url` ← `link`, `snippet` ← `content`, `publishedAt` ← `publish_date`) with no auxiliary LLM request, no generated `content` to discard, and no per-search model token spend. The chat-side server tool would route a search through a full model request — billing model tokens per query and returning an answer the seam's `content` field would invite consumers to depend on — which is a chat capability, not a search provider.

Credential resolution reuses the `llm-zai` convention: `apiKeyEnv` defaults to the `ZAI_API_KEY` credential reference, resolved per search through `ctx.credentials` with the launch environment as fallback, and a literal `apiKey` wins. The endpoint default is `https://api.z.ai/api/paas/v4` with `$ZAI_SEARCH_BASE_URL` as the environment override; `$ZAI_BASE_URL` is deliberately not reused because deployments point it at the coding-plan endpoint (`api.z.ai/api/coding/paas/v4`), which does not serve `/web_search`.

The base bundle mounts `web-search-zai` and selects it as the default `searchProvider`; `web-search-deepseek` stays mounted, so a deployment with a valid DeepSeek key can switch routes through the web config, a settings layer, or `$DSH_WEB_SEARCH_PROVIDER` without changing composition. The deployment's chat and default search now read one credential domain.

`search_engine` is required by the API (HTTP 400 code 1214 when empty) and defaults to `search-prime`; `count` (range 1–50) is derived from the request's `maxResults` and clamped, with the seam still enforcing the bound on the way back.

## Alternatives considered

### Why not the chat-completions `web_search` server tool?

It is the mechanism `web-search-deepseek` uses, and it returns a generated answer plus sources. It loses here: an auxiliary model request per search costs model tokens and adds answer-generation latency for a seam call that needs citations; it couples the search route to chat-model availability and model naming (the tool rides a chat model request, so a model rotation changes search behavior); and a coding-plan subscription that covers chat does not make the search tool free — the same billing wall appears one layer up. The standalone API returns exactly what the seam normalizes.

### Why not fix the DeepSeek key instead?

Storing a valid `DEEPSEEK_API_KEY` restores the existing route with zero code. It loses as the primary fix because the deployment's stated direction is that chat and search share the Z.ai credential domain; a second funded account for search only is an operational cost this package removes. The DeepSeek route remains mounted precisely so this alternative stays one settings change away.

### Why not Exa or Perplexity?

Both are existing seam providers, but each requires a new third-party account and key. Z.ai reuses the credential the deployment already funds for chat.

## Consequences

Search availability now depends on the Z.ai account funding the Web Search API, not just chat: the coding-plan subscription does not cover it — a key whose balance covers only the coding endpoint fails with HTTP 429 error code 1113 (`Insufficient balance or no resource package`), and a funded resource package is required. This is the cost of sharing one credential domain across two separately billed APIs, recorded in the package README's limitations.

The seam gains a provider that never sets `content`, proving the optional-answer shape stays honest for pure search engines. `maxResults` above 50 cannot be honored at the request layer (API bound); the seam sees at most 50 sources. Domain-filter, recency, and content-size controls the API offers stay unexposed until provider-neutral request fields exist ([web capability seam Agent Note](../architecture/2026-06-24-web-capability-seam.md)).

## Testing

`tests/zai.spec.ts` covers response mapping, availability, request mapping (engine, clamped count, abort signal), the error taxonomy (provider message extraction, abort classification in every body-parsing branch, missing-key failure naming the credential reference), and HMR-safe registration plus env fallback through the real `WebRuntime`. `tests/redirect.spec.ts` proves over real HTTP that redirects are rejected before a `Location` target is contacted for every redirect status. `tests/zai.e2e.ts` is a key-gated real-API smoke that self-skips without `$ZAI_API_KEY`.
