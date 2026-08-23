# Z.ai (GLM) 提供方配置指南

[English](llm-zai-setup.md) | 中文

本指南说明如何在 DeepSeek Harness 中配置 Z.ai (GLM) LLM 提供方。

## 前置条件

在 [https://open.bigmodel.cn/](https://open.bigmodel.cn/) 获取 API key。

## 配置

在 `cordis.yml` 中加入：

```yaml
- id: llm-zai
  name: '@deepseek-ai/dsh-llm-zai'
  config:
    apiKeyEnv: ZAI_API_KEY          # API key 的环境变量名
    baseURL: https://api.z.ai/api/paas/v4  # 可选；默认为 Z.ai 公共 API
    thinking: enabled               # 可选；为支持的模型启用思考模式
    maxTokens: 256000               # 可选；每次请求输出上限
    defaultContextWindow: 1000000   # 可选；回退上下文窗口
    models:                         # 可选；可用模型列表
      - id: glm-5.3
        name: GLM-5.3
        contextWindow: 1000000
```

## 环境变量

把 API key 写入 `.env`：

```bash
ZAI_API_KEY=your_api_key_here
```

或在 shell 中导出：

```bash
export ZAI_API_KEY=your_api_key_here
```

## 可用模型

Z.ai 提供以下 GLM 模型：

| 模型 ID | 上下文窗口 | 备注 |
|---------|-----------|------|
| glm-5.3 | 1,000,000 | 支持思考模式（加 `[1m]` 后缀进入全量推理） |
| glm-5.2 | 1,000,000 | 最新 GLM-5 系列 |
| glm-5.1 | 200,000 | GLM-5 系列 |
| glm-5 / glm-5-turbo | 200,000 | 标准 GLM-5 |
| glm-4.7 / glm-4.7-flash | 200,000 | Flash 变体 |
| glm-4.6 | 205,000 | GLM-4 系列 |
| glm-4.6v | 128,000 | 多模态 |
| glm-4.5 / glm-4.5-air | 131,000 | GLM-4 系列 |

完整且最新的参数列表请使用官方端点：

```bash
curl https://api.z.ai/api/paas/v4/models
```

## 用量

配置完成后，在 agent 中使用该提供方（路由为 `zai-official`，与 pi-ai 目录的 `zai` 区分）：

```yaml
- id: my-agent
  name: '@deepseek-ai/dsh-acp-demo'
  config:
    provider: zai-official
    model: glm-5.3
    # ... 其他配置
```

## 思考／推理模式

Z.ai 模型支持类似 DeepSeek-R1 的思考模式。启用时，推理 token 在独立的 `reasoning_content` 字段中提供，与最终 `content` 回复隔离。

为 GLM-5.3 启用全量推理模式时，在模型 ID 中使用 `[1m]` 后缀：`glm-5.3[1m]`。

账户用量上限耗尽时（`429` 错误码 `1308`，如 "Usage limit reached for 5 hour"），被拒轮的输入会被 quota-pause guard 暂停；上限重置后在会话错误行点击「继续」即可恢复。

## 另见

- [`@deepseek-ai/dsh-llm-zai` README](../packages/llm/llm-zai/README.zh.md)
- [Z.ai API 文档](https://open.bigmodel.cn/dev/api)
