/**
 * Real-socket verification of the production transport: the pinned `lookup`
 * decides which address the socket reaches while URL and Host stay intact,
 * redirects are delivered unfollowed, and cancel/abort release the socket.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { createServer as createHttpsServer, type Server as HttpsServer } from 'node:https'
import { AddressInfo } from 'node:net'
import { guardedRequest, lookupDns } from '../src/transport.ts'
import type { ResolvedAddress } from '../src/transport.ts'

const TEST_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDWd19V8hn2pJVZ
lCuVk3ag0kyRBrK/tahtlaJxyCctizcKXu2HqkSCX5oyw+ybd7OVjIbtrC9XhG2A
bYtNjQRO2um73hj8A7OQYpfZBDzMd2g9Ms8sRNUuKwuS8PB7Le/n5gDvQRlk/s41
tBIhlg275onf213joYyZM5M+WArPVA3GOAf72ZGtwIU5ExSb51LA2Vp/F+Pv3TrR
Eg/fwwWytaoy4zo6vCBqsp1HmLYqNLVCtVXSwQLDWfyiiAVMknUjipyD7zw6S5lT
vLuWLaqCEDNf5nZeCWSjQWVZjUUE0Pr9FEXnzd3STe4pk6248PIhYz8LjLN4Ppdc
aAb0kh5dAgMBAAECggEAdA+BrjcoSctjb2i59WYqCnoEKW+giBK8pSEXGdAhM4pl
LN2WWZaRIKSwA8z3XGL48nNsCW7m58uonpmpizxHGo1pc9uLVcaDBB324uBiLpxn
8sZuSxys6SEuUETHP0Hq1GoqE0/9eCRUX8elEDvuDsOB1X0XYDpqpfW9Nz3aC7wI
7PUarIVew3HePN3oKRrSiuP3ZpPW/13hcxYNKhX5mLG8Sf2HMvpjPJe7OXV3pWom
JD5pkSGqqqhPDlaSPd/5WqZW7P05z2DiceFhSXS3WPPQNcF+SMzivCNXGbT3oNEZ
8a11AQGWKJLLjKqXfX+XoMKdqzWSfB1/ffErooN9WQKBgQD4/SN2DawtTRKkFHRa
U7T068EQv6n5REyMVaZmi0I2P7Z6i4wHLpc1c5/yZH6oHGgR4+4pcdDW9PCIkhoi
f89O7iEkqDZhMvPI30G+aC192hQAbUQqWgrFAh7xKMgKwQlQQo8jIs7q1BAPu/FR
0FiV4/Fa3esac/MtvhiNdd2+/wKBgQDcgV/uNdbO1wYhmJnIc4NfGtkC60cv3o//
RoPPyZ39EDL9vBZFP39RGGZFEsQBlsXmS1tr9a55AnZgQLi4SBN+QGLF1XwHiBiO
L8O9ZNDGKREUfXwrkzHj8wgR16swb2bAB/JT2YyMC9ko8C5j/gZ8uCNEjoE0aXqq
Zf1Km6B+owKBgQDj4GmwBdtqqntBCCdk8+9NqObNuVyK8eNNHKZqe1Fh7PXJOiYx
/IYPOX9NjIQOv9DPbtftvmjwEsSBeZXJtUe6aV6T+g+q7cMIOKwm45me8RQVP+t/
B2GL5OEEvdo3XWx0tDXkZlsRuHvqqou14QTySef+zdP6JdyOJMi7zv/faQKBgFka
wpwtD2+n/mdHFiWlYBnnbHg8gRi79C5w3UTzMS+ZAzH7dnhnL1ii5njVG3WU6sWj
//6BWg62SwWcQcjd/1qORBuzqBoXCe0zKgL3oVHiOG+yQaIOKiP2CnXDU/8PlVLW
Izt09tGE3C0p2WU4uoBdnIrQly+JzDLdYdxrRRDHAoGAae9lTF3WsFKFDgbi/JvR
iwEbYN3AHUzAxhQcZ9qlrqAWBRRLGhppxqrFk2ZQssigDx6KZHRD2g/NYABaYp4E
/urpb/riSeomlzCpgF6TLcwFdomV5929xs6ThWGSKb8EwaA1SfAxWNUoZAsS0emR
Q1u8YSBHk9YFq47ZnNHAuWU=
-----END PRIVATE KEY-----`

const TEST_CERT = `-----BEGIN CERTIFICATE-----
MIIC4TCCAcmgAwIBAgIUbfwcQxcF4IqJkw1zkiG97YRRTrcwDQYJKoZIhvcNAQEL
BQAwADAeFw0yNjEwMTYyMzIxNDBaFw0zNjEwMTMyMzIxNDBaMAAwggEiMA0GCSqG
SIb3DQEBAQUAA4IBDwAwggEKAoIBAQDWd19V8hn2pJVZlCuVk3ag0kyRBrK/taht
laJxyCctizcKXu2HqkSCX5oyw+ybd7OVjIbtrC9XhG2AbYtNjQRO2um73hj8A7OQ
YpfZBDzMd2g9Ms8sRNUuKwuS8PB7Le/n5gDvQRlk/s41tBIhlg275onf213joYyZ
M5M+WArPVA3GOAf72ZGtwIU5ExSb51LA2Vp/F+Pv3TrREg/fwwWytaoy4zo6vCBq
sp1HmLYqNLVCtVXSwQLDWfyiiAVMknUjipyD7zw6S5lTvLuWLaqCEDNf5nZeCWSj
QWVZjUUE0Pr9FEXnzd3STe4pk6248PIhYz8LjLN4PpdcaAb0kh5dAgMBAAGjUzBR
MB0GA1UdDgQWBBQSs3ueAdqUk7tzNK6a8xkZap1NbDAfBgNVHSMEGDAWgBQSs3ue
AdqUk7tzNK6a8xkZap1NbDAPBgNVHRMBAf8EBTADAQH/MA0GCSqGSIb3DQEBCwUA
A4IBAQDH633tTtWm1h/EEVN2u6gy24r0tGTUxKzXWDl45lPfiCucxSsLk0rxKurd
ITt5f38yWe7KvMBJ+P262lAmK5oqqPQNTBDZwmBURJckhyDIxYq7WLr7rzdDnoTC
Ef68P3kozs/iWNVTyz+n5I5RG/GzoZvyo2UdbXFhUYGgXRpSXZu4slj6WvUipYNI
k1AYtOdP13q//JCeEr8xtf5+ZulUcMOdvjAfU/OMnG8Afm/kn2BZAG8Lb7Ly4lE0
mPUGLXY5vAByDtHyln36Hhuzf8H7FEgpNfJcc3p2wu9yZG5SFbVKIpopzSu/rQ07
rTHkVR2+N8OfGpApdsd2z+K7Rv7v
-----END CERTIFICATE-----`

type Handler = (req: IncomingMessage, res: ServerResponse) => void

let server: Server
let port: number
let handler: Handler

const LOOPBACK: ResolvedAddress = { address: '127.0.0.1', family: 4 }

beforeEach(async () => {
  handler = (_req, res) => { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('default') }
  server = createServer((req, res) => { handler(req, res) })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  port = (server.address() as AddressInfo).port
})

afterEach(async () => {
  await new Promise<void>(resolve => server.close(() => { resolve() }))
})

async function readAll(response: Awaited<ReturnType<typeof guardedRequest>>): Promise<string> {
  const parts: Uint8Array[] = []
  for (;;) {
    const next = await response.nextChunk()
    if (next.done) break
    parts.push(next.value)
  }
  return new TextDecoder().decode(concat(parts))
}

function concat(parts: Uint8Array[]): Uint8Array {
  const bytes = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0))
  let offset = 0
  for (const part of parts) {
    bytes.set(part, offset)
    offset += part.byteLength
  }
  return bytes
}

describe('guardedRequest over real sockets', () => {
  it('performs a GET and exposes status, headers, and the chunked body', async () => {
    handler = (_req, res) => {
      // set-cookie is the header the client parser keeps as an array; every
      // other repeated value arrives pre-joined.
      res.setHeader('set-cookie', ['a=1', 'b=2'])
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('hello pinned world')
    }
    const response = await guardedRequest(new URL(`http://127.0.0.1:${port}/body`), LOOPBACK, new AbortController().signal, {
      'user-agent': 'test-agent/1.0',
    })
    expect(response.status).toBe(200)
    expect(response.header('content-type')).toBe('text/plain; charset=utf-8')
    expect(response.header('set-cookie')).toBe('a=1, b=2')
    expect(response.header('x-absent')).toBeNull()
    expect(await readAll(response)).toBe('hello pinned world')
  })

  it('reaches the pinned address for a name-based URL while Host stays the URL host', async () => {
    let seenHost: string | undefined
    let seenAgent: string | undefined
    handler = (req, res) => {
      seenHost = req.headers.host
      seenAgent = req.headers['user-agent']
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.end('reached')
    }
    const response = await guardedRequest(new URL(`http://web-fetch-http.test:${port}/pinned`), LOOPBACK, new AbortController().signal, {
      'user-agent': 'test-agent/1.0',
    })
    expect(response.status).toBe(200)
    expect(await readAll(response)).toBe('reached')
    expect(seenHost).toBe(`web-fetch-http.test:${port}`)
    expect(seenAgent).toBe('test-agent/1.0')
  })

  it('connects to a pinned IPv6 address', async () => {
    const server6: Server = createServer((_req, res) => { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('v6') })
    await new Promise<void>(resolve => server6.listen(0, '::1', resolve))
    try {
      const port6 = (server6.address() as AddressInfo).port
      const response = await guardedRequest(
        new URL(`http://[::1]:${port6}/`),
        { address: '::1', family: 6 },
        new AbortController().signal,
        {},
      )
      expect(await readAll(response)).toBe('v6')
    } finally {
      await new Promise<void>(resolve => server6.close(() => { resolve() }))
    }
  })

  it('delivers a redirect status unfollowed with its Location header', async () => {
    handler = (_req, res) => { res.writeHead(302, { location: '/elsewhere' }); res.end() }
    const response = await guardedRequest(new URL(`http://127.0.0.1:${port}/jump`), LOOPBACK, new AbortController().signal, {})
    expect(response.status).toBe(302)
    expect(response.header('location')).toBe('/elsewhere')
    await response.cancel()
  })

  it('resolves a request URL without an explicit port (default-port form)', async () => {
    const controller = new AbortController()
    controller.abort()
    // The default-port branch runs while building the request; the pre-aborted
    // signal rejects it before any connection is attempted.
    await expect(guardedRequest(new URL('http://127.0.0.1/'), LOOPBACK, controller.signal, {}))
      .rejects.toThrow()
  })

  it('rejects on connection refusal', async () => {
    await expect(guardedRequest(new URL('http://127.0.0.1:1/'), { address: '127.0.0.1', family: 4 }, new AbortController().signal, {}))
      .rejects.toThrow()
  })

  it('rejects when the signal aborts mid-request', async () => {
    handler = (_req, _res) => { /* never responds */ }
    const controller = new AbortController()
    const pending = guardedRequest(new URL(`http://127.0.0.1:${port}/hang`), LOOPBACK, controller.signal, {})
    controller.abort()
    await expect(pending).rejects.toThrow()
  })

  it('cancels a streaming body and resolves the cancel promise', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.write('partial')
      // The body never ends; cancel() must still settle.
    }
    const response = await guardedRequest(new URL(`http://127.0.0.1:${port}/stream`), LOOPBACK, new AbortController().signal, {})
    const first = await response.nextChunk()
    expect(first.done).toBe(false)
    await response.cancel()
    await response.cancel()
  })

  it('resolves cancel immediately for a fully received body', async () => {
    handler = (_req, res) => { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('done') }
    const response = await guardedRequest(new URL(`http://127.0.0.1:${port}/full`), LOOPBACK, new AbortController().signal, {})
    expect(await readAll(response)).toBe('done')
    await response.cancel()
  })
})

