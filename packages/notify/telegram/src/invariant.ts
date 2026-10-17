/** Package-owned invariant companion. @module @deepseek-ai/dsh-telegram-notifier/invariant */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-telegram-notifier'

/** Cordis companion plugin name. */
export const name = 'telegram-notifier-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the provider’s guarantees are the transport round-trip,
 * the acknowledge-first update order, and the watcher’s per-pair dedup — all
 * pinned by the unit suites over a substituted transport. The package holds
 * no continuously observable in-process event relation of its own.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package’s invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration’s disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
