# Z.ai (GLM) Provider Setup

English | [中文](llm-zai-setup.zh.md)

This guide shows how to configure the Z.ai LLM provider in DeepSeek Harness.

## Prerequisites

Get your API key from [https://open.bigmodel.cn/](https://open.bigmodel.cn/).

## Configuration

Add the following to your `cordis.yml`:

```yaml
- id: llm-zai
  name: '@deepseek-ai/dsh-llm-zai'
  config:
    apiKeyEnv: ZAI_API_KEY          # Environment variable name for your API key
    baseURL: https://api.z.ai/api/paas/v4  # Optional; defaults to Z.ai public API
    thinking: enabled               # Optional; enables thinking mode for supported models
    maxTokens: 256000              # Optional; per-request output cap
    defaultContextWindow: 1000000   # Optional; fallback context window
    models:                         # Optional; list of available models
      - id: glm-5.3
        name: GLM-5.3
        contextWindow: 1000000
      - id: glm-5.2
        name: GLM-5.2
        contextWindow: 1000000
      - id: glm-4.7-flash
        name: GLM-4.7-Flash
        contextWindow: 200000
```

## Environment Variables

Set your API key in `.env`:

```bash
ZAI_API_KEY=your_api_key_here
```

Or export it in your shell:

```bash
export ZAI_API_KEY=your_api_key_here
```

## Available Models

The following GLM models are available on Z.ai:

| Model ID | Context Window | Notes |
|----------|----------------|-------|
| glm-5.3 | 1,000,000 | Supports thinking mode (add `[1m]` suffix for full reasoning) |
| glm-5.2 | 1,000,000 | Latest GLM-5 series |
| glm-5.1 | 200,000 | GLM-5 series |
| glm-5 / glm-5-turbo | 200,000 | Standard GLM-5 |
| glm-4.7 / glm-4.7-flash | 200,000 | Flash variant |
| glm-4.7-flashx | 200,000 | FlashX variant |
| glm-4.6 | 205,000 | GLM-4 series |
| glm-4.6v | 128,000 | Multimodal |
| glm-4.5 / glm-4.5-air | 131,000 | GLM-4 series |
| glm-4.5v | 64,000 | Multimodal |

For the complete and updated list with parameters, use the official endpoint:

```bash
curl https://api.z.ai/api/paas/v4/models
```

## Usage

Once configured, use the provider in your agent:

```yaml
- id: my-agent
  name: '@deepseek-ai/dsh-acp-demo'
  config:
    provider: zai-official
    model: glm-5.3
    # ... other config
```

## Thinking/Reasoning Mode

Z.ai models support a thinking/reasoning mode similar to DeepSeek-R1. When enabled, reasoning tokens are provided in a separate `reasoning_content` field, isolated from the final `content` response.

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

To enable full reasoning mode for GLM-5.3, use the `[1m]` suffix in the model ID: `glm-5.3[1m]`.

## See Also

- [`@deepseek-ai/dsh-llm-zai` README](../packages/llm/llm-zai/README.md)
- [Z.ai API Documentation](https://open.bigmodel.cn/dev/api)
