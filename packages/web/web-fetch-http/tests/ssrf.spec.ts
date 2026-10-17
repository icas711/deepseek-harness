/**
 * The SSRF guard invariant: the provider refuses private, loopback,
 * link-local, metadata, and multicast destinations — on direct URLs, on every
 * DNS answer, and on every same-origin redirect target — and pins each
 * connection to the address it validated, so DNS cannot re-resolve the socket
 * elsewhere after the check.
 */

import { describe, expect, it } from 'vitest'
import { HttpFetchProvider } from '@deepseek-ai/dsh-web-fetch-http'
import type { HttpFetchDeps } from '../src/transport.ts'
import type { ParsedIp } from '../src/policy.ts'
import { isBlockedIp, parseIpLiteral, stripLiteralDecorations } from '../src/policy.ts'
import { enc, fakeDeps, limits, pendingUntilAbort, PUBLIC_V4, PUBLIC_V4_URL, scriptedResponse } from './fake-transport.ts'

/** Parse a host for the tables below, failing the test when it is not a literal. */
function literal(host: string): ParsedIp {
  const parsed = parseIpLiteral(host)
  expect(parsed, host).toBeDefined()
  return parsed as ParsedIp
}

describe('parseIpLiteral', () => {
  it('parses canonical IPv4 and IPv6 forms, including compressed and embedded ones', () => {
    expect(parseIpLiteral('1.2.3.4')).toEqual({ family: 4, value: 0x01020304n })
    expect(parseIpLiteral('::1')).toEqual({ family: 6, value: 1n })
    expect(parseIpLiteral('0:0:0:0:0:0:0:1')).toEqual({ family: 6, value: 1n })
    expect(parseIpLiteral('2606:4700::1111')).toEqual({ family: 6, value: 0x26064700000000000000000000001111n })
    expect(parseIpLiteral('::ffff:1.2.3.4')).toEqual({ family: 6, value: 0xffff01020304n })
    expect(parseIpLiteral('64:ff9b::192.0.2.9')).toEqual({
      family: 6,
      value: (0x64n << 112n) | (0xff9bn << 96n) | (0xc000n << 16n) | 0x209n,
    })
  })

  it('strips zone ids and URL brackets from host strings', () => {
    expect(stripLiteralDecorations('fe80::1%25eth0')).toBe('fe80::1')
    expect(stripLiteralDecorations('fe80::1%eth0')).toBe('fe80::1')
    expect(stripLiteralDecorations('[::1]')).toBe('::1')
    expect(stripLiteralDecorations('1.2.3.4')).toBe('1.2.3.4')
    expect(parseIpLiteral('fe80::1%25eth0')).toEqual({ family: 6, value: 0xfe800000000000000000000000000001n })
    expect(parseIpLiteral('[::ffff:127.0.0.1]')).toEqual({ family: 6, value: 0xffff7f000001n })
  })

  it('leaves non-literals to DNS by returning undefined', () => {
    const malformed = [
      'example.com',
      'a.b.c.d',
      '1.2.3',
      '1.2.3.4.5',
      '256.1.1.1',
      '01.2.3.4',
      '1:2',
      'zz::1',
      '1::2::3',
      ':1:2',
      '1.2.3.4:5',
      '::1.2.3.256',
      '12345::',
      '::1:2:3:4:5:6:7:8:9',
    ]
    for (const host of malformed) expect(parseIpLiteral(host), host).toBeUndefined()
  })
})

