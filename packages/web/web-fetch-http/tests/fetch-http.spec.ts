/**
 * Provider behavior over a scripted transport (caps, redirect policy, charset
 * decoding, cancellation) and the plugin surface: registration, the settings
 * namespace layered over the composition entry, and HMR-safe disposal.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Fiber } from '@deepseek-ai/cordis'
import { SettingsProvider } from '@deepseek-ai/dsh-settings'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import WebRuntime from '@deepseek-ai/dsh-web'
import { HttpFetchProvider, LOCAL_FETCH_PROVIDER_ID } from '@deepseek-ai/dsh-web-fetch-http'
import * as fetchPlugin from '@deepseek-ai/dsh-web-fetch-http'
import { WEB_FETCH_HTTP_SETTINGS_NAMESPACE } from '@deepseek-ai/dsh-web-fetch-http'
import type { HttpFetchLimits } from '@deepseek-ai/dsh-web-fetch-http'
import { classifyContentType, decoderForCharset, isSameOrigin, parseCharset, validateFetchUrl } from '../src/policy.ts'
import type { HttpFetchDeps } from '../src/transport.ts'
import { enc, fakeDeps, limits, pendingUntilAbort, PUBLIC_NAME, scriptedResponse } from './fake-transport.ts'

function providerFor(deps: HttpFetchDeps, overrides: Partial<HttpFetchLimits> = {}): HttpFetchProvider {
  return new HttpFetchProvider(() => ({ ...limits, ...overrides }), deps)
}

/** The smallest real settings provider: one in-memory document, always writable. */
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

