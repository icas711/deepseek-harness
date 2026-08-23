import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { createUserMessage, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { Message } from '@deepseek-ai/dsh-llm'
import { LocalCredentialProvider } from '@deepseek-ai/dsh-credentials-local'
import * as LlmZai from '../src/index.ts'
import { assemble, type AssembledResult } from './assemble.ts'

/**
 * Real-API e2e for the Z.ai (GLM) adapter: thinking modes and the effort
 * vocabulary on GLM. Key-gated — skips entirely without $ZAI_API_KEY (see
 * vitest.e2e.config.ts).
 */

const MODEL = 'glm-4.7-flash'
const contexts: Context[] = []
let identityHome: string

beforeEach(async () => {
  identityHome = await mkdtemp(join(tmpdir(), 'dsh-zai-e2e-user-id-'))
  vi.stubEnv('DSH_HOME', identityHome)
})

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  vi.unstubAllEnvs()
  await rm(identityHome, { recursive: true, force: true })
})

function ask(text: string): Message[] {
  return [createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'plugin', plugin: 'test' },
  })]
}

function textOf(result: AssembledResult): string {
  return result.message.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('')
}

describe.skipIf(!process.env.ZAI_API_KEY)('llm-zai e2e (real API)', () => {
  it('serves a real request with the key held only by a credentials-local document', async () => {
    const key = process.env.ZAI_API_KEY
    if (key === undefined) throw new Error('e2e ran without ZAI_API_KEY')
    const dir = await mkdtemp(join(tmpdir(), 'dsh-zai-e2e-credentials-'))
    try {
      // JSON.stringify quotes the value: YAML is a JSON superset, so a real
      // key survives whatever characters it happens to carry.
      await writeFile(join(dir, '.credentials.yaml'), `ZAI_API_KEY: ${JSON.stringify(key)}\n`, { mode: 0o600 })
      // Scrub the ambient variable so only the credential seam can supply the
      // key: this request proves the per-request resolution path end to end.
      vi.stubEnv('ZAI_API_KEY', '')
      const ctx = new Context()
      contexts.push(ctx)
      await ctx.plugin(LlmRuntime)
      await ctx.plugin(LocalCredentialProvider, { path: join(dir, '.credentials.yaml'), watch: false })
      await ctx.plugin(LlmZai, {})

      const result = await assemble(ctx, {
        model: MODEL,
        messages: ask('Reply with exactly the word: pong'),
        maxTokens: 50,
      })
      expect(result.finish.kind).toBe('stop')
      expect(textOf(result).toLowerCase()).toContain('pong')
    } finally {
      vi.unstubAllEnvs()
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('answers without reasoning blocks when thinking is disabled', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(LlmZai, { thinking: 'disabled' })

    const result = await assemble(ctx, {
      model: MODEL,
      messages: ask('Reply with exactly the word: pong'),
      maxTokens: 50,
    })
    expect(result.finish.kind).toBe('stop')
    expect(result.message.content.some(block => block.type === 'reasoning')).toBe(false)
    expect(result.usage?.inputTokens).toBeGreaterThan(0)
    expect(result.usage?.outputTokens).toBeGreaterThan(0)
  })

  it('reasons and answers under the high effort', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(LlmZai, {})

    const result = await assemble(ctx, {
      model: MODEL,
      reasoningEffort: ReasoningEffortId('high'),
      messages: ask('Which is larger, 9.11 or 9.8? Answer with just the number.'),
      maxTokens: 2000,
    })
    expect(result.finish.kind).toBe('stop')
    expect(result.message.content.some(block => block.type === 'reasoning')).toBe(true)
    expect(textOf(result)).toContain('9.8')
  })
})
