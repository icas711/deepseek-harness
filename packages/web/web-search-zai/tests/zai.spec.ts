import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import WebRuntime from '@deepseek-ai/dsh-web'
import {
  ZaiSearchProvider,
  ZAI_PROVIDER_ID,
} from '@deepseek-ai/dsh-web-search-zai'
import * as zaiPlugin from '@deepseek-ai/dsh-web-search-zai'
import { clampZaiCount, mapZaiResponse } from '../src/provider.ts'

const options = {
  apiKey: 'zai-key',
  apiKeyEnv: 'ZAI_API_KEY',
  baseURL: 'https://api.z.ai.test',
  searchEngine: 'search-prime',
  count: 10,
}

/** The same facts as {@link options} minus the literal key. */
const keylessOptions = {
  apiKeyEnv: 'ZAI_API_KEY',
  baseURL: 'https://api.z.ai.test',
  searchEngine: 'search-prime',
  count: 10,
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init })
}

/** The web_search request fields the request-mapping assertions read. */
interface WebSearchRequestBody {
  search_engine: string
  search_query: string
  count: number
}

/** Parse the JSON body the provider posted to the mocked fetch call. */
function requestBodyOf(call: readonly unknown[] | undefined): WebSearchRequestBody {
  if (call === undefined) throw new Error('the mocked fetch call is absent')
  const [, init] = call as unknown as [string, RequestInit]
  return JSON.parse(init.body as string) as WebSearchRequestBody
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Z.ai response mapping', () => {
  it('maps structured results and never sets content', () => {
    const result = mapZaiResponse({
      id: 'resp-1',
      created: 1748261757,
      search_result: [
        {
          title: 'A',
          content: 'snip',
          link: 'https://a.test',
          media: 'Example',
          icon: 'https://a.test/icon.jpg',
          refer: 'ref_1',
          publish_date: '2025-05-23',
        },
        { link: 'https://b.test' },
      ],
    })
    expect(result).toEqual({
      sources: [
        { url: 'https://a.test', title: 'A', snippet: 'snip', publishedAt: '2025-05-23' },
        { url: 'https://b.test' },
      ],
      truncated: false,
    })
  })

  it('omits null/empty optional source fields', () => {
    const result = mapZaiResponse({
      search_result: [{ link: 'https://a.test', title: null, content: '', publish_date: null }],
    })
    expect(result.sources).toEqual([{ url: 'https://a.test' }])
  })

  it('yields no sources when search_result is absent or empty', () => {
    expect(mapZaiResponse({}).sources).toEqual([])
    expect(mapZaiResponse({ search_result: [] }).sources).toEqual([])
  })

  it('clamps counts into the API range', () => {
    expect(clampZaiCount(1)).toBe(1)
    expect(clampZaiCount(30)).toBe(30)
    expect(clampZaiCount(0)).toBe(1)
    expect(clampZaiCount(100)).toBe(50)
  })
})

describe('ZaiSearchProvider availability', () => {
  it('is unavailable without any key source', () => {
    expect(new ZaiSearchProvider(() => keylessOptions).available()).toBe(false)
  })

  it('is available with a literal key', () => {
    expect(new ZaiSearchProvider(() => options).available()).toBe(true)
  })

  it('is available with a key resolver alone', () => {
    expect(new ZaiSearchProvider(() => ({ ...keylessOptions, resolveApiKey: async () => 'env-key' })).available()).toBe(true)
  })

  it('is misconfigured when the base URL is unparseable', () => {
    expect(new ZaiSearchProvider(() => ({ ...options, baseURL: 'not a url' })).available()).toBe(false)
  })

  it('is misconfigured when the search engine is blank', () => {
    expect(new ZaiSearchProvider(() => ({ ...options, searchEngine: '' })).available()).toBe(false)
  })

  it('is misconfigured when count is outside the API range', () => {
    expect(new ZaiSearchProvider(() => ({ ...options, count: 0 })).available()).toBe(false)
    expect(new ZaiSearchProvider(() => ({ ...options, count: 1.5 })).available()).toBe(false)
    expect(new ZaiSearchProvider(() => ({ ...options, count: 51 })).available()).toBe(false)
  })
})

