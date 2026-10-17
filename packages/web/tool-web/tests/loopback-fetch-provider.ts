/**
 * A minimal fetch provider over loopback HTTP with the seam's provider face.
 * The tool suites exercise the seam/tool/policy assembly, not the guard, so
 * the adapter skips the real backend's SSRF guard (which refuses loopback
 * destinations by design) and its redirect/limit handling — those are
 * `dsh-web-fetch-http`'s own suites.
 */

import { request as httpRequest } from 'node:http'
import { WebError } from '@deepseek-ai/dsh-web'
import type { WebFetchProvider, WebFetchResult } from '@deepseek-ai/dsh-web'
import { LOCAL_FETCH_PROVIDER_ID } from '@deepseek-ai/dsh-web-fetch-http'

/** Build one loopback fetch provider for a suite's local HTTP servers. */
export function loopbackFetchProvider(): WebFetchProvider {
  return {
    id: LOCAL_FETCH_PROVIDER_ID,
    available: () => true,
    fetch(request, signal) {
      // The provider face's scheme restriction, so callers relying on it see
      // the same structured code the real backend reports.
      const parsed = new URL(request.url)
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return Promise.reject(new WebError(`unsupported URL scheme "${parsed.protocol}" (only http and https are allowed)`, 'WEB_INVALID_URL'))
      }
      return new Promise<WebFetchResult>((resolve, reject) => {
        const req = httpRequest(request.url, { signal }, (res) => {
          const chunks: Buffer[] = []
          res.on('data', (chunk: Buffer) => { chunks.push(chunk) })
          res.on('end', () => {
            const contentType = String(res.headers['content-type'] ?? '')
            resolve({
              url: request.url,
              statusCode: res.statusCode ?? 0,
              body: { kind: contentType.includes('text/html') ? 'html' : 'text', content: Buffer.concat(chunks).toString('utf8') },
              truncated: false,
            })
          })
        })
        req.on('error', (error: Error) => {
          if (signal?.aborted === true) {
            reject(new WebError('web fetch aborted', 'WEB_ABORTED'))
            return
          }
          reject(new WebError(`loopback fetch failed: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error }))
        })
        req.end()
      })
    },
  }
}
