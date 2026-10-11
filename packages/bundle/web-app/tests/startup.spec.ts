/**
 * The Web command-line provider over a real Loader tree: its ordinary service
 * releases a consumer whose config reads `ctx.webStartup` directly.
 */

import { createServer, type Server } from 'node:http'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { internals, provideCmdline } from '@deepseek-ai/dsh-cmdline'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  apply, DEFAULT_WEB_PORT, internals as startupInternals,
  probeExistingInstance, WEB_STARTUP_SERVICE, type WebStartupValues,
} from '../src/startup.ts'

/** What one fixture boot observed. */
interface Observed {
  exits: number[]
  out: string
  readerConfig?: unknown
}

const disposers: (() => Promise<void>)[] = []
const opened: string[] = []

afterEach(async () => {
  for (const dispose of disposers.splice(0)) await dispose()
  internals.stdout = process.stdout
  internals.stderr = process.stderr
  startupInternals.probe = async () => undefined
  startupInternals.open = (url) => { opened.push(url) }
})
startupInternals.open = (url) => { opened.push(url) }

/**
 * Mount the real provider and a consumer using injection-ordered config.
 * @param opts - probe stub (defaults to "port free"); a custom probe turns on
 *   the bounded settle, because the halt path never publishes the service.
 *   `singleInstance: false` pins the row's config to skip the gate.
 * @returns the service value and observed consumer/process effects.
 */
async function bootProvider(
  args: string[],
  opts: {
    probe?: (port: number) => Promise<string | undefined>
    singleInstance?: boolean
  } = {},
): Promise<{
  values: WebStartupValues | undefined
  observed: Observed
}> {
  startupInternals.probe = opts.probe ?? (async () => undefined)
  const dir = mkdtempSync(join(tmpdir(), 'dsh-web-startup-'))
  const observed: Observed = { exits: [], out: '' }
  writeFileSync(join(dir, 'reader.mjs'), `
export function apply(_ctx, config) { globalThis.__webStartupObserved.readerConfig = config }
`)
  // Node imports the fixture row outside Vite's source resolver, so delegate
  // to the source-plane plugin already imported by this test.
  writeFileSync(join(dir, 'provider.mjs'), `
export const name = 'web-startup'
export const inject = ['cmdlineArgs']
export const apply = (ctx, config) => globalThis.__webStartupApply(ctx, config)
`)
  const providerRow = [
    '- id: provider',
    `  name: ${pathToFileURL(join(dir, 'provider.mjs')).href}`,
    ...(opts.singleInstance === false ? ['  config:', '    singleInstance: false'] : []),
    '',
  ]
  writeFileSync(join(dir, 'cordis.yml'), [
    '- id: reader',
    `  name: ${pathToFileURL(join(dir, 'reader.mjs')).href}`,
    `  inject: [${WEB_STARTUP_SERVICE}]`,
    '  config:',
    "    host: !!js ctx.webStartup.host ?? '127.0.0.1'",
    '    port: !!js ctx.webStartup.port ?? 3080',
    '    trustedHosts: !!js ctx.webStartup.trustedHosts',
    ...providerRow,
  ].join('\n'))
  const observing = { write: (chunk: string) => { observed.out += chunk; return true } }
  internals.stdout = observing
  internals.stderr = observing
  const globals = globalThis as unknown as {
    __webStartupApply: typeof apply
    __webStartupObserved: Observed
  }
  globals.__webStartupApply = apply
  globals.__webStartupObserved = observed

  const ctx = new Context()
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  provideCmdline(ctx, { args, exit: code => void observed.exits.push(code) })
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(join(dir, 'cordis.yml')).href } })
  if (opts.probe !== undefined) {
    // The halt path never publishes the service, so the consumer row stays
    // pending by design; settle the provider's async gate instead.
    await new Promise((resolve) => { setTimeout(resolve, 200) })
  } else {
    await ctx.loader.await()
  }
  disposers.push(async () => { await ctx.fiber.dispose() })
  return {
    values: ctx.get(WEB_STARTUP_SERVICE) as WebStartupValues | undefined,
    observed,
  }
}

