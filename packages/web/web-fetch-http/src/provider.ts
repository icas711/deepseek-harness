/**
 * Safe HTTP(S) retrieval for `ctx.web`: validates URLs, refuses non-public
 * addresses after DNS resolution and connects to the validated address,
 * follows only same-origin redirects with per-hop re-validation, enforces time
 * and size limits, classifies and decodes text, and leaves presentation to
 * `@deepseek-ai/dsh-tool-web`. Requests carry no browser cookies or ambient
 * credentials.
 * @module @deepseek-ai/dsh-web-fetch-http/provider
 */

import { WebError } from '@deepseek-ai/dsh-web'
import type { WebFetchBody, WebFetchProvider, WebFetchRequest, WebFetchResult } from '@deepseek-ai/dsh-web'
import { deadline, timeoutOf } from '@deepseek-ai/dsh-timeout'
import {
  classifyContentType,
  decoderForCharset,
  isBlockedIp,
  isSameOrigin,
  parseCharset,
  parseIpLiteral,
  stripLiteralDecorations,
  validateFetchUrl,
} from './policy.ts'
import type { GuardedResponse, HttpFetchDeps, ResolvedAddress } from './transport.ts'
import { defaultHttpFetchDeps } from './transport.ts'

/** Resolved provider limits (the plugin's schemastery Config supplies defaults). */
export interface HttpFetchLimits {
  /** Maximum accepted request URL length. */
  maxUrlLength: number
  /** Maximum response body size in bytes (read is aborted past this). */
  maxResponseBytes: number
  /** Maximum decoded body length in characters (truncated past this). */
  maxBodyChars: number
  /** Default fetch timeout in milliseconds. */
  timeoutMs: number
  /** Maximum number of (same-origin) redirect hops to follow. */
  maxRedirects: number
  /** `User-Agent` header sent on every request. */
  userAgent: string
}

/** Fixed content-negotiation header: decodable text only, JSON preferred after HTML. */
const ACCEPT_HEADER = 'text/html,application/xhtml+xml,text/*;q=0.9,application/json;q=0.8'

/** Stable id this provider registers under. */
export const LOCAL_FETCH_PROVIDER_ID = 'http'

/**
 * The anonymous public HTTP(S) fetch provider. Its SSRF guard refuses private,
 * loopback, link-local, metadata, and multicast destinations — checked on the
 * literal host, on every DNS answer, and again on every same-origin redirect
 * target — and pins each connection to the validated address, so a name that
 * re-resolves after validation cannot reroute the socket (DNS rebinding).
 * SSRF-защита реализована и покрыта тестами: предупреждение «do not enable»
 * снято, провайдер пригоден для монтажа там, где цель запроса выбирает модель.
 */
export class HttpFetchProvider implements WebFetchProvider {
  readonly id = LOCAL_FETCH_PROVIDER_ID

  /**
   * @param limits - thunk returning the active limits; read once per fetch, so
   *   a settings change applies from the next fetch without re-registration.
   * @param deps - DNS and transport pair; the production default resolves
   *   through `node:dns` and connects via `node:http`/`node:https`.
   */
  constructor(
    private readonly limits: () => HttpFetchLimits,
    private readonly deps: HttpFetchDeps = defaultHttpFetchDeps(),
  ) {}

  /** No credentials to check — an anonymous public fetcher is always usable. */
  available(): boolean {
    return true
  }

  async fetch(request: WebFetchRequest, signal?: AbortSignal): Promise<WebFetchResult> {
    if (signal?.aborted) throw new WebError('web fetch aborted', 'WEB_ABORTED')
    // One limits snapshot per operation: a concurrent settings change applies
    // to the next fetch, never to a mid-read mix.
    const limits = this.limits()
    // One signal stops the request and the body read. The deadline's TimeoutReason later
    // distinguishes this provider's timeout from caller or outer-deadline cancellation.
    using d = deadline(signal, limits.timeoutMs, 'WEB_FETCH_TIMEOUT')
    return await this.followAndRead(request.url, limits, d.signal)
  }

