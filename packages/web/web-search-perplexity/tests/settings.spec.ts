/** The `web-search-perplexity` settings section layered over the composition entry. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Fiber } from '@deepseek-ai/cordis'
import { SettingsProvider } from '@deepseek-ai/dsh-settings'
import type { SettingsDescriptor, SettingsNamespace } from '@deepseek-ai/dsh-settings'
import WebRuntime from '@deepseek-ai/dsh-web'
import * as perplexityPlugin from '@deepseek-ai/dsh-web-search-perplexity'
import {
  PERPLEXITY_PROVIDER_ID,
  WEB_SEARCH_PERPLEXITY_SETTINGS_NAMESPACE,
} from '@deepseek-ai/dsh-web-search-perplexity'
import { MemoryCredentials } from './memory-credentials.ts'

/** Optional boot variations: a sparse plugin section, and a seeded credentials service. */
interface BootOptions {
  pluginConfig?: perplexityPlugin.Config
  credentialsSeed?: Record<string, string>
}

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

/** The smallest Perplexity-shaped answer the provider accepts — enough to observe the request. */
const ONE_RESULT = { choices: [{ message: { content: 'ok' } }], citations: [] }

async function boot(options: BootOptions = {}): Promise<{ ctx: Context; settingsFiber: Fiber; pluginFiber: Fiber }> {
  const ctx = new Context()
  await ctx.plugin(WebRuntime, { searchProvider: PERPLEXITY_PROVIDER_ID })
  if (options.credentialsSeed !== undefined) {
    const credentialsFiber = ctx.plugin(MemoryCredentials, options.credentialsSeed)
    await credentialsFiber.await()
  }
  const settingsFiber = ctx.plugin(MemorySettings)
  await settingsFiber.await()
  const pluginFiber = ctx.plugin(
    perplexityPlugin,
    options.pluginConfig ?? { apiKey: 'pplx-entry-key', baseURL: 'https://search.entry.test' },
  )
  await pluginFiber.await()
  return { ctx, settingsFiber, pluginFiber }
}

afterEach(() => {
  vi.restoreAllMocks()
})

/**
 * Run one search through the seam and answer the request it produced.
 * A fresh `Response` per call because a body can only be read once, and the
 * call history is cleared because repeated `spyOn` returns the same spy.
 * @param ctx - context whose `ctx.web` serves the search.
 * @returns the URL the provider fetched, the credential it sent, and the JSON body.
 */
async function searchOnce(ctx: Context): Promise<{ url: string; authorization: string; body: unknown }> {
  const fetchSpy = vi.spyOn(globalThis, 'fetch')
    .mockImplementation(() => Promise.resolve(new Response(JSON.stringify(ONE_RESULT), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })))
  fetchSpy.mockClear()
  await ctx.web.search({ query: 'anything' })
  const [url, init] = fetchSpy.mock.calls.at(-1) as unknown as [string, RequestInit]
  return {
    url: String(url),
    authorization: (init.headers as Record<string, string>)['authorization'] ?? '',
    body: JSON.parse(init.body as string),
  }
}

/**
 * Read this namespace's descriptor the way a wire surface would — secrets redacted.
 * @param ctx - context holding the registered settings namespace.
 * @returns the descriptor for `web-search-perplexity`.
 */
function describedSection(ctx: Context): SettingsDescriptor {
  const [descriptor] = ctx.settings.describe({ redactSecrets: true })
    .filter(row => String(row.ns) === WEB_SEARCH_PERPLEXITY_SETTINGS_NAMESPACE)
  if (descriptor === undefined) throw new Error('web-search-perplexity namespace is not described')
  return descriptor
}