async function boot(config: fetchPlugin.Config): Promise<{ ctx: Context; settingsFiber: Fiber; pluginFiber: Fiber }> {
  const ctx = new Context()
  await ctx.plugin(WebRuntime, { fetchProvider: LOCAL_FETCH_PROVIDER_ID })
  const settingsFiber = ctx.plugin(MemorySettings)
  await settingsFiber.await()
  const pluginFiber = ctx.plugin(fetchPlugin, config)
  await pluginFiber.await()
  return { ctx, settingsFiber, pluginFiber }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('policy helpers', () => {
  it('validates scheme, credentials, and length', () => {
    expect(validateFetchUrl('https://example.com/x', 2048).hostname).toBe('example.com')
    expect(() => validateFetchUrl('ftp://example.com', 2048)).toThrow(expect.objectContaining({ code: 'WEB_INVALID_URL' }))
    expect(() => validateFetchUrl('not a url', 2048)).toThrow(expect.objectContaining({ code: 'WEB_INVALID_URL' }))
    expect(() => validateFetchUrl('https://user:pass@example.com', 2048)).toThrow(expect.objectContaining({ code: 'WEB_BLOCKED_URL' }))
    expect(() => validateFetchUrl(`https://example.com/${'a'.repeat(3000)}`, 2048)).toThrow(expect.objectContaining({ code: 'WEB_INVALID_URL' }))
  })

  it('classifies content types', () => {
    expect(classifyContentType('text/html; charset=utf-8')).toBe('html')
    expect(classifyContentType('application/xhtml+xml')).toBe('html')
    expect(classifyContentType('text/plain')).toBe('text')
    expect(classifyContentType('application/json')).toBe('text')
    expect(classifyContentType('image/png')).toBeUndefined()
    expect(classifyContentType(null)).toBeUndefined()
  })

  it('compares origins', () => {
    expect(isSameOrigin(new URL('https://a.com/x'), new URL('https://a.com/y'))).toBe(true)
    expect(isSameOrigin(new URL('https://a.com'), new URL('https://b.com'))).toBe(false)
    expect(isSameOrigin(new URL('http://a.com'), new URL('https://a.com'))).toBe(false)
  })

  it('parses the charset parameter', () => {
    expect(parseCharset('text/html; charset=UTF-8')).toBe('utf-8')
    expect(parseCharset('text/plain; charset="iso-8859-1"')).toBe('iso-8859-1')
    expect(parseCharset('text/plain')).toBeUndefined()
    expect(parseCharset(null)).toBeUndefined()
  })

  it('builds a decoder for a charset and defaults to UTF-8', () => {
    expect(decoderForCharset(undefined).encoding).toBe('utf-8')
    expect(decoderForCharset('iso-8859-1').encoding).toBe('windows-1252')
    expect(() => decoderForCharset('not-a-charset')).toThrow(expect.objectContaining({ code: 'WEB_UNSUPPORTED_CONTENT_TYPE' }))
  })
})

describe('HttpFetchProvider success', () => {
  it('fetches a text body and sends the configured agent and accept headers', async () => {
    const body = scriptedResponse({ status: 200, headers: { 'content-type': 'text/plain' }, chunks: [enc('hello world')] })
    const deps = fakeDeps({ respond: () => body.response })
    const result = await providerFor(deps).fetch({ url: `http://${PUBLIC_NAME}/x` })
    expect(deps.calls[0]?.headers['user-agent']).toBe('test-agent/1.0')
    expect(deps.calls[0]?.headers['accept']).toContain('text/html')
    expect(result.statusCode).toBe(200)
    expect(result.url).toBe(`http://${PUBLIC_NAME}/x`)
    expect(result.body).toEqual({ kind: 'text', content: 'hello world' })
    expect(result.truncated).toBe(false)
  })

  it('fetches an html body and classifies it as html', async () => {
    const body = scriptedResponse({ status: 200, headers: { 'content-type': 'text/html' }, chunks: [enc('<h1>hi</h1>')] })
    const deps = fakeDeps({ respond: () => body.response })
    const result = await providerFor(deps).fetch({ url: `http://${PUBLIC_NAME}/` })
    expect(result.body).toEqual({ kind: 'html', content: '<h1>hi</h1>' })
  })

  it('returns a non-2xx response as a result, not an error', async () => {
    const body = scriptedResponse({ status: 404, headers: { 'content-type': 'text/plain' }, chunks: [enc('nope')] })
    const deps = fakeDeps({ respond: () => body.response })
    const result = await providerFor(deps).fetch({ url: `http://${PUBLIC_NAME}/missing` })
    expect(result.statusCode).toBe(404)
    expect(result.body).toEqual({ kind: 'text', content: 'nope' })
  })

  it('reports usability without any network step', () => {
    expect(providerFor(fakeDeps()).available()).toBe(true)
  })

  it('reads the limits thunk once per fetch, so a change applies to the next one', async () => {
    let current: HttpFetchLimits = { ...limits }
    const deps = fakeDeps({
      respond: () => scriptedResponse({ status: 200, headers: { 'content-type': 'text/plain' }, chunks: [enc('abcdefghij')] }).response,
    })
    const provider = new HttpFetchProvider(() => current, deps)
    const full = await provider.fetch({ url: `http://${PUBLIC_NAME}/` })
    expect(full.truncated).toBe(false)
    current = { ...limits, maxBodyChars: 3 }
    const capped = await provider.fetch({ url: `http://${PUBLIC_NAME}/` })
    expect(capped.body.content).toBe('abc')
    expect(capped.truncated).toBe(true)
  })
})

describe('HttpFetchProvider caps', () => {
  it('rejects an over-cap Content-Length with WEB_FETCH_TOO_LARGE', async () => {
    const body = scriptedResponse({ status: 200, headers: { 'content-type': 'text/plain', 'content-length': '999999' }, chunks: [enc('x')] })
    const deps = fakeDeps({ respond: () => body.response })
    await expect(providerFor(deps, { maxResponseBytes: 10 }).fetch({ url: `http://${PUBLIC_NAME}/` }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_FETCH_TOO_LARGE' }))
  })

  it('accepts a non-numeric Content-Length by falling through to the stream', async () => {
    const body = scriptedResponse({ status: 200, headers: { 'content-type': 'text/plain', 'content-length': 'garbage' }, chunks: [enc('fine')] })
    const deps = fakeDeps({ respond: () => body.response })
    const result = await providerFor(deps, { maxResponseBytes: 10 }).fetch({ url: `http://${PUBLIC_NAME}/` })
    expect(result.body.content).toBe('fine')
  })

  it('truncates a stream that grows past the byte cap', async () => {
    const body = scriptedResponse({ status: 200, headers: { 'content-type': 'text/plain' }, chunks: [enc('abcdefghij')] })
    const deps = fakeDeps({ respond: () => body.response })
    const result = await providerFor(deps, { maxResponseBytes: 4 }).fetch({ url: `http://${PUBLIC_NAME}/` })
    expect(result.body.content).toBe('abcd')
    expect(result.truncated).toBe(true)
  })

  it('does not flag a body that exactly fills the byte cap as truncated', async () => {
    const body = scriptedResponse({ status: 200, headers: { 'content-type': 'text/plain' }, chunks: [enc('abcd')] })
    const deps = fakeDeps({ respond: () => body.response })
    const result = await providerFor(deps, { maxResponseBytes: 4 }).fetch({ url: `http://${PUBLIC_NAME}/` })
    expect(result.body.content).toBe('abcd')
    expect(result.truncated).toBe(false)
  })

  it('truncates a decoded body past the character cap', async () => {
    const body = scriptedResponse({ status: 200, headers: { 'content-type': 'text/plain' }, chunks: [enc('abcdefghij')] })
    const deps = fakeDeps({ respond: () => body.response })
    const result = await providerFor(deps, { maxBodyChars: 3 }).fetch({ url: `http://${PUBLIC_NAME}/` })
    expect(result.body.content).toBe('abc')
    expect(result.truncated).toBe(true)
  })

  it('rejects an unsupported content type', async () => {
    const body = scriptedResponse({ status: 200, headers: { 'content-type': 'image/png' }, chunks: [enc('binary')] })
    const deps = fakeDeps({ respond: () => body.response })
    await expect(providerFor(deps).fetch({ url: `http://${PUBLIC_NAME}/` }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_UNSUPPORTED_CONTENT_TYPE' }))
  })

  it('rejects a response with no content type at all', async () => {
    const body = scriptedResponse({ status: 200, chunks: [enc('no type')] })
    const deps = fakeDeps({ respond: () => body.response })
    await expect(providerFor(deps).fetch({ url: `http://${PUBLIC_NAME}/` }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_UNSUPPORTED_CONTENT_TYPE' }))
  })

  it('decodes a non-UTF-8 declared charset', async () => {
    // 0xE9 is "é" in ISO-8859-1; decoded as UTF-8 it would be a replacement char.
    const body = scriptedResponse({
      status: 200,
      headers: { 'content-type': 'text/plain; charset=iso-8859-1' },
      chunks: [new Uint8Array([0x63, 0x61, 0x66, 0xe9])],
    })
    const deps = fakeDeps({ respond: () => body.response })
    const result = await providerFor(deps).fetch({ url: `http://${PUBLIC_NAME}/` })
    expect(result.body.content).toBe('café')
  })

  it('rejects an unsupported declared charset', async () => {
    const body = scriptedResponse({ status: 200, headers: { 'content-type': 'text/plain; charset=not-a-charset' }, chunks: [enc('x')] })
    const deps = fakeDeps({ respond: () => body.response })
    await expect(providerFor(deps).fetch({ url: `http://${PUBLIC_NAME}/` }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_UNSUPPORTED_CONTENT_TYPE' }))
  })
})

describe('HttpFetchProvider redirects', () => {
  it.each([301, 302, 303, 307, 308])('follows a same-origin %i redirect and reports the final URL', async (status) => {
    const deps = fakeDeps({
      respond: (_req, index) => {
        if (index === 0) return scriptedResponse({ status, headers: { location: '/end' } }).response
        return scriptedResponse({ status: 200, headers: { 'content-type': 'text/plain' }, chunks: [enc('arrived')] }).response
      },
    })
    const result = await providerFor(deps).fetch({ url: `http://${PUBLIC_NAME}/start` })
    expect(result.body.content).toBe('arrived')
    expect(result.url).toBe(`http://${PUBLIC_NAME}/end`)
    expect(deps.calls[1]?.url.toString()).toBe(`http://${PUBLIC_NAME}/end`)
    expect(deps.calls[1]?.pinned.address).toBe('93.184.216.34')
  })

  it('follows a relative same-origin redirect', async () => {
    const deps = fakeDeps({
      respond: (_req, index) => {
        if (index === 0) return scriptedResponse({ status: 301, headers: { location: 'b' } }).response
        return scriptedResponse({ status: 200, headers: { 'content-type': 'text/plain' }, chunks: [enc('landed')] }).response
      },
    })
    const result = await providerFor(deps).fetch({ url: `http://${PUBLIC_NAME}/a` })
    expect(result.body.content).toBe('landed')
  })

  it('blocks a cross-origin redirect with WEB_REDIRECT_BLOCKED and cancels the body', async () => {
    const redirect = scriptedResponse({ status: 302, headers: { location: 'https://elsewhere.test/' } })
    const deps = fakeDeps({ respond: () => redirect.response })
    await expect(providerFor(deps).fetch({ url: `http://${PUBLIC_NAME}/` }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_REDIRECT_BLOCKED' }))
    expect(redirect.cancelled()).toBe(true)
  })

  it('re-validates a redirect target, rejecting same-origin credentials in the Location', async () => {
    const redirect = scriptedResponse({ status: 302, headers: { location: `http://user:pass@${PUBLIC_NAME}/` } })
    const deps = fakeDeps({ respond: () => redirect.response })
    await expect(providerFor(deps).fetch({ url: `http://${PUBLIC_NAME}/` }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_BLOCKED_URL' }))
    expect(redirect.cancelled()).toBe(true)
  })

  it('rejects exceeding the redirect hop cap', async () => {
    const redirect = scriptedResponse({ status: 302, headers: { location: '/next' } })
    const deps = fakeDeps({ respond: () => redirect.response })
    await expect(providerFor(deps, { maxRedirects: 2 }).fetch({ url: `http://${PUBLIC_NAME}/?n=0` }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_REDIRECT_BLOCKED', message: 'exceeded the maximum of 2 redirects' }))
    expect(deps.calls).toHaveLength(3)
  })

  it('follows exactly maxRedirects hops: a chain landing on the Nth redirect succeeds', async () => {
    const deps = fakeDeps({
      respond: ({ url }) => {
        const step = Number(url.searchParams.get('n') ?? '0')
        if (step >= 2) return scriptedResponse({ status: 200, headers: { 'content-type': 'text/plain' }, chunks: [enc('landed')] }).response
        return scriptedResponse({ status: 302, headers: { location: `/?n=${step + 1}` } }).response
      },
    })
    const result = await providerFor(deps, { maxRedirects: 2 }).fetch({ url: `http://${PUBLIC_NAME}/?n=0` })
    expect(result.body.content).toBe('landed')
    expect(deps.calls).toHaveLength(3)
  })

  it('reports an over-limit redirect as "exceeded", not cross-origin, even when the over-limit hop points cross-origin', async () => {
    const deps = fakeDeps({
      respond: (_req, index) => {
        const location = index === 0 ? '/second' : 'https://elsewhere.test/'
        return scriptedResponse({ status: 302, headers: { location } }).response
      },
    })
    await expect(providerFor(deps, { maxRedirects: 1 }).fetch({ url: `http://${PUBLIC_NAME}/?n=0` }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_REDIRECT_BLOCKED', message: 'exceeded the maximum of 1 redirects' }))
  })

  it('maxRedirects: 0 follows no redirect but still fetches a direct 200', async () => {
    const redirect = scriptedResponse({ status: 302, headers: { location: '/done' } })
    const direct = scriptedResponse({ status: 200, headers: { 'content-type': 'text/plain' }, chunks: [enc('direct')] })
    const deps = fakeDeps({ respond: ({ url }) => url.pathname === '/r' ? redirect.response : direct.response })
    await expect(providerFor(deps, { maxRedirects: 0 }).fetch({ url: `http://${PUBLIC_NAME}/r` }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_REDIRECT_BLOCKED' }))
    const landed = await providerFor(deps, { maxRedirects: 0 }).fetch({ url: `http://${PUBLIC_NAME}/done` })
    expect(landed.body.content).toBe('direct')
  })

  it('treats a redirect without a Location header as a provider error and cancels the body', async () => {
    const redirect = scriptedResponse({ status: 302 })
    const deps = fakeDeps({ respond: () => redirect.response })
    await expect(providerFor(deps).fetch({ url: `http://${PUBLIC_NAME}/` }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
    expect(redirect.cancelled()).toBe(true)
  })
})

describe('HttpFetchProvider invalid URLs and abort', () => {
  it('rejects a non-http scheme before any network access', async () => {
    const deps = fakeDeps()
    await expect(providerFor(deps).fetch({ url: 'ftp://example.com' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_INVALID_URL' }))
    expect(deps.calls).toHaveLength(0)
  })

  it('rejects credentials in the URL', async () => {
    const deps = fakeDeps()
    await expect(providerFor(deps).fetch({ url: 'http://user:pass@example.com/' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_BLOCKED_URL' }))
    expect(deps.calls).toHaveLength(0)
  })

  it('honors a pre-aborted signal', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(providerFor(fakeDeps()).fetch({ url: `http://${PUBLIC_NAME}/` }, controller.signal))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_ABORTED' }))
  })

  it('aborts an in-flight request via the signal with WEB_ABORTED', async () => {
    const controller = new AbortController()
    const deps = fakeDeps({
      respond: ({ signal }) => pendingUntilAbort(signal),
    })
    const pending = providerFor(deps).fetch({ url: `http://${PUBLIC_NAME}/` }, controller.signal)
    controller.abort()
    await expect(pending).rejects.toThrow(expect.objectContaining({ code: 'WEB_ABORTED' }))
  })

  it('classifies the provider deadline firing during the request as WEB_FETCH_TIMEOUT', async () => {
    const deps = fakeDeps({
      respond: ({ signal }) => pendingUntilAbort(signal),
    })
    await expect(providerFor(deps, { timeoutMs: 40 }).fetch({ url: `http://${PUBLIC_NAME}/` }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_FETCH_TIMEOUT' }))
  })

  it('classifies the provider deadline firing during the body read as WEB_FETCH_TIMEOUT', async () => {
    const deps = fakeDeps({
      respond: ({ signal }) => ({
        status: 200,
        header: () => 'text/plain',
        nextChunk: () => pendingUntilAbort(signal),
        cancel: () => Promise.resolve(),
      }),
    })
    await expect(providerFor(deps, { timeoutMs: 40 }).fetch({ url: `http://${PUBLIC_NAME}/` }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_FETCH_TIMEOUT' }))
  })

  it('classifies a caller abort during the body read as WEB_ABORTED', async () => {
    const controller = new AbortController()
    const deps = fakeDeps({
      respond: ({ signal }) => ({
        status: 200,
        header: () => 'text/plain',
        nextChunk: () => pendingUntilAbort(signal),
        cancel: () => Promise.resolve(),
      }),
    })
    const pending = providerFor(deps).fetch({ url: `http://${PUBLIC_NAME}/` }, controller.signal)
    controller.abort()
    await expect(pending).rejects.toThrow(expect.objectContaining({ code: 'WEB_ABORTED' }))
  })

  it('maps a mid-read stream fault to WEB_PROVIDER_ERROR', async () => {
    const deps = fakeDeps({
      respond: () => ({
        status: 200,
        header: () => 'text/plain',
        nextChunk: () => Promise.reject(new Error('socket hang up')),
        cancel: () => Promise.resolve(),
      }),
    })
    await expect(providerFor(deps).fetch({ url: `http://${PUBLIC_NAME}/` }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
  })

  it('maps a connection failure to WEB_PROVIDER_ERROR', async () => {
    const deps = fakeDeps({ respond: () => { throw new Error('connect ECONNREFUSED') } })
    await expect(providerFor(deps).fetch({ url: `http://${PUBLIC_NAME}/` }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
  })
})

describe('HttpFetchProvider body cancellation on error paths', () => {
  it('does not let a rejecting body cancel mask a mid-read stream fault', async () => {
    const body = scriptedResponse({
      status: 200,
      headers: { 'content-type': 'text/plain' },
      cancelImpl: () => Promise.reject(new Error('cancel failed')),
    })
    const deps = fakeDeps({
      respond: () => ({
        ...body.response,
        nextChunk: () => Promise.reject(new Error('socket hang up')),
      }),
    })
    await expect(providerFor(deps).fetch({ url: `http://${PUBLIC_NAME}/` }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
    expect(body.cancelled()).toBe(true)
  })
})

describe('web-fetch-http plugin registration', () => {
  it('registers the provider, guards loopback through the seam, and disposes (HMR-safe)', async () => {
    const bench = await boot({})
    await expect(bench.ctx.web.fetch({ url: 'http://127.0.0.1:9/' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_BLOCKED_URL' }))
    await bench.pluginFiber.dispose()
    await expect(bench.ctx.web.fetch({ url: 'http://127.0.0.1:9/' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_CONFIGURED_MISSING' }))
    await bench.ctx.fiber.dispose()
  })

  it('serves a stored limit to the next fetch without re-registering the provider', async () => {
    const bench = await boot({})

    await bench.ctx.settings.update(WEB_FETCH_HTTP_SETTINGS_NAMESPACE, { maxUrlLength: 10 })

    // Sixteen characters: inside the entry cap, over the stored cap — so a
    // rejection here proves the stored value reached the provider, and it
    // fails at URL validation before any network step runs.
    await expect(bench.ctx.web.fetch({ url: 'http://8.8.8.8/x' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_INVALID_URL' }))
    await bench.ctx.fiber.dispose()
  })

  it('falls back to the composition entry when the settings provider detaches', async () => {
    const bench = await boot({})
    await bench.ctx.settings.update(WEB_FETCH_HTTP_SETTINGS_NAMESPACE, { maxUrlLength: 10 })
    await expect(bench.ctx.web.fetch({ url: 'http://8.8.8.8/x' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_INVALID_URL' }))

    await bench.settingsFiber.dispose()

    // The entry cap (2048) admits this URL again; the loopback literal is what
    // rejects it now — proving the stored override no longer applies.
    await expect(bench.ctx.web.fetch({ url: 'http://127.0.0.1:9/x' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_BLOCKED_URL' }))
    await bench.ctx.fiber.dispose()
  })

  it('refuses a stored value the schema cannot express at the write', async () => {
    const bench = await boot({})
    await expect(bench.ctx.settings.update(WEB_FETCH_HTTP_SETTINGS_NAMESPACE, { timeoutMs: 0 }))
      .rejects.toThrow(/timeoutMs must be a positive finite number/)
    await expect(bench.ctx.settings.update(WEB_FETCH_HTTP_SETTINGS_NAMESPACE, { maxRedirects: 1.5 }))
      .rejects.toThrow(/maxRedirects must be a non-negative integer/)
    await bench.ctx.fiber.dispose()
  })

  it('releases the namespace when the plugin unloads', async () => {
    const bench = await boot({})
    expect(bench.ctx.settings.describe().map(row => String(row.ns))).toContain('web-fetch-http')

    await bench.pluginFiber.dispose()

    expect(bench.ctx.settings.describe().map(row => String(row.ns))).not.toContain('web-fetch-http')
    await bench.ctx.fiber.dispose()
  })

  it('has no default export (namespace plugin export shape)', () => {
    expect('default' in fetchPlugin).toBe(false)
  })

  it('rejects a non-positive resource limit at construction', async () => {
    const ctx = new Context()
    await ctx.plugin(WebRuntime, { fetchProvider: LOCAL_FETCH_PROVIDER_ID })
    await expect(ctx.plugin(fetchPlugin, { maxResponseBytes: -1 }))
      .rejects.toThrow(/maxResponseBytes must be a positive finite number/)
    await ctx.fiber.dispose()
  })

  it('rejects a zero timeout at construction', async () => {
    const ctx = new Context()
    await ctx.plugin(WebRuntime, { fetchProvider: LOCAL_FETCH_PROVIDER_ID })
    await expect(ctx.plugin(fetchPlugin, { timeoutMs: 0 }))
      .rejects.toThrow(/timeoutMs must be a positive finite number/)
    await ctx.fiber.dispose()
  })

  it('rejects a timeout beyond Node timer range at construction', async () => {
    const ctx = new Context()
    await ctx.plugin(WebRuntime, { fetchProvider: LOCAL_FETCH_PROVIDER_ID })
    await expect(ctx.plugin(fetchPlugin, { timeoutMs: 2_147_483_648 }))
      .rejects.toThrow(/timeoutMs must be no greater than 2147483647/)
    await ctx.fiber.dispose()
  })

  it('rejects a fractional redirect cap at construction', async () => {
    const ctx = new Context()
    await ctx.plugin(WebRuntime, { fetchProvider: LOCAL_FETCH_PROVIDER_ID })
    await expect(ctx.plugin(fetchPlugin, { maxRedirects: 1.5 }))
      .rejects.toThrow(/maxRedirects must be a non-negative integer/)
    await ctx.fiber.dispose()
  })

  it('rejects a negative redirect cap at construction', async () => {
    const ctx = new Context()
    await ctx.plugin(WebRuntime, { fetchProvider: LOCAL_FETCH_PROVIDER_ID })
    await expect(ctx.plugin(fetchPlugin, { maxRedirects: -1 }))
      .rejects.toThrow(/maxRedirects must be a non-negative integer/)
    await ctx.fiber.dispose()
  })

  it('accepts maxRedirects: 0 (follow no redirects) as valid config and serves the entry without a settings service', async () => {
    const ctx = new Context()
    await ctx.plugin(WebRuntime, { fetchProvider: LOCAL_FETCH_PROVIDER_ID })
    const fiber = await ctx.plugin(fetchPlugin, { maxRedirects: 0 })
    await expect(ctx.web.fetch({ url: 'http://127.0.0.1:9/' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_BLOCKED_URL' }))
    await fiber.dispose()
    await ctx.fiber.dispose()
  })
})