  /** Follow same-origin redirects up to the hop cap, then read the final response. */
  private async followAndRead(initialUrl: string, limits: HttpFetchLimits, signal: AbortSignal): Promise<WebFetchResult> {
    let currentUrl = validateFetchUrl(initialUrl, limits.maxUrlLength)
    let redirectsFollowed = 0

    for (;;) {
      const response = await this.requestOnce(currentUrl, limits, signal)

      if (isRedirectStatus(response.status)) {
        // Enforce the redirect budget before resolving or validating the next hop.
        if (redirectsFollowed >= limits.maxRedirects) {
          await response.cancel()
          throw new WebError(`exceeded the maximum of ${limits.maxRedirects} redirects`, 'WEB_REDIRECT_BLOCKED')
        }
        const location = response.header('location')
        if (location === null) {
          // A redirect status with no Location is not a usable resource. Cancel
          // the (possibly streaming) body before throwing so no socket leaks.
          await response.cancel()
          throw new WebError(`redirect response (HTTP ${response.status}) without a Location header`, 'WEB_PROVIDER_ERROR')
        }
        const target = resolveRedirect(location, currentUrl)
        // Re-validate the target against everything a direct request gets:
        // transport hygiene, same-origin, and the SSRF guard — a redirect must
        // not be a back door to a blocked or credentialed URL.
        let validatedTarget: URL
        try {
          validatedTarget = validateFetchUrl(target.toString(), limits.maxUrlLength)
          if (!isSameOrigin(validatedTarget, currentUrl)) {
            throw new WebError(
              `cross-origin redirect to ${validatedTarget.origin} is not followed automatically; retry against that URL directly`,
              'WEB_REDIRECT_BLOCKED',
            )
          }
        } catch (error: unknown) {
          await response.cancel()
          throw error
        }
        await response.cancel()
        currentUrl = validatedTarget
        redirectsFollowed++
        continue
      }

      return await this.readBody(response, currentUrl, limits, signal)
    }
  }

  /** Resolve and guard the URL's host, then request it pinned to the checked address. */
  private async requestOnce(url: URL, limits: HttpFetchLimits, signal: AbortSignal): Promise<GuardedResponse> {
    const pinned = await this.pinnedAddressFor(url, signal)
    try {
      return await this.deps.request(url, pinned, signal, {
        'user-agent': limits.userAgent,
        'accept': ACCEPT_HEADER,
      })
    } catch (error: unknown) {
      throw translateAbortOrNetwork(error, signal)
    }
  }

  /**
   * Resolve `url`'s host once, refuse blocked answers, and return the single
   * address the transport must connect to. The literal host is classified
   * without DNS; a name is classified on every DNS answer, and connecting to
   * the checked answer instead of re-resolving closes the rebinding window.
   * @param url - the request URL whose hostname is guarded.
   * @param signal - cancellation signal fused with the fetch deadline.
   * @returns the validated address to connect to.
   */
  private async pinnedAddressFor(url: URL, signal: AbortSignal): Promise<ResolvedAddress> {
    const literal = parseIpLiteral(url.hostname)
    if (literal !== undefined) {
      if (isBlockedIp(literal)) {
        throw new WebError(`blocked non-public address "${url.hostname}"`, 'WEB_BLOCKED_URL')
      }
      return { address: stripLiteralDecorations(url.hostname), family: literal.family }
    }
    let answers: readonly ResolvedAddress[]
    try {
      answers = await this.deps.lookup(url.hostname)
    } catch (error: unknown) {
      throw translateAbortOrNetwork(error, signal)
    }
    if (answers.length === 0) {
      throw new WebError(`dns returned no addresses for "${url.hostname}"`, 'WEB_PROVIDER_ERROR')
    }
    for (const answer of answers) {
      const parsed = parseIpLiteral(answer.address)
      if (parsed === undefined || isBlockedIp(parsed)) continue
      return answer
    }
    throw new WebError(`"${url.hostname}" resolves only to blocked non-public addresses`, 'WEB_BLOCKED_URL')
  }

  /** Read, byte-cap, classify, and decode the final response body. */
  private async readBody(response: GuardedResponse, finalUrl: URL, limits: HttpFetchLimits, signal: AbortSignal): Promise<WebFetchResult> {
    const contentType = response.header('content-type')
    const kind = classifyContentType(contentType)
    if (kind === undefined) {
      await response.cancel()
      throw new WebError(`unsupported content type "${contentType ?? 'unknown'}"`, 'WEB_UNSUPPORTED_CONTENT_TYPE')
    }

    // Resolve the decoder BEFORE reading the body so an unsupported charset
    // fails without consuming the stream — but cancel the body on that failure
    // so the socket does not leak (matching the unsupported-content-type path).
    let decoder: TextDecoder
    try {
      decoder = decoderForCharset(parseCharset(contentType))
    } catch (error: unknown) {
      await response.cancel()
      throw error
    }
    const { bytes, truncatedByBytes } = await this.readCapped(response, limits, signal)
    const decoded = decoder.decode(bytes)
    const truncatedByChars = decoded.length > limits.maxBodyChars
    const content = truncatedByChars ? decoded.slice(0, limits.maxBodyChars) : decoded
    const body: WebFetchBody = kind === 'html' ? { kind: 'html', content } : { kind: 'text', content }

    return {
      url: finalUrl.toString(),
      statusCode: response.status,
      body,
      truncated: truncatedByBytes || truncatedByChars,
    }
  }