describe('web-search-perplexity settings section', () => {
  it('serves a stored endpoint to the next search without re-registering the provider', async () => {
    const bench = await boot()
    expect((await searchOnce(bench.ctx)).url).toContain('https://search.entry.test')

    await bench.ctx.settings.update(WEB_SEARCH_PERPLEXITY_SETTINGS_NAMESPACE, {
      baseURL: 'https://search.stored.test',
    })

    expect((await searchOnce(bench.ctx)).url).toContain('https://search.stored.test')
    await bench.ctx.fiber.dispose()
  })

  it('marks overridden fields in the user layer; reset returns the field to the composition value', async () => {
    const bench = await boot()
    await bench.ctx.settings.update(WEB_SEARCH_PERPLEXITY_SETTINGS_NAMESPACE, {
      baseURL: 'https://search.stored.test',
      model: 'sonar-pro',
    })
    expect(describedSection(bench.ctx).user).toEqual({
      baseURL: 'https://search.stored.test',
      model: 'sonar-pro',
    })

    await bench.ctx.settings.mutate(WEB_SEARCH_PERPLEXITY_SETTINGS_NAMESPACE, [{ op: 'unset', path: ['baseURL'] }])

    const afterReset = describedSection(bench.ctx)
    expect(afterReset.user).toEqual({ model: 'sonar-pro' })
    expect((afterReset.base as { baseURL?: string }).baseURL).toBe('https://search.entry.test')

    const call = await searchOnce(bench.ctx)
    expect(call.url).toContain('https://search.entry.test')
    expect(call.body).toMatchObject({ model: 'sonar-pro' })
    await bench.ctx.fiber.dispose()
  })

  it('serves a stored key reference to the next search without re-registering the provider', async () => {
    const bench = await boot({
      pluginConfig: { baseURL: 'https://search.entry.test' },
      credentialsSeed: { PERPLEXITY_API_KEY: 'entry-key', PERPLEXITY_ALT_KEY: 'alt-key' },
    })
    expect((await searchOnce(bench.ctx)).authorization).toBe('Bearer entry-key')

    await bench.ctx.settings.update(WEB_SEARCH_PERPLEXITY_SETTINGS_NAMESPACE, {
      apiKeyEnv: 'PERPLEXITY_ALT_KEY',
    })

    expect((await searchOnce(bench.ctx)).authorization).toBe('Bearer alt-key')
    const sections = JSON.stringify(bench.ctx.settings.describe({ redactSecrets: true }))
    expect(sections).not.toContain('entry-key')
    expect(sections).not.toContain('alt-key')
    await bench.ctx.fiber.dispose()
  })

  it('keeps the literal key out of every described layer and names the key reference', async () => {
    const bench = await boot()
    await bench.ctx.settings.update(WEB_SEARCH_PERPLEXITY_SETTINGS_NAMESPACE, { apiKey: 'pplx-stored-secret' })

    const descriptor = describedSection(bench.ctx)
    expect(JSON.stringify(descriptor)).not.toContain('pplx-stored-secret')
    expect(JSON.stringify(descriptor)).not.toContain('pplx-entry-key')
    expect(descriptor.secrets).toEqual([{ path: ['apiKey'], set: true }])
    expect((descriptor.value as { apiKeyEnv?: string }).apiKeyEnv).toBe('PERPLEXITY_API_KEY')
    await bench.ctx.fiber.dispose()
  })

  it('falls back to the composition entry when the settings provider detaches', async () => {
    const bench = await boot()
    await bench.ctx.settings.update(WEB_SEARCH_PERPLEXITY_SETTINGS_NAMESPACE, {
      baseURL: 'https://search.stored.test',
    })
    expect((await searchOnce(bench.ctx)).url).toContain('https://search.stored.test')

    await bench.settingsFiber.dispose()

    expect((await searchOnce(bench.ctx)).url).toContain('https://search.entry.test')
    await bench.ctx.fiber.dispose()
  })

  it('releases the namespace when the plugin unloads', async () => {
    const bench = await boot()
    expect(bench.ctx.settings.describe().map(row => String(row.ns))).toContain('web-search-perplexity')

    await bench.pluginFiber.dispose()

    expect(bench.ctx.settings.describe().map(row => String(row.ns))).not.toContain('web-search-perplexity')
    await bench.ctx.fiber.dispose()
  })
})
