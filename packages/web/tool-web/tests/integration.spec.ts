/**
 * Integration: the real seam (`dsh-web`) + the model tool (`dsh-tool-web`) + the tool-call
 * timeout policy (`dsh-tool-call-timeout-policy`), exercised through `ctx.tools.execute()` —
 * nothing bypasses the tool registry. Fetch verifies world effects against loopback HTTP
 * through a minimal loopback provider adapter: the real backend's SSRF guard refuses
 * loopback destinations by design, and the guard plus the real transport are
 * `dsh-web-fetch-http`'s own suites. Search uses the real Exa provider with only its
 * network boundary stubbed.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { AddressInfo } from 'node:net'
import { Context } from '@deepseek-ai/cordis'
import { CallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { type ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import WebRuntime from '@deepseek-ai/dsh-web'
import * as WebFetchLocal from '@deepseek-ai/dsh-web-fetch-http'
import { loopbackFetchProvider } from './loopback-fetch-provider.ts'
import * as WebSearchExa from '@deepseek-ai/dsh-web-search-exa'
import * as ToolWeb from '@deepseek-ai/dsh-tool-web'
import * as TimeoutPolicy from '@deepseek-ai/dsh-tool-call-timeout-policy'

const testToolSignal = new AbortController().signal

type Handler = (req: IncomingMessage, res: ServerResponse) => void

let server: Server
let base: string
let handler: Handler
let ctx: Context
let fiber: Awaited<ReturnType<Context['plugin']>>

beforeEach(async () => {
  handler = (_req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<h1>Hello</h1><p>World</p>') }
  server = createServer((req, res) => { handler(req, res) })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

  ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(WebRuntime, { searchProvider: WebSearchExa.EXA_PROVIDER_ID, fetchProvider: WebFetchLocal.LOCAL_FETCH_PROVIDER_ID })
  ctx.web.registerFetchProvider(loopbackFetchProvider())
  await ctx.plugin(WebSearchExa, { apiKey: 'exa-key', baseURL: 'https://api.exa.test' })
  // The shipped deployment shape: the tool-call budget is declared by tool-web
  // config (default 30s, attached as ToolDefinition.timeoutMs) and enforced by
  // the zero-config timeout-policy plugin, set above the provider backstop so the
  // policy normally wins.
  await ctx.plugin(TimeoutPolicy)
  fiber = await ctx.plugin(ToolWeb)
})

afterEach(async () => {
  await fiber.dispose()
  vi.unstubAllGlobals()
  await new Promise<void>(resolve => server.close(() => { resolve() }))
})

let counter = 0
function call(name: string, args: unknown): Promise<ToolExecutionResult> {
  return ctx.tools.execute({ signal: testToolSignal, callId: CallId(`call-${++counter}`), name, arguments: args })
}


describe('web_fetch integration over the real backend', () => {
  it('fetches an html page and renders it to markdown', async () => {
    const out = await call('web_fetch', { url: base })
    expect(out.isError).toBe(false)
    const text = out.content.map(b => b.type === 'text' ? b.text : '').join('')
    expect(text).toContain(`Fetched ${base}`)
    expect(text).toContain('# Hello')
    expect(text).toContain('World')
  })

  it('reports a 404 as a result, not an error', async () => {
    handler = (_req, res) => { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('missing') }
    const out = await call('web_fetch', { url: base })
    expect(out.isError).toBe(false)
    expect(out.content.map(b => b.type === 'text' ? b.text : '').join('')).toContain('HTTP 404')
  })

  it('surfaces WEB_INVALID_URL as a structured tool error', async () => {
    const out = await call('web_fetch', { url: 'ftp://example.com' })
    expect(out.isError).toBe(true)
    expect(out.error?.info?.code).toBe('WEB_INVALID_URL')
  })

})

describe('web_search integration over the real Exa provider', () => {
  it('runs web_search end-to-end and formats the provider result', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ results: [{ url: 'https://result.test', title: 'Result', highlights: ['a highlight'] }] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )))
    const out = await call('web_search', { query: 'deepseek-official' })
    expect(out.isError).toBe(false)
    expect(out.content.map(b => b.type === 'text' ? b.text : '').join('')).toContain('[Result](https://result.test)')
  })
})

describe('tool-call timeout policy over the migrated web tools', () => {
  it('neither model schema exposes a timeout parameter after the migration', () => {
    const byName = new Map(ctx.tools.schemas().map(s => [s.name, s]))
    const fetchParams = byName.get('web_fetch')!.parameters as { properties: Record<string, unknown> }
    const searchParams = byName.get('web_search')!.parameters as { properties: Record<string, unknown> }
    expect(Object.keys(fetchParams.properties)).toEqual(['url'])
    expect('timeout_ms' in fetchParams.properties).toBe(false)
    expect(Object.keys(searchParams.properties)).toEqual(['query'])
  })
})

describe('tool-call timeout returns TOOL_TIMEOUT (deadline wins over a slow fetch)', () => {
  let slowServer: Server
  let slowBase: string
  let openSockets: ServerResponse[]
  let tctx: Context
  let tfiber: Awaited<ReturnType<Context['plugin']>>

  beforeEach(async () => {
    // A server that never responds: it holds the connection open until the
    // client aborts. The cooperative deadline (via exec.signal → the fetch
    // provider → undici) is what ends the call.
    openSockets = []
    slowServer = createServer((_req, res) => { openSockets.push(res) })
    await new Promise<void>(resolve => slowServer.listen(0, '127.0.0.1', resolve))
    slowBase = `http://127.0.0.1:${(slowServer.address() as AddressInfo).port}`

    tctx = new Context()
    await tctx.plugin(SystemPrompt)
    await tctx.plugin(ToolRuntime)
    await tctx.plugin(WebRuntime, { fetchProvider: WebFetchLocal.LOCAL_FETCH_PROVIDER_ID })
    tctx.web.registerFetchProvider(loopbackFetchProvider())
    await tctx.plugin(TimeoutPolicy)
    // The tool-call budget is declared by tool-web config, enforced by the policy.
    tfiber = await tctx.plugin(ToolWeb, { fetchTimeoutMs: 50 })
  })

  afterEach(async () => {
    for (const res of openSockets) res.destroy()
    await tfiber.dispose()
    await new Promise<void>(resolve => slowServer.close(() => { resolve() }))
  })

  it('returns a structured TOOL_TIMEOUT (not the provider WEB_FETCH_TIMEOUT) when the tool-call budget wins', async () => {
    const out = await tctx.tools.execute({ signal: testToolSignal, callId: CallId('slow-1'), name: 'web_fetch', arguments: { url: slowBase } })
    expect(out.isError).toBe(true)
    // The outer tool-call deadline won: TOOL_TIMEOUT, owned by dsh-tool-call-timeout-policy,
    // NOT the provider's own WEB_FETCH_TIMEOUT (its 30s backstop never fired).
    expect(out.error?.info?.code).toBe('TOOL_TIMEOUT')
    const text = out.content.map(b => (b.type === 'text' ? b.text : '')).join('')
    expect(text).toContain('timed out after 50ms')
  })

  // The adapter rejects with WEB_ABORTED when the deadline's signal fires;
  // execute's outer catch turns that into an error result, and the policy —
  // whose timer did fire — replaces it with the structured TOOL_TIMEOUT above.
  // The provider-side backstop classification (WEB_FETCH_TIMEOUT on a direct
  // call) is dsh-web-fetch-http's own suite.
})
