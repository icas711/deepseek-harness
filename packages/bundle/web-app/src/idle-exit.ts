/**
 * Browser-presence idle exit for the web surface. The browser surface holds
 * its event-downlink upgrades open for as long as a page is alive, so the
 * webserver's upgrade count is the presence signal: once a browser has
 * connected and then stayed away for `idleExitMs`, the exit is requested
 * through the launcher's bounded `appExit` (full tree disposal, then exit) —
 * closing the tab must not leave a `node` process behind. A server no browser
 * has ever connected to never exits: boot-time smokes and headless probing
 * keep a server that was never used.
 * @module @deepseek-ai/dsh-web-app/idle-exit
 */

import type { Context } from '@deepseek-ai/cordis'

/** How often presence is sampled; the exit lands within one poll of the deadline. */
const PRESENCE_POLL_INTERVAL_MS = 30_000

/**
 * Sample presence on an interval and request a bounded exit after the last
 * browser connection has been gone for `idleExitMs`. The poll disposes with
 * the plugin fiber; the interval never holds the process by itself (`unref`).
 * @param ctx - plugin context carrying the webServer service and the
 *   launcher-provided `appExit`.
 * @param idleExitMs - non-negative idle interval; zero callers are refused by
 *   the config schema, and the installer is not mounted at all.
 */
export function installIdleExit(ctx: Context, idleExitMs: number): void {
  let everConnected = false
  let lastPresentAt = Date.now()
  let exiting = false
  const poll = (): void => {
    if (exiting) return
    const present = ctx.get('webServer') !== undefined && ctx.webServer.openUpgradeCount > 0
    if (present) {
      everConnected = true
      lastPresentAt = Date.now()
      return
    }
    if (!everConnected || Date.now() - lastPresentAt < idleExitMs) return
    exiting = true
    console.log(`dsh web: no browser connected for ${Math.round(idleExitMs / 60_000)} min; shutting down`)
    ctx.get('appExit')?.(0)
  }
  const timer = setInterval(poll, PRESENCE_POLL_INTERVAL_MS)
  timer.unref()
  ctx.effect(() => () => { clearInterval(timer) }, 'web-app: idle-exit poll')
}