describe('isBlockedIp ranges', () => {
  it('blocks every private, loopback, link-local, metadata, multicast, and reserved IPv4 range', () => {
    const blocked = [
      '0.0.0.0',
      '0.1.2.3',
      '10.0.0.1',
      '10.255.255.255',
      '127.0.0.1',
      '127.255.255.254',
      '169.254.0.0',
      '169.254.169.254',
      '172.16.0.0',
      '172.31.255.255',
      '192.168.0.0',
      '192.168.255.255',
      '224.0.0.1',
      '239.255.255.255',
      '240.0.0.1',
      '255.255.255.255',
    ]
    for (const host of blocked) expect(isBlockedIp(literal(host)), host).toBe(true)
  })

  it('allows public IPv4 just outside every blocked range', () => {
    const allowed = [
      '1.1.1.1',
      '8.8.8.8',
      '9.255.255.255',
      '11.0.0.1',
      '126.255.255.255',
      '128.0.0.1',
      '169.255.0.1',
      '172.15.255.255',
      '172.32.0.0',
      '192.167.255.255',
      '192.169.0.0',
      '223.255.255.255',
    ]
    for (const host of allowed) expect(isBlockedIp(literal(host)), host).toBe(false)
  })

  it('blocks IPv6 loopback, link-local, unique-local, multicast, and embedded IPv4 forms', () => {
    const blocked = [
      '::',
      '::1',
      '0:0:0:0:0:0:0:1',
      '::7f00:1',
      '::127.0.0.1',
      '::ffff:127.0.0.1',
      '::ffff:7f00:1',
      '::ffff:169.254.169.254',
      '64:ff9b::127.0.0.1',
      'fe80::1',
      'fe80::1%25eth0',
      'fe80::1%eth0',
      'fc00::1',
      'fd12:3456:789a::1',
      'ff01::1',
      'ff0e::1',
    ]
    for (const host of blocked) expect(isBlockedIp(literal(host)), host).toBe(true)
  })

  it('allows public IPv6, including a public embedded IPv4 tail', () => {
    const allowed = ['2606:4700::1111', '2001:db8::1', '2001:4860:4860::8888', '2a02:6b8::1', '::ffff:8.8.8.8', '64:ff9b::8.8.8.8']
    for (const host of allowed) expect(isBlockedIp(literal(host)), host).toBe(false)
  })
})