describe('guardedRequest over TLS', () => {
  it('keeps the URL hostname for the TLS handshake while connecting to the pinned address', async () => {
    const previousReject = process.env.NODE_TLS_REJECT_UNAUTHORIZED
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
    const tlsServer: HttpsServer = createHttpsServer(
      { key: TEST_KEY, cert: TEST_CERT },
      (_req, res) => { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('over tls') },
    )
    await new Promise<void>(resolve => tlsServer.listen(0, '127.0.0.1', resolve))
    try {
      const tlsPort = (tlsServer.address() as AddressInfo).port
      let sni: string | false | null | undefined
      tlsServer.on('tlsClientError', () => {})
      tlsServer.on('secureConnection', (tlsSocket) => { sni = tlsSocket.servername })
      const response = await guardedRequest(
        new URL(`https://web-fetch-http.test:${tlsPort}/secure`),
        LOOPBACK,
        new AbortController().signal,
        {},
      )
      expect(response.status).toBe(200)
      expect(await readAll(response)).toBe('over tls')
      expect(sni).toBe('web-fetch-http.test')
    } finally {
      if (previousReject === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED
      else process.env.NODE_TLS_REJECT_UNAUTHORIZED = previousReject
      await new Promise<void>(resolve => tlsServer.close(() => { resolve() }))
    }
  })
})

describe('lookupDns', () => {
  it('resolves address literals to every family without touching a resolver', async () => {
    await expect(lookupDns('127.0.0.1')).resolves.toEqual([{ address: '127.0.0.1', family: 4 }])
    await expect(lookupDns('::1')).resolves.toEqual([{ address: '::1', family: 6 }])
  })
})
