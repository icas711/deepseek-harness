/** Package-owned invariant companion. @module @deepseek-ai/dsh-notifier/invariant */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-notifier'

/** Cordis companion plugin name. */
export const name = 'notifier-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the package's guarantees are the durable binding
 * round-trip, the merge-under-lock write, and the single-use code-lifetime
 * rule — all pinned by the unit suites over a stub provider. The seam
 * exposes no continuously observable in-process event relation of its own.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