describe('ZaiSearchProvider request mapping', () => {
  it('sends a web_search request with the engine, query, and count', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ search_result: [] }))
    vi.stubGlobal('fetch', fetchMock)
    await new ZaiSearchProvider(() => options).search({ query: 'hello' })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.z.ai.test/web_search')
    expect(init).toMatchObject({ method: 'POST', redirect: 'error' })
    expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer zai-key')
    expect(JSON.parse(init.body as string)).toEqual({
      search_engine: 'search-prime',
      search_query: 'hello',
      count: 10,
    })
  })

  it('derives count from maxResults and clamps it into the API range', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ search_result: [] }))
    vi.stubGlobal('fetch', fetchMock)
    const provider = new ZaiSearchProvider(() => options)
    await provider.search({ query: 'q', maxResults: 3 })
    await provider.search({ query: 'q', maxResults: 100 })
    const first = requestBodyOf(fetchMock.mock.calls[0])
    const second = requestBodyOf(fetchMock.mock.calls[1])
    expect(first.count).toBe(3)
    expect(second.count).toBe(50)
  })

  it('forwards the abort signal', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ search_result: [] }))
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    await new ZaiSearchProvider(() => options).search({ query: 'q' }, controller.signal)
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(init.signal).toBe(controller.signal)
  })
})

