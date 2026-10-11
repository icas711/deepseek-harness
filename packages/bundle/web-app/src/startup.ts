/**
 * The web app's command-line provider: it parses the `dsh --profile web` flag
 * family (`--host`, `--port`, `--trusted-host`) and its `--help`
 * text, then provides the immutable values as {@link WEB_STARTUP_SERVICE}.
 * Ordinary rows inject that service before reading it from lazy config.
 *
 * Before publishing, the provider runs the single-instance gate: when a
 * custom-harness surface already answers on the target loopback port, the
 * invocation opens that instance in the default browser and exits instead of
 * colliding with it. Publication of the service is what releases the
 * webserver row, so the gate holds the bind until the probe has spoken.
 * @module @deepseek-ai/dsh-web-app/startup
 */

import { spawn } from 'node:child_process'
import { Command } from 'commander'
import type { Context } from '@deepseek-ai/cordis'
import { parseCmdline } from '@deepseek-ai/dsh-cmdline'
import { UNAUTHORIZED_BODY } from '@deepseek-ai/dsh-host-webserver'
import z from '@deepseek-ai/schemastery'

/** Stable Cordis plugin name. */
export const name = 'web-startup'

/** Services required before the flags can be resolved. */
export const inject = ['cmdlineArgs']

/**
 * Plugin config: knobs of the flag provider itself.
 */
export interface Config {
  /**
   * Run the single-instance gate before publishing the flags (default true).
   * Test lanes and embedders that manage instance identity themselves turn it
   * off, so a boot never opens a browser or exits on their behalf.
   */
  singleInstance: boolean
}

export const Config: z<Config> = z.object({
  singleInstance: z.boolean().default(true),
})

/** Service provided by this ordinary plugin and injected by flag-configured rows. */
export const WEB_STARTUP_SERVICE = 'webStartup'

/**
 * The port the shipped composition serves on when the invocation did not name
 * one (`--port`); the webserver row in the web bundle's patch carries the same
 * literal as its lazy-config default.
 */
export const DEFAULT_WEB_PORT = 3080

/** How long the single-instance probe waits for one answer before treating the port as free. */
const PROBE_TIMEOUT_MS = 1500

/** The boot marker only `dsh web` injects into the served index.html. */
const BOOT_MARKER = '__DSH_BOOT__'

/**
 * What the web rows read from {@link WEB_STARTUP_SERVICE}.
 */
export interface WebStartupValues {
  /** `--host`, absent when the invocation did not name one. */
  host?: string
  /** `--port`, absent when the invocation did not name one. */
  port?: number
  /** Explicit `--trusted-host` authorities, in argument order. */
  trustedHosts: string[]
}

/** The web flag family, as commander parsed it. */
interface WebOptions {
  host?: string
  port?: string
  trustedHost?: string[]
}

/**
 * Whether a custom-harness surface already answers on this loopback port.
 * The marker is the served index's boot injection, or — with the login gate
 * on — the exact 401 body the webserver answers unauthenticated probes with.
 * Any other answer (or no answer) reads as "not this app": the port is free,
 * or something else holds it and the bind will fail loud as before.
 * @param port - the invocation's target port.
 * @param fetchImpl - fetch implementation (tests substitute a stub).
 * @returns the running instance's loopback URL, or undefined.
 */
export async function probeExistingInstance(
  port: number,
  fetchImpl: typeof fetch = fetch,
): Promise<string | undefined> {
  try {
    const response = await fetchImpl(`http://127.0.0.1:${String(port)}/`, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) })
    const body = await response.text()
    if (response.status === 200 && body.includes(BOOT_MARKER)) return `http://127.0.0.1:${String(port)}/`
    if (response.status === 401 && body === UNAUTHORIZED_BODY) return `http://127.0.0.1:${String(port)}/`
    return undefined
  } catch {
    return undefined
  }
}

/**
 * Open one URL in the user's default browser; the detached helper survives
 * this process exiting (the single-instance path exits right after).
 * @param url - the URL to open.
 */
export function openInBrowser(url: string): void {
  const command = process.platform === 'win32' ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open'
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url]
  spawn(command, args, { detached: true, stdio: 'ignore' }).unref()
}

/**
 * This app's command: its flags, its description, and its help text.
 * @returns a fresh program, so one process can parse more than once (tests).
 */
function webCommand(): Command {
  return new Command()
    .name('dsh --profile web')
    .description('Serve the custom-harness browser UI.')
    .helpOption('-h, --help', 'show this help')
    .option('--host <host>', 'bind host')
    .option('--port <port>', `listen port; pass 0 to let the OS pick a free one (default ${String(DEFAULT_WEB_PORT)})`)
    .option('--trusted-host <authority...>', 'extra authority the /api browser-trust fence accepts (host or host:port; repeatable)')
    .addHelpText('after', `
Examples:
  dsh --profile web                          serve on the composed host and port
  dsh --profile web --port 8080              serve on another port
`)
}

/** Test hooks: the probe and the browser open, substitutable in specs so tests never touch the network. */
export const internals: {
  probe: (port: number) => Promise<string | undefined>
  open: (url: string) => void
} = { probe: probeExistingInstance, open: openInBrowser }

/**
 * Parse and provide the Web invocation as an ordinary Cordis service. The
 * command's action publishes the flags this invocation named; `--host 0.0.0.0`
 * or a non-numeric `--port` is a usage error, so on rejection (and on `--help`)
 * nothing is provided.
 *
 * The single-instance gate runs before publication: an already-running
 * instance is opened in the browser and the process exits through the
 * launcher's bounded `appExit`, so the webserver row (which waits on this
 * service) never binds a second time. A probe transport failure publishes
 * anyway and lets the bind speak for itself.
 * @param ctx - plugin context carrying the command line.
 */
export function apply(ctx: Context, pluginConfig: Config | undefined): void {
  const config = Config(pluginConfig)
  const program = webCommand()
  program.action(() => {
    const options = program.opts<WebOptions>()
    if (options.host === '0.0.0.0') {
      program.error('error: --host 0.0.0.0 is intentionally not supported yet for safety: it would expose remote code execution to the network; use 127.0.0.1 instead')
    }
    if (options.port !== undefined && !/^\d+$/.test(options.port)) {
      program.error(`error: --port must be a number, got ${JSON.stringify(options.port)}`)
    }
    const values: WebStartupValues = {
      ...options.host !== undefined && { host: options.host },
      ...options.port !== undefined && { port: Number(options.port) },
      trustedHosts: options.trustedHost ?? [],
    }
    const provide = (): void => { ctx.provide(WEB_STARTUP_SERVICE, values) }
    if (!config.singleInstance) {
      provide()
      return
    }
    void internals.probe(values.port ?? DEFAULT_WEB_PORT).then((existing) => {
      if (existing === undefined) {
        provide()
        return
      }
      console.log(`dsh web: already running at ${existing} — opening it instead of starting a second server`)
      internals.open(existing)
      ctx.get('appExit')?.(0)
    }, () => {
      // The probe could not speak (transport error); the bind answers next.
      provide()
    })
  })
  parseCmdline(ctx, program)
}
