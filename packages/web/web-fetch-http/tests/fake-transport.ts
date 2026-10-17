/**
 * Scripted DNS/transport doubles shared by the provider and SSRF suites: the
 * guard's decisions are verified against a fake dependency pair, never against
 * a live network.
 */

import type { HttpFetchLimits } from '../src/provider.ts'
import type { GuardedResponse, GuardedRequest, HttpFetchDeps, ResolvedAddress } from '../src/transport.ts'

/** A public, explicitly allowed address the scripted resolver answers with by default. */
export const PUBLIC_V4 = '93.184.216.34'

/** A public literal URL whose hostname is an IP, so no DNS step can run. */
export const PUBLIC_V4_URL = 'http://93.184.216.34/x'

/** A public name the scripted resolver resolves to {@link PUBLIC_V4}. */
export const PUBLIC_NAME = 'public.example.test'

/** The base limits the suites tweak per test. */
export const limits: HttpFetchLimits = {
  maxUrlLength: 2048,
  maxResponseBytes: 5_000_000,
  maxBodyChars: 100_000,
  timeoutMs: 5_000,
  maxRedirects: 5,
  userAgent: 'test-agent/1.0',
}

/** Encode one body chunk. */
export function enc(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

/** One scripted response plus an observable cancel flag. */
export interface ScriptedResponse {
  response: GuardedResponse
  cancelled(): boolean
}

/**
 * Build a `GuardedResponse` from a status, headers, and body chunks. The body
 * replays `chunks` and then reports the end of the stream.
 * @param init - the response parts; `cancelImpl` replaces the cancel
 *   resolution (for rejection tests) and stays observable through `cancelled`.
 */
export function scriptedResponse(init: {
  status: number
  headers?: Record<string, string>
  chunks?: Uint8Array[]
  cancelImpl?: () => Promise<void>
}): ScriptedResponse {
  let cancelled = false
  const queue = [...(init.chunks ?? [])]
  return {
    response: {
      status: init.status,
      header: name => init.headers?.[name.toLowerCase()] ?? null,
      nextChunk: () =>
        Promise.resolve(
          queue.length > 0
            ? { done: false as const, value: queue.shift() as Uint8Array }
            : { done: true as const, value: undefined },
        ),
      cancel: () => {
        cancelled = true
        return init.cancelImpl?.() ?? Promise.resolve()
      },
    },
    cancelled: () => cancelled,
  }
}

/** One request the scripted transport received. */
export interface RecordedRequest {
  url: URL
  pinned: ResolvedAddress
  signal: AbortSignal
  headers: Record<string, string>
}

/**
 * Build the dependency pair with a scripted resolver and responder. The
 * default resolver answers every name with one public IPv4 address; the
 * default responder fails a test that lets the provider request unexpectedly.
 * @param options - `answers` replaces the resolver's answer set,
 *   `lookup` replaces the resolver, `respond` replaces the transport.
 */
export function fakeDeps(options: {
  answers?: readonly ResolvedAddress[]
  lookup?: (hostname: string) => Promise<readonly ResolvedAddress[]>
  respond?: (request: RecordedRequest, index: number) => GuardedResponse | Promise<GuardedResponse>
} = {}): HttpFetchDeps & { calls: RecordedRequest[] } {
  const calls: RecordedRequest[] = []
  const answers = options.answers ?? [{ address: PUBLIC_V4, family: 4 }]
  const lookup = options.lookup ?? (() => Promise.resolve(answers))
  const respond = options.respond ?? (() => { throw new Error('unexpected scripted request') })
  const request: GuardedRequest = async (url, pinned, signal, headers) => {
    const record: RecordedRequest = { url, pinned, signal, headers }
    calls.push(record)
    return await respond(record, calls.length - 1)
  }
  return { lookup, request, calls }
}

/**
 * A never-settling promise the scripted transport and resolver reject when the
 * operation's signal aborts — including a signal that aborted before this
 * helper ran, mirroring the real transport's rejection of a pre-aborted
 * request.
 * @param signal - the operation's fused deadline/caller signal.
 * @param makeError - builds the rejection error at abort time.
 * @returns the pending promise.
 */
export function pendingUntilAbort(signal: AbortSignal, makeError: () => Error = () => new Error('AbortError')): Promise<never> {
  return new Promise((_, reject) => {
    if (signal.aborted) {
      reject(makeError())
      return
    }
    signal.addEventListener('abort', () => reject(makeError()), { once: true })
  })
}