describe('the SSRF guard in fetch', () => {
  function providerFor(deps: HttpFetchDeps): HttpFetchProvider {
    return new HttpFetchProvider(() => ({ ...limits }), deps)
  }

  it('rejects direct URLs into blocked ranges before any request or DNS step', async () => {
    const hosts = [
      '127.0.0.1',
      '0.0.0.0',
      '10.1.2.3',
      '172.16.0.5',
      '172.31.255.255',
      '192.168.1.1',
      '169.254.169.254',
      '224.0.0.1',
      '255.255.255.255',
      '[::1]',
      '[0:0:0:0:0:0:0:1]',
      '[::ffff:127.0.0.1]',
      '[fe80::1]',
    ]
    for (const host of hosts) {
      const deps = fakeDeps({ lookup: async () => { throw new Error('dns must not run for literals') } })
      await expect(providerFor(deps).fetch({ url: `http://${host}/` }))
        .rejects.toThrow(expect.objectContaining({ code: 'WEB_BLOCKED_URL' }))
      expect(deps.calls, host).toHaveLength(0)
    }
  })

  it('rejects non-canonical IPv4 spellings the URL parser canonicalizes into loopback', async () => {
    const deps = fakeDeps({ lookup: async () => { throw new Error('dns must not run for literals') } })
    for (const url of ['http://0x7f000001/', 'http://2130706433/', 'http://0177.0.0.1/']) {
      await expect(providerFor(deps).fetch({ url }))
        .rejects.toThrow(expect.objectContaining({ code: 'WEB_BLOCKED_URL' }))
    }
    expect(deps.calls).toHaveLength(0)
  })

  it('rejects a URL carrying an IPv6 zone id before any network step', async () => {
    // Node's URL parser refuses zone ids outright; the guard still classifies
    // zone-bearing literal host strings, which is what a DNS answer or a
    // pre-parsed hostname would carry.
    const deps = fakeDeps()
    await expect(providerFor(deps).fetch({ url: 'http://[fe80::1%25eth0]/' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_INVALID_URL' }))
    expect(deps.calls).toHaveLength(0)
    expect(isBlockedIp(parseIpLiteral('fe80::1%25eth0') as ParsedIp)).toBe(true)
  })

  it('connects a public literal to itself without a DNS step', async () => {
    const ok = scriptedResponse({ status: 200, headers: { 'content-type': 'text/plain' }, chunks: [enc('ok')] })
    const deps = fakeDeps({ lookup: async () => { throw new Error('dns must not run for literals') }, respond: () => ok.response })
    const result = await providerFor(deps).fetch({ url: PUBLIC_V4_URL })
    expect(result.statusCode).toBe(200)
    expect(deps.calls[0]?.pinned).toEqual({ address: '93.184.216.34', family: 4 })
  })

  it('connects a public IPv6 literal pinned to its own address', async () => {
    const ok = scriptedResponse({ status: 200, headers: { 'content-type': 'text/plain' }, chunks: [enc('ok')] })
    const deps = fakeDeps({ respond: () => ok.response })
    await providerFor(deps).fetch({ url: 'http://[2606:4700::1111]/' })
    expect(deps.calls[0]?.pinned).toEqual({ address: '2606:4700::1111', family: 6 })
  })

  it('rejects a name resolving only to private addresses', async () => {
    const deps = fakeDeps({ answers: [{ address: '10.0.0.1', family: 4 }, { address: '192.168.0.1', family: 4 }] })
    await expect(providerFor(deps).fetch({ url: 'http://internal.example.test/' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_BLOCKED_URL' }))
    expect(deps.calls).toHaveLength(0)
  })

  it('rejects a name resolving only to addresses the parser cannot classify', async () => {
    const deps = fakeDeps({ answers: [{ address: 'not-an-address', family: 4 }] })
    await expect(providerFor(deps).fetch({ url: 'http://weird.example.test/' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_BLOCKED_URL' }))
    expect(deps.calls).toHaveLength(0)
  })

  it('pins a mixed public/private answer set to the first public address', async () => {
    const ok = scriptedResponse({ status: 200, headers: { 'content-type': 'text/plain' }, chunks: [enc('ok')] })
    const deps = fakeDeps({
      answers: [{ address: '10.0.0.1', family: 4 }, { address: PUBLIC_V4, family: 4 }],
      respond: () => ok.response,
    })
    await providerFor(deps).fetch({ url: 'http://mixed.example.test/' })
    expect(deps.calls[0]?.pinned.address).toBe(PUBLIC_V4)
  })

  it('pins the request to the validated answer so a later re-resolution cannot move the socket', async () => {
    const ok = scriptedResponse({ status: 200, headers: { 'content-type': 'text/plain' }, chunks: [enc('ok')] })
    const deps = fakeDeps({ respond: () => ok.response })
    await providerFor(deps).fetch({ url: 'http://rebind.example.test/' })
    expect(deps.calls).toHaveLength(1)
    expect(deps.calls[0]?.pinned).toEqual({ address: PUBLIC_V4, family: 4 })
  })

  it('re-checks a same-origin redirect target after DNS and never contacts it when blocked', async () => {
    let dnsCalls = 0
    const first = scriptedResponse({ status: 302, headers: { location: '/next' } })
    const deps = fakeDeps({
      lookup: async () => {
        dnsCalls++
        return dnsCalls === 1 ? [{ address: PUBLIC_V4, family: 4 }] : [{ address: '10.9.9.9', family: 4 }]
      },
      respond: () => first.response,
    })
    await expect(providerFor(deps).fetch({ url: 'http://shifty.example.test/start' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_BLOCKED_URL' }))
    expect(deps.calls).toHaveLength(1)
    expect(dnsCalls).toBe(2)
  })
})

describe('DNS-failure classification', () => {
  function providerWith(deps: HttpFetchDeps, timeoutMs = limits.timeoutMs): HttpFetchProvider {
    return new HttpFetchProvider(() => ({ ...limits, timeoutMs }), deps)
  }

  it('maps a resolver failure without abort to WEB_PROVIDER_ERROR', async () => {
    const deps = fakeDeps({ lookup: async () => { throw new Error('getaddrinfo ENOTFOUND missing.example.test') } })
    await expect(providerWith(deps).fetch({ url: 'http://missing.example.test/' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
  })

  it('classifies a timeout that elapses during DNS as WEB_FETCH_TIMEOUT', async () => {
    const deps = fakeDeps({
      lookup: () => new Promise(resolve => setTimeout(() => resolve([{ address: PUBLIC_V4, family: 4 }]), 300)),
      respond: ({ signal }) => {
        // The real transport rejects an already-aborted signal instead of
        // connecting; the scripted responder mirrors that.
        if (signal.aborted) throw new Error('AbortError')
        throw new Error('unreachable')
      },
    })
    await expect(providerWith(deps, 40).fetch({ url: 'http://slow-dns.example.test/' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_FETCH_TIMEOUT' }))
  })

  it('classifies a caller abort during DNS as WEB_ABORTED', async () => {
    const controller = new AbortController()
    const deps = fakeDeps({
      lookup: () => pendingUntilAbort(controller.signal, () => new Error('cancelled')),
    })
    const pending = providerWith(deps).fetch({ url: 'http://aborted-dns.example.test/' }, controller.signal)
    controller.abort()
    await expect(pending).rejects.toThrow(expect.objectContaining({ code: 'WEB_ABORTED' }))
  })

  it('reports an empty answer set as a provider error, not a block', async () => {
    const deps = fakeDeps({ answers: [] })
    await expect(providerWith(deps).fetch({ url: 'http://empty.example.test/' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR', message: 'dns returned no addresses for "empty.example.test"' }))
  })
})