  /**
   * Read the response stream up to `maxResponseBytes`. A `Content-Length` over
   * the cap rejects immediately with `WEB_FETCH_TOO_LARGE`; a stream that grows
   * past the cap is cut short (`truncatedByBytes`) rather than rejected, so a
   * server that under-reports still yields a bounded usable body.
   */
  private async readCapped(
    response: GuardedResponse,
    limits: HttpFetchLimits,
    signal: AbortSignal,
  ): Promise<{ bytes: Uint8Array; truncatedByBytes: boolean }> {
    const declared = response.header('content-length')
    if (declared !== null) {
      const length = Number(declared)
      if (Number.isFinite(length) && length > limits.maxResponseBytes) {
        await response.cancel()
        throw new WebError(`response exceeds the maximum of ${limits.maxResponseBytes} bytes`, 'WEB_FETCH_TOO_LARGE')
      }
    }

    const chunks: Uint8Array[] = []
    let total = 0
    let truncatedByBytes = false
    try {
      for (;;) {
        const next = await response.nextChunk()
        if (next.done) break
        const remaining = limits.maxResponseBytes - total
        // Only DROPPED bytes count as truncation: a chunk that exactly fills the
        // remaining capacity keeps all its bytes and we read on to observe EOF,
        // so an exactly-at-cap body is not falsely flagged truncated.
        if (next.value.byteLength > remaining) {
          chunks.push(next.value.subarray(0, remaining))
          total += remaining
          truncatedByBytes = true
          break
        }
        chunks.push(next.value)
        total += next.value.byteLength
      }
    } catch (error: unknown) {
      throw translateAbortOrNetwork(error, signal)
    } finally {
      // A mid-read fault or a cap break leaves the socket unconsumed; cancel is
      // best-effort cleanup after the needed bytes are collected, and must not
      // mask the outcome above.
      await response.cancel().catch(() => {
        // Cancel after a successful read (or after we broke past the cap) is
        // best-effort cleanup; the bytes we need are already collected.
      })
    }

    const bytes = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    return { bytes, truncatedByBytes }
  }
}

/** HTTP redirect status codes that carry a `Location`. */
function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308
}

/** Resolve a (possibly relative) `Location` against the current URL. */
function resolveRedirect(location: string, base: URL): URL {
  try {
    return new URL(location, base)
  } catch (error: unknown) {
    /* v8 ignore next 2 -- URL resolution against a valid absolute base effectively never throws; defensive guard. */
    throw new WebError(`invalid redirect Location "${location}"`, 'WEB_PROVIDER_ERROR', { cause: error })
  }
}

/**
 * Translate a thrown transport/stream error into a `WebError`, classified by
 * the deadline signal rather than the thrown value (which differs by phase:
 * the request phase rejects with the abort reason, while the read phase
 * surfaces a bare `AbortError`). `timeoutOf(signal, 'WEB_FETCH_TIMEOUT')`
 * recovering OUR reason means our timeout fired (`WEB_FETCH_TIMEOUT`); any
 * other abort — an upstream cancel, or a foreign/outer deadline's timeout
 * under nesting — is `WEB_ABORTED`; a throw with the signal NOT aborted is a
 * transport/network failure (`WEB_PROVIDER_ERROR`).
 */
function translateAbortOrNetwork(error: unknown, signal: AbortSignal): WebError {
  const timeout = timeoutOf(signal, 'WEB_FETCH_TIMEOUT')
  if (timeout !== undefined) return new WebError('web fetch timed out', 'WEB_FETCH_TIMEOUT', { cause: timeout })
  if (signal.aborted) return new WebError('web fetch aborted', 'WEB_ABORTED', { cause: error })
  return new WebError(`web fetch failed: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
}
