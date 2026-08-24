# Agent Note: 基于 Z.ai 独立 Web Search API 的搜索提供方

Status: implemented

[English](2026-08-24-web-search-zai-provider.md) | 中文

## Problem

基础 bundle 的默认 `web_search` 路由是 `web-search-deepseek`，解析 `DEEPSEEK_API_KEY`。聊天走 Z.ai 适配器（`llm-zai`、`ZAI_API_KEY`）的部署没有有效的 DeepSeek 密钥，于是每一次面向模型的搜索都带着提供方的 "invalid api key" 回复以 `WEB_PROVIDER_ERROR` 失败。聊天与搜索读取不同的凭据域，而搜索没有读取聊天侧密钥的提供方。

Z.ai 提供两个不同的可搜索接口，二者之间的选择是一个真实决策：chat-completions API 接受 `web_search` 服务端工具（带检索的辅助模型请求，即 `web-search-deepseek` 在 DeepSeek 侧使用的形态）；独立的 Web Search API（`POST /web_search`）返回结构化结果，不生成答案。

## Decision

`@deepseek-ai/dsh-web-search-zai`（`packages/web/web-search-zai`）实现独立 Web Search API，而非 chat-completions 的 `web_search` 服务端工具。它以提供方 id `zai` 注册到 `ctx.web`，包形态仿照 `web-search-perplexity`（函数插件、`inject: ['web']`、提供方私有的 `fetch` 客户端、redirect-`error` 策略）。

选择独立 API，是因为它是对「仅搜索」的 seam 调用最诚实的映射：结构化 `search_result[]` 直接映射 `sources[]`（`url` ← `link`、`snippet` ← `content`、`publishedAt` ← `publish_date`），没有辅助模型请求，没有需要丢弃的生成 `content`，也没有逐次搜索的模型 token 开销。聊天侧服务端工具会把一次搜索路由为完整的模型请求——每次查询计费模型 token，并返回一个会诱导消费方依赖 seam `content` 字段的答案——那是聊天能力，不是搜索提供方。

凭据解析沿用 `llm-zai` 约定：`apiKeyEnv` 默认为 `ZAI_API_KEY` 凭据引用，每次搜索经 `ctx.credentials` 解析、以启动环境为回退，字面 `apiKey` 优先。端点默认 `https://api.z.ai/api/paas/v4`，环境覆盖走 `$ZAI_SEARCH_BASE_URL`；刻意不复用 `$ZAI_BASE_URL`，因为部署会把它指向 coding 套餐端点（`api.z.ai/api/coding/paas/v4`），该端点不提供 `/web_search`。

基础 bundle 挂载 `web-search-zai` 并选其为默认 `searchProvider`；`web-search-deepseek` 保持挂载，持有有效 DeepSeek 密钥的部署可以通过 web 配置、settings 层或 `$DSH_WEB_SEARCH_PROVIDER` 切换路由，无需改组合。该部署的聊天与默认搜索由此读取同一凭据域。

`search_engine` 为 API 必填（为空时 HTTP 400 错误码 1214），默认 `search-prime`；`count`（范围 1–50）由请求的 `maxResults` 推导并钳制，回程仍由 seam 强制执行上界。

## Alternatives considered

### 为什么不用 chat-completions 的 `web_search` 服务端工具？

它是 `web-search-deepseek` 使用的机制，返回生成的答案加来源。落选原因：每次搜索一次辅助模型请求花费模型 token，并为只需引用的 seam 调用增加生成答案的延迟；它把搜索路由耦合到聊天模型可用性与模型命名（该工具搭载于聊天模型请求，模型轮换会改变搜索行为）；且覆盖聊天的 coding 套餐订阅并不让该搜索工具免费——同一堵计费墙只是上移了一层。独立 API 返回的正是 seam 所规范化的内容。

### 为什么不直接修复 DeepSeek 密钥？

存入有效的 `DEEPSEEK_API_KEY` 能以零代码恢复既有路由。作为主修复方案落选，是因为部署的明确方向是聊天与搜索共享 Z.ai 凭据域；仅为搜索维持第二个付费账号是本包消除的运营成本。DeepSeek 路由保持挂载，正是为了让这个替代方案始终只差一次 settings 变更。

### 为什么不用 Exa 或 Perplexity？

两者都是既有 seam 提供方，但各自需要新的第三方账号与密钥。Z.ai 复用该部署已为聊天付费的凭据。

## Consequences

搜索可用性现在取决于 Z.ai 账户是否为 Web Search API 充值，而不仅是聊天：coding 套餐订阅不覆盖它——余额仅覆盖 coding 端点的密钥会得到 HTTP 429 错误码 1113（`Insufficient balance or no resource package`），需要有余额的资源包。这是跨两个分开计费的 API 共享一个凭据域的代价，记录在包 README 的限制中。

seam 获得了一个永不设置 `content` 的提供方，证明可选答案形态对纯搜索引擎保持诚实。超过 50 的 `maxResults` 无法在请求层满足（API 上界）；seam 最多看到 50 条来源。API 提供的域名过滤、时间范围与摘要字数控制保持未暴露，直到存在提供方中立的请求字段（[web capability seam Agent Note](../architecture/2026-06-24-web-capability-seam.md)）。

## Testing

`tests/zai.spec.ts` 覆盖响应映射、可用性、请求映射（引擎、钳制后的 count、中止信号）、错误分类体系（提供方消息提取、每个 body 解析分支的中止分类、点名凭据引用的缺钥失败），以及经真实 `WebRuntime` 的 HMR 安全注册与环境回退。`tests/redirect.spec.ts` 以真实 HTTP 证明每种重定向状态都在接触 `Location` 目标之前被拒绝。`tests/zai.e2e.ts` 是带钥门控的真实 API 冒烟测试，无 `$ZAI_API_KEY` 时自跳过。
