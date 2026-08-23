/**
 * Real-composition guard: LlmRuntime, settings-file, credentials-local, and
 * llm-zai boot from a test-only cordis.yml through the actual Loader +
 * Include path, and an external edit of settings.yaml hot-publishes through
 * its provider so the very next request carries the fresh base URL.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import LocalCredentialProvider from '@deepseek-ai/dsh-credentials-local'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import FileSettingsProvider from '@deepseek-ai/dsh-settings-file'
import * as LlmZai from '../src/index.ts'
import { assemble } from './assemble.ts'
import { closeMockServers, mockServer, textEvents } from './mock-server.ts'

const NS = settingsNamespace('llm-zai')

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
  await closeMockServers()
  vi.unstubAllEnvs()
})

async function loadComposition(baseURL: string): Promise<{ ctx: Context; settingsPath: string }> {
  root = await mkdtemp(join(tmpdir(), 'dsh-llm-zai-composition-'))
  vi.stubEnv('DSH_HOME', root)
  const settingsPath = join(root, 'settings.yaml')
  const credentialsPath = join(root, '.credentials.yaml')
  await writeFile(settingsPath, '# personal settings\n')
  await writeFile(credentialsPath, 'ZAI_API_KEY: boot-key\n', { mode: 0o600 })

  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    '- id: llm',
    "  name: 'test-llm-service'",
    '- id: settings',
    "  name: '@deepseek-ai/dsh-settings-file'",
    '  config:',
    `    path: ${JSON.stringify(settingsPath)}`,
    '    debounceMs: 10',
    '- id: credentials',
    "  name: '@deepseek-ai/dsh-credentials-local'",
    '  config:',
    `    path: ${JSON.stringify(credentialsPath)}`,
    '    debounceMs: 10',
    '- id: llm-zai',
    "  name: '@deepseek-ai/dsh-llm-zai'",
    '  config:',
    `    baseURL: ${JSON.stringify(baseURL)}`,
    '',
  ].join('\n'))

  const ctx = new Context()
  context = ctx
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['test-llm-service', LlmRuntime],
    ['@deepseek-ai/dsh-settings-file', FileSettingsProvider],
    ['@deepseek-ai/dsh-credentials-local', LocalCredentialProvider],
    ['@deepseek-ai/dsh-llm-zai', LlmZai],
  ])
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await ctx.loader.await()
  return { ctx, settingsPath }
}

describe('llm-zai real dynamic composition', () => {
  it('boots from cordis.yml and routes the next request after an external settings edit', async () => {
    vi.stubEnv('ZAI_API_KEY', '')
    const serverA = await mockServer([{ kind: 'sse', events: textEvents }])
    const serverB = await mockServer([{ kind: 'sse', events: textEvents }])
    const { ctx, settingsPath } = await loadComposition(serverA.url)

    expect(ctx.get('settings')!.describe().map(entry => entry.ns)).toEqual([NS])
    await assemble(ctx, { model: 'glm-5.3', messages: [] })
    expect(serverA.headers[0]?.authorization).toBe('Bearer boot-key')

    // An external edit, exactly as a user or the web UI would leave it on disk.
    await writeFile(settingsPath, `llm-zai:\n  baseURL: ${serverB.url}\n`)
    await vi.waitFor(() => {
      expect((ctx.get('settings')!.get(NS) as { baseURL?: string }).baseURL).toBe(serverB.url)
    }, { timeout: 5000 })

    await assemble(ctx, { model: 'glm-5.3', messages: [] })
    expect(serverA.requests).toHaveLength(1)
    expect(serverB.headers[0]?.authorization).toBe('Bearer boot-key')
  })
})
