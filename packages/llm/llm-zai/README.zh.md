# @deepseek-ai/dsh-llm-zai

[English](README.md) | 中文

面向 harness LLM seam 的 Z.ai (GLM) chat-completions 适配器：直接 `fetch` + SSE（由 `eventsource-parser` 分帧），把 Z.ai 协议格式翻译为 `StreamChunk` 协议。

Z.ai 提供 GLM 系列模型，包括 GLM-5.3（1M 上下文、支持思考）、GLM-5.2、GLM-4.7 等。本适配器实现 `https://api.z.ai/api/paas/v4/` 的 OpenAI 兼容 API 格式。

本包拥有 `zai-official` 提供方路由——与 pi-ai 目录名 `zai` 刻意区分（镜像 `deepseek-official` 的先例），使同一组合可以并列挂载两条 Z.ai 路径；为 `zai-official` 本身注册另一个适配器仍会抛出 `LlmError('DUPLICATE_ADAPTER')`。

## 快速开始

1. 在 [https://open.bigmodel.cn/](https://open.bigmodel.cn/) 注册并获取 API key。
2. 设置环境变量：`ZAI_API_KEY=your_api_key_here`（或写入 `.env`）。
3. 组合中挂载本插件（`dsh-base` bundle 已内置该行）。
4. 请求使用 `provider: 'zai-official'`，例如：

```typescript
const response = await ctx.llm.stream({
  provider: 'zai-official',
  model: 'glm-5.3',
  messages: [{ role: 'user', content: '你好！' }],
})
```

## 配置

```yaml
- id: llm-zai
  name: '@deepseek-ai/dsh-llm-zai'
  config:
    apiKeyEnv: ZAI_API_KEY          # 默认；每次请求经 ctx.credentials 解析，其次环境变量
    baseURL: https://api.z.ai/api/paas/v4 # 可选；省略时依次取 $ZAI_BASE_URL 与公共 API
    thinking: enabled               # 可选；省略时不禁用思考
    reasoningEffort: high           # 可选；off | high | max
    maxTokens: 256000               # 可选；每次请求输出上限，此为默认
    streamIdleTimeoutMs: 300000     # 可选；流空闲超时，此为默认
    retryPolicy:                    # 可选；省略使用有界 normal 默认
      mode: always
    defaultContextWindow: 1000000   # 可选；目录条目未指定容量时的回退，此为默认
    models:                         # 可选；省略通告常见 GLM 模型
      - id: glm-5.3
        name: GLM-5.3
```

插件注册 `zai-official` 路由；`model` 原样作为协议 `model` 字符串传递，目录条目仅为建议：未列出的模型 id 仍原样放行。省略 `models` 时通告 GLM-5.3（含 `[1m]` 全量推理变体）、GLM-5.2、GLM-4.7 等常见模型及各自上下文窗口；显式列表整体替换默认值。

## 思考模式

- `glm-5.3`——标准思考模式（推理在 `reasoning_content`）
- `glm-5.3[1m]`——全量 1M 推理上下文模式
- 其他 GLM-4.5+ 模型通过 `reasoning_content` 支持思考

推理内容在带工具调用的助手轮按官方回传规则随请求传回；工具调用之外的轮次则丢弃。

## 缓存与用量

Z.ai 支持重复上下文的提示缓存。协议上报缓存命中时（`prompt_cache_hit_tokens` 或 `prompt_tokens_details.cached_tokens`），适配器通过用量元数据暴露 `cacheReadTokens`；`prompt_tokens` 包含缓存命中，映射时会从 `inputTokens` 中扣除以保持不相交计数。推理 token 单独计为 `reasoningTokens`。

## 错误

非 2xx 响应抛出带稳定代码的 `LlmError`：`AUTH`（401/403）、`RATE_LIMIT`（429）、`CONTEXT_WINDOW_EXCEEDED`（400）、`INVALID_REQUEST`（其余 400）、`SERVER`（5xx）、其他为 `HTTP_<status>`。账户用量上限耗尽的拒绝映射为提供方中立代码 `QUOTA`——quota-pause guard 会据此暂停该轮输入，Web 会话提供继续控件。

## 模型体验

### Z.ai 请求

#### 模型看到的内容

所选 GLM 模型收到 harness 系统提示、消息历史、工具 schema、停止序列与调用配置，适配器不添加任何提示性文字。上一个带工具调用的助手轮按官方回传规则传回其推理内容；无工具调用轮次的推理被丢弃。

#### Token 影响

精确输入由提供方分词决定。条件性推理回传增加工具往返上下文，丢弃其余推理避免重复支付这些 token；提供方包含缓存命中时上报 cache-read 用量。

#### KV Cache 影响

未变化的组装前缀有资格复用 Z.ai 缓存，本适配器在用量中上报。模型路由变更或任何上游提示、schema、前缀、历史变更都可能从第一个变化 token 起阻止复用；推理回传在工具往返期间追加。

### Z.ai 响应

#### 模型看到的内容

推理（`reasoning_content`）、文本与原始字符串工具参数被翻译为 harness chunk，由循环记录并组装。

#### Token 影响

生成 token 遵循请求记录的推理档位与 `maxTokens`；仅循环保留的块影响后续输入。

#### KV Cache 影响

循环保留的响应块追加到下一次请求并保持其更早的可复用前缀；被丢弃的块没有后续缓存影响。更换提供方或模型会选择不同的缓存域。

## 已知限制与后续工作

- **设置中的 `models` 列表整体替换组合列表**——逐条目目录合并暂缓
- **`tool_choice` 未映射**——不属于核心词汇
- **请求使用原生 `fetch` 而非 `@cordisjs/plugin-http`**——无共享代理配置

更多细节见 [English README](README.md) 与 [Z.ai (GLM) Provider Setup](../../../docs/llm-zai-setup.zh.md)。