describe('ZaiSearchProvider error handling', () => {
  it('maps an HTTP error to WEB_PROVIDER_ERROR with the provider message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      jsonResponse({ error: { code: '1113', message: 'Insufficient balance or no resource package.' } }, { status: 429 })))
    await expect(new ZaiSearchProvider(() => options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({
        code: 'WEB_PROVIDER_ERROR',
        message: 'Insufficient balance or no resource package.',
      }))
  })

  it('handles a top-level error body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ code: '1214', message: 'bad engine' }, { status: 400 })))
    await expect(new ZaiSearchProvider(() => options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ message: 'bad engine' }))
  })

  it('maps a well-formed body of the wrong shape to WEB_PROVIDER_ERROR, not a raw TypeError', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ search_result: null }, { status: 200 })))
    await expect(new ZaiSearchProvider(() => options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
  })

  it('fails with the credential reference when no key resolves', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ search_result: [] })))
    await expect(new ZaiSearchProvider(() => ({ ...keylessOptions, resolveApiKey: async () => undefined })).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({
        code: 'WEB_PROVIDER_CREDENTIAL_MISSING',
        message: expect.stringContaining('"ZAI_API_KEY"') as string,
      }))
  })

  it('keeps a status-line message when the error body is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('upstream error', { status: 503 })))
    await expect(new ZaiSearchProvider(() => options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ message: 'Z.ai API error (HTTP 503)' }))
  })

  it('keeps the status-line message when the JSON error body carries no detail', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({}, { status: 500 })))
    await expect(new ZaiSearchProvider(() => options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ message: 'Z.ai API error (HTTP 500)' }))
  })

  it('maps an abort to WEB_ABORTED', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new DOMException('aborted', 'AbortError'))))
    await expect(new ZaiSearchProvider(() => options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_ABORTED' }))
  })

  it('maps an unparseable success body to WEB_PROVIDER_ERROR', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not json', { status: 200 })))
    await expect(new ZaiSearchProvider(() => options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
  })

  it('surfaces an abort during success-body parse as WEB_ABORTED, not provider error', async () => {
    const body = { json: () => Promise.reject(new DOMException('aborted', 'AbortError')), ok: true, status: 200 }
    vi.stubGlobal('fetch', vi.fn(async () => body as unknown as Response))
    await expect(new ZaiSearchProvider(() => options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_ABORTED' }))
  })

  it('surfaces an abort during error-body parse as WEB_ABORTED', async () => {
    const body = { json: () => Promise.reject(new DOMException('aborted', 'AbortError')), ok: false, status: 500 }
    vi.stubGlobal('fetch', vi.fn(async () => body as unknown as Response))
    await expect(new ZaiSearchProvider(() => options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_ABORTED' }))
  })

  it('maps a network failure to WEB_PROVIDER_ERROR', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('connection refused'))))
    await expect(new ZaiSearchProvider(() => options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
  })

  it('fails the search when the options carry no key source at all', async () => {
    await expect(new ZaiSearchProvider(() => ({ ...keylessOptions })).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({
        code: 'WEB_PROVIDER_CREDENTIAL_MISSING',
        message: expect.stringContaining('"ZAI_API_KEY"') as string,
      }))
  })
})

describe('web-search-zai plugin registration', () => {
  it('registers the provider into ctx.web (HMR-safe)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ search_result: [{ link: 'https://a.test' }] })))
    const ctx = new Context()
    await ctx.plugin(WebRuntime, { searchProvider: ZAI_PROVIDER_ID })
    const fiber = await ctx.plugin(zaiPlugin, { apiKey: 'zai-key' })
    await expect(ctx.web.search({ query: 'q' })).resolves.toMatchObject({ sources: [{ url: 'https://a.test' }] })
    await fiber.dispose()
    await expect(ctx.web.search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_CONFIGURED_MISSING' }))
  })

  it('has no default export (namespace plugin export shape)', () => {
    expect('default' in zaiPlugin).toBe(false)
  })

  it('threads searchEngine and count config into the request', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ search_result: [] }))
    vi.stubGlobal('fetch', fetchMock)
    const ctx = new Context()
    await ctx.plugin(WebRuntime, { searchProvider: ZAI_PROVIDER_ID })
    const fiber = await ctx.plugin(zaiPlugin, { apiKey: 'zai-key', searchEngine: 'search-pro', count: 7 })
    await ctx.web.search({ query: 'q' })
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toMatchObject({ search_engine: 'search-pro', count: 7 })
    await fiber.dispose()
  })

  it('falls back to env key and defaults for base URL when config omits them', async () => {
    const prev = process.env.ZAI_API_KEY
    process.env.ZAI_API_KEY = 'env-key'
    try {
      const fetchMock = vi.fn(async () => jsonResponse({ search_result: [] }))
      vi.stubGlobal('fetch', fetchMock)
      const ctx = new Context()
      await ctx.plugin(WebRuntime, { searchProvider: ZAI_PROVIDER_ID })
      const fiber = await ctx.plugin(zaiPlugin, {})
      await ctx.web.search({ query: 'q' })
      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
      expect(url).toBe('https://api.z.ai/api/paas/v4/web_search')
      expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer env-key')
      expect(JSON.parse(init.body as string)).toMatchObject({ search_engine: 'search-prime' })
      await fiber.dispose()
    } finally {
      if (prev === undefined) delete process.env.ZAI_API_KEY
      else process.env.ZAI_API_KEY = prev
    }
  })

  it('projects an unresolved composition entry onto the env key and constant defaults', async () => {
    const prevKey = process.env.ZAI_API_KEY
    const prevBase = process.env.ZAI_SEARCH_BASE_URL
    process.env.ZAI_API_KEY = 'env-key'
    delete process.env.ZAI_SEARCH_BASE_URL
    try {
      const fetchMock = vi.fn(async () => jsonResponse({ search_result: [] }))
      vi.stubGlobal('fetch', fetchMock)
      const ctx = new Context()
      await ctx.plugin(WebRuntime, { searchProvider: ZAI_PROVIDER_ID })
      zaiPlugin.apply(ctx, {})
      await ctx.web.search({ query: 'q' })
      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
      expect(url).toBe('https://api.z.ai/api/paas/v4/web_search')
      expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer env-key')
      expect(JSON.parse(init.body as string)).toMatchObject({ search_engine: 'search-prime', count: 10 })
      await ctx.fiber.dispose()
    } finally {
      if (prevKey === undefined) delete process.env.ZAI_API_KEY
      else process.env.ZAI_API_KEY = prevKey
      if (prevBase === undefined) delete process.env.ZAI_SEARCH_BASE_URL
      else process.env.ZAI_SEARCH_BASE_URL = prevBase
    }
  })

  it('fails the search when neither config nor env supplies a key', async () => {
    const prev = process.env.ZAI_API_KEY
    delete process.env.ZAI_API_KEY
    try {
      const ctx = new Context()
      await ctx.plugin(WebRuntime, { searchProvider: ZAI_PROVIDER_ID })
      const fiber = await ctx.plugin(zaiPlugin, {})
      await expect(ctx.web.search({ query: 'q' }))
        .rejects.toThrow(expect.objectContaining({
          code: 'WEB_PROVIDER_CREDENTIAL_MISSING',
          message: expect.stringContaining('no API key for "ZAI_API_KEY"') as string,
        }))
      await fiber.dispose()
    } finally {
      if (prev !== undefined) process.env.ZAI_API_KEY = prev
    }
  })
})
