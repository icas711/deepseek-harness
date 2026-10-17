/**
 * Production DNS and HTTP(S) transport for the fetch provider's SSRF guard.
 * Hostnames resolve through `node:dns`, and each request connects to the exact
 * address the guard validated via a custom `lookup` — the transport never
 * re-resolves, so DNS rebinding between validation and connection cannot move
 * the socket. TLS keeps the URL hostname for Server Name Indication and
 * certificate verification.
 * @module @deepseek-ai/dsh-web-fetch-http/transport
 */

import * as dns from 'node:dns'
import * as http from 'node:http'
import * as https from 'node:https'
import type { IncomingMessage } from 'node:http'
import type { IpFamily } from './policy.ts'

/** One address DNS reported for a hostname. */
export interface ResolvedAddress {
  /** The address text, canonical and zone-free. */
  readonly address: string
  /** Address family of {@link address}. */
  readonly family: IpFamily
}

/**
 * Resolve a hostname to every address DNS reports. The caller checks the
 * answers and pins one; the resolver is the only DNS step of a request.
 * @param hostname - the host to resolve (never an IP literal — the caller
 *   classifies those without DNS).
 * @returns every reported address.
 */
export type DnsResolver = (hostname: string) => Promise<readonly ResolvedAddress[]>

/**
 * The response view the provider consumes: status, selected headers, chunked
 * body access, and cancellation that releases the socket without reading it.
 */
export interface GuardedResponse {
  /** HTTP status code of the response. */
  readonly status: number
  /**
   * One response header value.
   * @param name - lower-case header name.
   * @returns the (joined, when repeated) value, or `null` when absent.
   */
  header(name: string): string | null
  /**
   * Await the next body chunk.
   * @returns the next chunk, or a done result at the end of the body.
   */
  nextChunk(): Promise<IteratorResult<Uint8Array>>
  /**
   * Release the response and its socket without reading the remaining body.
   * Idempotent; never rejects.
   * @returns when the underlying message is closed.
   */
  cancel(): Promise<void>
}

/**
 * Issue one request to `url`, connecting to the guard-validated
 * `pinned` address instead of resolving again.
 * @param url - the absolute request URL (scheme, host, port, path, query).
 * @param pinned - the address the guard validated for `url`'s hostname.
 * @param signal - cancellation signal; aborting rejects the request and any
 *   pending body read.
 * @param headers - request headers (user agent, accept).
 * @returns the response headers with a readable body.
 */
export type GuardedRequest = (
  url: URL,
  pinned: ResolvedAddress,
  signal: AbortSignal,
  headers: Record<string, string>,
) => Promise<GuardedResponse>

/** The DNS and request pair the provider composes; fakes replace it in tests. */
export interface HttpFetchDeps {
  /** The resolver every hostname lookup goes through. */
  readonly lookup: DnsResolver
  /** The transport every request goes through. */
  readonly request: GuardedRequest
}

/**
 * `node:dns` resolver returning every address in the server's order.
 * @param hostname - the host to resolve.
 * @returns every reported address.
 */
export const lookupDns: DnsResolver = async (hostname) => {
  const answers = await dns.promises.lookup(hostname, { all: true, verbatim: true })
  return answers.map(answer => ({ address: answer.address, family: answer.family === 6 ? 6 : 4 }))
}

/**
 * The production `GuardedRequest`: `node:http`/`node:https` with a `lookup`
 * that returns the validated address verbatim. Redirects are never followed
 * here — the provider owns redirect policy.
 * @param url - the absolute request URL.
 * @param pinned - the validated address to connect to.
 * @param signal - cancellation signal.
 * @param headers - request headers.
 * @returns the response.
 */
export const guardedRequest: GuardedRequest = (url, pinned, signal, headers) =>
  new Promise((resolve, reject) => {
    const secure = url.protocol === 'https:'
    const request = (secure ? https : http).request(
      {
        method: 'GET',
        host: url.hostname,
        port: url.port === '' ? undefined : Number(url.port),
        path: `${url.pathname}${url.search}`,
        signal,
        headers,
        // One validated address, one connect attempt: autoSelectFamily's
        // attempt-set logic has nothing to choose between.
        autoSelectFamily: false,
        // The guard validated `pinned`; returning it verbatim pins the socket
        // to the checked address regardless of what DNS would answer now.
        // Node requests the `all: true` list form when autoSelectFamily drives
        // the connect; the classic path expects a single address.
        lookup: (_host, options, callback) => {
          /* v8 ignore next 4 -- autoSelectFamily is off: Node takes the single-address form; the list form stays for other defaults. */
          if (options.all === true) {
            const listForm = callback as unknown as (error: null, addresses: ReadonlyArray<{ address: string; family: number }>) => void
            listForm(null, [{ address: pinned.address, family: pinned.family }])
            return
          }
          callback(null, pinned.address, pinned.family)
        },
      } as http.RequestOptions,
      response => resolve(responseFor(response)),
    )
    request.on('error', reject)
    request.end()
  })

/**
 * The production dependency pair.
 * @returns `node:dns` resolution and the `node:http`/`node:https` transport.
 */
export function defaultHttpFetchDeps(): HttpFetchDeps {
  return { lookup: lookupDns, request: guardedRequest }
}

/** Project a delivered `IncomingMessage` onto the {@link GuardedResponse} view. */
function responseFor(message: IncomingMessage): GuardedResponse {
  /* v8 ignore next -- a delivered response always carries a status line. */
  const status = message.statusCode ?? 0
  const chunks = message[Symbol.asyncIterator]()
  let cancelled: Promise<void> | undefined
  return {
    status,
    header(name: string): string | null {
      const value = message.headers[name.toLowerCase()]
      if (value === undefined) return null
      return Array.isArray(value) ? value.join(', ') : value
    },
    nextChunk: () => chunks.next(),
    cancel: () => {
      cancelled ??= new Promise<void>((resolve) => {
        // A fully received body is already closed; otherwise destroying the
        // message always ends in 'close'.
        if (message.complete) {
          resolve()
          return
        }
        message.once('close', () => resolve())
        message.destroy()
      })
      return cancelled
    },
  }
}
