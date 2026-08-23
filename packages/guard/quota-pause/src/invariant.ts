/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-quota-pause`.
 * @module @deepseek-ai/dsh-quota-pause/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-quota-pause'

/** Cordis companion plugin name. */
export const name = 'quota-pause-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the pause is private per-agent live state over the
 * session log and inbox projections, both of which carry their own owners'
 * contracts; the pause's own relation (refused turn ⇒ parked input ⇒ resume
 * spends it once) is covered by this package's suite.
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
