# @deepseek-ai/dsh-llm-zai

English | [中文](README.zh.md)

Z.ai (GLM) chat-completions adapter for the harness LLM seam: direct `fetch` + SSE (framed by `eventsource-parser`) translating the Z.ai wire format into the `StreamChunk` protocol.

Z.ai provides the GLM series of models including GLM-5.3 (1M context with thinking support), GLM-5.2, GLM-4.7, and more. This adapter implements the OpenAI-compatible API format at `https://api.z.ai/api/paas/v4/`.

## Quick Start

### 1. Get an API Key

Visit [https://open.bigmodel.cn/](https://open.bigmodel.cn/) to sign up and obtain your API key.

### 2. Configure the API Key

Add your API key to your environment:

```bash
export ZAI_API_KEY=your_api_key_here
```

Or add it to your `.env` file:

```env
ZAI_API_KEY=your_api_key_here
```

### 3. Configure the Provider

Add the provider to your `cordis.yml` configuration:

```yaml
plugins:
  - id: llm-zai
    name: '@deepseek-ai/dsh-llm-zai'
    config:
      apiKeyEnv: ZAI_API_KEY
      # Optional: override default models or customize settings
      # models:
      #   - id: glm-5.3
      #     name: GLM-5.3
      #     contextWindow: 1000000
```

### 4. Use the Provider

In your code, request using the `zai` provider:

```typescript
const response = await ctx.llm.stream({
  provider: 'zai-official',
  model: 'glm-5.3',
  messages: [{ role: 'user', content: 'Hello!' }],
})
```

## Config

Full configuration options for `cordis.yml`:

```yaml
- id: llm-zai
  name: '@deepseek-ai/dsh-llm-zai'
  config:
    apiKeyEnv: ZAI_API_KEY      # default; resolved per request via ctx.credentials, then the environment
    baseURL: https://api.z.ai/api/paas/v4 # optional; defaults to the Z.ai public API
    thinking: enabled           # optional; provider default is enabled for supported models
    reasoningEffort: high       # optional; off | high | max (default: off)
    maxTokens: 256000           # optional positive per-request output cap; this is the default
    streamIdleTimeoutMs: 300000 # optional; positive finite Node timer delay; five-minute default
    retryPolicy:                # optional; omission uses bounded normal defaults
      mode: always              # normal | always
      backoff:
        initialDelayMs: 500
        maxDelayMs: 10000
        jitterRatio: 0.1
    defaultContextWindow: 1000000 # optional positive-integer fallback; this is the default
    models:                     # optional; defaults to all GLM models (see below)
      - id: glm-5.3
        name: GLM-5.3
        contextWindow: 1000000
        description: Latest GLM with 1M context and thinking support
      - id: glm-4.7-flash
        name: GLM-4.7-Flash
        contextWindow: 200000
        description: Fast variant with 200K context
```

The plugin registers the provider route `zai-official` (mirroring `deepseek-official`: pi-ai's catalog owns the bare `zai` route for its own adapter family). A request selects it with `provider: zai-official`. The `model` field is passed through as the wire `model` string. Omitting `models` advertises the most common GLM models with their appropriate context windows; an explicit list replaces those defaults. Catalog entries are exposed through `ctx.llm.listModels('zai-official')` for clients, but remain advisory: unlisted model ids still pass through unchanged.

## Usage Examples

### Basic Chat Completion

```typescript
const stream = await ctx.llm.stream({
  provider: 'zai-official',
  model: 'glm-5.3',
  messages: [
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: 'Explain quantum computing in simple terms.' }
  ],
  maxTokens: 4096,
})

for await (const chunk of stream) {
  if (chunk.type === 'text-delta') {
    process.stdout.write(chunk.text)
  }
}
```

### Using Reasoning Mode

```typescript
const stream = await ctx.llm.stream({
  provider: 'zai-official',
  model: 'glm-5.3',
  messages: [
    { role: 'user', content: 'Solve this step by step: 2x + 5 = 13' }
  ],
  // Reasoning is controlled by the model selection:
  // - glm-5.3[1m] for full 1M reasoning mode
  // - glm-5.3 for standard thinking mode
  // Models support reasoning_content in responses
})

// The adapter will emit reasoning-delta chunks when the model thinks
for await (const chunk of stream) {
  if (chunk.type === 'reasoning-delta') {
    console.log('[Thinking]', chunk.text)
  } else if (chunk.type === 'text-delta') {
    process.stdout.write(chunk.text)
  }
}
```

### Multimodal Requests (Vision Models)

```typescript
const stream = await ctx.llm.stream({
  provider: 'zai-official',
  model: 'glm-4.6v', // or glm-4.5v
  messages: [
    {
      role: 'user',
      content: [
        { type: 'text', text: 'Describe this image.' },
        { type: 'image', image: 'data:image/jpeg;base64,...' }
      ]
    }
  ])
})
```

### Custom Retry Policy

```yaml
- id: llm-zai
  name: '@deepseek-ai/dsh-llm-zai'
  config:
    apiKeyEnv: ZAI_API_KEY
    retryPolicy:
      mode: always
      maxAttempts: 5
      backoff:
        initialDelayMs: 1000
        maxDelayMs: 30000
        jitterRatio: 0.2
```

## Z.ai Models

### Model Catalog

The adapter includes the following models by default (exposed via `ctx.llm.listModels('zai-official')`):

| Model ID | Name | Context | Features |
|----------|------|---------|----------|
| `glm-5.3` | GLM-5.3 | 1M | Latest with thinking/reasoning |
| `glm-5.3[1m]` | GLM-5.3 (1M reasoning) | 1M | Full reasoning mode enabled |
| `glm-5.2` | GLM-5.2 | 1M | High-performance, thinking support |
| `glm-5.1` | GLM-5.1 | 200K | Advanced reasoning |
| `glm-5` | GLM-5 | 200K | Standard model |
| `glm-5-turbo` | GLM-5-Turbo | 200K | Faster variant |
| `glm-4.7` | GLM-4.7 | 200K | With thinking support |
| `glm-4.7-flash` | GLM-4.7-Flash | 200K | Fast variant |
| `glm-4.7-flashx` | GLM-4.7-FlashX | 200K | Ultra-fast variant |
| `glm-4.6` | GLM-4.6 | 205K | With thinking support |
| `glm-4.6v` | GLM-4.6v | 128K | **Multimodal** (vision + text) |
| `glm-4.5` | GLM-4.5 | 131K | With thinking support |
| `glm-4.5-air` | GLM-4.5-Air | 131K | Lightweight variant |
| `glm-4.5v` | GLM-4.5v | 64K | **Multimodal** (vision + text) |

### Model Selection Guidelines

- **For maximum context and reasoning**: Use `glm-5.3` or `glm-5.3[1m]` (1M tokens)
- **For speed**: Use `glm-5-turbo`, `glm-4.7-flash`, or `glm-4.7-flashx`
- **For vision/multimodal**: Use `glm-4.6v` or `glm-4.5v`
- **For lightweight needs**: Use `glm-4.5-air`

### Fetching Available Models

For the complete and updated list with parameters, use the official endpoint:

```bash
curl https://api.z.ai/api/paas/v4/models \
  -H "Authorization: Bearer $ZAI_API_KEY"
```

## Thinking/Reasoning Mode

Z.ai models support a thinking/reasoning mode similar to DeepSeek-R1 or OpenAI o1/o3. When enabled, reasoning tokens are provided in a separate `reasoning_content` field, isolated from the final `content` response.

### How to Enable Reasoning

Reasoning mode is controlled through model selection:

- `glm-5.3` — Standard thinking mode (reasoning in `reasoning_content`)
- `glm-5.3[1m]` — Full 1M reasoning context mode
- Other GLM-4.5+ models support thinking via `reasoning_content`

### Response Structure

Example response structure:
```json
{
  "choices": [{
    "message": {
      "role": "assistant",
      "content": "Here's the final answer...",
      "reasoning_content": "Let me think through this step by step..."
    }
  }]
}
```

### Stream Chunk Protocol

The adapter translates `reasoning_content` into the harness's `StreamChunk` protocol:

- `type: 'block-start', blockType: 'reasoning'` — First reasoning token
- `type: 'reasoning-delta', text: '...'` — Reasoning content chunks
- `type: 'block-end', block: { type: 'reasoning', text: '...' }` — Complete reasoning block

Reasoning tokens are accounted separately in usage reports as `reasoningTokens`.

## Cache Support

Z.ai supports prompt caching for repeated context. When the API reports cached tokens, the adapter exposes them through the usage metadata:

```typescript
for await (const chunk of stream) {
  if (chunk.type === 'usage') {
    console.log('Input:', chunk.usage.inputTokens)
    console.log('Output:', chunk.usage.outputTokens)
    console.log('Cache reads:', chunk.usage.cacheReadTokens ?? 0)
    console.log('Reasoning tokens:', chunk.usage.reasoningTokens ?? 0)
  }
}
```

The `cacheReadTokens` value is reported when the provider includes cache hit information. This allows tracking cost savings from cached prefixes.

## Wire-format notes

- Uses OpenAI-compatible `/chat/completions` endpoint at `https://api.z.ai/api/paas/v4/chat/completions`
- Streaming only (translates SSE events via `eventsource-parser`)
- The `reasoning_content` field is separate from `content` and maps to reasoning chunks
- Cache accounting: `cacheReadTokens` is reported when available in usage metadata
- Reasoning tokens are separately accounted as `reasoningTokens` in usage reports

## Errors

Non-2xx responses throw `LlmError` with stable codes: `AUTH` (401/403), `RATE_LIMIT` (429), `CONTEXT_WINDOW_EXCEEDED` (400), `INVALID_REQUEST` (other 400s), `SERVER` (5xx), `HTTP_<status>` otherwise. An exhausted-account refusal maps to the provider-neutral `QUOTA` code — the quota-pause guard parks the turn's input on it and the web conversation offers its continuation control.

## Model Experience

### Z.ai request

#### What the model sees

The selected GLM model receives the harness system prompt, message history, tool schemas, stop sequences, and call config without adapter-authored prompt prose. On a prior assistant turn with tool calls, its reasoning content is passed back as the official passback rule requires; reasoning from tool-call-free turns is dropped.

#### Token effect

Provider tokenization governs exact input. Conditional reasoning passback increases tool-round-trip context, while dropping other reasoning avoids paying those tokens again; cache-read usage is reported when the provider includes it (`prompt_cache_hit_tokens` or `prompt_tokens_details.cached_tokens`).

#### KV Cache effect

An unchanged assembled prefix is eligible for Z.ai cache reuse, which this adapter reports in usage. A model-route change or any upstream prompt, schema, prefix, or history change may prevent reuse from the first changed token; reasoning passback appends during tool round trips.

### Z.ai response

#### What the model sees

Reasoning (`reasoning_content`), text, and raw-string tool arguments are translated into harness chunks for the loop to log and assemble.

#### Token effect

Generated tokens follow the request's logged reasoning effort and `maxTokens`; only loop-retained blocks affect later input.

#### KV Cache effect

Loop-retained response blocks append to the next request and preserve its earlier reusable prefix; dropped blocks have no later cache effect. Changing the provider or model selects a different cache domain.

## Known Limitations and Deferred Work

- **A settings `models` list replaces the composition list wholesale** — per-entry catalog merging is deferred
- **`tool_choice` is not mapped** — not part of the core vocabulary
- **Requests use raw `fetch`, not `@cordisjs/plugin-http`** — no shared proxy configuration
