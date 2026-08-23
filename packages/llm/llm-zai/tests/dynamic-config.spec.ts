/**
 * Request-level dynamic configuration: settings and credentials resolve
 * per request through the real seams (file providers, no restart), the
 * launch environment supplies ZAI_BASE_URL as the entry fallback, and the
 * settings layer replaces the model catalog live.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { LocalCredentialProvider } from '@deepseek-ai/dsh-credentials-local'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { FileSettingsProvider } from '@deepseek-ai/dsh-settings-file'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import * as LlmZai from '../src/index.ts'
import { resolveAdapterOptions } from '../src/index.ts'
import { assemble } from './assemble.ts'
import { closeMockServers, mockServer, textEvents } from './mock-server.ts'

const NS = settingsNamespace('llm-zai')
const KEY_REF = credentialRef('ZAI_API_KEY')

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!()
  await closeMockServers()
  vi.unstubAllEnvs()
})

async function home(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-llm-zai-dynamic-'))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  return dir
}

/**
 * Real dynamic composition: llm + settings-file + credentials-local + llm-zai
 * over one temp harness home. `watch: false` keeps every change flowing
 * through the in-process write path, which is deterministic.
 */
async function boot(dir: string, config: object): Promise<Context> {
  vi.stubEnv('DSH_HOME', dir)
  const ctx = new Context()
  cleanups.push(async () => { await ctx.fiber.dispose() })
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(FileSettingsProvider, { path: join(dir, 'settings.yaml'), watch: false })
  await ctx.plugin(LocalCredentialProvider, { path: join(dir, '.credentials.yaml'), watch: false })
  await ctx.plugin(LlmZai, config)
  return ctx
}

function prompt(ctx: Context) {
  return assemble(ctx, { model: 'glm-5.3', messages: [] })
}

describe('request-level dynamic configuration', () => {
  it('routes the next request with the freshly resolved base URL and credential', async () => {
    vi.stubEnv('ZAI_API_KEY', '')
    const dir = await home()
    const serverA = await mockServer([{ kind: 'sse', events: textEvents }])
    const serverB = await mockServer([{ kind: 'sse', events: textEvents }])
    const ctx = await boot(dir, { baseURL: serverA.url })
    await ctx.credentials.set(KEY_REF, 'first-key')

    await prompt(ctx)
    expect(serverA.headers[0]?.authorization).toBe('Bearer first-key')

    await ctx.settings.update(NS, { baseURL: serverB.url })
    await ctx.credentials.set(KEY_REF, 'second-key')

    await prompt(ctx)
    // No restart, no re-registration: the next request resolved both facts.
    expect(serverA.requests).toHaveLength(1)
    expect(serverB.headers[0]?.authorization).toBe('Bearer second-key')
  })

  it('starts keyless and reports MISSING_CREDENTIAL without leaving a user id behind', async () => {
    vi.stubEnv('ZAI_API_KEY', '')
    const dir = await home()
    const server = await mockServer([{ kind: 'sse', events: textEvents }])
    const ctx = await boot(dir, { baseURL: server.url })

    const keyless = await prompt(ctx)
    expect(keyless.finish).toMatchObject({ kind: 'error', failure: { code: 'MISSING_CREDENTIAL' } })
    expect(server.requests).toHaveLength(0)
  })

  it('replaces the model catalog live through the settings layer', async () => {
    const dir = await home()
    const ctx = await boot(dir, { baseURL: 'http://127.0.0.1:1' })

    const defaultIds = (await ctx.llm.listModels('zai-official')).map(model => model.id)
    expect(defaultIds).toContain('glm-5.3')
    await ctx.settings.update(NS, { models: [{ id: 'settings-model', name: 'From Settings' }] })
    await expect(ctx.llm.listModels('zai-official')).resolves.toEqual([
      { provider: 'zai-official', id: 'settings-model', name: 'From Settings', inputModalities: ['text'] },
    ])
  })

  it('resolves ZAI_BASE_URL from the launch environment when config omits baseURL', () => {
    vi.stubEnv('ZAI_BASE_URL', 'https://env.example.com/v4')
    const environment = launchEnvironmentOf(new Context())
    expect(resolveAdapterOptions({}, environment).baseURL).toBe('https://env.example.com/v4')
    // Explicit config wins over the environment layer.
    expect(resolveAdapterOptions({ baseURL: 'https://config.example.com' }, environment).baseURL)
      .toBe('https://config.example.com')
  })
})
