# @deepseek-ai/dsh-web-search-zai

[English](README.md) | 中文

由 [Z.ai](https://z.ai) 支撑的 `WebSearchProvider`，面向 harness 的 [web 能力 seam](../web/README.md)（`ctx.web`）。它调用独立的 Web Search API（`POST /web_search`），并把结构化结果映射为 seam 的规范化 `WebSearchResult`。

这是一个**实现**包：它向 `ctx.web` 注册提供方，不持有密钥，也不注册面向模型的工具。与 `@deepseek-ai/dsh-web-search-perplexity` 一样，它是函数/命名空间插件（`inject: ['web']`）。wire 格式是提供方私有细节——这不是一次模型请求，也**不**依赖 `ctx.llm`。

## 配置

| 键 | 默认值 | 含义 |
|---|---|---|
| `apiKey` | 未设置 | Z.ai API 密钥字面值。非空字面值优先；优先使用 `apiKeyEnv`，避免密钥进入配置文件。 |
| `apiKeyEnv` | `ZAI_API_KEY` | 每次搜索经 `ctx.credentials` 解析的凭据引用；该 seam 缺席时取启动环境。 |
| `baseURL` | `https://api.z.ai/api/paas/v4` | 端点基址；追加 `/web_search`。`$ZAI_SEARCH_BASE_URL` 供同一字段；刻意不复用 `$ZAI_BASE_URL`，因为部署会把它指向 coding 套餐端点，而该端点不提供 `/web_search`。 |
| `searchEngine` | `search-prime` | 以 `search_engine` 发送的搜索引擎档位。API 必填（为空时 HTTP 400 错误码 1214）。 |
| `count` | `10` | 搜索未携带 `maxResults` 时请求的结果条数；范围 1–50。 |

```yaml
- id: web-search-zai
  name: '@deepseek-ai/dsh-web-search-zai'
  config:
    apiKeyEnv: ZAI_API_KEY
```

## 映射

`content` 永不设置：该 API 是搜索引擎而非聊天模型，不存在答案文本。`sources[]` 映射 `search_result[]`（`url` ← `link`、`title` ← `title`、`snippet` ← `content`、`publishedAt` ← `publish_date`）；空白字段省略。`maxResults` 在请求层作为 `count` 生效（钳制到 API 的 1–50 范围），回程仍由 seam 强制执行。提供方失败以 `WebError` `WEB_PROVIDER_ERROR` 暴露；中止的请求以 `WEB_ABORTED` 暴露。HTTP 重定向在接触 `Location` 目标之前被拒绝，并以 `WEB_PROVIDER_ERROR` 暴露。

## 模型体验

### 搜索请求

#### 模型看到什么

不直接看到任何内容：对话模型仅通过 `dsh-tool-web` 提交 `<query>`，查询原文发往 Web Search API。不存在提供方模型请求。

#### Token 效应

不产生提供方 LLM token；该 API 按搜索请求计费。结果来源仅通过工具结果进入对话。

#### KV 缓存效应

不存在提供方模型请求，也就没有提供方缓存；搜索本身不影响对话请求缓存。

### 间接的对话工具结果

#### 模型看到什么

通过 [`dsh-tool-web`](../tool-web/README.md)，对话模型看到结构化来源。本提供方的失败文案为 `Z.ai search aborted`、`Z.ai search request failed: <error>` 与 `Z.ai returned an unprocessable response body: <error>`；HTTP 失败保留提供方消息。错误包装由消费方负责。

#### Token 效应

注册不产生直接对话 token。来源 token 依赖数据量，受 API 的 50 条上限约束；保留的结果或错误会随请求重发直至压缩。

#### KV 缓存效应

只追加；新出现的内容位于可复用请求前缀之后，不会使既有 KV 缓存条目失效。

## 已知限制与遗留工作

- **没有生成的答案**——该 API 只返回结构化结果，`content` 保持未设置，工具渲染来源时不带摘要。
- **`count` 受 API 限制在 1–50**——超过 50 的 `maxResults` 无法在请求层满足；seam 最多只能看到 50 条来源。
- **仅暴露 `searchEngine`/`count`**——API 的域名过滤、时间范围过滤与摘要字数控制等待提供方中立的 Service Definition 字段（[seam Agent Note](../../../.agents/notes/implemented/architecture/2026-06-24-web-capability-seam.md)）。
- **Web Search API 不包含在 coding 套餐订阅内**——余额仅覆盖 `api.z.ai/api/coding/paas/v4` 聊天的密钥会得到 HTTP 429 错误码 1113（`Insufficient balance or no resource package`）；需要有余额的资源包。
- **中止判定基于错误形态**——只有名为 `AbortError` 的 `DOMException` 映射为 `WEB_ABORTED`；携带自定义 reason 的中止（如 `dsh-timeout` 的 `TimeoutReason`）以 `WEB_PROVIDER_ERROR` 暴露。
