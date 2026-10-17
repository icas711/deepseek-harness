/** The `web-search-zai` settings section layered over the composition entry. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import type { Fiber } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import LocalCredentialProvider from '@deepseek-ai/dsh-credentials-local'
import { SettingsProvider } from '@deepseek-ai/dsh-settings'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import WebRuntime from '@deepseek-ai/dsh-web'
import * as zaiPlugin from '@deepseek-ai/dsh-web-search-zai'
import { WEB_SEARCH_ZAI_SETTINGS_NAMESPACE } from '@deepseek-ai/dsh-web-search-zai'
import type { Config as ZaiConfig } from '@deepseek-ai/dsh-web-search-zai'

/** The smallest real provider: one in-memory document, always writable. */
class MemorySettings extends SettingsProvider {
  doc: Record<string, unknown> = {}

  get writable(): boolean {
    return true
  }

  protected load(): Promise<Record<string, unknown>> {
    return Promise.resolve(structuredClone(this.doc))
  }

  protected persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.doc = { ...this.doc, [ns]: structuredClone(section) }
    return Promise.resolve()
  }
}

/** One search's observed request: the endpoint, the key header, the wire body. */
interface ObservedRequest {
  url: string
  authorization: string
  body: { search_engine: string; search_query: string; count: number }
}

/**
 * Run one search and return the request it produced. A fresh `Response` per
 * call because a body can only be read once, and the call history is cleared
 * because repeated `spyOn` returns the same spy.
 */
async function searchOnce(ctx: Context): Promise<ObservedRequest> {
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
    Promise.resolve(new Response(JSON.stringify({ search_result: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })))
  fetchSpy.mockClear()
  await ctx.web.search({ query: 'anything' })
  const call = fetchSpy.mock.calls.at(-1)
  if (call === undefined) throw new Error('the provider made no fetch call')
  const [url, init] = call as unknown as [string, RequestInit]
  return {
    url: String(url),
    authorization: (init.headers as Record<string, string>)['authorization'] ?? '',
    body: JSON.parse(init.body as string) as ObservedRequest['body'],
  }
}

/** Boot the web seam, an in-memory settings provider, and the plugin over `config`. */
async function boot(config: ZaiConfig): Promise<{ ctx: Context; settingsFiber: Fiber; pluginFiber: Fiber }> {
  const ctx = new Context()
  await ctx.plugin(WebRuntime, {})
  const settingsFiber = ctx.plugin(MemorySettings)
  await settingsFiber.await()
  const pluginFiber = ctx.plugin(zaiPlugin, config)
  await pluginFiber.await()
  return { ctx, settingsFiber, pluginFiber }
}

