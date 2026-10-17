/** The `web` settings namespace layered over the compositional entry: selection resolution. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Fiber } from '@deepseek-ai/cordis'
import { SettingsProvider } from '@deepseek-ai/dsh-settings'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import WebRuntime, {
  WEB_SETTINGS_NAMESPACE,
  type WebFetchProvider,
  type WebFetchResult,
  type WebSearchProvider,
  type WebSearchResult,
} from '@deepseek-ai/dsh-web'

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

function makeSearchProvider(id: string, marker: string): WebSearchProvider {
  return { id, available: () => true, search: () => Promise.resolve(searchResult(marker)) }
}

function makeFetchProvider(id: string, marker: string): WebFetchProvider {
  const result: WebFetchResult = {
    url: 'https://example.com',
    statusCode: 200,
    body: { kind: 'text', content: marker },
    truncated: false,
  }
  return { id, available: () => true, fetch: () => Promise.resolve(result) }
}

function searchResult(marker: string): WebSearchResult {
  return { content: marker, sources: [], truncated: false }
}

/** The provider id the resolved selection reached, read off the scripted marker. */
async function searchOnce(web: WebRuntime): Promise<string> {
  return (await web.search({ query: 'q' })).content ?? ''
}

async function fetchOnce(web: WebRuntime): Promise<string> {
  return (await web.fetch({ url: 'https://example.com' })).body.content
}

async function boot(config: ConstructorParameters<typeof WebRuntime>[1] = {}): Promise<{
  ctx: Context
  settingsFiber: Fiber
  webFiber: Fiber
  web: WebRuntime
}> {
  const ctx = new Context()
  const webFiber = ctx.plugin(WebRuntime, config)
  await webFiber.await()
  const settingsFiber = ctx.plugin(MemorySettings)
  await settingsFiber.await()
  const bench = { ctx, settingsFiber, webFiber, web: ctx.web }
  // The namespace registration and the source swap run inside the injected
  // wiring; wait for the registration so every test reads the layered section.
  await vi.waitFor(() => {
    expect(bench.ctx.settings.get(WEB_SETTINGS_NAMESPACE)).toBeDefined()
  })
  return bench
}

describe('web settings namespace: selection layers', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('resolves the user layer over the composition entry, which beats $DSH_WEB_SEARCH_PROVIDER', async () => {
    vi.stubEnv('DSH_WEB_SEARCH_PROVIDER', 'perplexity')
    const bench = await boot({ searchProvider: 'zai' })
    bench.web.registerSearchProvider(makeSearchProvider('zai', 'zai'))
    bench.web.registerSearchProvider(makeSearchProvider('exa', 'exa'))
    bench.web.registerSearchProvider(makeSearchProvider('perplexity', 'perplexity'))

    expect(await searchOnce(bench.web)).toBe('zai')

    await bench.ctx.settings.update(WEB_SETTINGS_NAMESPACE, { searchProvider: 'exa' })

    expect(await searchOnce(bench.web)).toBe('exa')
    const [descriptor] = bench.ctx.settings.describe().filter(row => String(row.ns) === 'web')
    expect(descriptor?.user).toEqual({ searchProvider: 'exa' })
  })

  it('feeds $DSH_WEB_SEARCH_PROVIDER into the compositional entry when the yml field is absent', async () => {
    vi.stubEnv('DSH_WEB_SEARCH_PROVIDER', 'exa')
    const bench = await boot()
    bench.web.registerSearchProvider(makeSearchProvider('exa', 'exa'))
    bench.web.registerSearchProvider(makeSearchProvider('perplexity', 'perplexity'))

    expect(await searchOnce(bench.web)).toBe('exa')
    const [descriptor] = bench.ctx.settings.describe().filter(row => String(row.ns) === 'web')
    expect(descriptor?.base).toEqual({ searchProvider: 'exa' })
  })

  it('returns to the compositional value when the user layer field is removed', async () => {
    const bench = await boot({ searchProvider: 'zai' })
    bench.web.registerSearchProvider(makeSearchProvider('zai', 'zai'))
    bench.web.registerSearchProvider(makeSearchProvider('exa', 'exa'))

    await bench.ctx.settings.update(WEB_SETTINGS_NAMESPACE, { searchProvider: 'exa' })
    expect(await searchOnce(bench.web)).toBe('exa')

    await bench.ctx.settings.mutate(WEB_SETTINGS_NAMESPACE, [{ op: 'unset', path: ['searchProvider'] }])

    expect(await searchOnce(bench.web)).toBe('zai')
  })

  it('treats an explicitly stored empty string as auto-select', async () => {
    const bench = await boot({ searchProvider: 'zai' })
    bench.web.registerSearchProvider(makeSearchProvider('zai', 'zai'))

    await bench.ctx.settings.update(WEB_SETTINGS_NAMESPACE, { searchProvider: '' })
    expect(await searchOnce(bench.web)).toBe('zai')

    bench.web.registerSearchProvider(makeSearchProvider('exa', 'exa'))
    await expect(bench.web.search({ query: 'q' })).rejects.toThrow(
      expect.objectContaining({ code: 'WEB_PROVIDER_AMBIGUOUS' }),
    )
  })

  it('resolves the fetch selection through the same section', async () => {
    const bench = await boot({ fetchProvider: 'http' })
    bench.web.registerFetchProvider(makeFetchProvider('http', 'http'))
    bench.web.registerFetchProvider(makeFetchProvider('http2', 'http2'))

    expect(await fetchOnce(bench.web)).toBe('http')

    await bench.ctx.settings.update(WEB_SETTINGS_NAMESPACE, { fetchProvider: 'http2' })

    expect(await fetchOnce(bench.web)).toBe('http2')
  })

  it('falls back to the compositional entry when the settings provider detaches', async () => {
    const bench = await boot({ searchProvider: 'zai' })
    bench.web.registerSearchProvider(makeSearchProvider('zai', 'zai'))
    bench.web.registerSearchProvider(makeSearchProvider('exa', 'exa'))

    await bench.ctx.settings.update(WEB_SETTINGS_NAMESPACE, { searchProvider: 'exa' })
    expect(await searchOnce(bench.web)).toBe('exa')

    await bench.settingsFiber.dispose()

    expect(await searchOnce(bench.web)).toBe('zai')
  })

  it('releases the web namespace when the web fiber is disposed (HMR safety)', async () => {
    const bench = await boot()
    expect(bench.ctx.settings.describe().map(row => String(row.ns))).toContain('web')

    await bench.webFiber.dispose()

    expect(bench.ctx.settings.describe().map(row => String(row.ns))).not.toContain('web')
  })
})
