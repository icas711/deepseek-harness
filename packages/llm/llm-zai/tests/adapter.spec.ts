/**
 * Adapter behavior against a mock Z.ai endpoint: request shape, streaming
 * assembly, and the stable error-code mapping. Configuration resolution is
 * covered here only as the adapter's frozen input.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import LlmRuntime, { createUserMessage, QUOTA_EXCEEDED_CODE, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { AnonymousUserId } from '@deepseek-ai/dsh-anonymous-user-id'
import * as LlmZai from '../src/index.ts'
import { ZaiAdapter, resolveAdapterOptions } from '../src/index.ts'
import { assemble } from './assemble.ts'
import { closeMockServers, mockServer, textEvents } from './mock-server.ts'

const TEST_USER_ID = '00000000-0000-4000-8000-000000000001' as AnonymousUserId
let testHome: string

beforeEach(() => {
  testHome = mkdtempSync(join(tmpdir(), 'dsh-llm-zai-'))
  vi.stubEnv('DSH_HOME', testHome)
})

afterEach(async () => {
  await closeMockServers()
  vi.unstubAllEnvs()
  rmSync(testHome, { recursive: true, force: true })
})

async function harness(baseURL: string, config: object = {}) {
  vi.stubEnv('ZAI_API_KEY', 'test-key')
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(LlmZai, { baseURL, ...config })
  return ctx
}

function prompt(text = 'hi') {
  return [createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'plugin', plugin: 'test' } })]
}

describe('ZaiAdapter against a mock server', () => {
  it('streams a text generation end to end through the assembler', async () => {
    const server = await mockServer([{ kind: 'sse', events: textEvents }])
    const ctx = await harness(server.url)

    const result = await assemble(ctx, { model: 'glm-5.3', messages: prompt() })
    expect(result.message.content).toEqual([{ type: 'text', text: 'hello' }])
    expect(result.finish).toEqual({ kind: 'stop' })
    expect(result.usage).toEqual({ inputTokens: 3, outputTokens: 1 })

    expect(server.requests[0]).toMatchObject({
      model: 'glm-5.3',
      stream: true,
      stream_options: { include_usage: true },
      max_tokens: 256_000,
    })
  })

  it('passes the [1m] reasoning-mode suffix through as the wire model id', async () => {
    const server = await mockServer([{ kind: 'sse', events: textEvents }])
    const ctx = await harness(server.url)

    await assemble(ctx, { model: 'glm-5.3[1m]', messages: prompt() })
    expect(server.requests[0]).toMatchObject({ model: 'glm-5.3[1m]' })
  })

  it('maps an exhausted-account rejection to the provider-neutral QUOTA code', async () => {
    const server = await mockServer([{
      kind: 'http-error',
      status: 429,
      body: JSON.stringify({ error: { code: '1113', message: 'Insufficient balance in your account.' } }),
    }])
    const ctx = await harness(server.url)

    const result = await assemble(ctx, { model: 'glm-5.3', messages: prompt() })
    expect(result.finish).toMatchObject({ kind: 'error', failure: { code: QUOTA_EXCEEDED_CODE } })
  })

  it('maps an unauthorized key to AUTH and names the provider endpoint', async () => {
    const server = await mockServer([{
      kind: 'http-error',
      status: 401,
      body: JSON.stringify({ error: { code: '1002', message: 'Invalid api key' } }),
    }])
    const ctx = await harness(server.url)

    const result = await assemble(ctx, { model: 'glm-5.3', messages: prompt() })
    expect(result.finish).toMatchObject({ kind: 'error', failure: { code: 'AUTH' } })
  })

  it('maps a context-overflow rejection to the provider-neutral code', async () => {
    const server = await mockServer([{
      kind: 'http-error',
      status: 400,
      body: JSON.stringify({
        error: {
          message: 'This model maximum context length is 128000 tokens; your input exceeds that limit.',
          code: 'context_length_exceeded',
        },
      }),
    }])
    const ctx = await harness(server.url)

    const result = await assemble(ctx, { model: 'glm-5.3', messages: prompt() })
    expect(result.finish).toMatchObject({ kind: 'error', failure: { code: 'CONTEXT_WINDOW_EXCEEDED' } })
  })
})

describe('ZaiAdapter catalog resolution', () => {
  const options = resolveAdapterOptions({
    models: [
      { id: 'glm-5.3', name: 'GLM-5.3', contextWindow: 1_000_000 },
      { id: 'glm-4.7-flash', name: 'GLM-4.7-Flash', contextWindow: 200_000 },
    ],
  })

  function adapterWith(resolved: ReturnType<typeof resolveAdapterOptions>): ZaiAdapter {
    return new ZaiAdapter({
      options: () => resolved,
      resolveApiKey: () => Promise.resolve('test-key'),
      resolveUserId: () => TEST_USER_ID,
    })
  }

  it('lists configured models', async () => {
    const adapter = adapterWith(options)
    await expect(adapter.listModels('zai-official')).resolves.toEqual([
      { provider: 'zai-official', id: 'glm-5.3', name: 'GLM-5.3', inputModalities: ['text'] },
      { provider: 'zai-official', id: 'glm-4.7-flash', name: 'GLM-4.7-Flash', inputModalities: ['text'] },
    ])
  })

  it('resolves an exact catalog match with thinking efforts', async () => {
    const adapter = adapterWith(options)
    const info = await adapter.resolveModel('zai-official', 'glm-5.3')

    expect(info).toMatchObject({
      provider: 'zai-official',
      id: 'glm-5.3',
      name: 'GLM-5.3',
      context: { contextWindow: 1_000_000 },
      defaultMaxTokens: 256_000,
    })
    expect(info.reasoning?.efforts).toEqual([
      { id: ReasoningEffortId('off'), name: 'Off' },
      { id: ReasoningEffortId('high'), name: 'High' },
      { id: ReasoningEffortId('max'), name: 'Max' },
    ])
    expect(info.reasoning?.defaultEffort).toBe(ReasoningEffortId('high'))
  })

  it('resolves an unlisted model id with connection defaults', async () => {
    const adapter = adapterWith(options)
    const info = await adapter.resolveModel('zai-official', 'custom-finetune')

    expect(info).toMatchObject({
      provider: 'zai-official',
      id: 'custom-finetune',
      name: 'custom-finetune',
      context: { contextWindow: 1_000_000 },
      defaultMaxTokens: 256_000,
    })
  })

  it('uses the model entry maxTokens over the connection default', async () => {
    const adapter = adapterWith(resolveAdapterOptions({
      models: [{ id: 'glm-5.3', maxTokens: 128_000 }],
    }))
    await expect(adapter.resolveModel('zai-official', 'glm-5.3'))
      .resolves.toMatchObject({ defaultMaxTokens: 128_000 })
  })

  it('offers only the off effort when the deployment disables thinking', async () => {
    const adapter = adapterWith(resolveAdapterOptions({ thinking: 'disabled' }))
    const info = await adapter.resolveModel('zai-official', 'glm-5.3')

    expect(info.reasoning).toEqual({
      efforts: [{ id: ReasoningEffortId('off'), name: 'Off' }],
      defaultEffort: ReasoningEffortId('off'),
    })
  })
})

describe('resolveAdapterOptions', () => {
  it('resolves the documented defaults', () => {
    const resolved = resolveAdapterOptions({})

    expect(resolved.baseURL).toBe('https://api.z.ai/api/paas/v4')
    expect(resolved.maxTokens).toBe(256_000)
    expect(resolved.defaultContextWindow).toBe(1_000_000)
    expect(resolved.streamIdleTimeoutMs).toBe(300_000)
    expect(resolved.thinkingEnabled).toBe(true)
    expect(resolved.models.map(model => model.id)).toContain('glm-5.3')
  })

  it('resolves custom values', () => {
    const resolved = resolveAdapterOptions({
      baseURL: 'https://custom.example.com',
      maxTokens: 128_000,
      defaultContextWindow: 500_000,
      streamIdleTimeoutMs: 120_000,
      thinking: 'disabled',
      models: [{ id: 'custom-model', contextWindow: 64_000 }],
    })

    expect(resolved).toMatchObject({
      baseURL: 'https://custom.example.com',
      maxTokens: 128_000,
      defaultContextWindow: 500_000,
      streamIdleTimeoutMs: 120_000,
      thinkingEnabled: false,
      defaults: { thinking: 'disabled' },
    })
    expect(resolved.models).toEqual([{ id: 'custom-model', contextWindow: 64_000 }])
  })

  it('falls back to ZAI_BASE_URL from the launch environment', () => {
    vi.stubEnv('ZAI_BASE_URL', 'https://env.example.com/v4')
    const environment = launchEnvironmentOf(new Context())
    expect(resolveAdapterOptions({}, environment).baseURL).toBe('https://env.example.com/v4')
  })
})