/** Run one body under a temporary set of process-env values, restoring them after. */
async function withEnv(values: Record<string, string | undefined>, body: () => Promise<void>): Promise<void> {
  const previous = Object.fromEntries(Object.keys(values).map(name => [name, process.env[name]]))
  for (const [name, value] of Object.entries(values)) {
    // Reflect keeps the dynamic key off `delete process.env[name]`, which the staged lint forbids.
    if (value === undefined) Reflect.deleteProperty(process.env, name)
    else process.env[name] = value
  }
  try {
    await body()
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) Reflect.deleteProperty(process.env, name)
      else process.env[name] = value
    }
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('web-search-zai settings section', () => {
  it('serves a stored section to the next search without re-registering the provider', async () => {
    const bench = await boot({ apiKey: 'zai-key', baseURL: 'https://search.entry.test' })
    expect(await searchOnce(bench.ctx)).toMatchObject({
      url: 'https://search.entry.test/web_search',
      body: { search_engine: 'search-prime', count: 10 },
    })

    await bench.ctx.settings.update(WEB_SEARCH_ZAI_SETTINGS_NAMESPACE, {
      baseURL: 'https://search.stored.test',
      searchEngine: 'search-pro',
      count: 7,
    })

    expect(await searchOnce(bench.ctx)).toMatchObject({
      url: 'https://search.stored.test/web_search',
      body: { search_engine: 'search-pro', count: 7 },
    })
    await bench.ctx.fiber.dispose()
  })

  it('treats a blank stored value as no value and falls to the projection default', async () => {
    await withEnv({ ZAI_API_KEY: 'env-key', ZAI_SEARCH_BASE_URL: undefined }, async () => {
      const bench = await boot({ apiKey: 'zai-key', baseURL: 'https://search.entry.test' })
      await bench.ctx.settings.update(WEB_SEARCH_ZAI_SETTINGS_NAMESPACE, { apiKey: '', baseURL: '' })
      const request = await searchOnce(bench.ctx)
      expect(request.url).toBe('https://api.z.ai/api/paas/v4/web_search')
      expect(request.authorization).toBe('Bearer env-key')
      await bench.ctx.fiber.dispose()
    })
  })

  it('feeds a blank endpoint from the search base-URL environment variable', async () => {
    await withEnv({ ZAI_SEARCH_BASE_URL: 'https://search.env.test' }, async () => {
      const bench = await boot({ apiKey: 'zai-key', baseURL: 'https://search.entry.test' })
      await bench.ctx.settings.update(WEB_SEARCH_ZAI_SETTINGS_NAMESPACE, { baseURL: '' })
      expect((await searchOnce(bench.ctx)).url).toBe('https://search.env.test/web_search')
      await bench.ctx.fiber.dispose()
    })
  })

  it('returns the composition value when the stored field is unset', async () => {
    const bench = await boot({ apiKey: 'zai-key', baseURL: 'https://search.entry.test' })
    await bench.ctx.settings.update(WEB_SEARCH_ZAI_SETTINGS_NAMESPACE, { baseURL: 'https://search.stored.test' })
    expect((await searchOnce(bench.ctx)).url).toContain('search.stored.test')

    await bench.ctx.settings.mutate(WEB_SEARCH_ZAI_SETTINGS_NAMESPACE, [{ op: 'unset', path: ['baseURL'] }])

    expect((await searchOnce(bench.ctx)).url).toBe('https://search.entry.test/web_search')
    await bench.ctx.fiber.dispose()
  })

  it('keeps the literal key out of every described layer', async () => {
    const bench = await boot({ apiKey: 'zai-key', baseURL: 'https://search.entry.test' })
    await bench.ctx.settings.update(WEB_SEARCH_ZAI_SETTINGS_NAMESPACE, { apiKey: 'zai-stored-secret' })

    const [descriptor] = bench.ctx.settings.describe({ redactSecrets: true })
      .filter(row => String(row.ns) === 'web-search-zai')

    expect(JSON.stringify(descriptor)).not.toContain('zai-stored-secret')
    expect(descriptor?.secrets).toEqual([{ path: ['apiKey'], set: true }])
    await bench.ctx.fiber.dispose()
  })

  it('falls back to the composition entry when the settings provider detaches', async () => {
    const bench = await boot({ apiKey: 'zai-key', baseURL: 'https://search.entry.test' })
    await bench.ctx.settings.update(WEB_SEARCH_ZAI_SETTINGS_NAMESPACE, {
      baseURL: 'https://search.stored.test',
    })
    expect((await searchOnce(bench.ctx)).url).toContain('search.stored.test')

    await bench.settingsFiber.dispose()

    expect((await searchOnce(bench.ctx)).url).toBe('https://search.entry.test/web_search')
    await bench.ctx.fiber.dispose()
  })

  it('releases the namespace when the plugin unloads', async () => {
    const bench = await boot({ apiKey: 'zai-key', baseURL: 'https://search.entry.test' })
    expect(bench.ctx.settings.describe().map(row => String(row.ns))).toContain('web-search-zai')

    await bench.pluginFiber.dispose()

    expect(bench.ctx.settings.describe().map(row => String(row.ns))).not.toContain('web-search-zai')
    await bench.ctx.fiber.dispose()
  })

  it('resolves the stored key reference through the credentials service', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-web-search-zai-'))
    const ctx = new Context()
    try {
      await ctx.plugin(WebRuntime, {})
      const settingsFiber = ctx.plugin(MemorySettings)
      await settingsFiber.await()
      await ctx.plugin(LocalCredentialProvider, { path: join(dir, '.credentials.yaml'), watch: false })
      await ctx.plugin(zaiPlugin, { baseURL: 'https://search.entry.test' })
      await ctx.credentials.set(credentialRef('ZAI_SECTION_KEY'), 'stored-key')

      await ctx.settings.update(WEB_SEARCH_ZAI_SETTINGS_NAMESPACE, { apiKeyEnv: 'ZAI_SECTION_KEY' })
      expect((await searchOnce(ctx)).authorization).toBe('Bearer stored-key')

      await ctx.settings.update(WEB_SEARCH_ZAI_SETTINGS_NAMESPACE, { apiKeyEnv: '' })
      await expect(ctx.web.search({ query: 'q' })).rejects.toThrow(expect.objectContaining({
        code: 'WEB_PROVIDER_CREDENTIAL_MISSING',
        message: expect.stringContaining('no API key for "ZAI_API_KEY"') as string,
      }))
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('ignores an empty ambient key and fails naming the reference', async () => {
    await withEnv({ ZAI_API_KEY: '' }, async () => {
      const bench = await boot({ apiKey: '', baseURL: 'https://search.entry.test' })
      await expect(bench.ctx.web.search({ query: 'q' })).rejects.toThrow(expect.objectContaining({
        code: 'WEB_PROVIDER_CREDENTIAL_MISSING',
        message: expect.stringContaining('no API key for "ZAI_API_KEY"') as string,
      }))
      await bench.ctx.fiber.dispose()
    })
  })
})