describe('web command-line provider', () => {
  it('publishes each flag and releases direct service expressions', async () => {
    const { values, observed } = await bootProvider([
      '--host', '127.0.0.1',
      '--port', '8080',
      '--trusted-host', 'lab.internal', 'lab-2.internal',
      '--trusted-host', '10.0.0.9',
    ])
    expect(values).toEqual({
      host: '127.0.0.1',
      port: 8080,
      trustedHosts: ['lab.internal', 'lab-2.internal', '10.0.0.9'],
    })
    expect(observed.readerConfig).toEqual(values)
    expect(observed.exits).toEqual([])
  })

  it('leaves deployment values to each consumer when flags omit them', async () => {
    const { values, observed } = await bootProvider([])
    expect(values).toEqual({ trustedHosts: [] })
    expect(observed.readerConfig).toEqual({
      host: '127.0.0.1',
      port: 3080,
      trustedHosts: [],
    })
  })

  it('prints its own help and leaves the consumer pending', async () => {
    const { values, observed } = await bootProvider(['--help'])
    expect(observed.out).toContain('dsh --profile web')
    expect(observed.out).toContain('--trusted-host')
    expect(values).toBeUndefined()
    expect(observed.readerConfig).toBeUndefined()
    expect(observed.exits).toEqual([0])
  })

  it('rejects a non-numeric port before the consumer activates', async () => {
    const { values, observed } = await bootProvider(['--port', 'abc'])
    expect(observed.out).toContain('--port must be a number')
    expect(values).toBeUndefined()
    expect(observed.readerConfig).toBeUndefined()
    expect(observed.exits).toEqual([1])
  })

  it('rejects the intentionally unsupported all-interfaces host before the consumer activates', async () => {
    const { values, observed } = await bootProvider(['--host', '0.0.0.0'])
    expect(observed.out).toContain('--host 0.0.0.0 is intentionally not supported yet for safety: it would expose remote code execution to the network; use 127.0.0.1 instead')
    expect(values).toBeUndefined()
    expect(observed.readerConfig).toBeUndefined()
    expect(observed.exits).toEqual([1])
  })

  it('publishes without probing when the row config turns the gate off', async () => {
    const probeCalls: number[] = []
    const { values } = await bootProvider(['--port', '8081'], {
      singleInstance: false,
      probe: async (port) => { probeCalls.push(port); return `http://127.0.0.1:${String(port)}/` },
    })
    expect(probeCalls).toEqual([])
    expect(values).toEqual({ port: 8081, trustedHosts: [] })
  })

  it('opens the running instance and exits instead of publishing when the port already serves this app', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const { values, observed } = await bootProvider(['--port', '3080'], {
      probe: async port => port === DEFAULT_WEB_PORT ? `http://127.0.0.1:${String(port)}/` : undefined,
    })
    expect(log).toHaveBeenCalledWith(expect.stringContaining('already running at http://127.0.0.1:3080/'))
    log.mockRestore()
    expect(opened).toEqual(['http://127.0.0.1:3080/'])
    expect(observed.exits).toEqual([0])
    expect(values).toBeUndefined()
    expect(observed.readerConfig).toBeUndefined()
  })
})

describe('probeExistingInstance', () => {
  const servers: Server[] = []
  afterEach(async () => {
    for (const server of servers.splice(0)) await new Promise<void>((resolve) => { server.close(() => { resolve() }) })
  })

  /** One HTTP server answering every request with the given status and body. */
  async function listen(status: number, body: string): Promise<number> {
    const server = createServer((_req, res) => {
      res.writeHead(status, { 'content-type': 'text/plain' })
      res.end(body)
    })
    servers.push(server)
    return await new Promise<number>((resolve) => {
      server.listen(0, '127.0.0.1', () => { resolve((server.address() as { port: number }).port) })
    })
  }

  it('recognizes the served boot marker as the running instance', async () => {
    const port = await listen(200, '<html>window.__DSH_BOOT__ = {}</html>')
    await expect(probeExistingInstance(port)).resolves.toBe(`http://127.0.0.1:${String(port)}/`)
  })

  it('recognizes the login-gated 401 body as the running instance', async () => {
    const port = await listen(401, 'unauthorized')
    await expect(probeExistingInstance(port)).resolves.toBe(`http://127.0.0.1:${String(port)}/`)
  })

  it('reads a foreign answer and a closed port as not-this-app', async () => {
    const foreign = await listen(200, '<html>someone else</html>')
    await expect(probeExistingInstance(foreign)).resolves.toBeUndefined()
    // Port 1 on loopback is reserved and refuses immediately on every platform.
    await expect(probeExistingInstance(1)).resolves.toBeUndefined()
  })
})
