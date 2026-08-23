/**
 * Shared OTLP mock collector: a scripted `node:http` listener capturing the
 * REAL SDK export requests (headers + gunzipped JSON bodies) for wire
 * assertions across this package's suites.
 */

import { once } from 'node:events'
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http'
import { gunzipSync } from 'node:zlib'

/** One captured OTLP/HTTP export request. */
export interface Capture {
  headers: IncomingHttpHeaders
  body: OtlpLogsRequest
}

/** Just the slice of ExportLogsServiceRequest JSON these assertions touch. */
export interface OtlpLogsRequest {
  resourceLogs: {
    resource: { attributes: { key: string; value: { stringValue?: string } }[] }
    scopeLogs: {
      scope: { name: string }
      logRecords: {
        timeUnixNano: string
        severityNumber: number
        severityText: string
        attributes?: { key: string; value: Record<string, unknown> }[]
        body?: unknown
      }[]
    }[]
  }[]
}

const servers: Server[] = []

/** Close every collector opened since the last call; run from each spec's afterEach. */
export async function closeCollectors(): Promise<void> {
  for (const server of servers.splice(0)) {
    server.close()
    server.closeAllConnections()
  }
}

/**
 * Start a collector accepting every OTLP logs export.
 * @param beforeRespond - optional per-request gate executed before the 200 is
 *   written (used to stall or sequence exports).
 * @returns the endpoint URL and the captured requests, in arrival order.
 */
export async function mockCollector(
  beforeRespond?: (requestIndex: number) => Promise<void> | void,
): Promise<{ url: string; captures: Capture[] }> {
  const captures: Capture[] = []
  let requestIndex = 0
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', chunk => chunks.push(chunk as Buffer))
    request.on('end', () => {
      const index = requestIndex++
      void (async () => {
        await beforeRespond?.(index)
        const raw = Buffer.concat(chunks)
        const body = request.headers['content-encoding'] === 'gzip' ? gunzipSync(raw) : raw
        captures.push({
          headers: request.headers,
          body: JSON.parse(body.toString()) as OtlpLogsRequest,
        })
        response.writeHead(200, { 'content-type': 'application/json' }).end('{}')
      })()
    })
  })
  servers.push(server)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no port')
  return { url: `http://127.0.0.1:${address.port}/v1/logs`, captures }
}
